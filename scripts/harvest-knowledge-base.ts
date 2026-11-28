import path from 'path';
import { fileURLToPath } from 'url';
import { MarketStore } from '../server/marketStore.ts';
import { distillAnnualReportWithAi } from '../server/fundamental/annualReportIntelEngine.ts';
import { FundamentalVault } from '../server/fundamental/fundamentalVault.ts';
import { evaluateScreenerUniverse } from '../server/fundamental/investorScoringEngine.ts';
import {
  ALL_AGENCIES,
  RegulatoryKnowledgeBase,
} from '../server/fundamental/regulatoryKnowledgeBase.ts';
import type { RegulatoryAgency } from '../src/types/fundamental.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');

interface CliArgs {
  agencies: RegulatoryAgency[];
  enrichLimit: number;
  distillAnnualLimit: number;
  symbols: string[];
  force: boolean;
  skipEnrich: boolean;
}

function printHelp(): void {
  console.log(`Usage: npx tsx scripts/harvest-knowledge-base.ts [options]

Options:
  --agencies=ALL|ICRA,CARE,...   Comma-separated regulatory agencies (default: ALL)
  --enrich-limit=N               Max symbols to enrich with Gemini grounding if GEMINI_API_KEY is set (default: 15)
  --distill-annual=N             Max companies to distill latest Annual Report via Gemini if missing (default: 4)
  --symbol=NABIL,NTC             Comma-separated ticker symbols to prioritize for enrichment
  --skip-enrich                  Only run direct agency notice crawl (no per-company enrichment)
  --force                        Re-enrich even if enriched within the last 7 days
  --help                         Show this help message
`);
}

function parseArgs(argv: string[]): CliArgs {
  let agencies: RegulatoryAgency[] = [...ALL_AGENCIES];
  let enrichLimit = 15;
  let distillAnnualLimit = 4;
  let symbols: string[] = [];
  let force = false;
  let skipEnrich = false;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith('--agencies=')) {
      const raw = arg.slice('--agencies='.length).trim().toUpperCase();
      if (raw && raw !== 'ALL') {
        const picked = raw
          .split(',')
          .map((s) => s.trim() as RegulatoryAgency)
          .filter((a) => ALL_AGENCIES.includes(a));
        if (picked.length > 0) agencies = picked;
      }
    } else if (arg.startsWith('--enrich-limit=')) {
      const parsed = Number(arg.slice('--enrich-limit='.length));
      if (Number.isFinite(parsed) && parsed >= 0) enrichLimit = Math.min(100, Math.round(parsed));
    } else if (arg.startsWith('--distill-annual=')) {
      const parsed = Number(arg.slice('--distill-annual='.length));
      if (Number.isFinite(parsed) && parsed >= 0) distillAnnualLimit = Math.min(25, Math.round(parsed));
    } else if (arg.startsWith('--symbol=')) {
      symbols = arg
        .slice('--symbol='.length)
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--skip-enrich') {
      skipEnrich = true;
    }
  }

  return { agencies, enrichLimit, distillAnnualLimit, symbols, force, skipEnrich };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = new MarketStore(DATA_DIR);
  const vault = new FundamentalVault(DATA_DIR);
  vault.initIfNeeded();

  const kb = new RegulatoryKnowledgeBase(DATA_DIR);
  kb.initIfNeeded();

  const initialSummary = kb.getSummary();
  console.log(
    `[kb-crawl] Starting Regulatory KB crawl. Agencies=${args.agencies.join(',')} | existingNotices=${initialSummary.totalNotices} | existingCompanies=${initialSummary.totalCompaniesIndexed}`
  );

  const harvestRes = await kb.harvestAgencies(args.agencies, store);
  console.log(
    `[kb-crawl] Agency crawl complete: addedNotices=${harvestRes.addedNotices}, companiesUpdated=${harvestRes.companiesUpdated}, direct=${JSON.stringify(harvestRes.directResults)}`
  );
  if (harvestRes.warnings.length > 0) {
    console.warn(
      `[kb-crawl] Warnings (${harvestRes.warnings.length}): ${harvestRes.warnings.slice(0, 5).join(' | ')}`
    );
  }

  const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());
  if (!args.skipEnrich && hasGemini) {
    const evaluated = evaluateScreenerUniverse(store, vault, {
      equityOnly: true,
      kbMap: kb.getAllCompanyEntries(),
    });
    const staleCutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const orderedCandidates = evaluated.rows
      .filter((r) => r.hasFundamentalData)
      .sort((a, b) => (b.market.turnover ?? 0) - (a.market.turnover ?? 0))
      .map((r) => r.symbol);

    if (args.enrichLimit > 0) {
      let candidateTargets = orderedCandidates;
      if (args.symbols.length > 0) {
        candidateTargets = args.symbols;
      } else if (!args.force) {
        candidateTargets = candidateTargets.filter((sym) => {
          const existing = kb.getCompanyEntry(sym);
          if (!existing?.updatedAt) return true;
          const ts = Date.parse(existing.updatedAt);
          return !Number.isFinite(ts) || ts < staleCutoffMs;
        });
      }

      const batchTargets = candidateTargets.slice(0, args.enrichLimit);
      if (batchTargets.length > 0) {
        console.log(
          `[kb-crawl] Enriching ${batchTargets.length} company dossier(s) via Gemini search grounding...`
        );
        for (let i = 0; i < batchTargets.length; i += 6) {
          const chunk = batchTargets.slice(i, i + 6);
          const enrichRes = await kb.enrichCompanies(chunk, store, vault);
          console.log(
            `[kb-crawl] Batch ${Math.floor(i / 6) + 1}: updated=${enrichRes.updated.length}${
              enrichRes.warnings.length ? ` warnings=${enrichRes.warnings.length}` : ''
            }`
          );
        }
      } else {
        console.log('[kb-crawl] All candidate equity symbols already have fresh (<7d) KB dossiers.');
      }
    }

    if (args.distillAnnualLimit > 0) {
      const annualTargets = (args.symbols.length > 0 ? args.symbols : orderedCandidates).slice(
        0,
        args.distillAnnualLimit
      );
      let distilledCount = 0;
      for (const sym of annualTargets) {
        try {
          const res = await distillAnnualReportWithAi(
            store,
            vault,
            kb,
            sym,
            undefined,
            args.force
          );
          if (!res.cached) distilledCount++;
          console.log(
            `[kb-crawl] Annual Report FY ${res.fiscalYear} for ${sym}: ${res.cached ? 'cached' : 'distilled'}`
          );
        } catch (err) {
          console.warn(
            `[kb-crawl] Annual distill skipped for ${sym}: ${err instanceof Error ? err.message : 'failed'}`
          );
        }
      }
      console.log(`[kb-crawl] Annual report distillation pass complete (${distilledCount} new).`);
    }
  } else if (!args.skipEnrich && !hasGemini) {
    console.log(
      '[kb-crawl] GEMINI_API_KEY not configured — direct regulatory agency HTML crawl completed cleanly (skipping Gemini per-company enrichment & annual distillation).'
    );
  }

  const finalSummary = kb.getSummary();
  console.log(
    `[kb-crawl] Done. totalNotices=${finalSummary.totalNotices} | totalCompaniesIndexed=${finalSummary.totalCompaniesIndexed}`
  );
}

main().catch((err) => {
  console.error('[kb-crawl] Fatal error:', err);
  process.exit(1);
});

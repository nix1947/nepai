import cron, { type ScheduledTask } from 'node-cron';
import fs from 'fs';
import path from 'path';
import type {
  BackfillStatus,
  SchedulerConfig,
  SchedulerLogEntry,
  SchedulerSourceMode,
  SchedulerStatus,
} from '../src/types/market.ts';
import {
  pushDataDirectoryToGitHub,
  syncFromGitHub,
  validateGitHubConfig,
} from './githubSync.ts';
import { isValidDateStr, MarketStore } from './marketStore.ts';
import { ShareSansarClient } from './scraper.ts';

export interface DailyKbRunResult {
  skipped: boolean;
  addedNotices: number;
  companiesUpdated: number;
  enrichedSymbols: string[];
  annualDistilledSymbols: string[];
  quarterlyRefreshed: string[];
  warnings: string[];
  date: string;
}

export type DailyKbHandler = (opts: {
  force?: boolean;
  trigger: 'scheduled' | 'manual';
}) => Promise<DailyKbRunResult>;

const DEFAULT_CONFIG: SchedulerConfig = {
  enabled: true,
  time: '15:40', // After 3:30 PM NPT close
  timezone: 'Asia/Kathmandu',
  days: [1, 2, 3, 4, 5], // Monday - Friday
  retryIfNotUpdated: true,
  retryDelayMinutes: 20,
  sourceMode: 'github',
  githubRepo: 'nix1947/nepai',
  githubBranch: 'main',
  githubDataPath: 'data',
  pushToGitHub: true,
  crawlKbDaily: true,
  autoCrawlOnSearch: true,
  autoPushOnSearchUpdate: true,
};

const VALID_MODES = new Set<SchedulerSourceMode>(['sharesansar', 'github', 'both']);

interface PersistedSchedulerState {
  config: SchedulerConfig;
  history: SchedulerLogEntry[];
  lastKbCrawlDate?: string | null;
  lastGitHubPushDate?: string | null;
  lastGitHubPushAt?: string | null;
}

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function getDatePartsInTz(date: Date, tz: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Sun..6=Sat
  dateStr: string;
} {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour === '24' ? '0' : map.hour);
  const minute = Number(map.minute);
  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: weekdayMap[map.weekday] ?? 0,
    dateStr: `${map.year}-${map.month}-${map.day}`,
  };
}

export class DailyScheduler {
  private readonly statePath: string;
  private readonly store: MarketStore;
  private readonly scraper: ShareSansarClient;
  private config: SchedulerConfig;
  private history: SchedulerLogEntry[] = [];
  private lastKbCrawlDate: string | null = null;
  private lastGitHubPushDate: string | null = null;
  private lastGitHubPushAt: string | null = null;
  private dailyKbHandler: DailyKbHandler | null = null;
  private todaySearchedCounter: (() => number) | null = null;
  private task: ScheduledTask | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private backfill: BackfillStatus = {
    active: false,
    from: null,
    to: null,
    totalDays: 0,
    processedDays: 0,
    savedDays: 0,
    skippedDays: 0,
    failedDays: 0,
    currentDate: null,
    message: '',
  };

  constructor(store: MarketStore) {
    this.store = store;
    this.scraper = new ShareSansarClient();
    this.statePath = path.resolve(store.dataDir, 'scheduler.json');
    if (!this.statePath.startsWith(store.dataDir + path.sep)) {
      throw new Error('Invalid scheduler state path');
    }

    const loaded = this.loadState();
    this.config = loaded.config;
    this.history = loaded.history;
    this.lastKbCrawlDate = loaded.lastKbCrawlDate ?? null;
    this.lastGitHubPushDate = loaded.lastGitHubPushDate ?? null;
    this.lastGitHubPushAt = loaded.lastGitHubPushAt ?? null;
    this.applyCronSchedule();
    this.scheduleStartupSync();
  }

  public setDailyKbHandler(handler: DailyKbHandler): void {
    this.dailyKbHandler = handler;
  }

  public setTodaySearchedCounter(counter: () => number): void {
    this.todaySearchedCounter = counter;
  }

  public markKbCrawledOnDate(dateStr: string): void {
    this.lastKbCrawlDate = dateStr;
    this.saveState();
  }

  private scheduleStartupSync(): void {
    if (!this.config.enabled || this.config.sourceMode !== 'github' || !this.config.githubRepo) {
      return;
    }
    setTimeout(() => {
      void this.startupSyncFromGitHub();
    }, 1500);
  }

  private async startupSyncFromGitHub(): Promise<void> {
    if (this.running || this.config.sourceMode !== 'github' || !this.config.githubRepo) return;
    this.running = true;
    const started = Date.now();
    try {
      const res = await syncFromGitHub(
        this.store,
        {
          repo: this.config.githubRepo,
          branch: this.config.githubBranch,
          dataPath: this.config.githubDataPath,
        },
        false
      );
      if (res.fetchedFiles > 0) {
        this.appendLog({
          trigger: 'github',
          status: 'success',
          tradingDate: res.latestDate,
          rowsSaved: res.totalRows,
          durationMs: Date.now() - started,
          message: `Startup sync: pulled ${res.fetchedFiles} new CSV file(s) (${res.totalRows} rows) from GitHub.`,
        });
      }
    } catch {
      // Quietly ignore transient startup network errors; scheduled cron handles retries.
    } finally {
      this.running = false;
    }
  }

  private loadState(): PersistedSchedulerState {
    if (!fs.existsSync(this.statePath)) {
      return {
        config: { ...DEFAULT_CONFIG },
        history: [],
        lastKbCrawlDate: null,
        lastGitHubPushDate: null,
        lastGitHubPushAt: null,
      };
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf-8')) as Partial<PersistedSchedulerState>;
      const cfg = { ...DEFAULT_CONFIG, ...(raw.config || {}) };
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.time)) cfg.time = DEFAULT_CONFIG.time;
      if (!isValidTimezone(cfg.timezone)) cfg.timezone = DEFAULT_CONFIG.timezone;
      if (!Array.isArray(cfg.days) || cfg.days.length === 0) cfg.days = [...DEFAULT_CONFIG.days];
      if (!VALID_MODES.has(cfg.sourceMode)) cfg.sourceMode = DEFAULT_CONFIG.sourceMode;
      return {
        config: cfg,
        history: Array.isArray(raw.history) ? raw.history.slice(0, 60) : [],
        lastKbCrawlDate: typeof raw.lastKbCrawlDate === 'string' ? raw.lastKbCrawlDate : null,
        lastGitHubPushDate:
          typeof raw.lastGitHubPushDate === 'string' ? raw.lastGitHubPushDate : null,
        lastGitHubPushAt: typeof raw.lastGitHubPushAt === 'string' ? raw.lastGitHubPushAt : null,
      };
    } catch {
      return {
        config: { ...DEFAULT_CONFIG },
        history: [],
        lastKbCrawlDate: null,
        lastGitHubPushDate: null,
        lastGitHubPushAt: null,
      };
    }
  }

  private saveState(): void {
    const payload: PersistedSchedulerState = {
      config: this.config,
      history: this.history.slice(0, 60),
      lastKbCrawlDate: this.lastKbCrawlDate,
      lastGitHubPushDate: this.lastGitHubPushDate,
      lastGitHubPushAt: this.lastGitHubPushAt,
    };
    fs.writeFileSync(this.statePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  private appendLog(entry: Omit<SchedulerLogEntry, 'id' | 'timestamp'>): SchedulerLogEntry {
    const full: SchedulerLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.history.unshift(full);
    if (this.history.length > 60) this.history.length = 60;
    this.saveState();
    return full;
  }

  public recordExternalLog(entry: Omit<SchedulerLogEntry, 'id' | 'timestamp'>): SchedulerLogEntry {
    return this.appendLog(entry);
  }

  public updateConfig(patch: Partial<SchedulerConfig>): SchedulerConfig {
    const next = { ...this.config };
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
    if (typeof patch.time === 'string') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.time)) {
        throw new Error('Time must be in HH:MM 24-hour format');
      }
      next.time = patch.time;
    }
    if (typeof patch.timezone === 'string') {
      if (!isValidTimezone(patch.timezone)) {
        throw new Error(`Invalid timezone: ${patch.timezone}`);
      }
      next.timezone = patch.timezone;
    }
    if (Array.isArray(patch.days)) {
      const cleaned = Array.from(
        new Set(patch.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))
      ).sort((a, b) => a - b);
      if (cleaned.length === 0) {
        throw new Error('Select at least one day of the week');
      }
      next.days = cleaned;
    }
    if (typeof patch.retryIfNotUpdated === 'boolean') {
      next.retryIfNotUpdated = patch.retryIfNotUpdated;
    }
    if (typeof patch.retryDelayMinutes === 'number') {
      next.retryDelayMinutes = Math.max(5, Math.min(120, Math.round(patch.retryDelayMinutes)));
    }
    if (typeof patch.sourceMode === 'string') {
      if (!VALID_MODES.has(patch.sourceMode as SchedulerSourceMode)) {
        throw new Error('Invalid source mode');
      }
      next.sourceMode = patch.sourceMode as SchedulerSourceMode;
    }
    if (typeof patch.githubRepo === 'string') {
      next.githubRepo = patch.githubRepo.trim();
    }
    if (typeof patch.githubBranch === 'string') {
      next.githubBranch = patch.githubBranch.trim() || 'main';
    }
    if (typeof patch.githubDataPath === 'string') {
      next.githubDataPath = patch.githubDataPath.trim() || 'data';
    }
    if (typeof patch.pushToGitHub === 'boolean') {
      next.pushToGitHub = patch.pushToGitHub;
    }
    if (typeof patch.crawlKbDaily === 'boolean') {
      next.crawlKbDaily = patch.crawlKbDaily;
    }
    if (typeof patch.autoCrawlOnSearch === 'boolean') {
      next.autoCrawlOnSearch = patch.autoCrawlOnSearch;
    }
    if (typeof patch.autoPushOnSearchUpdate === 'boolean') {
      next.autoPushOnSearchUpdate = patch.autoPushOnSearchUpdate;
    }

    if ((next.sourceMode === 'github' || next.sourceMode === 'both' || next.pushToGitHub) && next.githubRepo) {
      validateGitHubConfig({
        repo: next.githubRepo,
        branch: next.githubBranch,
        dataPath: next.githubDataPath,
      });
    } else if (next.sourceMode === 'github' && !next.githubRepo) {
      throw new Error('Enter a GitHub repository (owner/repo) for GitHub sync mode.');
    }

    this.config = next;
    this.saveState();
    this.applyCronSchedule();
    return { ...this.config };
  }

  private applyCronSchedule(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (!this.config.enabled) return;

    const [hh, mm] = this.config.time.split(':').map(Number);
    const dow = this.config.days.join(',');
    const expr = `${mm} ${hh} * * ${dow}`;

    this.task = cron.schedule(
      expr,
      () => {
        void this.pullLatest('scheduled', false);
      },
      {
        timezone: this.config.timezone,
      }
    );
  }

  public computeNextRunIso(): string | null {
    if (!this.config.enabled || this.config.days.length === 0) return null;
    const [targetH, targetM] = this.config.time.split(':').map(Number);
    const now = new Date();
    const cursor = new Date(now.getTime());
    cursor.setUTCSeconds(0, 0);
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

    for (let step = 0; step < 8 * 24 * 60; step++) {
      const p = getDatePartsInTz(cursor, this.config.timezone);
      if (
        p.hour === targetH &&
        p.minute === targetM &&
        this.config.days.includes(p.weekday)
      ) {
        return cursor.toISOString();
      }
      cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
    }
    return null;
  }

  public async syncGitHubNow(force = false): Promise<SchedulerLogEntry> {
    if (this.running) {
      return this.appendLog({
        trigger: 'github',
        status: 'skipped',
        tradingDate: null,
        rowsSaved: 0,
        durationMs: 0,
        message: 'GitHub sync skipped because another sync job is already running.',
      });
    }
    if (!this.config.githubRepo) {
      return this.appendLog({
        trigger: 'github',
        status: 'error',
        tradingDate: null,
        rowsSaved: 0,
        durationMs: 0,
        message: 'Configure a GitHub repository (owner/repo) first.',
      });
    }

    this.running = true;
    const started = Date.now();
    try {
      const res = await syncFromGitHub(
        this.store,
        {
          repo: this.config.githubRepo,
          branch: this.config.githubBranch,
          dataPath: this.config.githubDataPath,
        },
        force
      );
      const hasHardError = res.errors.length > 0 && res.fetchedFiles === 0 && res.skippedFiles === 0;
      const msg =
        res.fetchedFiles > 0
          ? `Pulled ${res.fetchedFiles} CSV file(s) (${res.totalRows} rows) from GitHub${
              res.skippedFiles ? `, skipped ${res.skippedFiles} existing` : ''
            }.`
          : res.errors.length > 0
            ? res.errors.join('; ')
            : `GitHub repo is up to date (${res.skippedFiles} file(s) already loaded).`;

      return this.appendLog({
        trigger: 'github',
        status: hasHardError ? 'error' : res.fetchedFiles > 0 ? 'success' : 'skipped',
        tradingDate: res.latestDate,
        rowsSaved: res.totalRows,
        durationMs: Date.now() - started,
        message: msg,
      });
    } catch (err) {
      return this.appendLog({
        trigger: 'github',
        status: 'error',
        tradingDate: null,
        rowsSaved: 0,
        durationMs: Date.now() - started,
        message: `GitHub sync failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      this.running = false;
    }
  }

  public async pushDataToGitHubNow(
    trigger: SchedulerLogEntry['trigger'] = 'manual',
    commitMessage?: string
  ): Promise<{
    committed: boolean;
    filesChanged: number;
    commitSha: string | null;
    message: string;
  }> {
    if (!this.config.githubRepo) {
      throw new Error('Configure a GitHub repository (owner/repo) first.');
    }
    if (!process.env.GITHUB_TOKEN?.trim()) {
      throw new Error('GITHUB_TOKEN is not configured in server Secrets.');
    }
    const started = Date.now();
    const todayNpt = getDatePartsInTz(new Date(), 'Asia/Kathmandu').dateStr;
    try {
      const res = await pushDataDirectoryToGitHub(
        this.store.dataDir,
        {
          repo: this.config.githubRepo,
          branch: this.config.githubBranch,
          dataPath: this.config.githubDataPath,
        },
        commitMessage
      );
      if (res.committed) {
        this.lastGitHubPushDate = todayNpt;
        this.lastGitHubPushAt = new Date().toISOString();
        this.saveState();
      }
      this.appendLog({
        trigger,
        status: res.committed ? 'success' : 'skipped',
        tradingDate: todayNpt,
        rowsSaved: res.filesChanged,
        durationMs: Date.now() - started,
        message: res.message,
      });
      return {
        committed: res.committed,
        filesChanged: res.filesChanged,
        commitSha: res.commitSha,
        message: res.message,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.appendLog({
        trigger,
        status: 'error',
        tradingDate: todayNpt,
        rowsSaved: 0,
        durationMs: Date.now() - started,
        message: `GitHub push failed: ${msg}`,
      });
      throw err;
    }
  }

  public async triggerAutoGitHubPush(
    trigger: SchedulerLogEntry['trigger'] = 'search',
    commitMessage?: string
  ): Promise<{
    attempted: boolean;
    committed: boolean;
    filesChanged: number;
    message: string;
  }> {
    if (!this.config.pushToGitHub || !this.config.githubRepo) {
      return {
        attempted: false,
        committed: false,
        filesChanged: 0,
        message: 'Auto-push to GitHub is disabled or no repository is configured.',
      };
    }
    if (!process.env.GITHUB_TOKEN?.trim()) {
      return {
        attempted: false,
        committed: false,
        filesChanged: 0,
        message: 'GitHub auto-push skipped (GITHUB_TOKEN secret not set on server).',
      };
    }
    try {
      const res = await this.pushDataToGitHubNow(trigger, commitMessage);
      return {
        attempted: true,
        committed: res.committed,
        filesChanged: res.filesChanged,
        message: res.message,
      };
    } catch (err) {
      return {
        attempted: true,
        committed: false,
        filesChanged: 0,
        message: err instanceof Error ? err.message : 'GitHub push failed',
      };
    }
  }

  public async pullLatest(
    trigger: 'scheduled' | 'manual' = 'manual',
    isRetry = false
  ): Promise<SchedulerLogEntry> {
    if (this.running) {
      return this.appendLog({
        trigger,
        status: 'skipped',
        tradingDate: null,
        rowsSaved: 0,
        durationMs: 0,
        message: 'Pull skipped because another sync is already running.',
      });
    }

    this.running = true;
    const started = Date.now();
    const notes: string[] = [];
    let totalRows = 0;
    let latestDate: string | null = null;
    let didWork = false;
    const todayNpt = getDatePartsInTz(new Date(), 'Asia/Kathmandu').dateStr;

    try {
      // 1. Optional GitHub pull (when sourceMode is 'github' or 'both')
      if (
        (this.config.sourceMode === 'github' || this.config.sourceMode === 'both') &&
        this.config.githubRepo
      ) {
        try {
          const gh = await syncFromGitHub(this.store, {
            repo: this.config.githubRepo,
            branch: this.config.githubBranch,
            dataPath: this.config.githubDataPath,
          });
          totalRows += gh.totalRows;
          if (gh.latestDate) latestDate = gh.latestDate;
          if (gh.fetchedFiles > 0) {
            didWork = true;
            notes.push(`GitHub: pulled ${gh.fetchedFiles} file(s) (${gh.totalRows} rows)`);
          } else if (gh.errors.length > 0) {
            notes.push(`GitHub warning: ${gh.errors[0]}`);
          } else {
            notes.push(`GitHub: up to date (${gh.skippedFiles} existing)`);
          }

          // If running scheduled GitHub-only mode and today's CSV isn't on GitHub yet, schedule a retry
          const todayInTz = getDatePartsInTz(new Date(), this.config.timezone).dateStr;
          if (
            this.config.sourceMode === 'github' &&
            trigger === 'scheduled' &&
            !this.store.hasDate(todayInTz) &&
            this.config.retryIfNotUpdated &&
            !isRetry
          ) {
            this.retryTimer = setTimeout(() => {
              void this.pullLatest('scheduled', true);
            }, this.config.retryDelayMinutes * 60 * 1000);
            notes.push(
              `Today's file (${todayInTz}.csv) not on GitHub yet; retrying in ${this.config.retryDelayMinutes} min`
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (this.config.sourceMode === 'github') {
            notes.push(`GitHub pull warning: ${msg}`);
          } else {
            notes.push(`GitHub skipped: ${msg}`);
          }
        }
      }

      // 2. Direct NEPSE EOD pull (when sourceMode is 'sharesansar' or 'both')
      if (this.config.sourceMode === 'sharesansar' || this.config.sourceMode === 'both') {
        const todayInTz = getDatePartsInTz(new Date(), this.config.timezone).dateStr;
        if (trigger === 'scheduled' && this.store.hasDate(todayInTz)) {
          latestDate = latestDate || todayInTz;
          notes.push(`Direct feed: ${todayInTz}.csv already loaded today, skipped`);
        } else {
          try {
            const feed = await this.scraper.fetchLatestOrHoliday();

            if (feed.status === 'no_data') {
              latestDate = latestDate || feed.date;
              notes.push(`Holiday / no trading data: ${feed.reason}`);
            } else {
              const { date, rows } = feed;
              const alreadyLoaded = this.store.hasDate(date);

              if (date < todayInTz && alreadyLoaded) {
                latestDate = latestDate || date;
                if (trigger === 'scheduled' && this.config.retryIfNotUpdated && !isRetry) {
                  this.retryTimer = setTimeout(() => {
                    void this.pullLatest('scheduled', true);
                  }, this.config.retryDelayMinutes * 60 * 1000);
                  notes.push(
                    `Market feed still shows ${date}; retrying in ${this.config.retryDelayMinutes} min`
                  );
                } else {
                  notes.push(`Market closed / latest remains ${date}`);
                }
              } else {
                const saved = this.store.saveDayRows(date, rows);
                totalRows += saved;
                latestDate = date;
                didWork = true;
                notes.push(`Direct feed: saved ${saved} rows for ${date}`);
              }
            }
          } catch (feedErr) {
            notes.push(
              `Direct feed skipped: ${feedErr instanceof Error ? feedErr.message : String(feedErr)}`
            );
          }
        }
      }

      // 3. Once-a-day Regulatory Knowledge Base & Fundamental Crawl
      if (this.config.crawlKbDaily && this.dailyKbHandler) {
        if (this.lastKbCrawlDate === todayNpt) {
          notes.push(`KB crawl: already completed today (${todayNpt}), skipped`);
        } else {
          try {
            const kbRes = await this.dailyKbHandler({ force: false, trigger });
            this.lastKbCrawlDate = kbRes.date || todayNpt;
            this.saveState();
            if (!kbRes.skipped) {
              didWork = true;
              notes.push(
                `KB crawl: +${kbRes.addedNotices} notice(s), ${kbRes.enrichedSymbols.length} enriched, ${kbRes.annualDistilledSymbols.length} annuals, ${kbRes.quarterlyRefreshed.length} quarterly`
              );
            } else {
              notes.push(`KB crawl: skipped for ${todayNpt}`);
            }
          } catch (kbErr) {
            notes.push(
              `KB crawl skipped: ${kbErr instanceof Error ? kbErr.message : String(kbErr)}`
            );
          }
        }
      }

      // 4. Automatic atomic push of all updated data/ (CSVs, financials, regulatory KB) to GitHub
      if (this.config.pushToGitHub && this.config.githubRepo) {
        if (process.env.GITHUB_TOKEN?.trim()) {
          try {
            const pushRes = await pushDataDirectoryToGitHub(
              this.store.dataDir,
              {
                repo: this.config.githubRepo,
                branch: this.config.githubBranch,
                dataPath: this.config.githubDataPath,
              },
              `chore(data): daily NEPSE market & knowledge base sync (${todayNpt})`
            );
            if (pushRes.committed) {
              didWork = true;
              this.lastGitHubPushDate = todayNpt;
              this.lastGitHubPushAt = new Date().toISOString();
              this.saveState();
            }
            notes.push(pushRes.message);
          } catch (pushErr) {
            notes.push(
              `GitHub push skipped: ${pushErr instanceof Error ? pushErr.message : String(pushErr)}`
            );
          }
        } else {
          notes.push('GitHub push pending (add GITHUB_TOKEN secret to enable auto-push)');
        }
      }

      return this.appendLog({
        trigger,
        status: didWork || totalRows > 0 ? 'success' : 'skipped',
        tradingDate: latestDate ?? todayNpt,
        rowsSaved: totalRows,
        durationMs: Date.now() - started,
        message: notes.join(' · ') || 'Completed daily check.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.appendLog({
        trigger,
        status: 'error',
        tradingDate: latestDate,
        rowsSaved: totalRows,
        durationMs: Date.now() - started,
        message: `Fetch failed: ${msg}`,
      });
    } finally {
      this.running = false;
    }
  }

  public startBackfill(from: string, to: string, force = false): BackfillStatus {
    if (!isValidDateStr(from) || !isValidDateStr(to)) {
      throw new Error('From and To dates must be YYYY-MM-DD');
    }
    if (from > to) {
      throw new Error('Start date must be before or equal to end date');
    }
    if (this.backfill.active) {
      return { ...this.backfill };
    }

    const dates: string[] = [];
    const cur = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    while (cur <= end) {
      const dow = cur.getUTCDay();
      if (dow !== 0 && dow !== 6) {
        dates.push(cur.toISOString().slice(0, 10));
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    if (dates.length > 180) {
      throw new Error('Backfill range cannot exceed 180 trading days per batch.');
    }

    this.backfill = {
      active: true,
      from,
      to,
      totalDays: dates.length,
      processedDays: 0,
      savedDays: 0,
      skippedDays: 0,
      failedDays: 0,
      currentDate: dates[0] ?? null,
      message: `Starting backfill of ${dates.length} candidate trading days…`,
    };

    void this.runBackfillLoop(dates, force);
    return { ...this.backfill };
  }

  private async runBackfillLoop(dates: string[], force: boolean): Promise<void> {
    const started = Date.now();
    let session: Awaited<ReturnType<ShareSansarClient['createSession']>> | undefined;
    try {
      session = await this.scraper.createSession();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.backfill.active = false;
      this.backfill.message = `Could not connect to market feed: ${msg}`;
      this.appendLog({
        trigger: 'backfill',
        status: 'error',
        tradingDate: null,
        rowsSaved: 0,
        durationMs: Date.now() - started,
        message: this.backfill.message,
      });
      return;
    }

    let totalRows = 0;
    for (const d of dates) {
      this.backfill.currentDate = d;
      if (!force && this.store.hasDate(d)) {
        this.backfill.skippedDays++;
        this.backfill.processedDays++;
        this.backfill.message = `Skipped ${d} (already loaded)`;
        continue;
      }

      try {
        const res = await this.scraper.fetchByDate(d, session);
        session = res.session;
        if (res.rows.length > 0) {
          totalRows += this.store.saveDayRows(d, res.rows);
          this.backfill.savedDays++;
          this.backfill.message = `Saved ${res.rows.length} rows for ${d}`;
        } else {
          this.backfill.skippedDays++;
          this.backfill.message = `No trading data on ${d} (holiday/closed)`;
        }
      } catch {
        this.backfill.failedDays++;
        this.backfill.message = `Failed fetching ${d}`;
      }

      this.backfill.processedDays++;
      await new Promise((r) => setTimeout(r, 950));
    }

    this.backfill.active = false;
    this.backfill.currentDate = null;
    this.backfill.message = `Completed: ${this.backfill.savedDays} saved, ${this.backfill.skippedDays} skipped, ${this.backfill.failedDays} failed.`;

    this.appendLog({
      trigger: 'backfill',
      status: this.backfill.failedDays > 0 && this.backfill.savedDays === 0 ? 'error' : 'success',
      tradingDate: `${this.backfill.from} → ${this.backfill.to}`,
      rowsSaved: totalRows,
      durationMs: Date.now() - started,
      message: this.backfill.message,
    });
  }

  public getStatus(): SchedulerStatus {
    return {
      config: { ...this.config },
      isRunning: this.running,
      hasGitHubToken: Boolean(process.env.GITHUB_TOKEN?.trim()),
      nextRunIso: this.computeNextRunIso(),
      lastRun: this.history[0] ?? null,
      history: [...this.history],
      loadedDates: this.store.getDates(),
      lastKbCrawlDate: this.lastKbCrawlDate,
      lastGitHubPushDate: this.lastGitHubPushDate,
      lastGitHubPushAt: this.lastGitHubPushAt,
      todaySearchedSymbolsCount: this.todaySearchedCounter ? this.todaySearchedCounter() : 0,
    };
  }

  public getBackfillStatus(): BackfillStatus {
    return { ...this.backfill };
  }
}

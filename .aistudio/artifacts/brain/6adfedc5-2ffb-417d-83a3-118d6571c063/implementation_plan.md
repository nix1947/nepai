# NEPSE Auto Analyzer — Deterministic Price-Action, SMC & ICT Workbench

Builds a deterministic, config-driven **Auto Analyzer** section accessible from a new sidebar menu item. It inspects any NEPSE-listed stock across Daily, Weekly, and Monthly timeframes on loaded end-of-day data, renders toggleable ICT, SMC, Price Action, Chart Pattern, Supply/Demand, Liquidity, and Range overlays directly onto a Lightweight Charts canvas via custom primitives, scores causal trade setups (`A/B/C`), proves zero look-ahead via bar-by-bar Replay, scans the market for today's qualifying Grade A/B setups, and sends entry, stop, and target parameters directly into the NEPSE Trade Planner.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The four choices confirmed during clarification override conflicting defaults and establish the active baseline behavior below.

- **Confirmed Default Overlays**: On first load, **Core Structure + FVG/OB + Liquidity** (swings, HH/HL/LH/LL, BOS/CHoCH/MSS, unmitigated FVGs & Order Blocks, key liquidity levels & sweeps, and entry/SL/TP box) are enabled by default; all secondary overlays (IFVG, BPR, Breaker/Unicorn/Propulsion, Premium/Discount & OTE, Chart Patterns, S/R Zones, Trendlines, Supply/Demand, and Experimental Wyckoff) remain toggleable via layer checkboxes and persisted in settings.
- **Confirmed Default View State**: Auto Analyzer initializes on the **Daily (`1D`)** chart with **All Strategies (`All`)** selected, keeping Weekly (`1W`) and Monthly (`1M`) HTF bias computed in parallel.
- **Confirmed NEPSE Long-Only Policy**: Because NEPSE retail accounts cannot short-sell equities, bearish setups (e.g., Sweep-High MSS Bearish, Bearish OB, Turtle Soup High) are surfaced as **Exit / Profit-Take Warnings** when inspecting individual stocks and excluded from actionable long buy results in Market Scan.
- **Confirmed API Protection (`x-api-key`)**: No API-key middleware currently exists in the server; `/api/analyzer/*` routes enforce `x-api-key` checking strictly on the server only when the `NEPSE_API_KEY` environment variable is configured, while remaining open like existing endpoints when unset and enforcing strict schema/bounds validation on every parameter.

---

### 1. Overview & Core Concept

- **What It Does**: Provides a unified charting and quantitative structure analyzer under a new **Auto Analyzer** sidebar entry. For any stock and timeframe (`1D`, `1W`, `1M`), it deterministically extracts market structure, imbalances, institutional order-block zones, liquidity pools & sweeps, Fibonacci/OTE ranges, chart/candle patterns, Supply/Demand zones, and experimental Wyckoff phases, then synthesizes actionable setups with scored checklists, narrative explanations, key levels, hold-out backtest metrics, PNG/JSON export, and interactive bar-by-bar Replay.
- **Honest EOD & NEPSE Guardrails**:
  - Clearly discloses in the top banner that NEPSE data is **End-of-Day (EOD) only**; intraday ICT models (session killzones, Silver Bullet windows, 5m/15m entries) are explicitly shown as *Not Available (EOD Only)* alongside their valid Daily/Weekly equivalents (**Weekly Open, Power of 3, PDH/PDL, PWH/PWL, PMH/PML, and 20/40/60-day ranges**).
  - Applies NEPSE constraints automatically: flags `±10%` upper/lower circuit-locked sessions, rounds prices to the `Rs 0.10` exchange tick size, flags large corporate-action/bonus/right adjustment gaps (`>= 12%` overnight open dislocation with low turnover disruption) so they are never misclassified as Fair Value Gaps, and evaluates stock liquidity before grading.
  - Guarantees **zero look-ahead bias**: swing pivots at bar `i` only become visible at bar `i + n`, so slicing history up to any `asOf` date yields identical prior detections. Users can step forward bar-by-bar in **Replay Mode** to inspect confirmation timing live.
- **Target Persona**: Active NEPSE swing and positional traders evaluating clean technical structure, institutional footprint confluence, and exact post-fee risk/reward before placing orders.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Single-Stock Chart Inspection**: Select any NEPSE ticker (`⌘K`/picker), pick timeframe (`Daily`, `Weekly`, `Monthly`) and strategy lens (`All`, `ICT`, `SMC`, `Price Action`, `Wyckoff`), toggle concept overlays, hover or inspect scored `Setup[]` cards in the right rail, and click **"Send to NEPSE Trade Planner"** to populate fee-adjusted share quantity and net breakeven/target calculations below the chart.
  2. **Zero-Look-Ahead Replay Mode**: Toggle **Replay**, rewind to any historical date, and step (`-1`, `+1`, `Play/Pause`) through candles; chart primitives dynamically draw swings, BOS/MSS, FVGs, Order Blocks, liquidity sweeps (`✕`), and emerging setups strictly using confirmed bars available at that stepped date.
  3. **Market-Wide Setup Scan**: Switch to **Scan Today** mode inside Auto Analyzer to scan active NEPSE stocks on the latest EOD date for qualifying Grade `A (≥ 75)` and `B (60–74)` long setups, click any result to load its full chart overlays, or export full structured diagnostics as **JSON** or a chart snapshot as **PNG**.
- **Visual Identity & Design Tokens**:
  - Matches the existing NEPSE Workbench **SaaS Analytical Workspace** language: hairline `1px` borders (`border-slate-200 dark:border-slate-800`), crisp neutral canvas (`bg-slate-50 dark:bg-slate-950` with `bg-white dark:bg-slate-900` containers), monospace tabular numbers (`font-mono tabular-nums`), unboxed text-with-dot metadata hierarchy (avoiding decorative badge clutter), and balanced light/dark semantic accents (`emerald` bullish/long, `red` invalidation/exit warning, `amber` caution/inducement, `blue` active POI/structure).
  - Full viewport layout allocates ~68% width (`xl:col-span-8`) to the primary interactive Lightweight Charts canvas, Replay scrub bar, and toggle strip, and ~32% (`xl:col-span-4`) to the tabbed right inspector (M/W/D Bias, Scored Setups & Checklists, Key Levels & Narrative, Warnings & Backtest), followed below by the integrated NEPSE Trade Planner.
  - Footer explicitly displays: *"Educational analysis on end-of-day data. Not investment advice."*

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Lightweight Charts Custom Primitives (`ISeriesPrimitive`) vs. Static SVG Overlays**
  - *Chosen Approach*: Implement custom `ISeriesPrimitive` canvas renderers attached to the candlestick series for shaded FVG/OB/Breaker/Supply-Demand rectangles extending right until mitigated (plus 50% CE dashed midlines), horizontal liquidity rays terminating at sweep bars with a `✕` marker, diagonal trendlines/channel envelopes, and entry/SL/TP risk-reward boxes—paired with `createSeriesMarkers` for swing (`HH/HL/LH/LL`), `BOS`, `CHoCH`, `MSS`, candlestick patterns, and `✕` sweep markers.
  - *Why*: Native canvas primitives zoom, pan, and rescale synchronously with Lightweight Charts at 60fps and preserve clean PNG canvas export, whereas separate SVG layers drift on zoom.
- **Decision 2 — Pure Functional Server Engine + Parameterized Config**
  - *Chosen Approach*: Build all analytical modules as pure functions under `server/analyzer/` driven by an explicit `AnalyzerConfig` object (`swingLeft`, `swingRight`, `atrPeriod`, `fvgMinAtr`, `displacementBodyAtr`, `eqTolerancePct`, scoring weights, and penalty caps) and expose them via cached/validated REST routes.
  - *Why*: Keeping detectors pure allows deterministic unit tests and strict look-ahead invariance tests across prefixes `[0..k]` without HTTP or file I/O overhead.
- **Decision 3 — Corporate-Action Gap Protection & Optional `x-api-key`**
  - *Chosen Approach*: Apply a deterministic overnight gap heuristic (flagging sharp overnight drops/jumps matching bonus/right ex-date signatures so they mark an informational "Possible Corp Action Gap" instead of an active FVG or invalidating structure), and enforce `x-api-key` validation using constant-time comparison only when `process.env.NEPSE_API_KEY` is defined (no client-side key input UI; empty placeholder documented in `.env.example`).
  - *Why*: Preserves zero-friction preview usability while providing authentic server-side key gating and protecting technical zone quality on NEPSE adjusted/ex-date price series.

---

### 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Auto Analyzer View (SPA)                          │
│  ┌───────────────────────────────────┐  ┌────────────────────────────┐  │
│  │ Toolbar: Ticker · 1D/1W/1M ·      │  │ Right Rail Inspector       │  │
│  │ Strategy Tabs · Replay · Settings │  │ · M/W/D HTF Alignment      │  │
│  ├───────────────────────────────────┤  │ · Scored Setup[] + Weights │  │
│  │ Lightweight Charts v5 Canvas      │  │ · Exit/TP Bearish Warnings │  │
│  │ + Custom ISeriesPrimitive Layers  │  │ · Narrative & Key Levels   │  │
│  │   (Zones, Rays+✕, Trend, RR Box)  │  │ · Hold-Out Backtest Metrics│  │
│  ├───────────────────────────────────┤  └────────────────────────────┘  │
│  │ Integrated NEPSE Trade Planner (Prefilled Entry / Stop / Target)     │
│  │ + Today's Grade A/B Market Scan Table + JSON/PNG Export Controls     │
└──┴───────────────────────────────────────────────────────────────────┴──┘
                                    │ HTTP GET (validated params + optional x-api-key)
┌───────────────────────────────────▼─────────────────────────────────────┐
│                Express API Middleware & Analyzer Routes                 │
│  x-api-key Guard (active if NEPSE_API_KEY set) + Bounds Validation      │
│  · GET /api/analyzer/:symbol?tf=&strategy=&asOf=                        │
│  · GET /api/analyzer/scan?tf=&strategy=&asOf=&minGrade=                 │
│  · GET /api/analyzer/backtest?tf=&strategy=&holdoutPct=                 │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ Read-only EOD slices up to `asOf`
┌───────────────────────────────────▼─────────────────────────────────────┐
│              Pure Deterministic Analyzer Engine (No I/O)                │
│  OHLCV Aggregator (1D→1W/1M) + Circuit/Tick/Corp-Action Guard           │
│    ├─ swings + structure (HH/HL/LH/LL, BOS, CHoCH, MSS, Displacement)   │
│    ├─ imbalance (FVG, CE 50%, IFVG, BPR, Vol Imbalance, Voids, Gaps)    │
│    ├─ orderblocks (OB, Breaker, Mitigation, Rejection, Propulsion, Unic)│
│    ├─ liquidity (BSL/SSL, EQH/EQL, PDH/PWH/PMH/52w, Sweeps, IDM, TS)    │
│    ├─ premiumDiscount (Eq, OTE 0.62–0.79, Fib Retrace/Ext)              │
│    ├─ priceAction (Candles, S/R, Trendlines, Chart Patterns, VSA)       │
│    ├─ zones (RBR/DBD/RBD/DBR Supply/Demand + Experimental Wyckoff)      │
│    └─ strategies -> confluence (0–100, A/B/C) -> tradePlan -> backtest  │
└─────────────────────────────────────────────────────────────────────────┘
```

- **State & Caching Model**:
  - UI layer holds selected symbol, timeframe (`1D` default), strategy (`All` default), overlay visibility mask (defaulting to Core Structure + FVG/OB + Liquidity), `AnalyzerConfig` overrides, and optional Replay bar index (`asOf` timestamp driving live server/replay slicing). Overlay preferences persist locally while trading calculations stay deterministic.
  - Server layer slices `MarketStore` symbol histories strictly up to `asOf` before weekly/monthly OHLCV aggregation so neither higher-timeframe candles nor swing/FVG/liquidity detectors can ever peek at future bars.
- **Security & Validation Safeguards**:
  - Route parameters (`symbol` regex, `tf` enum `1D|1W|1M`, `strategy` enum, valid `YYYY-MM-DD` `asOf`, numeric config bounds) are validated before hitting the engine, preventing path traversal or DoS via extreme lookback inputs.
  - `x-api-key` verification runs strictly on the server against `process.env.NEPSE_API_KEY` (only enforced when configured; placeholder added cleanly to `.env.example`, zero secret exposure to client bundles).
- **Verification & Automated Test Coverage**:
  - Configure `npm test` (`tsx --test`) covering unit assertions on Weekly/Monthly OHLCV aggregation, non-repainting Swing confirmation at `i + n`, BOS vs. CHoCH vs. MSS transitions, FVG & mitigation tracking, Order Block / Unicorn qualification, liquidity sweep (`✕`) classification, and a prefix **no-look-ahead property test** asserting `detect(bars[0..k])` history up to confirmed `k - n` matches `detect(bars[0..k+m])`.
  - Run hold-out chronological backtest reporting exact sample sizes (`N`) and out-of-sample metrics, followed by `npx tsc --noEmit`, `npm test`, `npm run build` (Vite), and a live headless-browser smoke test against port 3000.

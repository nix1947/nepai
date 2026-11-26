# NEPSE Turnover & Scanner Workbench

Full-stack analytics, algorithmic stock scanner, and capital-flow workbench for the Nepal Stock Exchange (NEPSE), powered by ShareSansar end-of-day CSV market data (`data/YYYY-MM-DD.csv`).

## Features

- **Market Overview & Market Pulse**: Daily turnover, advance/decline breadth, gainers/losers, high-volume/low-trade block alerts, and intraday VWAP vs. close dispersion.
- **Turnover × Direction (Momentum & Distribution Finder)**: Isolates the top `X%` highest-turnover equities and scores momentum (`0–100`) across turnover dominance, price expansion, green-day consistency, VWAP & close conviction, and MA120/52-week trend alignment—with Buying vs. Selling capital flow balance and shaded quadrants.
- **Top Turnover & Mon–Fri Weekly Heatmap**: Period turnover rankings and Monday–Friday multi-week capital rotation tracking.
- **8 Algorithmic Technical Scanners**:
  - Consolidation → Volume Breakout (`+ Setups`)
  - Support + Volume Breakout
  - Heavy Selloff at Resistance
  - High Breakout (`N`-Day Donchian)
  - Support Breakdown (Bearish)
  - Quiet Accumulation
  - Near 52-Week High
  - Relative Strength Leaders
- **Stock Explorer & NEPSE Trade Planner**: Candlestick/OHLC history, technical overlays (`MA120`, `MA180`, `VWAP`), watchlist starring, quick `⌘K` ticker jump, CSV export, and SEBON broker/DP/CGT buy-sell break-even calculator.
- **Algorithm Reference & Interactive Score Lab**: Step-by-step execution pipelines, worked NEPSE numerical examples, a real-time What-If Conviction Score Simulator, and a Live Stock Step-by-Step Formula Tracer.
- **Automated Daily Sync**: GitHub Actions pulls ShareSansar daily share prices Monday–Friday after `15:30 NPT` (`data/YYYY-MM-DD.csv`), and the local app syncs cleanly from GitHub at `15:40 NPT` (or on demand).

---

## Prerequisites

- **Node.js** `20.x` or `22.x` (recommended `22+`)
- **npm** (comes with Node.js) or **Git**

---

## Download & Run Locally

### 1. Clone or Download the Repository

Using Git:

```bash
git clone https://github.com/nix1947/nepai.git
cd nepai
```

Or click **Code → Download ZIP** on GitHub, extract the archive, and open a terminal inside the extracted `nepai` folder.

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables (Optional)

Copy `.env.example` to `.env` if you want to customize tokens or data paths:

```bash
cp .env.example .env
```

Available variables:

| Variable | Required | Description |
| --- | --- | --- |
| `GITHUB_TOKEN` | Optional | GitHub Personal Access Token (`contents: read/write`) needed only for private repos or pushing changes back to GitHub. |
| `NEPSE_DATA` | Optional | Custom directory path for `YYYY-MM-DD.csv` files (defaults to `./data`). |

> You do **not** need `GEMINI_API_KEY` or `GITHUB_TOKEN` just to run the workbench locally on public `nix1947/nepai` data or local CSVs.

### 4. Start the Local Server

```bash
npm run dev
```

Open your browser to:

```text
http://localhost:3000
```

---

## Loading & Updating Market Data

You have three ways to populate historical and daily NEPSE CSV files in `data/`:

1. **GitHub Auto-Sync (Recommended)**: Open **Scheduler & Data** in the sidebar and click **Sync from GitHub** to pull all `YYYY-MM-DD.csv` files from `nix1947/nepai`.
2. **Pull Latest or Backfill from ShareSansar (CLI or UI)**:
   - In the UI: Click **Pull Latest** in the top bar or run a date-range backfill in **Scheduler & Data**.
   - In the terminal:
     ```bash
     npx tsx scripts/pull-sharesansar.ts
     ```
3. **Import Local CSVs**: Drop ShareSansar `YYYY-MM-DD.csv` files directly into `./data/` (or upload them via **Scheduler & Data**).

> Multi-week scanners (e.g. Consolidation Breakout, Relative Strength, 20-day Breakouts) require `15–25+` trading sessions in `data/`. Use the backfill tool in **Scheduler & Data** or load historical CSVs to unlock full scanner coverage.

---

## Production Build

To build and serve the optimized production bundle locally on port `3000`:

```bash
npm run build
NODE_ENV=production npx tsx server.ts
```

## Available Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Express API + Vite dev server on `http://localhost:3000` |
| `npm run build` | Build frontend assets into `dist/` |
| `npm run lint` | Run TypeScript typechecking (`tsc --noEmit`) |
| `npx tsx scripts/pull-sharesansar.ts` | Fetch the latest ShareSansar EOD table into `data/` |

## Project Structure

```text
├── .github/workflows/daily-sharesansar.yml  # Mon–Fri automated ShareSansar pull
├── data/                                    # Daily NEPSE CSVs (YYYY-MM-DD.csv)
├── scripts/pull-sharesansar.ts              # Standalone ShareSansar scraper CLI
├── server/                                  # Market store, scanners, scheduler, GitHub sync
├── src/                                     # React + Tailwind v4 frontend views & charts
├── server.ts                                # Express + Vite server entrypoint (port 3000)
└── package.json
```

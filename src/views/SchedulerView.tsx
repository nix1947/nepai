import React, { useEffect, useState } from 'react';
import { CalendarClock, Download, GitBranch, Play, RefreshCw, Trash2, Upload } from 'lucide-react';
import { DataTable, type ColumnDef } from '../components/DataTable';
import type {
  BackfillStatus,
  SchedulerLogEntry,
  SchedulerSourceMode,
  SchedulerStatus,
} from '../types/market';
import { formatDateTimeLocal, formatTimeUntil } from '../utils/format';

interface SchedulerViewProps {
  onDataChanged: () => void;
}

const WEEKDAYS = [
  { id: 0, label: 'Sun' },
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
];

export const SchedulerView: React.FC<SchedulerViewProps> = ({ onDataChanged }) => {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [backfill, setBackfill] = useState<BackfillStatus | null>(null);

  // Form states synced from backend config
  const [enabled, setEnabled] = useState(true);
  const [time, setTime] = useState('15:40');
  const [timezone, setTimezone] = useState('Asia/Kathmandu');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [retryIfNotUpdated, setRetryIfNotUpdated] = useState(true);
  const [retryDelayMinutes, setRetryDelayMinutes] = useState(20);
  const [sourceMode, setSourceMode] = useState<SchedulerSourceMode>('github');
  const [githubRepo, setGithubRepo] = useState('nix1947/nepai');
  const [githubBranch, setGithubBranch] = useState('main');
  const [githubDataPath, setGithubDataPath] = useState('data');
  const [pushToGitHub, setPushToGitHub] = useState(false);

  // Backfill states
  const todayIso = new Date().toISOString().slice(0, 10);
  const monthStartIso = `${todayIso.slice(0, 8)}01`;
  const [bfFrom, setBfFrom] = useState(monthStartIso);
  const [bfTo, setBfTo] = useState(todayIso);
  const [bfForce, setBfForce] = useState(false);

  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [syncingGh, setSyncingGh] = useState(false);
  const [pushingProj, setPushingProj] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ghAccount, setGhAccount] = useState<{
    authenticated: boolean;
    login: string | null;
    repos: Array<{ full_name: string; private: boolean; default_branch: string; html_url: string }>;
  } | null>(null);
  const [pushRepoName, setPushRepoName] = useState('nepse-turnover-workbench');
  const [pushBranchName, setPushBranchName] = useState('main');
  const [pushPrivate, setPushPrivate] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

  const loadStatus = async () => {
    const res = await fetch('/api/scheduler/status');
    const data = await res.json();
    setStatus(data);
    setBackfill(data.backfill ?? null);
    if (data.config) {
      setEnabled(data.config.enabled);
      setTime(data.config.time);
      setTimezone(data.config.timezone);
      setDays(data.config.days);
      setRetryIfNotUpdated(data.config.retryIfNotUpdated);
      setRetryDelayMinutes(data.config.retryDelayMinutes);
      setSourceMode(data.config.sourceMode || 'sharesansar');
      setGithubRepo(data.config.githubRepo || '');
      setGithubBranch(data.config.githubBranch || 'main');
      setGithubDataPath(data.config.githubDataPath || 'data');
      setPushToGitHub(Boolean(data.config.pushToGitHub));
      if (data.config.githubRepo && !pushRepoName) {
        setPushRepoName(data.config.githubRepo);
      }
    }
    if (data.hasGitHubToken) {
      fetch('/api/github/account')
        .then((r) => r.json())
        .then((acc) => setGhAccount(acc))
        .catch(() => null);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  // Poll backfill progress while active
  useEffect(() => {
    if (!backfill?.active) return;
    const timer = setInterval(async () => {
      const res = await fetch('/api/scraper/backfill/status');
      const bf: BackfillStatus = await res.json();
      setBackfill(bf);
      if (!bf.active) {
        await loadStatus();
        onDataChanged();
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [backfill?.active]);

  const saveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch('/api/scheduler/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          time,
          timezone,
          days,
          retryIfNotUpdated,
          retryDelayMinutes,
          sourceMode,
          githubRepo,
          githubBranch,
          githubDataPath,
          pushToGitHub,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save schedule');
      setNotice({ kind: 'success', text: 'Daily scheduler and GitHub sync settings saved.' });
      await loadStatus();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const pullNow = async () => {
    setPulling(true);
    setNotice(null);
    try {
      const res = await fetch('/api/scraper/latest', { method: 'POST' });
      const data = await res.json();
      const entry: SchedulerLogEntry = data.entry;
      setNotice({
        kind: entry.status === 'error' ? 'error' : 'success',
        text: entry.message,
      });
      await loadStatus();
      if (entry.status === 'success') onDataChanged();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Pull failed' });
    } finally {
      setPulling(false);
    }
  };

  const syncGitHubNow = async () => {
    setSyncingGh(true);
    setNotice(null);
    try {
      // Save repo settings first if edited
      if (githubRepo.trim()) {
        const saveRes = await fetch('/api/scheduler/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ githubRepo, githubBranch, githubDataPath }),
        });
        if (!saveRes.ok) {
          const errData = await saveRes.json();
          throw new Error(errData.error || 'Invalid GitHub repository settings');
        }
      }
      const res = await fetch('/api/github/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      const data = await res.json();
      const entry: SchedulerLogEntry = data.entry;
      setNotice({
        kind: entry.status === 'error' ? 'error' : 'success',
        text: entry.message,
      });
      await loadStatus();
      if (entry.status === 'success') onDataChanged();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'GitHub sync failed' });
    } finally {
      setSyncingGh(false);
    }
  };

  const pushProject = async () => {
    setPushingProj(true);
    setNotice(null);
    try {
      const target = pushRepoName.trim() || githubRepo.trim();
      const res = await fetch('/api/github/push-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: target,
          branch: pushBranchName.trim() || 'main',
          isPrivate: pushPrivate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to push project to GitHub');
      setNotice({
        kind: 'success',
        text: `${data.result.createdRepo ? 'Created' : 'Updated'} ${data.result.repoFullName} (${data.result.filesUploaded} files committed). GitHub Actions handles daily ShareSansar pulls and this app syncs from GitHub.`,
      });
      await loadStatus();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Push failed' });
    } finally {
      setPushingProj(false);
    }
  };

  const startBackfill = async () => {
    setNotice(null);
    try {
      const res = await fetch('/api/scraper/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: bfFrom, to: bfTo, force: bfForce }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start backfill');
      setBackfill(data);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Backfill error' });
    }
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setNotice(null);
    try {
      const files = await Promise.all(
        Array.from(fileList).map(async (f) => ({
          name: f.name,
          content: await f.text(),
        }))
      );
      const res = await fetch('/api/data/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'CSV upload failed');
      setNotice({
        kind: data.errors?.length ? 'info' : 'success',
        text: `Imported ${data.totalRows} rows from ${data.savedFiles} file(s).${
          data.errors?.length ? ` Warnings: ${data.errors.join('; ')}` : ''
        }`,
      });
      await loadStatus();
      onDataChanged();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Upload failed' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteDate = async (d: string) => {
    await fetch(`/api/data/${encodeURIComponent(d)}`, { method: 'DELETE' });
    await loadStatus();
    onDataChanged();
  };

  const toggleDay = (id: number) => {
    setDays((prev) =>
      prev.includes(id)
        ? prev.length > 1
          ? prev.filter((x) => x !== id)
          : prev
        : [...prev, id].sort((a, b) => a - b)
    );
  };

  const logCols: ColumnDef<SchedulerLogEntry>[] = [
    {
      key: 'timestamp',
      label: 'Executed At',
      align: 'left',
      render: (r) => <span className="font-mono text-xs">{formatDateTimeLocal(r.timestamp)}</span>,
    },
    { key: 'trigger', label: 'Trigger', align: 'left', render: (r) => <span className="capitalize">{r.trigger}</span> },
    {
      key: 'status',
      label: 'Outcome',
      align: 'left',
      render: (r) => (
        <span
          className={`font-medium ${
            r.status === 'success'
              ? 'text-emerald-600 dark:text-emerald-400'
              : r.status === 'error'
                ? 'text-red-600 dark:text-red-400'
                : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          {r.status}
        </span>
      ),
    },
    { key: 'tradingDate', label: 'Date', align: 'left', render: (r) => <span className="font-mono">{r.tradingDate || '–'}</span> },
    { key: 'rowsSaved', label: 'Rows', align: 'right', render: (r) => r.rowsSaved },
    { key: 'durationMs', label: 'Duration', align: 'right', render: (r) => `${(r.durationMs / 1000).toFixed(1)}s` },
    {
      key: 'message',
      label: 'Details',
      align: 'left',
      render: (r) => <span className="text-xs text-slate-600 dark:text-slate-300">{r.message}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Daily Scheduler, GitHub Sync &amp; Data Ingestion
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Pull daily NEPSE prices automatically from ShareSansar, sync CSV archives daily from a GitHub repository, or backfill historical dates
        </p>
      </div>

      {notice && (
        <div
          className={`px-4 py-3 rounded-lg border text-xs ${
            notice.kind === 'error'
              ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
              : notice.kind === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
                : 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-300'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Status summary row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Auto-Pull Schedule</div>
          <div className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
            {status?.config.enabled ? `Active · ${status.config.time} (${status.config.timezone})` : 'Paused'}
          </div>
          <div className="mt-1 text-xs font-mono text-slate-500 dark:text-slate-400">
            Next run: {status?.nextRunIso ? `${formatDateTimeLocal(status.nextRunIso)} (${formatTimeUntil(status.nextRunIso)})` : '–'}
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Data Source Mode</div>
          <div className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
            {status?.config.sourceMode === 'github'
              ? 'GitHub Repository'
              : status?.config.sourceMode === 'both'
                ? 'ShareSansar + GitHub'
                : 'ShareSansar Direct'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
            {status?.config.githubRepo
              ? `${status.config.githubRepo}@${status.config.githubBranch}/${status.config.githubDataPath}`
              : 'Configure a GitHub repo below to enable daily GitHub sync'}
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Stored Trading Days</div>
          <div className="mt-1 text-base font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {status?.loadedDates.length ?? 0} session(s)
          </div>
          <div className="mt-1 text-xs font-mono text-slate-500 dark:text-slate-400">
            {status && status.loadedDates.length > 0
              ? `${status.loadedDates[0]} → ${status.loadedDates[status.loadedDates.length - 1]}`
              : 'Empty data directory'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Daily Cron + GitHub Config Form */}
        <form
          onSubmit={saveConfig}
          className="lg:col-span-6 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Daily Auto-Pull &amp; GitHub Sync
              </h3>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Enabled</span>
            </label>
          </div>

          <div className="space-y-2 text-xs">
            <span className="block font-medium text-slate-600 dark:text-slate-300">
              Daily Data Source
            </span>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
              {(
                [
                  { id: 'github', label: 'GitHub Repo (Recommended)' },
                  { id: 'sharesansar', label: 'ShareSansar Direct' },
                  { id: 'both', label: 'Both' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSourceMode(opt.id)}
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    sourceMode === opt.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <label className="space-y-1">
              <span className="block font-medium text-slate-600 dark:text-slate-300">
                Run Time (24h)
              </span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 font-mono text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="space-y-1">
              <span className="block font-medium text-slate-600 dark:text-slate-300">
                Timezone
              </span>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="Asia/Kathmandu">Asia/Kathmandu (NPT, UTC+5:45)</option>
                <option value="UTC">UTC</option>
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PT)</option>
                <option value="America/New_York">America/New_York (ET)</option>
              </select>
            </label>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-600 dark:text-slate-300">Trading Days</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDays([1, 2, 3, 4, 5])}
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  Mon–Fri
                </button>
                <span className="text-slate-300 dark:text-slate-700">|</span>
                <button
                  type="button"
                  onClick={() => setDays([0, 1, 2, 3, 4])}
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Sun–Thu
                </button>
                <span className="text-slate-300 dark:text-slate-700">|</span>
                <button
                  type="button"
                  onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])}
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Every day
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAYS.map((d) => {
                const active = days.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggleDay(d.id)}
                    className={`py-2 rounded-md text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* GitHub Repository Settings */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                <GitBranch className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>GitHub Data Repository</span>
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {status?.hasGitHubToken
                  ? 'GITHUB_TOKEN configured on server'
                  : 'Public repos work without a token'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="sm:col-span-2 space-y-1">
                <span className="block font-medium text-slate-600 dark:text-slate-300">
                  Repository (owner/repo)
                </span>
                <input
                  type="text"
                  value={githubRepo}
                  onChange={(e) => setGithubRepo(e.target.value)}
                  placeholder="username/nepse-workbench"
                  className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 font-mono text-slate-900 dark:text-slate-100"
                />
              </label>

              <label className="space-y-1">
                <span className="block font-medium text-slate-600 dark:text-slate-300">Branch</span>
                <input
                  type="text"
                  value={githubBranch}
                  onChange={(e) => setGithubBranch(e.target.value)}
                  placeholder="main"
                  className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 font-mono text-slate-900 dark:text-slate-100"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <label className="space-y-1">
                <span className="block font-medium text-slate-600 dark:text-slate-300">
                  CSV Folder Path
                </span>
                <input
                  type="text"
                  value={githubDataPath}
                  onChange={(e) => setGithubDataPath(e.target.value)}
                  placeholder="data"
                  className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 font-mono text-slate-900 dark:text-slate-100"
                />
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300 sm:mt-5">
                <input
                  type="checkbox"
                  checked={pushToGitHub}
                  onChange={(e) => setPushToGitHub(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Commit scraped CSVs to GitHub (requires GITHUB_TOKEN)</span>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
            <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={retryIfNotUpdated}
                onChange={(e) => setRetryIfNotUpdated(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Auto-retry if today&apos;s CSV isn&apos;t posted yet</span>
            </label>
            {retryIfNotUpdated && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">Delay:</span>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={retryDelayMinutes}
                  onChange={(e) => setRetryDelayMinutes(Number(e.target.value))}
                  className="w-16 px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 font-mono"
                />
                <span className="text-slate-500">min</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {saving ? 'Saving…' : 'Save Schedule'}
            </button>
            <button
              type="button"
              onClick={pullNow}
              disabled={pulling}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {pulling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>{pulling ? 'Running…' : 'Run Scheduled Pull Now'}</span>
            </button>
            <button
              type="button"
              onClick={syncGitHubNow}
              disabled={syncingGh || !githubRepo.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>{syncingGh ? 'Syncing…' : 'Pull from GitHub Now'}</span>
            </button>
          </div>
        </form>

        {/* Backfill, CSV Import & GitHub Actions Info */}
        <div className="lg:col-span-6 space-y-6">
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <Download className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Historical Date-Range Backfill
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <label className="space-y-1">
                <span className="block font-medium text-slate-600 dark:text-slate-300">From</span>
                <input
                  type="date"
                  value={bfFrom}
                  onChange={(e) => setBfFrom(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="block font-medium text-slate-600 dark:text-slate-300">To</span>
                <input
                  type="date"
                  value={bfTo}
                  onChange={(e) => setBfTo(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 font-mono"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={bfForce}
                  onChange={(e) => setBfForce(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Re-download already loaded days</span>
              </label>

              <button
                type="button"
                onClick={startBackfill}
                disabled={backfill?.active}
                className="px-4 py-2 text-xs font-medium rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {backfill?.active ? 'Backfilling…' : 'Download Range'}
              </button>
            </div>

            {backfill && (backfill.active || backfill.processedDays > 0) && (
              <div className="space-y-1.5 pt-1 text-xs">
                <div className="flex justify-between font-mono text-slate-600 dark:text-slate-300">
                  <span>{backfill.message}</span>
                  <span>
                    {backfill.processedDays}/{backfill.totalDays}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{
                      width: `${
                        backfill.totalDays > 0
                          ? Math.round((backfill.processedDays / backfill.totalDays) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Import Local Daily CSV Files
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Upload one or more <code className="font-mono">YYYY-MM-DD.csv</code> files matching the ShareSansar / analysis.py column layout.
            </p>
            <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors">
              <Upload className="w-3.5 h-3.5" />
              <span>{uploading ? 'Importing…' : 'Select CSV File(s)'}</span>
              <input
                type="file"
                accept=".csv,text/csv"
                multiple
                onChange={handleCsvUpload}
                className="sr-only"
                disabled={uploading}
              />
            </label>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Push Code &amp; Daily Pipeline to GitHub
                </h3>
              </div>
              {ghAccount?.login && (
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  @{ghAccount.login}
                </span>
              )}
            </div>

            {status?.hasGitHubToken ? (
              <div className="space-y-3 text-xs">
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  Pushes the full app, loaded <code className="font-mono">data/*.csv</code> files, and{' '}
                  <code className="font-mono">.github/workflows/daily-sharesansar.yml</code> directly to GitHub (creating the repo if it doesn&apos;t exist) and enables daily GitHub sync.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="sm:col-span-2 space-y-1">
                    <span className="block font-medium text-slate-600 dark:text-slate-300">
                      Target Repo (name or owner/name)
                    </span>
                    <input
                      type="text"
                      list="gh-existing-repos"
                      value={pushRepoName}
                      onChange={(e) => setPushRepoName(e.target.value)}
                      placeholder="nepse-turnover-workbench"
                      className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 font-mono text-slate-900 dark:text-slate-100"
                    />
                    <datalist id="gh-existing-repos">
                      {(ghAccount?.repos || []).map((r) => (
                        <option key={r.full_name} value={r.full_name} />
                      ))}
                    </datalist>
                  </label>
                  <label className="space-y-1">
                    <span className="block font-medium text-slate-600 dark:text-slate-300">Branch</span>
                    <input
                      type="text"
                      value={pushBranchName}
                      onChange={(e) => setPushBranchName(e.target.value)}
                      placeholder="main"
                      className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 font-mono text-slate-900 dark:text-slate-100"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={pushPrivate}
                      onChange={(e) => setPushPrivate(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Private repository (when creating new)</span>
                  </label>
                  <button
                    type="button"
                    onClick={pushProject}
                    disabled={pushingProj || !pushRepoName.trim()}
                    className="px-4 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {pushingProj ? 'Pushing to GitHub…' : 'Push Project to GitHub'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Add <code className="font-mono">GITHUB_TOKEN</code> in AI Studio Secrets or use the AI Studio GitHub export button to push this repository (including <code className="font-mono">.github/workflows/daily-sharesansar.yml</code>) to GitHub.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Sync Run History */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Scheduler &amp; Sync Run History
        </h3>
        <DataTable
          rows={status?.history || []}
          columns={logCols}
          rowKey={(r) => r.id}
          emptyMessage="No sync runs recorded yet."
          maxHeightClass="max-h-[300px]"
        />
      </div>

      {/* Loaded Trading Dates */}
      {status && status.loadedDates.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Loaded Trading Date Files ({status.loadedDates.length})
            </h3>
            <span className="text-xs text-slate-400">Stored in ./data/YYYY-MM-DD.csv</span>
          </div>
          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
            {[...status.loadedDates].reverse().map((d) => (
              <div
                key={d}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-700 dark:text-slate-300"
              >
                <span>{d}</span>
                <button
                  type="button"
                  onClick={() => handleDeleteDate(d)}
                  title={`Remove ${d}`}
                  className="text-slate-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

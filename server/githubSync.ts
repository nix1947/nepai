import fs from 'fs';
import path from 'path';
import { isValidDateStr, MarketStore } from './marketStore.ts';

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REPO_NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,100}$/;

export interface GitHubSyncConfig {
  repo: string;
  branch: string;
  dataPath: string;
}

export interface GitHubSyncResult {
  fetchedFiles: number;
  skippedFiles: number;
  totalRows: number;
  latestDate: string | null;
  errors: string[];
}

export interface GitHubRepoSummary {
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
}

export interface GitHubAccountInfo {
  authenticated: boolean;
  login: string | null;
  repos: GitHubRepoSummary[];
  error?: string;
}

export interface GitHubPushProjectResult {
  repoFullName: string;
  branch: string;
  htmlUrl: string;
  commitSha: string;
  filesUploaded: number;
  createdRepo: boolean;
}

export function validateGitHubConfig(cfg: GitHubSyncConfig): {
  owner: string;
  repoName: string;
  branch: string;
  cleanPath: string;
} {
  const repo = cfg.repo.trim();
  if (!REPO_RE.test(repo)) {
    throw new Error('GitHub repository must be in "owner/repo" format.');
  }
  const [owner, repoName] = repo.split('/');
  const branch = (cfg.branch || 'main').trim();
  if (!BRANCH_RE.test(branch) || branch.includes('..')) {
    throw new Error('Invalid GitHub branch name.');
  }
  const cleanPath = (cfg.dataPath || 'data')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!cleanPath || cleanPath.includes('..') || !/^[A-Za-z0-9._/-]+$/.test(cleanPath)) {
    throw new Error('Invalid GitHub folder path (e.g., "data").');
  }
  return { owner, repoName, branch, cleanPath };
}

function authHeaders(requireToken = false): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'nepse-turnover-workbench',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (requireToken && !token) {
    throw new Error('GITHUB_TOKEN is not configured in server Secrets.');
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function getGitHubAccount(): Promise<GitHubAccountInfo> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return { authenticated: false, login: null, repos: [] };
  }
  const userRes = await fetch('https://api.github.com/user', { headers: authHeaders(true) });
  if (!userRes.ok) {
    const txt = await userRes.text();
    return {
      authenticated: false,
      login: null,
      repos: [],
      error: `GitHub auth failed (${userRes.status}): ${txt.slice(0, 140)}`,
    };
  }
  const user = (await userRes.json()) as { login?: string };
  const login = user.login || null;

  const reposRes = await fetch(
    'https://api.github.com/user/repos?per_page=50&sort=updated&affiliation=owner',
    { headers: authHeaders(true) }
  );
  const rawRepos = reposRes.ok ? ((await reposRes.json()) as GitHubRepoSummary[]) : [];
  const repos = Array.isArray(rawRepos)
    ? rawRepos.map((r) => ({
        full_name: r.full_name,
        name: r.name,
        private: Boolean(r.private),
        default_branch: r.default_branch || 'main',
        html_url: r.html_url,
      }))
    : [];

  return { authenticated: true, login, repos };
}

function collectProjectFiles(projectRoot: string): Array<{ repoPath: string; contentBase64: string }> {
  const root = path.resolve(projectRoot);
  const files: Array<{ repoPath: string; contentBase64: string }> = [];

  const ignoredTopDirs = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
  const ignoredFiles = new Set(['.DS_Store', 'scheduler.json']);

  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.resolve(dir, entry.name);
      if (!full.startsWith(root + path.sep)) continue;
      const rel = path.relative(root, full).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (ignoredTopDirs.has(entry.name)) continue;
        if (rel === 'public/assets/aistudio' || rel.startsWith('public/assets/aistudio/')) continue;
        walk(full);
      } else if (entry.isFile()) {
        if (ignoredFiles.has(entry.name)) continue;
        if (entry.name.startsWith('.env') && entry.name !== '.env.example') continue;
        if (entry.name.endsWith('.log')) continue;
        const stat = fs.statSync(full);
        if (stat.size > 5 * 1024 * 1024) continue; // skip oversized artifacts
        files.push({
          repoPath: rel,
          contentBase64: fs.readFileSync(full).toString('base64'),
        });
      }
    }
  };

  walk(root);
  return files.sort((a, b) => a.repoPath.localeCompare(b.repoPath));
}

export async function pushProjectToGitHub(
  projectRoot: string,
  opts: { repo: string; branch?: string; isPrivate?: boolean; commitMessage?: string }
): Promise<GitHubPushProjectResult> {
  const headers = authHeaders(true);
  const account = await getGitHubAccount();
  if (!account.authenticated || !account.login) {
    throw new Error(account.error || 'Could not authenticate with GITHUB_TOKEN.');
  }

  const rawRepo = (opts.repo || '').trim();
  let owner = account.login;
  let repoName = rawRepo;
  if (rawRepo.includes('/')) {
    const parts = rawRepo.split('/');
    if (parts.length !== 2 || !REPO_RE.test(rawRepo)) {
      throw new Error('Repository must be "name" or "owner/name".');
    }
    owner = parts[0];
    repoName = parts[1];
  } else if (!REPO_NAME_RE.test(repoName)) {
    throw new Error('Invalid repository name.');
  }

  const fullName = `${owner}/${repoName}`;
  const branch = (opts.branch || 'main').trim();
  if (!BRANCH_RE.test(branch) || branch.includes('..')) {
    throw new Error('Invalid branch name.');
  }

  let createdRepo = false;
  let htmlUrl = `https://github.com/${fullName}`;

  const repoCheck = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`,
    { headers }
  );

  if (repoCheck.status === 404) {
    if (owner.toLowerCase() !== account.login.toLowerCase()) {
      throw new Error(`Repository ${fullName} does not exist or token lacks access.`);
    }
    const createRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: repoName,
        private: Boolean(opts.isPrivate),
        description: 'NEPSE Turnover & Scanner Workbench with daily ShareSansar data sync',
        auto_init: false,
      }),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Failed to create GitHub repo (${createRes.status}): ${errText.slice(0, 180)}`);
    }
    const created = (await createRes.json()) as { html_url?: string };
    if (created.html_url) htmlUrl = created.html_url;
    createdRepo = true;
  } else if (!repoCheck.ok) {
    const errText = await repoCheck.text();
    throw new Error(`GitHub repo check failed (${repoCheck.status}): ${errText.slice(0, 180)}`);
  } else {
    const existing = (await repoCheck.json()) as { html_url?: string };
    if (existing.html_url) htmlUrl = existing.html_url;
  }

  const files = collectProjectFiles(projectRoot);
  if (files.length === 0) {
    throw new Error('No project files found to push.');
  }

  // Ensure branch ref exists (Git Data API cannot create trees on an empty unborn repo)
  let parentCommitSha: string | null = null;
  let refExists = false;

  const refRes = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repoName
    )}/git/ref/heads/${encodeURIComponent(branch)}`,
    { headers }
  );
  if (refRes.ok) {
    const refData = (await refRes.json()) as { object?: { sha?: string } };
    parentCommitSha = refData.object?.sha ?? null;
    refExists = Boolean(parentCommitSha);
  } else {
    // Check if another default branch exists (e.g. repo was initialized on another branch)
    const repoMetaRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`,
      { headers }
    );
    const repoMeta = repoMetaRes.ok
      ? ((await repoMetaRes.json()) as { default_branch?: string })
      : {};
    const fallbackBranch = repoMeta.default_branch;
    if (fallbackBranch && fallbackBranch !== branch) {
      const fbRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
          repoName
        )}/git/ref/heads/${encodeURIComponent(fallbackBranch)}`,
        { headers }
      );
      if (fbRes.ok) {
        const fbData = (await fbRes.json()) as { object?: { sha?: string } };
        parentCommitSha = fbData.object?.sha ?? null;
      }
    }
  }

  if (!parentCommitSha) {
    // Bootstrap empty repository with .gitignore via Contents API
    const gitignoreFile = files.find((f) => f.repoPath === '.gitignore') ?? files[0];
    const bootRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repoName
      )}/contents/${encodeURIComponent(gitignoreFile.repoPath)}`,
      {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'chore: initialize repository',
          content: gitignoreFile.contentBase64,
          branch,
        }),
      }
    );
    if (!bootRes.ok) {
      const errText = await bootRes.text();
      throw new Error(`Failed to bootstrap empty repo (${bootRes.status}): ${errText.slice(0, 180)}`);
    }
    const bootData = (await bootRes.json()) as { commit?: { sha?: string } };
    parentCommitSha = bootData.commit?.sha ?? null;
    refExists = Boolean(parentCommitSha);

    // Wait briefly for GitHub's Git Data API to recognize the initial commit
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((r) => setTimeout(r, 900));
      const verifyRef = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
          repoName
        )}/git/ref/heads/${encodeURIComponent(branch)}`,
        { headers }
      );
      if (verifyRef.ok) break;
    }
  }

  // Create blobs in bounded parallel batches
  const treeEntries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];
  const batchSize = 8;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const createdBlobs = await Promise.all(
      batch.map(async (file) => {
        let blobRes: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          blobRes = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
              repoName
            )}/git/blobs`,
            {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: file.contentBase64,
                encoding: 'base64',
              }),
            }
          );
          if (blobRes.status !== 409) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (!blobRes || !blobRes.ok) {
          const errText = blobRes ? await blobRes.text() : 'no response';
          throw new Error(
            `Blob upload failed for ${file.repoPath} (${blobRes?.status ?? 0}): ${errText.slice(0, 140)}`
          );
        }
        const blob = (await blobRes.json()) as { sha: string };
        return {
          path: file.repoPath,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: blob.sha,
        };
      })
    );
    treeEntries.push(...createdBlobs);
  }

  // Create tree (full snapshot)
  const treeRes = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repoName
    )}/git/trees`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tree: treeEntries }),
    }
  );
  if (!treeRes.ok) {
    const errText = await treeRes.text();
    throw new Error(`Tree creation failed (${treeRes.status}): ${errText.slice(0, 180)}`);
  }
  const treeData = (await treeRes.json()) as { sha: string };

  // Create commit
  const commitRes = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repoName
    )}/git/commits`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: opts.commitMessage || 'feat: push NEPSE Turnover & Scanner Workbench',
        tree: treeData.sha,
        ...(parentCommitSha ? { parents: [parentCommitSha] } : {}),
      }),
    }
  );
  if (!commitRes.ok) {
    const errText = await commitRes.text();
    throw new Error(`Commit creation failed (${commitRes.status}): ${errText.slice(0, 180)}`);
  }
  const commitData = (await commitRes.json()) as { sha: string };

  // Update or create branch ref
  if (refExists) {
    const patchRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repoName
      )}/git/refs/heads/${encodeURIComponent(branch)}`,
      {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: commitData.sha, force: false }),
      }
    );
    if (!patchRes.ok) {
      const errText = await patchRes.text();
      throw new Error(`Branch update failed (${patchRes.status}): ${errText.slice(0, 180)}`);
    }
  } else {
    const createRefRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repoName
      )}/git/refs`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitData.sha }),
      }
    );
    if (!createRefRes.ok) {
      const errText = await createRefRes.text();
      throw new Error(`Branch creation failed (${createRefRes.status}): ${errText.slice(0, 180)}`);
    }
  }

  return {
    repoFullName: fullName,
    branch,
    htmlUrl,
    commitSha: commitData.sha,
    filesUploaded: files.length,
    createdRepo,
  };
}

export async function syncFromGitHub(
  store: MarketStore,
  cfg: GitHubSyncConfig,
  force = false
): Promise<GitHubSyncResult> {
  const { owner, repoName, branch, cleanPath } = validateGitHubConfig(cfg);
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repoName
  )}/contents/${cleanPath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}?ref=${encodeURIComponent(branch)}`;

  const listRes = await fetch(apiUrl, { headers: authHeaders() });
  if (listRes.status === 404) {
    return {
      fetchedFiles: 0,
      skippedFiles: 0,
      totalRows: 0,
      latestDate: null,
      errors: [`Directory "${cleanPath}" not found in ${owner}/${repoName}@${branch}.`],
    };
  }
  if (!listRes.ok) {
    const msg = await listRes.text();
    throw new Error(`GitHub API ${listRes.status}: ${msg.slice(0, 180)}`);
  }

  const items = (await listRes.json()) as Array<{
    name?: string;
    type?: string;
    download_url?: string | null;
  }>;
  if (!Array.isArray(items)) {
    throw new Error('GitHub path did not resolve to a directory.');
  }

  const csvEntries = items
    .filter((item) => item.type === 'file' && typeof item.name === 'string' && item.name.endsWith('.csv'))
    .map((item) => ({
      name: item.name!,
      dateStr: item.name!.slice(0, -4),
      downloadUrl: item.download_url || null,
    }))
    .filter((e) => isValidDateStr(e.dateStr))
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr));

  let fetchedFiles = 0;
  let skippedFiles = 0;
  let totalRows = 0;
  let latestDate: string | null = null;
  const errors: string[] = [];

  for (const entry of csvEntries) {
    if (!force && store.hasDate(entry.dateStr)) {
      skippedFiles++;
      continue;
    }

    const rawUrl =
      entry.downloadUrl &&
      (entry.downloadUrl.startsWith('https://raw.githubusercontent.com/') ||
        entry.downloadUrl.startsWith('https://api.github.com/'))
        ? entry.downloadUrl
        : `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(
            repoName
          )}/${encodeURIComponent(branch)}/${cleanPath}/${encodeURIComponent(entry.name)}`;

    try {
      const fileRes = await fetch(rawUrl, { headers: authHeaders() });
      if (!fileRes.ok) {
        errors.push(`${entry.name}: HTTP ${fileRes.status}`);
        continue;
      }
      const csvText = await fileRes.text();
      const rows = store.parseCsvContent(csvText, entry.dateStr);
      if (rows.length === 0) {
        errors.push(`${entry.name}: 0 valid rows`);
        continue;
      }
      totalRows += store.saveDayRows(entry.dateStr, rows);
      fetchedFiles++;
      latestDate = entry.dateStr;
    } catch (err) {
      errors.push(`${entry.name}: ${err instanceof Error ? err.message : 'download error'}`);
    }
  }

  return { fetchedFiles, skippedFiles, totalRows, latestDate, errors };
}

export async function pushDayCsvToGitHub(
  store: MarketStore,
  cfg: GitHubSyncConfig,
  dateStr: string
): Promise<{ committed: boolean; message: string }> {
  const headers = authHeaders(true);
  if (!isValidDateStr(dateStr)) {
    throw new Error(`Invalid date: ${dateStr}`);
  }

  const { owner, repoName, branch, cleanPath } = validateGitHubConfig(cfg);
  const localPath = path.resolve(store.dataDir, `${dateStr}.csv`);
  if (!localPath.startsWith(store.dataDir + path.sep) || !fs.existsSync(localPath)) {
    throw new Error(`Local CSV for ${dateStr} not found.`);
  }
  const contentBase64 = fs.readFileSync(localPath).toString('base64');

  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repoName
  )}/contents/${cleanPath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}/${encodeURIComponent(`${dateStr}.csv`)}`;

  let sha: string | undefined;
  const checkRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, {
    headers,
  });
  if (checkRes.ok) {
    const existing = (await checkRes.json()) as { sha?: string };
    sha = existing.sha;
  }

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `chore(data): update NEPSE share prices for ${dateStr}`,
      content: contentBase64,
      branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`GitHub push failed (${putRes.status}): ${errText.slice(0, 180)}`);
  }

  return {
    committed: true,
    message: `Committed ${cleanPath}/${dateStr}.csv to ${owner}/${repoName}@${branch}.`,
  };
}

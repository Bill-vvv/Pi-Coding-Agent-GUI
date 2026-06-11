import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import type { Project, ProjectGitSummary } from "@pi-gui/shared";

const GIT_TIMEOUT_MS = 1200;
const GIT_MAX_BUFFER = 128 * 1024;

export function decorateProjectWithGitSummary(project: Project): Project {
  return { ...project, git: readProjectGitSummary(project.cwd) };
}

export function decorateProjectsWithGitSummary(projects: Project[]): Project[] {
  return projects.map(decorateProjectWithGitSummary);
}

export function readProjectGitSummary(cwd: string): ProjectGitSummary {
  if (!isLocalDirectory(cwd)) return { available: false, error: "not a local directory" };

  const rootResult = runGit(cwd, ["rev-parse", "--show-toplevel"], { allowNonZero: true });
  if (rootResult.error) return { available: false, error: rootResult.error };
  if (rootResult.status !== 0) return { available: false };

  const root = rootResult.stdout.trim() || cwd;
  const statusResult = runGit(root, ["status", "--porcelain=v2", "--branch"], { allowNonZero: true });
  if (statusResult.error) return { available: false, root, error: statusResult.error };
  if (statusResult.status !== 0) return { available: false, root, error: statusResult.stderr.trim() || "git status failed" };

  const parsed = parseGitStatus(statusResult.stdout);
  const defaultBranch = readDefaultBranch(root, parsed.upstream, listLocalBranchNames(root));
  const isDefaultBranch = Boolean(parsed.branch && defaultBranch && parsed.branch === defaultBranch && !parsed.detached);
  return {
    available: true,
    root,
    branch: parsed.branch,
    head: parsed.head,
    dirty: parsed.dirty,
    detached: parsed.detached,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    changedFiles: parsed.changedFiles,
    defaultBranch,
    isDefaultBranch,
  };
}

export type ParsedGitStatus = {
  branch?: string;
  head?: string;
  detached: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
  dirty: boolean;
  changedFiles: number;
};

export function parseGitStatus(stdout: string): ParsedGitStatus {
  let branch: string | undefined;
  let head: string | undefined;
  let detached = false;
  let upstream: string | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;
  let changedFiles = 0;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith("# branch.oid ")) {
      const oid = line.slice("# branch.oid ".length).trim();
      head = oid && oid !== "(initial)" ? oid.slice(0, 8) : undefined;
      continue;
    }
    if (line.startsWith("# branch.head ")) {
      const value = line.slice("# branch.head ".length).trim();
      detached = value === "(detached)";
      if (!detached && value && value !== "(unknown)" && value !== "(initial)") branch = value;
      continue;
    }
    if (line.startsWith("# branch.upstream ")) {
      const value = line.slice("# branch.upstream ".length).trim();
      upstream = value || undefined;
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/^# branch\.ab \+(\d+) \-(\d+)$/);
      if (match) {
        ahead = Number.parseInt(match[1] ?? "0", 10);
        behind = Number.parseInt(match[2] ?? "0", 10);
      }
      continue;
    }
    if (line.startsWith("1 ") || line.startsWith("2 ") || line.startsWith("u ") || line.startsWith("? ")) {
      changedFiles += 1;
    }
  }

  return {
    branch,
    head,
    detached,
    upstream,
    ahead,
    behind,
    dirty: changedFiles > 0,
    changedFiles,
  };
}

function readDefaultBranch(cwd: string, upstream: string | undefined, localBranches: string[]): string | undefined {
  const preferredRemote = upstream?.split("/")[0] || "origin";
  const remotes = preferredRemote === "origin" ? [preferredRemote] : [preferredRemote, "origin"];
  for (const remote of remotes) {
    const result = runGit(cwd, ["symbolic-ref", `refs/remotes/${remote}/HEAD`], { allowNonZero: true });
    if (result.status !== 0) continue;
    const ref = result.stdout.trim();
    const prefix = `refs/remotes/${remote}/`;
    if (ref.startsWith(prefix)) return ref.slice(prefix.length);
  }
  const configuredDefault = runGit(cwd, ["config", "--get", "init.defaultBranch"], { allowNonZero: true }).stdout.trim();
  if (configuredDefault && localBranches.includes(configuredDefault)) return configuredDefault;
  const oldestLocalBranch = runGit(cwd, ["for-each-ref", "--sort=creatordate", "refs/heads", "--format=%(refname:short)"], { allowNonZero: true }).stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (oldestLocalBranch && localBranches.includes(oldestLocalBranch)) return oldestLocalBranch;
  return localBranches.length === 1 ? localBranches[0] : undefined;
}

function listLocalBranchNames(cwd: string): string[] {
  return runGit(cwd, ["for-each-ref", "refs/heads", "--format=%(refname:short)"], { allowNonZero: true }).stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isLocalDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function runGit(cwd: string, args: string[], options: { allowNonZero?: boolean } = {}): { status: number | null; stdout: string; stderr: string; error?: string } {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: errorCode(result.error) === "ETIMEDOUT" ? "git command timed out" : result.error.message,
    };
  }
  if (!options.allowNonZero && result.status !== 0) {
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: (result.stderr ?? "").trim() || `git exited with status ${result.status ?? "unknown"}`,
    };
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function errorCode(error: Error): string | undefined {
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}

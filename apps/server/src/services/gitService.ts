import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import type { GitBranchSummary, GitRepositoryStatus, Project } from "@pi-gui/shared";
import { parseGitStatus } from "./projectGitSummary.js";

const GIT_TIMEOUT_MS = 1500;
const GIT_MAX_BUFFER = 192 * 1024;

export function readGitStatus(project: Project): GitRepositoryStatus {
  if (!isLocalDirectory(project.cwd)) return unavailableStatus(project.id, "not a local directory");

  const rootResult = runGit(project.cwd, ["rev-parse", "--show-toplevel"], { allowNonZero: true });
  if (rootResult.error) return unavailableStatus(project.id, rootResult.error);
  if (rootResult.status !== 0) return unavailableStatus(project.id);

  const root = rootResult.stdout.trim() || project.cwd;
  const statusResult = runGit(root, ["status", "--porcelain=v2", "--branch"], { allowNonZero: true });
  if (statusResult.error) return unavailableStatus(project.id, statusResult.error, root);
  if (statusResult.status !== 0) return unavailableStatus(project.id, statusResult.stderr.trim() || "git status failed", root);

  const parsed = parseGitStatus(statusResult.stdout);
  const localBranches = listLocalBranches(root);
  const defaultBranch = detectDefaultBranch(root, parsed.upstream, localBranches.map((branch) => branch.name));
  const mergedIntoDefault = defaultBranch ? listMergedBranches(root, defaultBranch) : new Set<string>();
  const branches = localBranches.map((branch) => ({
    ...branch,
    default: branch.name === defaultBranch,
    mergedIntoDefault: mergedIntoDefault.has(branch.name),
  }));

  return {
    projectId: project.id,
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
    isDefaultBranch: Boolean(parsed.branch && defaultBranch && parsed.branch === defaultBranch && !parsed.detached),
    branches,
  };
}

export function createGitBranch(project: Project, name: string): GitRepositoryStatus {
  const status = readGitStatus(project);
  const root = requireAvailableRoot(status);
  const branchName = normalizeBranchName(name, "git.branch.create name");
  validateBranchName(root, branchName);
  if (branchExists(root, branchName)) throw new Error(`Branch already exists: ${branchName}`);
  runGitOrThrow(root, ["switch", "-c", branchName]);
  return readGitStatus(project);
}

export function switchGitBranch(project: Project, branch: string): GitRepositoryStatus {
  const status = readGitStatus(project);
  const root = requireAvailableRoot(status);
  assertCleanWorkingTree(status, "切换分支前请先提交或清理当前改动");
  const branchName = normalizeBranchName(branch, "git.branch.switch branch");
  if (!branchExists(root, branchName)) throw new Error(`Local branch not found: ${branchName}`);
  runGitOrThrow(root, ["switch", "--no-guess", branchName]);
  return readGitStatus(project);
}

export function deleteMergedGitBranch(project: Project, branch: string): GitRepositoryStatus {
  const status = readGitStatus(project);
  const root = requireAvailableRoot(status);
  assertCleanWorkingTree(status, "删除分支前请先提交或清理当前改动");
  const branchName = normalizeBranchName(branch, "git.branch.delete branch");
  if (status.branch === branchName) throw new Error("Cannot delete the currently checked out branch");
  const branchSummary = status.branches?.find((item) => item.name === branchName);
  if (!branchSummary) throw new Error(`Local branch not found: ${branchName}`);
  if (!branchSummary.mergedIntoDefault) throw new Error(`Branch is not merged into ${status.defaultBranch ?? "the default branch"}`);
  runGitOrThrow(root, ["branch", "-d", branchName]);
  return readGitStatus(project);
}

function unavailableStatus(projectId: string, error?: string, root?: string): GitRepositoryStatus {
  return { projectId, available: false, error, root };
}

function listLocalBranches(root: string): GitBranchSummary[] {
  const result = runGit(root, ["for-each-ref", "refs/heads", "--format=%(refname:short)\t%(HEAD)"], { allowNonZero: true });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [name, headMarker] = line.split("\t");
      return { name, current: headMarker?.trim() === "*" };
    })
    .sort((left, right) => {
      if (left.current !== right.current) return left.current ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

function listMergedBranches(root: string, defaultBranch: string): Set<string> {
  const result = runGit(root, ["for-each-ref", `--merged=${defaultBranch}`, "refs/heads", "--format=%(refname:short)"], { allowNonZero: true });
  if (result.status !== 0) return new Set();
  return new Set(result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

function detectDefaultBranch(root: string, upstream: string | undefined, localBranches: string[]): string | undefined {
  const preferredRemote = upstream?.split("/")[0] || "origin";
  const remotes = preferredRemote === "origin" ? [preferredRemote] : [preferredRemote, "origin"];
  for (const remote of remotes) {
    const result = runGit(root, ["symbolic-ref", `refs/remotes/${remote}/HEAD`], { allowNonZero: true });
    if (result.status !== 0) continue;
    const ref = result.stdout.trim();
    const prefix = `refs/remotes/${remote}/`;
    if (ref.startsWith(prefix)) return ref.slice(prefix.length);
  }
  const configuredDefault = runGit(root, ["config", "--get", "init.defaultBranch"], { allowNonZero: true }).stdout.trim();
  if (configuredDefault && localBranches.includes(configuredDefault)) return configuredDefault;
  const oldestLocalBranch = runGit(root, ["for-each-ref", "--sort=creatordate", "refs/heads", "--format=%(refname:short)"], { allowNonZero: true }).stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (oldestLocalBranch && localBranches.includes(oldestLocalBranch)) return oldestLocalBranch;
  return localBranches.length === 1 ? localBranches[0] : undefined;
}

function branchExists(root: string, branch: string): boolean {
  return runGit(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { allowNonZero: true }).status === 0;
}

function validateBranchName(root: string, branch: string): void {
  const result = runGit(root, ["check-ref-format", "--branch", branch], { allowNonZero: true });
  if (result.status !== 0) throw new Error(`Invalid branch name: ${branch}`);
}

function assertCleanWorkingTree(status: GitRepositoryStatus, message: string): void {
  if (!status.available) throw new Error(status.error ?? "Git repository unavailable");
  if (status.dirty) throw new Error(message);
}

function requireAvailableRoot(status: GitRepositoryStatus): string {
  if (!status.available || !status.root) throw new Error(status.error ?? "Git repository unavailable");
  return status.root;
}

function normalizeBranchName(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} must be a non-empty string`);
  return trimmed;
}

function isLocalDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function runGitOrThrow(cwd: string, args: string[]): void {
  const result = runGit(cwd, args);
  if (result.error) throw new Error(result.error);
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

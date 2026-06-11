import type { GitRepositoryStatus, Project } from "@pi-gui/shared";

export type BranchWorkflowViewModel = {
  currentBranchLabel: string;
  defaultBranchLabel: string;
  compareBranchLabel: string;
  changedFilesLabel: string;
  syncLabel: string;
  noGitMessage?: string;
  branches: Array<{ name: string; current: boolean; default: boolean; mergedIntoDefault: boolean }>;
};

export function branchWorkflowViewModel(project: Project, status?: GitRepositoryStatus): BranchWorkflowViewModel {
  const effectiveStatus = status ?? projectGitStatusFromProject(project);
  if (!effectiveStatus?.available) {
    return {
      currentBranchLabel: "no git",
      defaultBranchLabel: "unknown",
      compareBranchLabel: "unknown",
      changedFilesLabel: "0 changes",
      syncLabel: "Sync unknown",
      noGitMessage: effectiveStatus?.error ?? "This project is not an available local Git repository.",
      branches: [],
    };
  }

  const currentBranchLabel = effectiveStatus.detached ? `detached${effectiveStatus.head ? ` ${effectiveStatus.head}` : ""}` : effectiveStatus.branch ?? (effectiveStatus.head ? `head ${effectiveStatus.head}` : "unknown");
  const defaultBranchLabel = effectiveStatus.defaultBranch ?? "unknown";
  const compareBranchLabel = effectiveStatus.branch ?? currentBranchLabel;
  const changedFilesLabel = `${effectiveStatus.changedFiles ?? 0} changes`;
  const ahead = effectiveStatus.ahead ?? 0;
  const behind = effectiveStatus.behind ?? 0;
  const syncLabel = ahead || behind ? `${ahead ? `ahead ${ahead}` : ""}${ahead && behind ? " · " : ""}${behind ? `behind ${behind}` : ""}` : "Synced locally";

  return {
    currentBranchLabel,
    defaultBranchLabel,
    compareBranchLabel,
    changedFilesLabel,
    syncLabel,
    branches: (effectiveStatus.branches ?? []).map((branch) => ({
      name: branch.name,
      current: branch.current,
      default: branch.default === true,
      mergedIntoDefault: branch.mergedIntoDefault === true,
    })),
  };
}

function projectGitStatusFromProject(project: Project): GitRepositoryStatus | undefined {
  const git = project.git;
  if (!git) return undefined;
  return {
    projectId: project.id,
    available: git.available,
    root: git.root,
    branch: git.branch,
    head: git.head,
    dirty: git.dirty,
    detached: git.detached,
    upstream: git.upstream,
    ahead: git.ahead,
    behind: git.behind,
    changedFiles: git.changedFiles,
    defaultBranch: git.defaultBranch,
    isDefaultBranch: git.isDefaultBranch,
    error: git.error,
  };
}

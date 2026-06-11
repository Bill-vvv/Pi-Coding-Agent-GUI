import type { Project } from "@pi-gui/shared";

export type ProjectGitChipModel = {
  label: string;
  title: string;
  tone: "default" | "working" | "warning" | "neutral";
};

export function projectGitChipModel(project: Project): ProjectGitChipModel {
  const git = project.git;
  if (!git?.available) {
    return {
      label: "no git",
      title: git?.error ? `Git unavailable · ${git.error}` : "No Git repository detected for this project",
      tone: "neutral",
    };
  }

  const markers: string[] = [];
  if (git.dirty) markers.push("●");
  if ((git.ahead ?? 0) > 0) markers.push(`↑${git.ahead}`);
  if ((git.behind ?? 0) > 0) markers.push(`↓${git.behind}`);

  const baseLabel = git.detached ? `detached${git.head ? ` ${git.head}` : ""}` : git.branch ?? (git.head ? `head ${git.head}` : "git");
  const label = [baseLabel, ...markers].join(" ");
  const tone = git.detached ? "warning" : git.isDefaultBranch ? "default" : "working";

  const titleParts = [
    git.detached ? "Detached HEAD" : git.branch ? `Branch: ${git.branch}` : undefined,
    git.defaultBranch ? `Default: ${git.defaultBranch}` : undefined,
    git.upstream ? `Upstream: ${git.upstream}` : undefined,
    git.changedFiles !== undefined ? `${git.changedFiles} changed` : undefined,
    git.root ? `Root: ${git.root}` : undefined,
  ].filter(Boolean);

  return {
    label,
    title: titleParts.join(" · ") || label,
    tone,
  };
}

import type { Project } from "@pi-gui/shared";
import { projectGitChipModel } from "../domain/projectGitDisplay";

type SelectedProjectBranchChipProps = {
  project: Project;
  onClick?: () => void;
};

export function SelectedProjectBranchChip({ project, onClick }: SelectedProjectBranchChipProps) {
  const model = projectGitChipModel(project);
  const className = `selected-project-branch-chip tone-${model.tone}${onClick ? " is-clickable" : ""}`;

  if (onClick) {
    return (
      <button type="button" className={className} title={model.title} aria-label={`Project branch: ${model.label}`} onClick={onClick}>
        {model.label}
      </button>
    );
  }

  return <span className={className} title={model.title} aria-label={`Project branch: ${model.label}`}>{model.label}</span>;
}

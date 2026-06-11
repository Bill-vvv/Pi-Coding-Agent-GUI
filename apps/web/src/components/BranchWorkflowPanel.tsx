import type { GitRepositoryStatus, Project } from "@pi-gui/shared";
import { branchWorkflowViewModel } from "../domain/branchWorkflowDisplay";

type BranchWorkflowPanelProps = {
  project: Project;
  status?: GitRepositoryStatus;
  loading: boolean;
  mutating: boolean;
  onRefresh: () => void;
  onSwitchBranch: (branch: string) => void;
  onDeleteBranch: (branch: string) => void;
  onClose: () => void;
};

export function BranchWorkflowPanel({ project, status, loading, mutating, onRefresh, onSwitchBranch, onDeleteBranch, onClose }: BranchWorkflowPanelProps) {
  const model = branchWorkflowViewModel(project, status);
  const canMutate = status?.available === true && status.dirty !== true && !mutating;

  return (
    <section className="branch-workflow-panel" aria-label={`${project.name} branch workflow`}>
      <header className="branch-workflow-header">
        <div>
          <h2>{project.name}</h2>
          <p>{project.cwd}</p>
        </div>
        <div className="branch-workflow-header-actions">
          <button type="button" onClick={onRefresh} disabled={loading}>Refresh</button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </header>

      <div className="branch-workflow-summary">
        <span>Current: {model.currentBranchLabel}</span>
        <span>Default: {model.defaultBranchLabel}</span>
        <span>{model.changedFilesLabel}</span>
        <span>{model.syncLabel}</span>
      </div>

      {model.noGitMessage ? <p className="branch-workflow-empty">{model.noGitMessage}</p> : null}

      {!model.noGitMessage ? (
        <>
          <section className="branch-workflow-card">
            <h3>Pull Request</h3>
            <p>Base: {model.defaultBranchLabel}</p>
            <p>Compare: {model.compareBranchLabel}</p>
            <small>This PR will merge {model.compareBranchLabel} into {model.defaultBranchLabel}.</small>
          </section>

          <section className="branch-workflow-card">
            <h3>Local branches</h3>
            <div className="branch-workflow-branch-list">
              {model.branches.length ? model.branches.map((branch) => (
                <div className="branch-workflow-branch-row" key={branch.name}>
                  <div>
                    <strong>{branch.name}</strong>
                    <small>
                      {branch.current ? "current" : branch.default ? "default" : branch.mergedIntoDefault ? "merged" : "local"}
                    </small>
                  </div>
                  <div className="branch-workflow-branch-actions">
                    {!branch.current ? <button type="button" disabled={!canMutate} onClick={() => onSwitchBranch(branch.name)}>Switch</button> : null}
                    {!branch.current && branch.mergedIntoDefault ? <button type="button" disabled={!canMutate} onClick={() => onDeleteBranch(branch.name)}>Delete</button> : null}
                  </div>
                </div>
              )) : <p className="branch-workflow-empty">No local branches available.</p>}
            </div>
            {!canMutate && status?.available ? <small>Commit or clean current changes before switching or deleting branches.</small> : null}
          </section>
        </>
      ) : null}
    </section>
  );
}

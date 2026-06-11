import type { BranchType } from "../domain/branchNaming";

type DefaultBranchGuardDialogProps = {
  open: boolean;
  currentBranchLabel: string;
  type: BranchType;
  title: string;
  branchName: string;
  generatedBranchName: string;
  canCreate: boolean;
  creating: boolean;
  error?: string;
  onChangeType: (type: BranchType) => void;
  onChangeTitle: (title: string) => void;
  onChangeBranchName: (name: string) => void;
  onContinueOnDefault: () => void;
  onCreateAndContinue: () => void;
  onClose: () => void;
};

const BRANCH_TYPES: BranchType[] = ["feat", "fix", "chore", "refactor"];

export function DefaultBranchGuardDialog({
  open,
  currentBranchLabel,
  type,
  title,
  branchName,
  generatedBranchName,
  canCreate,
  creating,
  error,
  onChangeType,
  onChangeTitle,
  onChangeBranchName,
  onContinueOnDefault,
  onCreateAndContinue,
  onClose,
}: DefaultBranchGuardDialogProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="extension-ui-dialog branch-guard-dialog" role="dialog" aria-modal="true" aria-label="Create working branch" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>You are on {currentBranchLabel}</h2>
          <p>It is safer to create a working branch before making code changes.</p>
        </header>

        <div className="branch-guard-type-row" aria-label="Branch type">
          {BRANCH_TYPES.map((value) => (
            <button
              key={value}
              type="button"
              className={`branch-guard-type ${value === type ? "selected" : ""}`}
              onClick={() => onChangeType(value)}
            >
              {value}
            </button>
          ))}
        </div>

        <label className="branch-guard-field">
          <span>Title</span>
          <input value={title} placeholder="branch visibility" onChange={(event) => onChangeTitle(event.target.value)} />
        </label>

        <label className="branch-guard-field">
          <span>Branch name</span>
          <input value={branchName} placeholder={generatedBranchName} onChange={(event) => onChangeBranchName(event.target.value)} />
          <small>Suggested: {generatedBranchName}</small>
        </label>

        {error ? <p className="branch-guard-error">{error}</p> : null}

        <footer>
          <button type="button" onClick={onContinueOnDefault}>Continue on default branch</button>
          <button type="button" className="primary" disabled={!canCreate || creating} onClick={onCreateAndContinue}>
            {creating ? "Creating…" : "Create and continue"}
          </button>
        </footer>
      </section>
    </div>
  );
}

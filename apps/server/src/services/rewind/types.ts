export const REWIND_STORE_VERSION = 1;

export type RewindEntryKind = "file" | "symlink" | "deleted";
export type RewindSkipReason =
  | "excluded"
  | "secret"
  | "too_large"
  | "new_bytes_budget_exceeded"
  | "unsupported_type"
  | "symlink_escape"
  | "invalid_path"
  | "read_error";

export interface RewindCapturePolicy {
  maxFileBytes: number;
  maxNewBytes: number;
  excludeNames: Set<string>;
  excludePathPrefixes: string[];
  secretNamePatterns: RegExp[];
}

export interface RewindSnapshotOptions {
  root: string;
  storeRoot?: string;
  policy?: Partial<Pick<RewindCapturePolicy, "maxFileBytes" | "maxNewBytes">>;
  now?: () => number;
  idFactory?: () => string;
}

export interface RewindSnapshotEntry {
  kind: RewindEntryKind;
  relativePath: string;
  mode?: number;
  size?: number;
  mtimeMs?: number;
  hash?: string;
  symlinkTarget?: string;
}

export interface RewindSkippedEntry {
  relativePath: string;
  reason: RewindSkipReason;
  size?: number;
  message?: string;
}

export interface RewindSnapshotSummary {
  capturedFiles: number;
  capturedSymlinks: number;
  deletedEntries: number;
  skipped: number;
  capturedBytes: number;
  newBytes: number;
}

export interface RewindSnapshotManifest {
  storeVersion: typeof REWIND_STORE_VERSION;
  id: string;
  createdAt: number;
  root: string;
  entries: RewindSnapshotEntry[];
  skipped: RewindSkippedEntry[];
  summary: RewindSnapshotSummary;
}

export type RewindPreviewAction = "add" | "modify" | "delete" | "recreate" | "overwrite" | "unchanged" | "skip" | "conflict";

export interface RewindPreviewChange {
  action: RewindPreviewAction;
  relativePath: string;
  reason?: string;
  currentHash?: string;
  targetHash?: string;
  size?: number;
}

export interface RewindPreviewResult {
  snapshotId: string;
  changes: RewindPreviewChange[];
  summary: Record<RewindPreviewAction, number>;
}

export interface RewindRestoreResult {
  ok: boolean;
  snapshotId: string;
  rollbackSnapshotId?: string;
  applied: RewindPreviewChange[];
  error?: string;
}

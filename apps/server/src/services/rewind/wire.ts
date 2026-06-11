import type { RewindCheckpointPreview, RewindCheckpointRestoreResult, RewindCheckpointSummary } from "@pi-gui/shared";
import type { RewindPreviewResult, RewindRestoreResult, RewindSnapshotManifest } from "./types.js";

export function rewindSnapshotSummaryForWire(projectId: string, snapshot: RewindSnapshotManifest): RewindCheckpointSummary {
  return {
    id: snapshot.id,
    projectId,
    root: snapshot.root,
    createdAt: snapshot.createdAt,
    capturedFiles: snapshot.summary.capturedFiles,
    capturedSymlinks: snapshot.summary.capturedSymlinks,
    deletedEntries: snapshot.summary.deletedEntries,
    skipped: snapshot.summary.skipped,
    capturedBytes: snapshot.summary.capturedBytes,
    newBytes: snapshot.summary.newBytes,
  };
}

export function rewindPreviewForWire(projectId: string, preview: RewindPreviewResult): RewindCheckpointPreview {
  return { projectId, snapshotId: preview.snapshotId, changes: preview.changes, summary: preview.summary };
}

export function rewindRestoreResultForWire(projectId: string, result: RewindRestoreResult): RewindCheckpointRestoreResult {
  return {
    projectId,
    snapshotId: result.snapshotId,
    ok: result.ok,
    rollbackSnapshotId: result.rollbackSnapshotId,
    applied: result.applied,
    error: result.error,
  };
}

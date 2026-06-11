import type Database from "better-sqlite3";
import type { RewindCheckpointCaptureSource, RewindCheckpointSummary } from "@pi-gui/shared";

type RewindCheckpointRow = {
  project_id: string;
  snapshot_id: string;
  root: string;
  created_at: number;
  captured_files: number;
  captured_symlinks: number;
  deleted_entries: number;
  skipped: number;
  captured_bytes: number;
  new_bytes: number;
  runtime_id: string | null;
  session_id: string | null;
  target_entry_id: string | null;
  capture_source: RewindCheckpointCaptureSource | null;
};

export class RewindCheckpointStore {
  private readonly listProjectStatement: Database.Statement;
  private readonly upsertStatement: Database.Statement;
  private readonly deleteProjectStatement: Database.Statement;
  private readonly replaceProjectTransaction: (projectId: string, checkpoints: RewindCheckpointSummary[]) => void;

  constructor(private readonly db: Database.Database) {
    this.listProjectStatement = this.db.prepare(
      `select c.*, l.runtime_id, l.session_id, l.target_entry_id, l.capture_source
       from rewind_checkpoints c
       left join rewind_checkpoint_conversation_links l on l.project_id = c.project_id and l.snapshot_id = c.snapshot_id
       where c.project_id = ?
       order by c.created_at desc, c.snapshot_id desc
       limit ?`,
    );
    this.upsertStatement = this.db.prepare(
      `insert into rewind_checkpoints (
         project_id,
         snapshot_id,
         root,
         created_at,
         captured_files,
         captured_symlinks,
         deleted_entries,
         skipped,
         captured_bytes,
         new_bytes,
         indexed_at
       ) values (
         @projectId,
         @id,
         @root,
         @createdAt,
         @capturedFiles,
         @capturedSymlinks,
         @deletedEntries,
         @skipped,
         @capturedBytes,
         @newBytes,
         @indexedAt
       )
       on conflict(project_id, snapshot_id) do update set
         root = excluded.root,
         created_at = excluded.created_at,
         captured_files = excluded.captured_files,
         captured_symlinks = excluded.captured_symlinks,
         deleted_entries = excluded.deleted_entries,
         skipped = excluded.skipped,
         captured_bytes = excluded.captured_bytes,
         new_bytes = excluded.new_bytes,
         indexed_at = excluded.indexed_at`,
    );
    this.deleteProjectStatement = this.db.prepare("delete from rewind_checkpoints where project_id = ?");
    this.replaceProjectTransaction = this.db.transaction((projectId: string, checkpoints: RewindCheckpointSummary[]) => {
      this.deleteProjectStatement.run(projectId);
      for (const checkpoint of checkpoints) this.upsertCheckpoint(checkpoint);
    });
  }

  listCheckpoints(projectId: string, limit = 200): RewindCheckpointSummary[] {
    const boundedLimit = Math.max(1, Math.min(limit, 1000));
    const rows = this.listProjectStatement.all(projectId, boundedLimit) as RewindCheckpointRow[];
    return rows.map(checkpointFromRow);
  }

  upsertCheckpoint(checkpoint: RewindCheckpointSummary): void {
    this.upsertStatement.run({ ...checkpoint, indexedAt: Date.now() });
  }

  replaceProjectCheckpoints(projectId: string, checkpoints: RewindCheckpointSummary[]): void {
    this.replaceProjectTransaction(projectId, checkpoints);
  }
}

function checkpointFromRow(row: RewindCheckpointRow): RewindCheckpointSummary {
  return {
    id: row.snapshot_id,
    projectId: row.project_id,
    root: row.root,
    createdAt: row.created_at,
    capturedFiles: row.captured_files,
    capturedSymlinks: row.captured_symlinks,
    deletedEntries: row.deleted_entries,
    skipped: row.skipped,
    capturedBytes: row.captured_bytes,
    newBytes: row.new_bytes,
    runtimeId: row.runtime_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    targetEntryId: row.target_entry_id ?? undefined,
    captureSource: row.capture_source ?? undefined,
  };
}

import type Database from "better-sqlite3";

export type RewindJumpHistoryEntry = {
  id: number;
  projectId: string;
  snapshotId: string;
  runtimeId: string;
  sourceSessionId?: string;
  targetEntryId: string;
  resultSessionId?: string;
  resultEntryId?: string;
  createdAt: number;
  ok: boolean;
  rollbackSnapshotId?: string;
  error?: string;
};

type RewindJumpHistoryRow = {
  id: number;
  project_id: string;
  snapshot_id: string;
  runtime_id: string;
  source_session_id: string | null;
  target_entry_id: string;
  result_session_id: string | null;
  result_entry_id: string | null;
  created_at: number;
  ok: number;
  rollback_snapshot_id: string | null;
  error: string | null;
};

export class RewindJumpHistoryStore {
  private readonly listRecentStatement: Database.Statement;
  private readonly listRecentForProjectStatement: Database.Statement;
  private readonly insertStatement: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.listRecentStatement = this.db.prepare(
      `select * from rewind_jump_history
       order by id desc
       limit ?`,
    );
    this.listRecentForProjectStatement = this.db.prepare(
      `select * from rewind_jump_history
       where project_id = ?
       order by id desc
       limit ?`,
    );
    this.insertStatement = this.db.prepare(
      `insert into rewind_jump_history (
         project_id,
         snapshot_id,
         runtime_id,
         source_session_id,
         target_entry_id,
         result_session_id,
         result_entry_id,
         created_at,
         ok,
         rollback_snapshot_id,
         error
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  listRecent(limit = 50, projectId?: string): RewindJumpHistoryEntry[] {
    const boundedLimit = Math.max(1, Math.min(limit, 500));
    const rows = (
      projectId
        ? this.listRecentForProjectStatement.all(projectId, boundedLimit)
        : this.listRecentStatement.all(boundedLimit)
    ) as RewindJumpHistoryRow[];
    return rows.reverse().map(entryFromRow);
  }

  append(entry: Omit<RewindJumpHistoryEntry, "id">): RewindJumpHistoryEntry {
    const result = this.insertStatement.run(
      entry.projectId,
      entry.snapshotId,
      entry.runtimeId,
      entry.sourceSessionId ?? null,
      entry.targetEntryId,
      entry.resultSessionId ?? null,
      entry.resultEntryId ?? null,
      entry.createdAt,
      entry.ok ? 1 : 0,
      entry.rollbackSnapshotId ?? null,
      entry.error ?? null,
    );
    return {
      id: Number(result.lastInsertRowid),
      ...entry,
    };
  }
}

function entryFromRow(row: RewindJumpHistoryRow): RewindJumpHistoryEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    snapshotId: row.snapshot_id,
    runtimeId: row.runtime_id,
    sourceSessionId: row.source_session_id ?? undefined,
    targetEntryId: row.target_entry_id,
    resultSessionId: row.result_session_id ?? undefined,
    resultEntryId: row.result_entry_id ?? undefined,
    createdAt: row.created_at,
    ok: row.ok !== 0,
    rollbackSnapshotId: row.rollback_snapshot_id ?? undefined,
    error: row.error ?? undefined,
  };
}

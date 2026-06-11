import type Database from "better-sqlite3";
import type { RewindCheckpointOperation } from "@pi-gui/shared";

type RewindCheckpointOperationRow = {
  id: number;
  project_id: string;
  kind: RewindCheckpointOperation["kind"];
  snapshot_id: string;
  created_at: number;
  ok: number;
  rollback_snapshot_id: string | null;
  error: string | null;
};

export class RewindCheckpointOperationStore {
  private readonly listRecentStatement: Database.Statement;
  private readonly insertStatement: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.listRecentStatement = this.db.prepare(
      `select * from rewind_checkpoint_operations
       order by id desc
       limit ?`,
    );
    this.insertStatement = this.db.prepare(
      `insert into rewind_checkpoint_operations (
         project_id,
         kind,
         snapshot_id,
         created_at,
         ok,
         rollback_snapshot_id,
         error
       ) values (?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  listRecent(limit = 20): RewindCheckpointOperation[] {
    const boundedLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.listRecentStatement.all(boundedLimit) as RewindCheckpointOperationRow[];
    return rows.reverse().map(operationFromRow);
  }

  appendOperation(input: Omit<RewindCheckpointOperation, "id">): RewindCheckpointOperation {
    const result = this.insertStatement.run(
      input.projectId,
      input.kind,
      input.snapshotId,
      input.createdAt,
      input.ok ? 1 : 0,
      input.rollbackSnapshotId ?? null,
      input.error ?? null,
    );
    return {
      id: Number(result.lastInsertRowid),
      ...input,
    };
  }
}

function operationFromRow(row: RewindCheckpointOperationRow): RewindCheckpointOperation {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    snapshotId: row.snapshot_id,
    createdAt: row.created_at,
    ok: row.ok !== 0,
    rollbackSnapshotId: row.rollback_snapshot_id ?? undefined,
    error: row.error ?? undefined,
  };
}

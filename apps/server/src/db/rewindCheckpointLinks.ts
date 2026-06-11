import type Database from "better-sqlite3";
import type { RewindCheckpointCaptureSource } from "@pi-gui/shared";

export type RewindCheckpointConversationLink = {
  projectId: string;
  snapshotId: string;
  runtimeId?: string;
  sessionId?: string;
  targetEntryId?: string;
  captureSource: RewindCheckpointCaptureSource;
  createdAt: number;
};

type RewindCheckpointConversationLinkRow = {
  project_id: string;
  snapshot_id: string;
  runtime_id: string | null;
  session_id: string | null;
  target_entry_id: string | null;
  capture_source: RewindCheckpointCaptureSource;
  created_at: number;
};

export class RewindCheckpointLinkStore {
  private readonly getStatement: Database.Statement;
  private readonly upsertStatement: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.getStatement = this.db.prepare(
      `select * from rewind_checkpoint_conversation_links
       where project_id = ? and snapshot_id = ?`,
    );
    this.upsertStatement = this.db.prepare(
      `insert into rewind_checkpoint_conversation_links (
         project_id,
         snapshot_id,
         runtime_id,
         session_id,
         target_entry_id,
         capture_source,
         created_at
       ) values (
         @projectId,
         @snapshotId,
         @runtimeId,
         @sessionId,
         @targetEntryId,
         @captureSource,
         @createdAt
       )
       on conflict(project_id, snapshot_id) do update set
         runtime_id = excluded.runtime_id,
         session_id = excluded.session_id,
         target_entry_id = coalesce(excluded.target_entry_id, rewind_checkpoint_conversation_links.target_entry_id),
         capture_source = excluded.capture_source,
         created_at = excluded.created_at`,
    );
  }

  getConversationLink(projectId: string, snapshotId: string): RewindCheckpointConversationLink | undefined {
    const row = this.getStatement.get(projectId, snapshotId) as RewindCheckpointConversationLinkRow | undefined;
    return row ? linkFromRow(row) : undefined;
  }

  upsertConversationLink(link: RewindCheckpointConversationLink): void {
    this.upsertStatement.run({
      projectId: link.projectId,
      snapshotId: link.snapshotId,
      runtimeId: link.runtimeId ?? null,
      sessionId: link.sessionId ?? null,
      targetEntryId: link.targetEntryId ?? null,
      captureSource: link.captureSource,
      createdAt: link.createdAt,
    });
  }
}

function linkFromRow(row: RewindCheckpointConversationLinkRow): RewindCheckpointConversationLink {
  return {
    projectId: row.project_id,
    snapshotId: row.snapshot_id,
    runtimeId: row.runtime_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    targetEntryId: row.target_entry_id ?? undefined,
    captureSource: row.capture_source,
    createdAt: row.created_at,
  };
}

import type Database from "better-sqlite3";
import type { Runtime } from "@pi-gui/shared";
import { runtimeFromRow } from "./mappers.js";
import type { RuntimeRow } from "./rows.js";

export class RuntimeStore {
  constructor(private readonly db: Database.Database) {}

  upsertRuntime(runtime: Runtime): Runtime {
    const now = Date.now();
    this.db
      .prepare(
        `insert into runtimes (id, project_id, cwd, status, pid, session_id, started_at, archived_at, model, thinking_level, response_mode, created_at, updated_at)
         values (@id, @projectId, @cwd, @status, @pid, @sessionId, @startedAt, @archivedAt, @model, @thinkingLevel, @responseMode, @createdAt, @updatedAt)
         on conflict(id) do update set
           status = excluded.status,
           pid = excluded.pid,
           session_id = excluded.session_id,
           started_at = excluded.started_at,
           archived_at = coalesce(excluded.archived_at, runtimes.archived_at),
           model = excluded.model,
           thinking_level = excluded.thinking_level,
           response_mode = excluded.response_mode,
           updated_at = excluded.updated_at`,
      )
      .run({
        id: runtime.id,
        projectId: runtime.projectId,
        cwd: runtime.cwd,
        status: runtime.status,
        pid: runtime.pid ?? null,
        sessionId: runtime.sessionId ?? null,
        startedAt: runtime.startedAt ?? null,
        archivedAt: runtime.archivedAt ?? null,
        model: runtime.model ?? null,
        thinkingLevel: runtime.thinkingLevel ?? null,
        responseMode: runtime.responseMode ?? null,
        createdAt: now,
        updatedAt: now,
      });
    return runtime;
  }

  listRuntimes(limit = 100): Runtime[] {
    const boundedLimit = Math.max(1, Math.min(limit, 1000));
    const rows = this.db
      .prepare("select * from runtimes order by updated_at desc limit ?")
      .all(boundedLimit) as RuntimeRow[];
    return rows.map(runtimeFromRow);
  }

  getRuntime(id: string): Runtime | undefined {
    const row = this.db.prepare("select * from runtimes where id = ?").get(id) as RuntimeRow | undefined;
    return row ? runtimeFromRow(row) : undefined;
  }

  getLatestRuntimeBySessionId(sessionId: string): Runtime | undefined {
    const row = this.db
      .prepare("select * from runtimes where session_id = ? and archived_at is null order by updated_at desc limit 1")
      .get(sessionId) as RuntimeRow | undefined;
    return row ? runtimeFromRow(row) : undefined;
  }

  archiveRuntime(id: string, timestamp = Date.now()): Runtime | undefined {
    this.db
      .prepare("update runtimes set archived_at = coalesce(archived_at, ?), updated_at = ? where id = ?")
      .run(timestamp, timestamp, id);
    return this.getRuntime(id);
  }

  archiveStoppedRuntimesWithoutSessions(): void {
    const timestamp = Date.now();
    this.db
      .prepare(
        `update runtimes
         set archived_at = ?, updated_at = ?
         where status = 'stopped' and session_id is null and archived_at is null`,
      )
      .run(timestamp, timestamp);
  }

  markOrphanedRuntimesCrashed(): void {
    const orphaned = this.db
      .prepare("select * from runtimes where status in ('starting', 'running')")
      .all() as RuntimeRow[];
    if (orphaned.length === 0) return;

    const timestamp = Date.now();
    const updateRuntimes = this.db.prepare(
      `update runtimes
       set status = 'crashed', pid = null, ended_at = coalesce(ended_at, ?), updated_at = ?
       where status in ('starting', 'running')`,
    );
    const insertEvent = this.db.prepare(
      `insert into events (runtime_id, project_id, timestamp, kind, payload)
       values (?, ?, ?, ?, ?)`,
    );
    const clearBusy = this.db.prepare(
      `update runtime_conversation_state
       set busy = 0, updated_at = ?
       where runtime_id = ?`,
    );

    this.db.transaction((rows: RuntimeRow[]) => {
      updateRuntimes.run(timestamp, timestamp);
      for (const row of rows) {
        const crashedRuntime = runtimeFromRow({ ...row, status: "crashed", pid: null });
        clearBusy.run(timestamp, row.id);
        insertEvent.run(row.id, row.project_id, timestamp, "runtime_status", JSON.stringify(crashedRuntime));
        insertEvent.run(
          row.id,
          row.project_id,
          timestamp,
          "error",
          JSON.stringify({
            message: "GUI server restarted while this runtime was running; the previous Pi RPC process cannot be reattached.",
            reason: "orphaned_runtime_on_startup",
            previousStatus: row.status,
            previousPid: row.pid,
            status: "crashed",
          }),
        );
      }
    })(orphaned);
  }
}

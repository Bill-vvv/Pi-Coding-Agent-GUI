import type Database from "better-sqlite3";
import type { ExecutionHostRef, Runtime } from "@pi-gui/shared";
import { runtimeFromRow } from "./mappers.js";
import type { RuntimeRow } from "./rows.js";

export class RuntimeStore {
  constructor(
    private readonly db: Database.Database,
    private readonly executionHost?: ExecutionHostRef,
  ) {}

  upsertRuntime(runtime: Runtime): Runtime {
    const now = Date.now();
    const host = runtime.host ?? this.executionHost;
    const nextRuntime = host ? { ...runtime, host } : runtime;
    this.db
      .prepare(
        `insert into runtimes (id, project_id, cwd, status, pid, session_id, started_at, archived_at, model, thinking_level, response_mode, host_kind, host_id, host_label, runtime_profile_id, enabled_capability_ids_json, created_at, updated_at)
         values (@id, @projectId, @cwd, @status, @pid, @sessionId, @startedAt, @archivedAt, @model, @thinkingLevel, @responseMode, @hostKind, @hostId, @hostLabel, @runtimeProfileId, @enabledCapabilityIdsJson, @createdAt, @updatedAt)
         on conflict(id) do update set
           status = excluded.status,
           pid = excluded.pid,
           session_id = excluded.session_id,
           started_at = excluded.started_at,
           archived_at = coalesce(excluded.archived_at, runtimes.archived_at),
           model = excluded.model,
           thinking_level = excluded.thinking_level,
           response_mode = excluded.response_mode,
           host_kind = coalesce(excluded.host_kind, runtimes.host_kind),
           host_id = coalesce(excluded.host_id, runtimes.host_id),
           host_label = coalesce(excluded.host_label, runtimes.host_label),
           runtime_profile_id = coalesce(excluded.runtime_profile_id, runtimes.runtime_profile_id),
           enabled_capability_ids_json = coalesce(excluded.enabled_capability_ids_json, runtimes.enabled_capability_ids_json),
           updated_at = excluded.updated_at`,
      )
      .run({
        id: nextRuntime.id,
        projectId: nextRuntime.projectId,
        cwd: nextRuntime.cwd,
        status: nextRuntime.status,
        pid: nextRuntime.pid ?? null,
        sessionId: nextRuntime.sessionId ?? null,
        startedAt: nextRuntime.startedAt ?? null,
        archivedAt: nextRuntime.archivedAt ?? null,
        model: nextRuntime.model ?? null,
        thinkingLevel: nextRuntime.thinkingLevel ?? null,
        responseMode: nextRuntime.responseMode ?? null,
        hostKind: nextRuntime.host?.kind ?? null,
        hostId: nextRuntime.host?.id ?? null,
        hostLabel: nextRuntime.host?.label ?? null,
        runtimeProfileId: nextRuntime.runtimeProfileId ?? null,
        enabledCapabilityIdsJson: nextRuntime.enabledCapabilityIds ? JSON.stringify(nextRuntime.enabledCapabilityIds) : null,
        createdAt: now,
        updatedAt: now,
      });
    return nextRuntime;
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

  markOrphanedRuntimesCrashed(): Runtime[] {
    const orphaned = this.db
      .prepare("select * from runtimes where status in ('starting', 'running')")
      .all() as RuntimeRow[];
    if (orphaned.length === 0) return [];

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

    const crashedRuntimes = orphaned.map((row) => runtimeFromRow({ ...row, status: "crashed", pid: null }));
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
    return crashedRuntimes;
  }
}

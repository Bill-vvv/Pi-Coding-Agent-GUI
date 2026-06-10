import type Database from "better-sqlite3";
import type { ExecutionHostRef, GuiSession } from "@pi-gui/shared";
import { sessionFromRow } from "./mappers.js";
import type { SessionRow } from "./rows.js";

export class SessionStore {
  constructor(
    private readonly db: Database.Database,
    private readonly executionHost?: ExecutionHostRef,
  ) {}

  listSessions(projectId?: string, limit = 200): GuiSession[] {
    const boundedLimit = Math.max(1, Math.min(limit, 1000));
    const rows = projectId
      ? (this.db
          .prepare("select * from sessions where project_id = ? order by updated_at desc limit ?")
          .all(projectId, boundedLimit) as SessionRow[])
      : (this.db.prepare("select * from sessions order by updated_at desc limit ?").all(boundedLimit) as SessionRow[]);
    return rows.map(sessionFromRow);
  }

  getSession(id: string): GuiSession | undefined {
    const row = this.db.prepare("select * from sessions where id = ?").get(id) as SessionRow | undefined;
    return row ? sessionFromRow(row) : undefined;
  }

  upsertSession(session: GuiSession): GuiSession {
    const host = session.host ?? this.executionHost;
    const nextSession = host ? { ...session, host } : session;
    this.db
      .prepare(
        `insert into sessions (id, project_id, pi_session_file, title, created_at, updated_at, runtime_id, host_kind, host_id, host_label)
         values (@id, @projectId, @piSessionFile, @title, @createdAt, @updatedAt, @runtimeId, @hostKind, @hostId, @hostLabel)
         on conflict(id) do update set
           project_id = excluded.project_id,
           pi_session_file = excluded.pi_session_file,
           title = coalesce(excluded.title, sessions.title),
           updated_at = excluded.updated_at,
           runtime_id = coalesce(excluded.runtime_id, sessions.runtime_id),
           host_kind = coalesce(excluded.host_kind, sessions.host_kind),
           host_id = coalesce(excluded.host_id, sessions.host_id),
           host_label = coalesce(excluded.host_label, sessions.host_label)`,
      )
      .run({
        id: nextSession.id,
        projectId: nextSession.projectId,
        piSessionFile: nextSession.piSessionFile,
        title: nextSession.title ?? null,
        createdAt: nextSession.createdAt,
        updatedAt: nextSession.updatedAt,
        runtimeId: nextSession.runtimeId ?? null,
        hostKind: nextSession.host?.kind ?? null,
        hostId: nextSession.host?.id ?? null,
        hostLabel: nextSession.host?.label ?? null,
      });
    return this.getSession(nextSession.id) ?? nextSession;
  }
}

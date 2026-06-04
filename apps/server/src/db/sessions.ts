import type Database from "better-sqlite3";
import type { GuiSession } from "@pi-gui/shared";
import { sessionFromRow } from "./mappers.js";
import type { SessionRow } from "./rows.js";

export class SessionStore {
  constructor(private readonly db: Database.Database) {}

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
    this.db
      .prepare(
        `insert into sessions (id, project_id, pi_session_file, title, created_at, updated_at, runtime_id)
         values (@id, @projectId, @piSessionFile, @title, @createdAt, @updatedAt, @runtimeId)
         on conflict(id) do update set
           project_id = excluded.project_id,
           pi_session_file = excluded.pi_session_file,
           title = coalesce(excluded.title, sessions.title),
           updated_at = excluded.updated_at,
           runtime_id = coalesce(excluded.runtime_id, sessions.runtime_id)`,
      )
      .run({
        id: session.id,
        projectId: session.projectId,
        piSessionFile: session.piSessionFile,
        title: session.title ?? null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        runtimeId: session.runtimeId ?? null,
      });
    return this.getSession(session.id) ?? session;
  }
}

import type Database from "better-sqlite3";
import type { ExecutionHostRef, GuiSession } from "@pi-gui/shared";
import { sessionFromRow } from "./mappers.js";
import type { SessionRow } from "./rows.js";

export type SessionListPage = {
  sessions: GuiSession[];
  hasMore: boolean;
  nextCursor?: string;
};

export class SessionStore {
  constructor(
    private readonly db: Database.Database,
    private readonly executionHost?: ExecutionHostRef,
  ) {}

  listSessions(projectId?: string, limit = 200): GuiSession[] {
    return this.listSessionsPage(projectId, limit).sessions;
  }

  listSessionsPage(projectId?: string, limit = 200, cursor?: string): SessionListPage {
    const boundedLimit = Math.max(1, Math.min(limit, 1000));
    const decodedCursor = decodeSessionCursor(cursor);
    const rows = this.querySessionRows(projectId, boundedLimit + 1, decodedCursor);
    const visibleRows = rows.slice(0, boundedLimit);
    const sessions = visibleRows.map(sessionFromRow);
    return {
      sessions,
      hasMore: rows.length > boundedLimit,
      nextCursor: rows.length > boundedLimit ? sessionCursorFromRow(visibleRows.at(-1)) : undefined,
    };
  }

  private querySessionRows(projectId: string | undefined, limit: number, cursor: SessionCursor | undefined): SessionRow[] {
    if (projectId && cursor) {
      return this.db
        .prepare("select * from sessions where project_id = ? and (updated_at < ? or (updated_at = ? and id < ?)) order by updated_at desc, id desc limit ?")
        .all(projectId, cursor.updatedAt, cursor.updatedAt, cursor.id, limit) as SessionRow[];
    }
    if (projectId) {
      return this.db
        .prepare("select * from sessions where project_id = ? order by updated_at desc, id desc limit ?")
        .all(projectId, limit) as SessionRow[];
    }
    if (cursor) {
      return this.db
        .prepare("select * from sessions where updated_at < ? or (updated_at = ? and id < ?) order by updated_at desc, id desc limit ?")
        .all(cursor.updatedAt, cursor.updatedAt, cursor.id, limit) as SessionRow[];
    }
    return this.db.prepare("select * from sessions order by updated_at desc, id desc limit ?").all(limit) as SessionRow[];
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

type SessionCursor = { updatedAt: number; id: string };

export function sessionCursorFromSession(session: Pick<GuiSession, "updatedAt" | "id"> | undefined): string | undefined {
  if (!session) return undefined;
  return Buffer.from(JSON.stringify({ updatedAt: session.updatedAt, id: session.id }), "utf8").toString("base64url");
}

function sessionCursorFromRow(row: SessionRow | undefined): string | undefined {
  if (!row) return undefined;
  return sessionCursorFromSession({ updatedAt: row.updated_at, id: row.id });
}

function decodeSessionCursor(cursor: string | undefined): SessionCursor | undefined {
  if (!cursor?.trim()) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const value = parsed as { updatedAt?: unknown; id?: unknown };
    if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) || typeof value.id !== "string") return undefined;
    return { updatedAt: value.updatedAt, id: value.id };
  } catch {
    return undefined;
  }
}

import type Database from "better-sqlite3";

export type SessionFileSummaryCacheContext = {
  parserVersion: number;
};

export type SessionFileSummaryCacheEntry = SessionFileSummaryCacheContext & {
  filePath: string;
  mtimeMs: number;
  size: number;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  title?: string;
  detail?: string;
  summaryUpdatedAt?: number;
  messageCount: number;
  latestAssistantCompletedAt?: number;
  cacheUpdatedAt: number;
};

type SessionFileSummaryCacheRow = {
  file_path: string;
  parser_version: number;
  mtime_ms: number;
  size: number;
  session_id: string | null;
  cwd: string | null;
  timestamp: string | null;
  title: string | null;
  detail: string | null;
  summary_updated_at: number | null;
  message_count: number;
  latest_assistant_completed_at: number | null;
  cache_updated_at: number;
};

export class SessionFileSummaryCacheStore {
  constructor(private readonly db: Database.Database) {}

  getFileSummary(filePath: string, context: SessionFileSummaryCacheContext): SessionFileSummaryCacheEntry | undefined {
    const row = this.db
      .prepare(
        `select * from session_file_summary_cache
         where file_path = ? and parser_version = ?`,
      )
      .get(filePath, context.parserVersion) as SessionFileSummaryCacheRow | undefined;
    return row ? sessionFileSummaryCacheFromRow(row) : undefined;
  }

  upsertFileSummary(entry: SessionFileSummaryCacheEntry): void {
    this.db
      .prepare(
        `insert into session_file_summary_cache (
           file_path,
           parser_version,
           mtime_ms,
           size,
           session_id,
           cwd,
           timestamp,
           title,
           detail,
           summary_updated_at,
           message_count,
           latest_assistant_completed_at,
           cache_updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(file_path) do update set
           parser_version = excluded.parser_version,
           mtime_ms = excluded.mtime_ms,
           size = excluded.size,
           session_id = excluded.session_id,
           cwd = excluded.cwd,
           timestamp = excluded.timestamp,
           title = excluded.title,
           detail = excluded.detail,
           summary_updated_at = excluded.summary_updated_at,
           message_count = excluded.message_count,
           latest_assistant_completed_at = excluded.latest_assistant_completed_at,
           cache_updated_at = excluded.cache_updated_at`,
      )
      .run(
        entry.filePath,
        entry.parserVersion,
        entry.mtimeMs,
        entry.size,
        entry.sessionId ?? null,
        entry.cwd ?? null,
        entry.timestamp ?? null,
        entry.title ?? null,
        entry.detail ?? null,
        entry.summaryUpdatedAt ?? null,
        entry.messageCount,
        entry.latestAssistantCompletedAt ?? null,
        entry.cacheUpdatedAt,
      );
  }

  deleteFileSummary(filePath: string): void {
    this.db.prepare("delete from session_file_summary_cache where file_path = ?").run(filePath);
  }
}

function sessionFileSummaryCacheFromRow(row: SessionFileSummaryCacheRow): SessionFileSummaryCacheEntry {
  return {
    filePath: row.file_path,
    parserVersion: row.parser_version,
    mtimeMs: row.mtime_ms,
    size: row.size,
    sessionId: row.session_id ?? undefined,
    cwd: row.cwd ?? undefined,
    timestamp: row.timestamp ?? undefined,
    title: row.title ?? undefined,
    detail: row.detail ?? undefined,
    summaryUpdatedAt: row.summary_updated_at ?? undefined,
    messageCount: row.message_count,
    latestAssistantCompletedAt: row.latest_assistant_completed_at ?? undefined,
    cacheUpdatedAt: row.cache_updated_at,
  };
}

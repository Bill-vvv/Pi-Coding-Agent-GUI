import type Database from "better-sqlite3";
import type { ConversationTokenUsage } from "@pi-gui/shared";

export type SessionTokenUsageCacheContext = {
  parserVersion: number;
  maxLineBytes: number;
};

export type SessionTokenUsageCacheEntry = SessionTokenUsageCacheContext & {
  filePath: string;
  mtimeMs: number;
  size: number;
  usageJson: string;
  updatedAt: number;
};

type SessionTokenUsageCacheRow = {
  file_path: string;
  parser_version: number;
  max_line_bytes: number;
  mtime_ms: number;
  size: number;
  usage_json: string;
  updated_at: number;
};

export class SessionTokenUsageCacheStore {
  constructor(private readonly db: Database.Database) {}

  getFileUsage(filePath: string, context: SessionTokenUsageCacheContext): SessionTokenUsageCacheEntry | undefined {
    const row = this.db
      .prepare(
        `select * from session_token_usage_cache
         where file_path = ? and parser_version = ? and max_line_bytes = ?`,
      )
      .get(filePath, context.parserVersion, context.maxLineBytes) as SessionTokenUsageCacheRow | undefined;
    return row ? sessionTokenUsageCacheFromRow(row) : undefined;
  }

  upsertFileUsage(entry: SessionTokenUsageCacheEntry): void {
    this.db
      .prepare(
        `insert into session_token_usage_cache (
           file_path,
           parser_version,
           max_line_bytes,
           mtime_ms,
           size,
           usage_json,
           updated_at
         ) values (?, ?, ?, ?, ?, ?, ?)
         on conflict(file_path) do update set
           parser_version = excluded.parser_version,
           max_line_bytes = excluded.max_line_bytes,
           mtime_ms = excluded.mtime_ms,
           size = excluded.size,
           usage_json = excluded.usage_json,
           updated_at = excluded.updated_at`,
      )
      .run(entry.filePath, entry.parserVersion, entry.maxLineBytes, entry.mtimeMs, entry.size, entry.usageJson, entry.updatedAt);
  }

  deleteFileUsage(filePath: string): void {
    this.db.prepare("delete from session_token_usage_cache where file_path = ?").run(filePath);
  }
}

export function serializeConversationTokenUsage(usage: ConversationTokenUsage): string {
  return JSON.stringify(usage);
}

export function deserializeConversationTokenUsage(value: string): ConversationTokenUsage | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<ConversationTokenUsage>;
    if (!parsed || typeof parsed !== "object") return undefined;
    const usage: ConversationTokenUsage = {
      input: finiteNumberOrUndefined(parsed.input),
      output: finiteNumberOrUndefined(parsed.output),
      cacheRead: finiteNumberOrUndefined(parsed.cacheRead),
      cacheWrite: finiteNumberOrUndefined(parsed.cacheWrite),
      total: finiteNumberOrUndefined(parsed.total),
      cost: finiteNumberOrUndefined(parsed.cost),
    };
    return Object.values(usage).some((value) => value !== undefined) ? usage : undefined;
  } catch {
    return undefined;
  }
}

function sessionTokenUsageCacheFromRow(row: SessionTokenUsageCacheRow): SessionTokenUsageCacheEntry {
  return {
    filePath: row.file_path,
    parserVersion: row.parser_version,
    maxLineBytes: row.max_line_bytes,
    mtimeMs: row.mtime_ms,
    size: row.size,
    usageJson: row.usage_json,
    updatedAt: row.updated_at,
  };
}

function finiteNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

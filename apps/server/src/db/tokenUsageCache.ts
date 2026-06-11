import type Database from "better-sqlite3";

export type TokenUsageCacheContext = {
  parserVersion: number;
  maxLineBytes: number;
  projectFingerprint: string;
};

export type TokenUsageFileCacheEntry = TokenUsageCacheContext & {
  filePath: string;
  mtimeMs: number;
  size: number;
  contributionJson: string;
  updatedAt: number;
};

type TokenUsageFileCacheRow = {
  file_path: string;
  parser_version: number;
  max_line_bytes: number;
  project_fingerprint: string;
  mtime_ms: number;
  size: number;
  contribution_json: string;
  updated_at: number;
};

export class TokenUsageCacheStore {
  constructor(private readonly db: Database.Database) {}

  getFileCache(filePath: string, context: TokenUsageCacheContext): TokenUsageFileCacheEntry | undefined {
    const row = this.db
      .prepare(
        `select * from token_usage_file_cache
         where file_path = ?
           and parser_version = ?
           and max_line_bytes = ?
           and project_fingerprint = ?`,
      )
      .get(filePath, context.parserVersion, context.maxLineBytes, context.projectFingerprint) as TokenUsageFileCacheRow | undefined;
    return row ? tokenUsageFileCacheFromRow(row) : undefined;
  }

  upsertFileCache(entry: TokenUsageFileCacheEntry): void {
    this.db
      .prepare(
        `insert into token_usage_file_cache (
           file_path,
           parser_version,
           max_line_bytes,
           project_fingerprint,
           mtime_ms,
           size,
           contribution_json,
           updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(file_path) do update set
           parser_version = excluded.parser_version,
           max_line_bytes = excluded.max_line_bytes,
           project_fingerprint = excluded.project_fingerprint,
           mtime_ms = excluded.mtime_ms,
           size = excluded.size,
           contribution_json = excluded.contribution_json,
           updated_at = excluded.updated_at`,
      )
      .run(entry.filePath, entry.parserVersion, entry.maxLineBytes, entry.projectFingerprint, entry.mtimeMs, entry.size, entry.contributionJson, entry.updatedAt);
  }

  deleteFileCache(filePath: string): void {
    this.db.prepare("delete from token_usage_file_cache where file_path = ?").run(filePath);
  }
}

function tokenUsageFileCacheFromRow(row: TokenUsageFileCacheRow): TokenUsageFileCacheEntry {
  return {
    filePath: row.file_path,
    parserVersion: row.parser_version,
    maxLineBytes: row.max_line_bytes,
    projectFingerprint: row.project_fingerprint,
    mtimeMs: row.mtime_ms,
    size: row.size,
    contributionJson: row.contribution_json,
    updatedAt: row.updated_at,
  };
}

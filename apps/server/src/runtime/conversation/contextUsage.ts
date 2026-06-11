import type { ConversationContextUsage, ConversationTokenUsage } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { AppDatabase } from "../../db.js";
import { deserializeConversationTokenUsage, serializeConversationTokenUsage } from "../../db/sessionTokenUsageCache.js";
import { DEFAULT_MAX_USAGE_LINE_BYTES, parseJsonRecord, processJsonlLines, safeStat, usageFromRecord } from "../../services/tokenUsage/index.js";

const SESSION_TOKEN_USAGE_CACHE_PARSER_VERSION = 1;

export function contextUsageFromSessionStats(data: Record<string, unknown>, currentContextWindow?: number, db?: AppDatabase): ConversationContextUsage | undefined {
  const contextUsage = isRecord(data.contextUsage) ? data.contextUsage : undefined;
  // Pi stats are derived from active state.messages, which can shrink after compaction.
  // Session files preserve historical assistant usage, so they are the preferred cumulative source.
  const sessionTokens = sessionTokensFromSessionFile(data, db) ?? sessionTokensFromStats(data);
  if (!contextUsage && !sessionTokens) return undefined;

  const tokens = contextUsage ? numberOrNullOrUndefined(contextUsage.tokens) : undefined;
  const contextWindow = (contextUsage ? numberOrUndefined(contextUsage.contextWindow) : undefined) ?? currentContextWindow;
  const reportedPercent = contextUsage ? numberOrNullOrUndefined(contextUsage.percent) : undefined;
  return {
    tokens,
    contextWindow,
    percent: typeof tokens === "number" && contextWindow !== undefined && contextWindow > 0 ? (tokens / contextWindow) * 100 : reportedPercent,
    sessionTokens,
    updatedAt: Date.now(),
  };
}

function sessionTokensFromStats(data: Record<string, unknown>): ConversationTokenUsage | undefined {
  const tokens = isRecord(data.tokens) ? data.tokens : undefined;
  if (!tokens) return undefined;
  const usage: ConversationTokenUsage = {
    input: numberOrUndefined(tokens.input),
    output: numberOrUndefined(tokens.output),
    cacheRead: numberOrUndefined(tokens.cacheRead),
    cacheWrite: numberOrUndefined(tokens.cacheWrite),
    total: numberOrUndefined(tokens.total) ?? numberOrUndefined(tokens.totalTokens),
    cost: numberOrUndefined(data.cost),
  };
  return hasAnyUsageValue(usage) ? usage : undefined;
}

function sessionTokensFromSessionFile(data: Record<string, unknown>, db?: AppDatabase): ConversationTokenUsage | undefined {
  const sessionFile = typeof data.sessionFile === "string" && data.sessionFile.trim() ? data.sessionFile : undefined;
  if (!sessionFile) return undefined;
  const stats = safeStat(sessionFile);
  if (!stats) return undefined;

  const context = { parserVersion: SESSION_TOKEN_USAGE_CACHE_PARSER_VERSION, maxLineBytes: DEFAULT_MAX_USAGE_LINE_BYTES };
  const cached = db?.getSessionTokenUsageCache(sessionFile, context);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    const usage = deserializeConversationTokenUsage(cached.usageJson);
    if (usage) return usage;
    db?.deleteSessionTokenUsageCache(sessionFile);
  }

  const usage = parseSessionTokenUsage(sessionFile);
  if (!usage) return undefined;
  db?.upsertSessionTokenUsageCache({
    ...context,
    filePath: sessionFile,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    usageJson: serializeConversationTokenUsage(usage),
    updatedAt: Date.now(),
  });
  return usage;
}

function parseSessionTokenUsage(sessionFile: string): ConversationTokenUsage | undefined {
  const usage: ConversationTokenUsage = {};
  const readOk = processJsonlLines(sessionFile, DEFAULT_MAX_USAGE_LINE_BYTES, (line, truncated) => {
    if (truncated) return;
    const record = parseJsonRecord(line.trim());
    if (!record || record.type !== "message") return;
    const message = isRecord(record.message) ? record.message : undefined;
    if (!message || message.role !== "assistant" || !isRecord(message.usage)) return;
    const parsed = usageFromRecord(message.usage);
    if (!parsed || parsed.total === undefined || parsed.total <= 0) return;
    usage.input = addOptional(usage.input, parsed.input);
    usage.output = addOptional(usage.output, parsed.output);
    usage.cacheRead = addOptional(usage.cacheRead, parsed.cacheRead);
    usage.cacheWrite = addOptional(usage.cacheWrite, parsed.cacheWrite);
    usage.total = (usage.total ?? 0) + parsed.total;
    usage.cost = addOptional(usage.cost, parsed.cost);
  });
  return readOk && hasAnyUsageValue(usage) ? usage : undefined;
}

function addOptional(left: number | undefined, right: number | undefined): number | undefined {
  return right === undefined ? left : (left ?? 0) + right;
}

function hasAnyUsageValue(usage: ConversationTokenUsage): boolean {
  return Object.values(usage).some((value) => value !== undefined);
}

export function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberOrNullOrUndefined(value: unknown): number | null | undefined {
  return value === null ? null : numberOrUndefined(value);
}

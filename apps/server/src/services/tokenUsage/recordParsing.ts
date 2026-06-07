import { isRecord } from "@pi-gui/shared";
import type { ModelContext, ParsedUsage, SessionMetadata } from "./types.js";

export function parseJsonRecord(line: string): Record<string, unknown> | undefined {
  if (!line.trim()) return undefined;
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function sessionMetadataFromLine(line: string | undefined): SessionMetadata | undefined {
  const record = parseJsonRecord(line ?? "");
  if (!record || record.type !== "session") return undefined;
  return {
    id: stringField(record.id),
    cwd: stringField(record.cwd),
    timestamp: timestampFromValue(record.timestamp),
  };
}

export function usageFromRecord(record: Record<string, unknown>): ParsedUsage | undefined {
  const input = firstNumber(record, ["input", "inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]);
  const output = firstNumber(record, ["output", "outputTokens", "output_tokens", "completionTokens", "completion_tokens"]);
  const cacheRead = firstNumber(record, ["cacheRead", "cacheReadTokens", "cache_read", "cache_read_tokens", "cacheReadInputTokens", "cache_read_input_tokens"]);
  const cacheWrite = firstNumber(record, ["cacheWrite", "cacheWriteTokens", "cache_write", "cache_write_tokens", "cacheCreationTokens", "cache_creation_tokens", "cacheCreationInputTokens", "cache_creation_input_tokens"]);
  const explicitTotal = firstNumber(record, ["totalTokens", "total_tokens", "tokenCount", "token_count", "tokens"]);
  const computed = (input ?? 0) + (output ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
  const total = explicitTotal ?? (computed > 0 ? computed : undefined);
  if (total === undefined) return undefined;
  const cost = costFromValue(record.cost);
  return { input, output, cacheRead, cacheWrite, cost, total };
}

export function modelContextFromRecord(record: Record<string, unknown>, fallback: ModelContext): ModelContext {
  return {
    provider: stringField(record.provider) ?? fallback.provider,
    model: stringField(record.model) ?? stringField(record.modelId) ?? fallback.model,
  };
}

export function timestampFromValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? Math.trunc(value * 1000) : Math.trunc(value);
  if (typeof value !== "string") return undefined;
  const numeric = Number(value);
  if (value.trim() && Number.isFinite(numeric)) return timestampFromValue(numeric);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    const parsed = numberFromValue(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function costFromValue(value: unknown): number | undefined {
  if (isRecord(value)) return numberFromValue(value.total);
  return numberFromValue(value);
}

function numberFromValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

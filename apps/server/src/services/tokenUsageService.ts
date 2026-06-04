import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Project, TokenUsageBreakdown, TokenUsageDay, TokenUsageOverview, TokenUsageRange } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";

const SESSION_FILE_SUFFIX = ".jsonl";
const MAX_USAGE_SCAN_FILES = 2_000;
const MAX_USAGE_LINE_BYTES = 1024 * 1024;

export type TokenUsageServiceOptions = {
  maxScanFiles?: number;
  maxLineBytes?: number;
  now?: () => number;
};

type UsageCoverage = TokenUsageOverview["coverage"];
type UsageModel = { provider?: string; model: string; totalTokens: number; messages: number; activeDays: Set<string> };
type ParsedUsage = Partial<Omit<TokenUsageBreakdown, "total">> & { total?: number };
type SessionMetadata = { id?: string; cwd?: string; timestamp?: number };
type ModelContext = { provider?: string; model?: string };
type FileContribution = {
  projectId?: string;
  sessionId?: string;
  sessionStartedAt?: number;
  days: Map<string, TokenUsageDay>;
  coverage: UsageCoverage;
  models: Map<string, UsageModel>;
  peakHours: Map<number, number>;
};
type CachedFileUsage = { mtimeMs: number; size: number; contribution: FileContribution };

type OverviewInput = { range?: TokenUsageRange; projectId?: string };

export class TokenUsageService {
  private readonly cache = new Map<string, CachedFileUsage>();
  private readonly maxScanFiles: number;
  private readonly maxLineBytes: number;
  private readonly now: () => number;

  constructor(options: TokenUsageServiceOptions = {}) {
    this.maxScanFiles = options.maxScanFiles ?? MAX_USAGE_SCAN_FILES;
    this.maxLineBytes = options.maxLineBytes ?? MAX_USAGE_LINE_BYTES;
    this.now = options.now ?? (() => Date.now());
  }

  getOverview(db: AppDatabase, input: OverviewInput = {}): TokenUsageOverview {
    const range = normalizeTokenUsageRange(input.range);
    const projects = db.listProjects();
    const projectByCwd = new Map(projects.map((project) => [resolve(project.cwd), project]));
    const knownProjectIds = new Set(projects.map((project) => project.id));

    if (input.projectId && !knownProjectIds.has(input.projectId)) {
      return emptyOverview(range, input.projectId, this.now());
    }

    const root = piSessionRoot();
    if (!existsSync(root) || projects.length === 0) return emptyOverview(range, input.projectId, this.now());

    const listedFiles = listSessionFiles(root)
      .map((filePath) => ({ filePath, mtimeMs: safeMtimeMs(filePath) }))
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    const scanLimited = listedFiles.length > this.maxScanFiles;
    const files = listedFiles.slice(0, this.maxScanFiles);
    const seenFiles = new Set(files.map((file) => file.filePath));
    for (const filePath of this.cache.keys()) {
      if (!seenFiles.has(filePath)) this.cache.delete(filePath);
    }

    const combined = createEmptyContribution();
    combined.coverage.scanLimited = scanLimited;

    for (const { filePath } of files) {
      const contribution = this.parseFile(filePath, projectByCwd);
      if (!contribution.projectId) continue;
      if (input.projectId && contribution.projectId !== input.projectId) continue;
      mergeContribution(combined, contribution);
    }

    return overviewFromContribution(combined, range, input.projectId, this.now());
  }

  private parseFile(filePath: string, projectByCwd: Map<string, Project>): FileContribution {
    const stats = safeStat(filePath);
    const cached = stats ? this.cache.get(filePath) : undefined;
    if (cached && cached.mtimeMs === stats?.mtimeMs && cached.size === stats.size) {
      const contribution = cloneContribution(cached.contribution);
      contribution.coverage.cachedFiles += 1;
      return contribution;
    }

    const contribution = createEmptyContribution();
    contribution.coverage.scannedFiles = 1;
    let modelContext: ModelContext = {};

    const metadata = findSessionMetadata(filePath, this.maxLineBytes);
    contribution.sessionId = metadata?.id;
    contribution.sessionStartedAt = metadata?.timestamp;
    if (metadata?.cwd) contribution.projectId = projectByCwd.get(resolve(metadata.cwd))?.id;
    if (!contribution.projectId) return contribution;

    const readOk = processJsonlLines(filePath, this.maxLineBytes, (line, truncated) => {
      if (truncated) {
        contribution.coverage.truncatedLines += 1;
        return;
      }
      const trimmed = line.trim();
      if (!trimmed) return;

      const record = parseJsonRecord(trimmed);
      if (!record) {
        contribution.coverage.malformedLines += 1;
        return;
      }

      if (record.type === "model_change") {
        modelContext = modelContextFromRecord(record, modelContext);
        return;
      }

      if (record.type !== "message") return;
      const message = isRecord(record.message) ? record.message : undefined;
      if (!message || message.role !== "assistant") return;
      contribution.coverage.assistantMessages += 1;

      const usage = isRecord(message.usage) ? usageFromRecord(message.usage) : undefined;
      if (!usage || usage.total === undefined || usage.total <= 0) {
        contribution.coverage.missingUsageMessages += 1;
        return;
      }

      const timestamp = timestampFromValue(message.timestamp) ?? timestampFromValue(record.timestamp);
      if (!timestamp) {
        contribution.coverage.skippedMissingTimestamp += 1;
        return;
      }

      contribution.coverage.recordedUsageMessages += 1;
      const day = localDayKey(timestamp);
      const hour = new Date(timestamp).getHours();
      contribution.peakHours.set(hour, (contribution.peakHours.get(hour) ?? 0) + usage.total);
      const provider = stringField(message.provider) ?? stringField(record.provider) ?? modelContext.provider;
      const model = stringField(message.model) ?? stringField(record.model) ?? stringField(message.modelId) ?? stringField(record.modelId) ?? modelContext.model ?? "unknown";
      addDailyUsage(contribution.days, day, usage, contribution.sessionId, model, provider);
      addModelUsage(contribution.models, day, usage.total, model, provider);
    });

    if (!readOk) return contribution;
    if (stats) this.cache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, contribution: cloneContribution(contribution) });
    return contribution;
  }
}

export function normalizeTokenUsageRange(value: unknown): TokenUsageRange {
  return value === "all" || value === "7d" || value === "30d" ? value : "30d";
}

function overviewFromContribution(contribution: FileContribution, range: TokenUsageRange, projectId: string | undefined, generatedAt: number): TokenUsageOverview {
  const days = filteredDays(contribution.days, range, generatedAt);
  const activeDays = days.filter((day) => day.tokens.total > 0).length;
  const totalTokens = days.reduce((sum, day) => sum + day.tokens.total, 0);
  const messages = days.reduce((sum, day) => sum + day.assistantMessages, 0);
  const sessions = days.reduce((sum, day) => sum + day.sessions, 0);
  const modelRows = modelsForDays(days);
  const peakHour = topNumberKey(contribution.peakHours);
  const favorite = modelRows[0];
  const quality = contribution.coverage.recordedUsageMessages === 0 ? "empty" : contribution.coverage.missingUsageMessages > 0 || contribution.coverage.skippedMissingTimestamp > 0 || contribution.coverage.malformedLines > 0 || contribution.coverage.truncatedLines > 0 || contribution.coverage.scanLimited ? "partial" : "recorded";

  return {
    range,
    projectId,
    generatedAt,
    days,
    summary: {
      sessions,
      messages,
      totalTokens,
      activeDays,
      currentStreakDays: streakFromEnd(days),
      longestStreakDays: longestStreak(days),
      peakHour,
      favoriteModel: favorite ? modelLabel(favorite.provider, favorite.model) : undefined,
      quality,
    },
    coverage: contribution.coverage,
    models: modelRows,
  };
}

function emptyOverview(range: TokenUsageRange, projectId: string | undefined, generatedAt: number): TokenUsageOverview {
  return overviewFromContribution(createEmptyContribution(), range, projectId, generatedAt);
}

function createEmptyCoverage(): UsageCoverage {
  return {
    scannedFiles: 0,
    cachedFiles: 0,
    assistantMessages: 0,
    recordedUsageMessages: 0,
    missingUsageMessages: 0,
    skippedMissingTimestamp: 0,
    malformedLines: 0,
    truncatedLines: 0,
    scanLimited: false,
  };
}

function createEmptyContribution(): FileContribution {
  return { days: new Map(), coverage: createEmptyCoverage(), models: new Map(), peakHours: new Map() };
}

function cloneContribution(input: FileContribution): FileContribution {
  return {
    projectId: input.projectId,
    sessionId: input.sessionId,
    sessionStartedAt: input.sessionStartedAt,
    days: new Map([...input.days.entries()].map(([day, value]) => [day, { ...value, tokens: { ...value.tokens }, models: value.models.map((model) => ({ ...model })) }])),
    coverage: { ...input.coverage },
    models: new Map([...input.models.entries()].map(([key, value]) => [key, { ...value, activeDays: new Set(value.activeDays) }])),
    peakHours: new Map(input.peakHours),
  };
}

function mergeContribution(target: FileContribution, source: FileContribution): void {
  target.coverage.scannedFiles += source.coverage.scannedFiles;
  target.coverage.cachedFiles += source.coverage.cachedFiles;
  target.coverage.assistantMessages += source.coverage.assistantMessages;
  target.coverage.recordedUsageMessages += source.coverage.recordedUsageMessages;
  target.coverage.missingUsageMessages += source.coverage.missingUsageMessages;
  target.coverage.skippedMissingTimestamp += source.coverage.skippedMissingTimestamp;
  target.coverage.malformedLines += source.coverage.malformedLines;
  target.coverage.truncatedLines += source.coverage.truncatedLines;
  target.coverage.scanLimited = target.coverage.scanLimited || source.coverage.scanLimited;

  for (const day of source.days.values()) {
    addDailyUsage(target.days, day.day, day.tokens, undefined, day.models[0]?.model, day.models[0]?.provider, day.sessions, day.assistantMessages, day.models);
  }
  for (const [key, model] of source.models) {
    const existing = target.models.get(key) ?? { provider: model.provider, model: model.model, totalTokens: 0, messages: 0, activeDays: new Set<string>() };
    existing.totalTokens += model.totalTokens;
    existing.messages += model.messages;
    for (const day of model.activeDays) existing.activeDays.add(day);
    target.models.set(key, existing);
  }
  for (const [hour, tokens] of source.peakHours) target.peakHours.set(hour, (target.peakHours.get(hour) ?? 0) + tokens);
}

function findSessionMetadata(filePath: string, maxLineBytes: number): SessionMetadata | undefined {
  let metadata: SessionMetadata | undefined;
  let inspectedLines = 0;
  processJsonlLines(filePath, maxLineBytes, (line, truncated) => {
    inspectedLines += 1;
    if (!truncated) metadata = sessionMetadataFromLine(line);
    return metadata || inspectedLines >= 20 ? false : undefined;
  });
  return metadata;
}

function sessionMetadataFromLine(line: string | undefined): SessionMetadata | undefined {
  const record = parseJsonRecord(line ?? "");
  if (!record || record.type !== "session") return undefined;
  return {
    id: stringField(record.id),
    cwd: stringField(record.cwd),
    timestamp: timestampFromValue(record.timestamp),
  };
}

function processJsonlLines(filePath: string, maxLineBytes: number, onLine: (line: string, truncated: boolean) => false | void): boolean {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return false;
  }

  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let line = "";
  let lineBytes = 0;
  let truncated = false;

  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const chunk = decoder.write(buffer.subarray(0, bytesRead));
      for (let index = 0; index < chunk.length; index += 1) {
        const char = chunk[index];
        if (char === "\n") {
          const shouldContinue = onLine(stripTrailingCr(line), truncated);
          line = "";
          lineBytes = 0;
          truncated = false;
          if (shouldContinue === false) return true;
          continue;
        }
        if (truncated) continue;
        line += char;
        lineBytes += Buffer.byteLength(char, "utf8");
        if (lineBytes > maxLineBytes) {
          line = "";
          truncated = true;
        }
      }
    }
    const tail = decoder.end();
    for (let index = 0; index < tail.length; index += 1) {
      const char = tail[index];
      if (char === "\n") {
        const shouldContinue = onLine(stripTrailingCr(line), truncated);
        line = "";
        lineBytes = 0;
        truncated = false;
        if (shouldContinue === false) return true;
        continue;
      }
      if (truncated) continue;
      line += char;
      lineBytes += Buffer.byteLength(char, "utf8");
      if (lineBytes > maxLineBytes) {
        line = "";
        truncated = true;
      }
    }
    if (line || truncated) onLine(stripTrailingCr(line), truncated);
    return true;
  } finally {
    closeSync(fd);
  }
}

function stripTrailingCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function parseJsonRecord(line: string): Record<string, unknown> | undefined {
  if (!line.trim()) return undefined;
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function usageFromRecord(record: Record<string, unknown>): ParsedUsage | undefined {
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

function modelContextFromRecord(record: Record<string, unknown>, fallback: ModelContext): ModelContext {
  return {
    provider: stringField(record.provider) ?? fallback.provider,
    model: stringField(record.model) ?? stringField(record.modelId) ?? fallback.model,
  };
}

function addDailyUsage(days: Map<string, TokenUsageDay>, day: string, usage: ParsedUsage, sessionId?: string, model = "unknown", provider?: string, sessions = sessionId ? 1 : 0, assistantMessages = 1, modelRows?: Array<{ provider?: string; model: string; totalTokens: number }>): void {
  const existing = days.get(day) ?? { day, tokens: { total: 0 }, sessions: 0, assistantMessages: 0, models: [] };
  const sessionIncrement = modelRows ? sessions : existing.sessions > 0 ? 0 : sessions;
  existing.tokens.total += usage.total ?? 0;
  addOptional(existing.tokens, "input", usage.input);
  addOptional(existing.tokens, "output", usage.output);
  addOptional(existing.tokens, "cacheRead", usage.cacheRead);
  addOptional(existing.tokens, "cacheWrite", usage.cacheWrite);
  addOptional(existing.tokens, "cost", usage.cost);
  existing.sessions += sessionIncrement;
  existing.assistantMessages += assistantMessages;
  if (modelRows) {
    for (const row of modelRows) mergeDayModel(existing.models, row.model, row.provider, row.totalTokens);
  } else {
    mergeDayModel(existing.models, model, provider, usage.total ?? 0);
  }
  days.set(day, existing);
}

function addOptional(target: TokenUsageBreakdown, key: keyof Omit<TokenUsageBreakdown, "total">, value: number | undefined): void {
  if (value === undefined) return;
  target[key] = (target[key] ?? 0) + value;
}

function mergeDayModel(models: TokenUsageDay["models"], model: string, provider: string | undefined, totalTokens: number): void {
  const existing = models.find((item) => item.model === model && item.provider === provider);
  if (existing) existing.totalTokens += totalTokens;
  else models.push({ provider, model, totalTokens });
  models.sort((left, right) => right.totalTokens - left.totalTokens);
}

function addModelUsage(models: Map<string, UsageModel>, day: string, totalTokens: number, model: string, provider?: string): void {
  const key = modelLabel(provider, model);
  const existing = models.get(key) ?? { provider, model, totalTokens: 0, messages: 0, activeDays: new Set<string>() };
  existing.totalTokens += totalTokens;
  existing.messages += 1;
  existing.activeDays.add(day);
  models.set(key, existing);
}

function filteredDays(days: Map<string, TokenUsageDay>, range: TokenUsageRange, generatedAt: number): TokenUsageDay[] {
  if (range === "all") return [...days.values()].sort((left, right) => left.day.localeCompare(right.day));
  const count = range === "7d" ? 7 : 30;
  const end = startOfLocalDay(generatedAt);
  const result: TokenUsageDay[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(end);
    date.setDate(date.getDate() - index);
    const key = localDayKey(date.getTime());
    const day = days.get(key);
    result.push(day ? { ...day, tokens: { ...day.tokens }, models: day.models.map((model) => ({ ...model })) } : { day: key, tokens: { total: 0 }, sessions: 0, assistantMessages: 0, models: [] });
  }
  return result;
}

function modelsForDays(days: TokenUsageDay[]): TokenUsageOverview["models"] {
  const models = new Map<string, { provider?: string; model: string; totalTokens: number; messages: number; days: Set<string> }>();
  for (const day of days) {
    for (const model of day.models) {
      const key = modelLabel(model.provider, model.model);
      const existing = models.get(key) ?? { provider: model.provider, model: model.model, totalTokens: 0, messages: 0, days: new Set<string>() };
      existing.totalTokens += model.totalTokens;
      existing.messages += 1;
      existing.days.add(day.day);
      models.set(key, existing);
    }
  }
  return [...models.values()]
    .map((model) => ({ provider: model.provider, model: model.model, totalTokens: model.totalTokens, messages: model.messages, activeDays: model.days.size }))
    .filter((model) => model.activeDays > 0)
    .sort((left, right) => right.totalTokens - left.totalTokens);
}

function streakFromEnd(days: TokenUsageDay[]): number {
  let count = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (days[index]?.tokens.total) count += 1;
    else break;
  }
  return count;
}

function longestStreak(days: TokenUsageDay[]): number {
  let current = 0;
  let best = 0;
  for (const day of days) {
    if (day.tokens.total > 0) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

function topNumberKey(values: Map<number, number>): number | undefined {
  let bestKey: number | undefined;
  let bestValue = -1;
  for (const [key, value] of values) {
    if (value > bestValue) {
      bestKey = key;
      bestValue = value;
    }
  }
  return bestKey;
}

function modelLabel(provider: string | undefined, model: string): string {
  return provider ? `${provider}/${model}` : model;
}

function timestampFromValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? Math.trunc(value * 1000) : Math.trunc(value);
  if (typeof value !== "string") return undefined;
  const numeric = Number(value);
  if (value.trim() && Number.isFinite(numeric)) return timestampFromValue(numeric);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function listSessionFiles(root: string): string[] {
  const results: string[] = [];
  const stack = [root];
  while (stack.length > 0 && results.length <= MAX_USAGE_SCAN_FILES * 2) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const entry of safeReadDir(dir)) {
      const fullPath = join(dir, entry);
      if (safeIsDirectory(fullPath)) stack.push(fullPath);
      else if (entry.endsWith(SESSION_FILE_SUFFIX)) results.push(fullPath);
    }
  }
  return results;
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safeMtimeMs(path: string): number {
  return safeStat(path)?.mtimeMs ?? 0;
}

function safeStat(path: string): { mtimeMs: number; size: number } | undefined {
  try {
    const stats = statSync(path);
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return undefined;
  }
}

function piSessionRoot(): string {
  return resolve(process.env.PI_GUI_SESSION_ROOT ?? join(homedir(), ".pi", "agent", "sessions"));
}

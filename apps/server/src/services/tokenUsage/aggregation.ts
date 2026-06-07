import type { TokenUsageBreakdown, TokenUsageDay, TokenUsageOverview, TokenUsageRange } from "@pi-gui/shared";
import type { FileContribution, ParsedUsage, UsageCoverage, UsageModel } from "./types.js";

export function overviewFromContribution(contribution: FileContribution, range: TokenUsageRange, projectId: string | undefined, generatedAt: number): TokenUsageOverview {
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

export function emptyTokenUsageOverview(range: TokenUsageRange, projectId: string | undefined, generatedAt = Date.now()): TokenUsageOverview {
  return overviewFromContribution(createEmptyContribution(), range, projectId, generatedAt);
}

export function createEmptyCoverage(): UsageCoverage {
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

export function createEmptyContribution(): FileContribution {
  return { days: new Map(), coverage: createEmptyCoverage(), models: new Map(), peakHours: new Map() };
}

export function cloneContribution(input: FileContribution): FileContribution {
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

export function mergeContribution(target: FileContribution, source: FileContribution): void {
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

export function addDailyUsage(days: Map<string, TokenUsageDay>, day: string, usage: ParsedUsage, sessionId?: string, model = "unknown", provider?: string, sessions = sessionId ? 1 : 0, assistantMessages = 1, modelRows?: Array<{ provider?: string; model: string; totalTokens: number }>): void {
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

export function addModelUsage(models: Map<string, UsageModel>, day: string, totalTokens: number, model: string, provider?: string): void {
  const key = modelLabel(provider, model);
  const existing = models.get(key) ?? { provider, model, totalTokens: 0, messages: 0, activeDays: new Set<string>() };
  existing.totalTokens += totalTokens;
  existing.messages += 1;
  existing.activeDays.add(day);
  models.set(key, existing);
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

export function localDayKey(timestamp: number): string {
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

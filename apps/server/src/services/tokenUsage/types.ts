import type { TokenUsageBreakdown, TokenUsageDay, TokenUsageOverview, TokenUsageRange } from "@pi-gui/shared";

export type TokenUsageServiceOptions = {
  maxScanFiles?: number;
  maxLineBytes?: number;
  now?: () => number;
};

export type OverviewInput = { range?: TokenUsageRange; projectId?: string };
export type UsageCoverage = TokenUsageOverview["coverage"];
export type UsageModel = { provider?: string; model: string; totalTokens: number; messages: number; activeDays: Set<string> };
export type ParsedUsage = Partial<Omit<TokenUsageBreakdown, "total">> & { total?: number };
export type SessionMetadata = { id?: string; cwd?: string; timestamp?: number };
export type ModelContext = { provider?: string; model?: string };
export type FileContribution = {
  projectId?: string;
  sessionId?: string;
  sessionStartedAt?: number;
  days: Map<string, TokenUsageDay>;
  coverage: UsageCoverage;
  models: Map<string, UsageModel>;
  peakHours: Map<number, number>;
};
export type CachedFileUsage = { mtimeMs: number; size: number; contribution: FileContribution };

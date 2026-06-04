import type { ConversationContextUsage } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";

export function contextUsageFromSessionStats(data: Record<string, unknown>, currentContextWindow?: number): ConversationContextUsage | undefined {
  const contextUsage = isRecord(data.contextUsage) ? data.contextUsage : undefined;
  if (!contextUsage) return undefined;
  const tokens = numberOrUndefined(contextUsage.tokens);
  const contextWindow = numberOrUndefined(contextUsage.contextWindow) ?? currentContextWindow;
  const reportedPercent = numberOrUndefined(contextUsage.percent);
  return {
    tokens,
    contextWindow,
    percent: tokens !== undefined && contextWindow !== undefined && contextWindow > 0 ? (tokens / contextWindow) * 100 : reportedPercent,
    updatedAt: Date.now(),
  };
}

export function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

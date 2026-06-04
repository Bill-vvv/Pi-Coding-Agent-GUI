import type { TokenUsageDay } from "@pi-gui/shared";

export type TokenUsagePalette = "blue" | "green";

export function tokenUsageIntensity(day: TokenUsageDay, maxTokens: number): number {
  if (day.tokens.total <= 0 || maxTokens <= 0) return 0;
  const ratio = day.tokens.total / maxTokens;
  if (ratio >= 0.8) return 4;
  if (ratio >= 0.45) return 3;
  if (ratio >= 0.18) return 2;
  return 1;
}

export function formatTokenCount(value: number | undefined): string {
  const count = Math.round(value ?? 0);
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function formatCost(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

export function formatHour(hour: number | undefined): string {
  if (hour === undefined) return "—";
  return `${String(hour).padStart(2, "0")}:00`;
}

export function topDayModel(day: TokenUsageDay): string | undefined {
  const model = day.models[0];
  if (!model) return undefined;
  return model.provider ? `${model.provider}/${model.model}` : model.model;
}

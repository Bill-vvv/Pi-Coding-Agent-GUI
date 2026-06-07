import type { TokenUsageDay } from "@pi-gui/shared";
import { formatCompactCount } from "./numberFormat";

export function tokenUsageIntensity(day: TokenUsageDay, maxTokens: number): number {
  if (day.tokens.total <= 0 || maxTokens <= 0) return 0;
  const ratio = day.tokens.total / maxTokens;
  if (ratio >= 0.8) return 4;
  if (ratio >= 0.45) return 3;
  if (ratio >= 0.18) return 2;
  return 1;
}

export function formatTokenCount(value: number | undefined): string {
  return formatCompactCount(value ?? 0);
}


export function formatHour(hour: number | undefined): string {
  if (hour === undefined) return "—";
  return `${String(hour).padStart(2, "0")}:00`;
}


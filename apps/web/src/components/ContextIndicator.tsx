import type { CSSProperties } from "react";
import type { Runtime } from "@pi-gui/shared";
import type { ConversationContextUsage } from "../types";

type ContextIndicatorProps = {
  usage?: ConversationContextUsage;
  activeRuntime?: Runtime;
};

export function ContextIndicator({ usage, activeRuntime }: ContextIndicatorProps) {
  const percent = usage?.percent;
  const numericPercent = percent ?? 0;
  const hasUsage = percent !== undefined && usage?.tokens !== undefined && usage?.contextWindow !== undefined;
  const ringPercent = hasUsage ? clamp(numericPercent, 0, 100) : 0;
  const severity = hasUsage && numericPercent >= 90 ? "danger" : hasUsage && numericPercent >= 70 ? "warning" : "normal";
  const detail = contextDetail(usage, activeRuntime, percent);

  return (
    <div
      className={`context-indicator ${severity} ${hasUsage ? "" : "unknown"}`}
      aria-label={detail}
      role="img"
      tabIndex={0}
      style={{ "--context-percent": `${ringPercent}%` } as CSSProperties}
    >
      <span className="context-ring" aria-hidden="true" />
      <span className="context-tooltip" role="tooltip">{detail}</span>
    </div>
  );
}

function contextDetail(usage: ConversationContextUsage | undefined, activeRuntime: Runtime | undefined, percent: number | undefined): string {
  if (percent !== undefined && usage?.tokens !== undefined && usage.contextWindow !== undefined) {
    return `对话上下文：${usage.tokens.toLocaleString()} / ${usage.contextWindow.toLocaleString()} tokens（${formatPercent(percent)}）`;
  }
  if (usage?.contextWindow !== undefined) {
    return `对话上下文：等待统计，窗口 ${usage.contextWindow.toLocaleString()} tokens`;
  }
  if (activeRuntime) return "对话上下文：等待 Pi 统计";
  return "对话上下文：未启动 runtime";
}

function formatPercent(percent: number): string {
  if (percent <= 0) return "0%";
  if (percent < 10) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

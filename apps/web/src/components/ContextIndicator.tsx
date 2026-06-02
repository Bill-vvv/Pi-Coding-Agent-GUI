import type { CSSProperties } from "react";
import type { Runtime } from "@pi-gui/shared";
import type { ConversationContextUsage } from "../types";

type ContextIndicatorProps = {
  usage?: ConversationContextUsage;
  activeRuntime?: Runtime;
};

export function ContextIndicator({ usage, activeRuntime }: ContextIndicatorProps) {
  const percent = usage?.percent;
  const hasUsage = percent !== undefined && usage?.tokens !== undefined && usage?.contextWindow !== undefined;
  const ringPercent = hasUsage ? clamp(percent, 0, 100) : 0;
  const severity = hasUsage && percent >= 90 ? "danger" : hasUsage && percent >= 70 ? "warning" : "normal";
  const detail = contextDetail(usage, activeRuntime, percent);
  const tokenLabel = hasUsage && usage ? `${formatTokenCount(usage.tokens!)} / ${formatTokenCount(usage.contextWindow!)}` : fallbackLabel(usage, activeRuntime);

  return (
    <div
      className={`context-indicator ${severity} ${hasUsage ? "" : "unknown"}`}
      title={detail}
      aria-label={detail}
      style={{ "--context-percent": `${ringPercent}%` } as CSSProperties}
    >
      <span className="context-ring" aria-hidden="true">
        <span>{hasUsage ? formatPercent(percent) : "—"}</span>
      </span>
      <span className="context-copy">
        <span>上下文</span>
        <small>{tokenLabel}</small>
      </span>
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

function fallbackLabel(usage: ConversationContextUsage | undefined, activeRuntime: Runtime | undefined): string {
  if (usage?.contextWindow !== undefined) return `窗口 ${formatTokenCount(usage.contextWindow)}`;
  return activeRuntime ? "等待统计" : "未启动";
}

function formatPercent(percent: number): string {
  if (percent <= 0) return "0%";
  if (percent < 10) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return `${value >= 10 ? Math.round(value).toString() : value.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

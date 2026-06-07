import type { CSSProperties, ReactNode } from "react";
import type { Runtime } from "@pi-gui/shared";
import { formatCompactCount, formatFullCount, formatPercent } from "../domain/numberFormat";
import type { ConversationContextUsage } from "../types";

type ContextIndicatorProps = {
  usage?: ConversationContextUsage;
  activeRuntime?: Runtime;
};

export function ContextIndicator({ usage, activeRuntime }: ContextIndicatorProps) {
  const percent = numericValue(usage?.percent);
  const percentForDisplay = percent;
  const numericPercent = percentForDisplay ?? 0;
  const tokens = numericValue(usage?.tokens);
  const contextWindow = numericValue(usage?.contextWindow);
  const hasContextUsage = percentForDisplay !== undefined && tokens !== undefined && contextWindow !== undefined;
  const hasCompactSummary = tokens !== undefined || contextWindow !== undefined;
  const ringPercent = hasContextUsage ? clamp(numericPercent, 0, 100) : 0;
  const severity = hasContextUsage && numericPercent >= 90 ? "danger" : hasContextUsage && numericPercent >= 70 ? "warning" : "normal";
  const detail = contextDetail(usage, activeRuntime, percentForDisplay);

  return (
    <div
      className={`context-indicator ${severity} ${hasContextUsage ? "" : "unknown"} ${hasCompactSummary ? "with-summary" : ""}`}
      aria-label={detail}
      role="img"
      tabIndex={0}
      style={{ "--context-percent": `${ringPercent}%` } as CSSProperties}
    >
      <span className="context-ring" aria-hidden="true" />
      {hasCompactSummary ? <span className="context-summary" aria-hidden="true">{compactSummary(usage)}</span> : null}
      <span className="context-tooltip context-popover" role="tooltip">
        <span className="context-popover-title">当前会话</span>
        <UsageRow label="上下文" value={contextValue(usage, percentForDisplay)} />
        <UsageRow label="Token 总计" value={tokenValue(usage?.sessionTokens?.total)} />
        <UsageRow label="输入" value={tokenValue(usage?.sessionTokens?.input)} />
        <UsageRow label="输出" value={tokenValue(usage?.sessionTokens?.output)} />
        <UsageRow label="缓存读取" value={tokenValue(usage?.sessionTokens?.cacheRead)} />
        <UsageRow label="缓存写入" value={tokenValue(usage?.sessionTokens?.cacheWrite)} />
        <UsageRow label="缓存率" value={cacheRateValue(usage?.sessionTokens)} />
        <UsageRow label="成本" value={costValue(usage?.sessionTokens?.cost)} />
      </span>
    </div>
  );
}

function UsageRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="context-popover-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function compactSummary(usage: ConversationContextUsage | undefined): string {
  const tokens = numericValue(usage?.tokens);
  const contextWindow = numericValue(usage?.contextWindow);
  if (tokens !== undefined && contextWindow !== undefined) return `${formatCompactCount(tokens)} / ${formatCompactCount(contextWindow)}`;
  if (tokens !== undefined) return formatCompactCount(tokens);
  if (contextWindow !== undefined) return `— / ${formatCompactCount(contextWindow)}`;
  return "";
}

function contextDetail(usage: ConversationContextUsage | undefined, activeRuntime: Runtime | undefined, percent: number | undefined): string {
  const context = contextValue(usage, percent);
  const contextWindow = numericValue(usage?.contextWindow);
  const sessionTotal = sessionTokenSummary(usage);
  const total = sessionTotal ? `，当前会话用量 ${sessionTotal}` : "";
  if (context !== "—") return `对话上下文：${context}${total}`;
  if (contextWindow !== undefined) return `对话上下文：等待统计，窗口 ${formatFullCount(contextWindow)}${total}`;
  if (usage?.sessionTokens) return `当前会话用量：${sessionTotal ?? "已记录部分用量"}`;
  if (activeRuntime) return "对话上下文：等待 Pi 统计";
  return "对话上下文：未启动 runtime";
}

function contextValue(usage: ConversationContextUsage | undefined, percent: number | undefined): string {
  const tokens = numericValue(usage?.tokens);
  const contextWindow = numericValue(usage?.contextWindow);
  if (tokens !== undefined && contextWindow !== undefined) {
    return `${formatFullCount(tokens)} / ${formatFullCount(contextWindow)}${percent !== undefined ? `（${formatPercent(percent)}）` : ""}`;
  }
  if (contextWindow !== undefined) return `等待统计，窗口 ${formatFullCount(contextWindow)}`;
  return "—";
}

function tokenValue(value: number | undefined): string {
  return value === undefined ? "—" : formatFullCount(value);
}

function cacheRateValue(sessionTokens: ConversationContextUsage["sessionTokens"]): string {
  if (!sessionTokens || sessionTokens.cacheRead === undefined) return "—";
  const denominator = (sessionTokens.input ?? 0) + sessionTokens.cacheRead + (sessionTokens.cacheWrite ?? 0);
  return denominator > 0 ? formatPercent((sessionTokens.cacheRead / denominator) * 100) : "—";
}

function sessionTokenSummary(usage: ConversationContextUsage | undefined): string | undefined {
  const sessionTokens = usage?.sessionTokens;
  if (!sessionTokens) return undefined;
  if (sessionTokens.total !== undefined) return `总计 ${formatFullCount(sessionTokens.total)}`;
  const componentTotal = (sessionTokens.input ?? 0) + (sessionTokens.output ?? 0) + (sessionTokens.cacheRead ?? 0) + (sessionTokens.cacheWrite ?? 0);
  return componentTotal > 0 ? `部分 ${formatFullCount(componentTotal)}` : undefined;
}

function costValue(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "—" : `$${value.toFixed(4)}`;
}

function numericValue(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

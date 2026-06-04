import type { SubagentChildRun, SubagentRun, SubagentRunStatus } from "@pi-gui/shared";

export function subagentStatusLabel(status: SubagentRunStatus): string {
  if (status === "pending") return "等待中";
  if (status === "running") return "运行中";
  if (status === "succeeded") return "完成";
  if (status === "failed") return "失败";
  return "已取消";
}

export function subagentModeLabel(mode: SubagentRun["mode"]): string {
  if (mode === "parallel") return "并行";
  if (mode === "chain") return "串行";
  return "单次";
}

export function subagentRunPreview(run: SubagentRun, maxChars = 320): string {
  const final = run.finalText?.trim();
  if (final) return truncate(final, maxChars);
  const latest = latestChildRun(run)?.textTail?.trim() || latestChildRun(run)?.stderrTail?.trim() || run.errorMessage?.trim();
  if (latest) return truncate(latest, maxChars);
  if (run.status === "running" || run.status === "pending") return "子代理正在处理，打开详情可查看实时过程。";
  return "暂无最终输出。";
}

export function subagentCopyText(run: SubagentRun): string | undefined {
  const final = run.finalText?.trim();
  if (final) return final;
  const childFinals = run.runs.map((child) => child.finalText?.trim()).filter((text): text is string => Boolean(text));
  if (childFinals.length === 1) return childFinals[0];
  if (childFinals.length > 1) return childFinals.map((text, index) => `### Child ${index + 1}\n\n${text}`).join("\n\n---\n\n");
  return undefined;
}

export function latestChildRun(run: SubagentRun): SubagentChildRun | undefined {
  return run.runs.reduce<SubagentChildRun | undefined>((latest, child) => {
    const updatedAt = child.finishedAt ?? child.startedAt ?? 0;
    const latestUpdatedAt = latest ? latest.finishedAt ?? latest.startedAt ?? 0 : -1;
    return updatedAt >= latestUpdatedAt ? child : latest;
  }, undefined);
}

export function subagentRunIsActive(run: SubagentRun): boolean {
  if (run.status === "pending" || run.status === "running") return true;
  if (run.finishedAt !== undefined) return false;
  return run.runs.some((child) => child.status === "pending" || child.status === "running");
}

export function runningSubagentRunsForRuntime(runs: Record<string, SubagentRun>, runtimeId: string): SubagentRun[] {
  return Object.values(runs)
    .filter((run) => run.parentRuntimeId === runtimeId && subagentRunIsActive(run))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function subagentDetailKey(runId: string, childRunId: string): string {
  return `${runId}:${childRunId}`;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

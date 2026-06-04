import type { ConversationMessage, SubagentChildRun, SubagentRun, SubagentRunStatus, SubagentToolTrace } from "@pi-gui/shared";

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
  const latest = latestChildRun(run);
  const liveText = latest?.textTail?.trim();
  if (liveText) return truncate(liveText, maxChars);
  const liveThinking = latest?.thinkingTail?.trim();
  if (liveThinking) return truncate(`思考中：${liveThinking}`, maxChars);
  const latestLog = latest?.stderrTail?.trim() || run.errorMessage?.trim();
  if (latestLog) return truncate(latestLog, maxChars);
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

export function buildSubagentLiveConversationMessages(run: SubagentRun, child: SubagentChildRun | undefined): ConversationMessage[] {
  if (!child) return [];
  const runtimeId = `subagent:${run.id}:${child.id}:live`;
  const projectId = run.projectId;
  const baseTimestamp = child.startedAt ?? run.startedAt;
  const messages: ConversationMessage[] = [];

  for (const tool of child.tools ?? []) {
    messages.push({
      id: `${runtimeId}:tool:${tool.id}`,
      runtimeId,
      projectId,
      role: "tool",
      title: `${tool.name} ${subagentToolStatusLabel(tool.status)}`,
      text: subagentToolText(tool),
      timestamp: tool.startedAt ?? baseTimestamp,
      updatedAt: tool.finishedAt ?? run.updatedAt,
      isStreaming: tool.status === "running",
    });
  }

  const thinking = child.thinkingTail?.trim();
  const text = child.textTail?.trim();
  if (thinking || text) {
    messages.push({
      id: `${runtimeId}:assistant:stream`,
      runtimeId,
      projectId,
      role: "assistant",
      text: text ?? "",
      thinking,
      timestamp: run.updatedAt,
      updatedAt: run.updatedAt,
      isStreaming: child.status === "pending" || child.status === "running",
    });
  }

  const stderr = child.stderrTail?.trim();
  if (stderr) {
    messages.push({
      id: `${runtimeId}:stderr`,
      runtimeId,
      projectId,
      role: "log",
      text: stderr,
      timestamp: run.updatedAt,
      updatedAt: run.updatedAt,
      isStreaming: child.status === "pending" || child.status === "running",
    });
  }

  const error = child.errorMessage?.trim();
  if (error) {
    messages.push({
      id: `${runtimeId}:error`,
      runtimeId,
      projectId,
      role: "error",
      text: error,
      timestamp: child.finishedAt ?? run.updatedAt,
      updatedAt: child.finishedAt ?? run.updatedAt,
    });
  }

  return messages.sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
}

function subagentToolStatusLabel(status: SubagentToolTrace["status"]): string {
  if (status === "running") return "运行中";
  if (status === "succeeded") return "完成";
  return "失败";
}

function subagentToolText(tool: SubagentToolTrace): string {
  const args = tool.args?.trim();
  if (!args) return tool.status === "running" ? "运行中…" : subagentToolStatusLabel(tool.status);
  return args;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

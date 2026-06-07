import type { ConversationMessage, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";

export type SessionDotState = "task-idle" | "task-busy" | "task-unread" | "starting" | "recoverable" | "crashed";

export function sessionDotState(runtime: Runtime, busy: boolean, hasUnreadReply: boolean, recoverable = false): SessionDotState {
  if (recoverable) return "recoverable";
  if (runtime.status === "crashed") return "crashed";
  if (busy) return "task-busy";
  if (runtime.status === "starting") return "starting";
  if (hasUnreadReply) return "task-unread";
  return "task-idle";
}

export function completedAssistantReplyAt(summary: RuntimeConversationSummary | undefined, messages: ConversationMessage[] | undefined): number | undefined {
  if (summary?.latestAssistantCompletedAt) return summary.latestAssistantCompletedAt;
  const assistantMessage = latestCompletedAssistantMessage(messages);
  const assistantUpdatedAt = assistantMessage?.updatedAt ?? assistantMessage?.timestamp;
  if (assistantUpdatedAt) return assistantUpdatedAt;
  if (!assistantMessage && (summary?.messageCount ?? 0) < 2) return undefined;
  return summary?.updatedAt;
}

export function latestCompletedAssistantMessage(messages: ConversationMessage[] | undefined): ConversationMessage | undefined {
  if (!messages) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && !message.isStreaming && Boolean(message.text.trim() || message.thinking?.trim())) return message;
  }
  return undefined;
}

export function sessionDotTitle(runtimeStatus: Runtime["status"], dotState: SessionDotState): string {
  if (dotState === "task-busy") return "Agent 正在生成回复";
  if (dotState === "task-unread") return "有未读回复，点击查看";
  if (dotState === "starting") return "Runtime 正在启动";
  if (dotState === "recoverable") return "GUI 已重启，可恢复会话";
  if (dotState === "crashed") return "Runtime 已崩溃";
  if (runtimeStatus === "running") return "已读，Runtime 空闲";
  return "已读";
}

import { stripSerializedToolCallsFromText, type ConversationMessage, type RuntimeConversationSummary } from "@pi-gui/shared";
import { isLeakedToolCallMessage } from "./conversationDisplay";

const TITLE_MAX_LENGTH = 72;
const DETAIL_MAX_LENGTH = 96;

export function indexConversationSummaries(summaries: RuntimeConversationSummary[]): Record<string, RuntimeConversationSummary> {
  return Object.fromEntries(summaries.map((summary) => [summary.runtimeId, summary]));
}

export function mergeConversationSummaries(
  persisted: Record<string, RuntimeConversationSummary>,
  messagesByRuntime: Record<string, ConversationMessage[]>,
): Record<string, RuntimeConversationSummary> {
  let merged = persisted;

  for (const [runtimeId, messages] of Object.entries(messagesByRuntime)) {
    const summary = conversationSummaryFromMessages(runtimeId, messages);
    if (!summary) continue;
    if (merged === persisted) merged = { ...persisted };

    const previous = persisted[runtimeId];
    merged[runtimeId] = previous
      ? {
          ...summary,
          title: previous.title || summary.title,
          detail: summary.detail ?? previous.detail,
          updatedAt: Math.max(previous.updatedAt ?? 0, summary.updatedAt ?? 0) || undefined,
          messageCount: Math.max(previous.messageCount, summary.messageCount),
        }
      : summary;
  }

  return merged;
}

export function conversationSummaryFromMessages(runtimeId: string, messages: ConversationMessage[]): RuntimeConversationSummary | undefined {
  const candidates = messages.filter((message) => isConversationSummaryCandidate(message) && summaryText(message.text, TITLE_MAX_LENGTH));
  const titleMessage = candidates.find((message) => message.role === "user") ?? candidates[0];
  if (!titleMessage) return undefined;

  const latestMessage = [...candidates].reverse().find((message) => summaryText(message.text, DETAIL_MAX_LENGTH));
  const title = summaryText(titleMessage.text, TITLE_MAX_LENGTH);
  if (!title) return undefined;

  const latestText = latestMessage ? summaryText(latestMessage.text, DETAIL_MAX_LENGTH) : undefined;
  const detail = latestMessage && latestMessage.id !== titleMessage.id && latestText ? `${messageRolePrefix(latestMessage)}：${latestText}` : undefined;
  const updatedAt = messages.reduce((latest, message) => Math.max(latest, message.updatedAt ?? message.timestamp ?? 0), 0);

  return {
    runtimeId,
    projectId: titleMessage.projectId,
    title,
    detail,
    updatedAt: updatedAt || undefined,
    messageCount: candidates.length,
  };
}

function isConversationSummaryCandidate(message: ConversationMessage): boolean {
  if (isLeakedToolCallMessage(message)) return false;
  return message.role === "user" || message.role === "assistant";
}

function messageRolePrefix(message: ConversationMessage): string {
  return message.role === "user" ? "你" : "Pi";
}

function summaryText(value: string, maxLength: number): string | undefined {
  const normalized = stripSerializedToolCallsFromText(value)
    .replace(/```[\s\S]*?```/g, "代码块")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…` : normalized;
}

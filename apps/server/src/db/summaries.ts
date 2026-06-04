import { stripSerializedToolCallsFromText, type ConversationMessage, type RuntimeConversationSummary } from "@pi-gui/shared";
import type { RuntimeConversationSummaryRow } from "./rows.js";

const TITLE_MAX_LENGTH = 72;
const DETAIL_MAX_LENGTH = 96;

export function runtimeConversationSummaryFromRow(row: RuntimeConversationSummaryRow): RuntimeConversationSummary[] {
  const titleSource = row.first_user_text ?? row.first_message_text;
  const title = summaryText(titleSource, TITLE_MAX_LENGTH);
  if (!title) return [];

  const latestText = row.latest_message_text === titleSource ? undefined : summaryText(row.latest_message_text, DETAIL_MAX_LENGTH);
  const detail = latestText && latestText !== title ? latestText : undefined;
  return [
    {
      runtimeId: row.runtime_id,
      projectId: row.project_id,
      title,
      detail,
      updatedAt: row.latest_updated_at ?? undefined,
      messageCount: row.message_count,
    },
  ];
}

export function runtimeConversationSummaryFromMessages(runtimeId: string, messages: ConversationMessage[]): RuntimeConversationSummary | undefined {
  const candidates = messages.filter((message) => isSummaryCandidate(message) && summaryText(message.text, TITLE_MAX_LENGTH));
  const titleMessage = candidates.find((message) => message.role === "user") ?? candidates[0];
  if (!titleMessage) return undefined;

  const title = summaryText(titleMessage.text, TITLE_MAX_LENGTH);
  if (!title) return undefined;

  const latestMessage = [...candidates].reverse().find((message) => summaryText(message.text, DETAIL_MAX_LENGTH));
  const latestText = latestMessage ? summaryText(latestMessage.text, DETAIL_MAX_LENGTH) : undefined;
  const detail = latestMessage && latestMessage.id !== titleMessage.id && latestText && latestText !== title ? latestText : undefined;
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

function isSummaryCandidate(message: ConversationMessage): boolean {
  return message.role === "user" || message.role === "assistant";
}

function summaryText(value: string | null | undefined, maxLength: number): string | undefined {
  const normalized = stripSerializedToolCallsFromText(value ?? "")
    .replace(/```[\s\S]*?```/g, "代码块")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…` : normalized;
}

import type { RuntimeConversationSummary } from "@pi-gui/shared";
import type { RuntimeConversationSummaryRow } from "./rows.js";

export function runtimeConversationSummaryFromRow(row: RuntimeConversationSummaryRow): RuntimeConversationSummary[] {
  const titleSource = row.first_user_text ?? row.first_message_text;
  const title = summaryText(titleSource, 72);
  if (!title) return [];

  const latestText = row.latest_message_text === titleSource ? undefined : summaryText(row.latest_message_text, 96);
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

function summaryText(value: string | null | undefined, maxLength: number): string | undefined {
  const normalized = value
    ?.replace(/```[\s\S]*?```/g, "代码块")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…` : normalized;
}

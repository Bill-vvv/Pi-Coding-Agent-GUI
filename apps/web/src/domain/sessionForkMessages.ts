import { isRecord } from "@pi-gui/shared";

export type SessionForkMessage = {
  entryId: string;
  text: string;
};

export function normalizeSessionForkMessages(value: unknown): SessionForkMessage[] {
  if (!isRecord(value) || !Array.isArray(value.messages)) return [];
  const messages: SessionForkMessage[] = [];
  for (const item of value.messages) {
    if (!isRecord(item) || typeof item.entryId !== "string" || typeof item.text !== "string") continue;
    const entryId = item.entryId.trim();
    if (!entryId) continue;
    messages.push({ entryId, text: item.text });
  }
  return messages;
}

export function sessionForkMessagePreview(text: string, maxLength = 180): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact || "（空消息）";
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

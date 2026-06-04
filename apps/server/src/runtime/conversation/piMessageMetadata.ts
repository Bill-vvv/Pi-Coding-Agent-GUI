export type PiMessageRole = "user" | "assistant" | "tool" | "toolResult" | "bashExecution";

export function messageRoleFromPiMessage(message: Record<string, unknown>): PiMessageRole | undefined {
  if (
    message.role === "user" ||
    message.role === "assistant" ||
    message.role === "tool" ||
    message.role === "toolResult" ||
    message.role === "bashExecution"
  ) {
    return message.role;
  }
  return undefined;
}

export function messageIdFromPiMessage(message: Record<string, unknown>): string | undefined {
  const rawId = message.id ?? message.messageId ?? message.message_id;
  return typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : undefined;
}

export function timestampFromPiMessage(message: Record<string, unknown>, fallback: number): number {
  if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) return message.timestamp;
  if (typeof message.createdAt === "number" && Number.isFinite(message.createdAt)) return message.createdAt;
  if (typeof message.updatedAt === "number" && Number.isFinite(message.updatedAt)) return message.updatedAt;
  if (typeof message.timestamp === "string") {
    const parsed = Date.parse(message.timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

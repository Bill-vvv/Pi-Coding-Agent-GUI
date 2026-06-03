import type { ConversationDelta, ConversationMessage } from "@pi-gui/shared";

export function upsertConversationMessage(messages: ConversationMessage[], message: ConversationMessage): ConversationMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index === -1) return [...messages, message];
  const next = [...messages];
  next[index] = message;
  return next;
}

export function applyConversationDelta(messages: ConversationMessage[], delta: ConversationDelta): ConversationMessage[] {
  const index = messages.findIndex((message) => message.id === delta.messageId);
  const fallback: ConversationMessage = {
    id: delta.messageId,
    runtimeId: delta.runtimeId,
    projectId: delta.projectId,
    role: delta.role ?? "assistant",
    text: "",
    timestamp: delta.timestamp,
    updatedAt: delta.timestamp,
    isStreaming: delta.isStreaming,
  };
  const current = index === -1 ? fallback : messages[index];
  const nextMessage: ConversationMessage = {
    ...current,
    role: delta.role ?? current.role,
    title: delta.title ?? current.title,
    text: delta.text ?? `${current.text}${delta.appendText ?? ""}`,
    thinking: delta.thinking ?? (delta.appendThinking ? `${current.thinking ?? ""}${delta.appendThinking}` : current.thinking),
    isStreaming: delta.isStreaming ?? current.isStreaming,
    updatedAt: delta.timestamp,
  };

  if (index === -1) return [...messages, nextMessage];
  const next = [...messages];
  next[index] = nextMessage;
  return next;
}

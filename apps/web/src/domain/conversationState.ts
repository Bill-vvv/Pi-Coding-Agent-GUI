import type { ConversationDelta, ConversationMessage } from "@pi-gui/shared";

export const HYDRATED_RUNTIME_MRU_LIMIT = 5;

export function mergeConversationSnapshot(currentMessages: ConversationMessage[], snapshotMessages: ConversationMessage[]): ConversationMessage[] {
  if (currentMessages.length === 0) return snapshotMessages;
  if (snapshotMessages.length === 0) return currentMessages;

  const originalOrder = new Map<string, number>();
  const merged = new Map<string, ConversationMessage>();
  for (const message of currentMessages) {
    originalOrder.set(message.id, originalOrder.size);
    merged.set(message.id, message);
  }
  for (const message of snapshotMessages) {
    if (!originalOrder.has(message.id)) originalOrder.set(message.id, originalOrder.size);
    const current = merged.get(message.id);
    merged.set(message.id, current ? newerConversationMessage(current, message) : message);
  }

  return [...merged.values()].sort((left, right) => compareConversationMessages(left, right, originalOrder));
}

export function prependConversationPage(currentMessages: ConversationMessage[], pageMessages: ConversationMessage[]): ConversationMessage[] {
  if (pageMessages.length === 0) return currentMessages;
  if (currentMessages.length === 0) return pageMessages;
  const existingIds = new Set(currentMessages.map((message) => message.id));
  const prepended = pageMessages.filter((message) => !existingIds.has(message.id));
  return prepended.length === 0 ? currentMessages : [...prepended, ...currentMessages];
}

export function evictInactiveRuntimeMessages(
  messagesByRuntime: Record<string, ConversationMessage[]>,
  hydratedRuntimeIds: string[],
  activeRuntimeId?: string,
): Record<string, ConversationMessage[]> {
  const keep = new Set(hydratedRuntimeIds.slice(-HYDRATED_RUNTIME_MRU_LIMIT));
  if (activeRuntimeId) keep.add(activeRuntimeId);
  const entries = Object.entries(messagesByRuntime).filter(([runtimeId]) => keep.has(runtimeId));
  return entries.length === Object.keys(messagesByRuntime).length ? messagesByRuntime : Object.fromEntries(entries);
}

export function rememberHydratedRuntime(current: string[], runtimeId: string, limit = HYDRATED_RUNTIME_MRU_LIMIT): string[] {
  const next = [...current.filter((id) => id !== runtimeId), runtimeId];
  return next.slice(-Math.max(1, limit));
}

export function upsertConversationMessage(messages: ConversationMessage[], message: ConversationMessage): ConversationMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index === -1) return [...messages, message];
  const next = [...messages];
  next[index] = message;
  return next;
}

export function applyConversationDeltas(messages: ConversationMessage[], deltas: ConversationDelta[]): ConversationMessage[] {
  return deltas.reduce(applyConversationDelta, messages);
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

function newerConversationMessage(current: ConversationMessage, snapshot: ConversationMessage): ConversationMessage {
  const currentUpdatedAt = current.updatedAt ?? current.timestamp ?? 0;
  const snapshotUpdatedAt = snapshot.updatedAt ?? snapshot.timestamp ?? 0;
  if (currentUpdatedAt > snapshotUpdatedAt) return current;
  if (currentUpdatedAt === snapshotUpdatedAt && current.isStreaming && snapshot.isStreaming && current.text.length > snapshot.text.length) return current;
  return snapshot;
}

function compareConversationMessages(left: ConversationMessage, right: ConversationMessage, originalOrder: Map<string, number>): number {
  const leftTimestamp = left.timestamp ?? left.updatedAt ?? 0;
  const rightTimestamp = right.timestamp ?? right.updatedAt ?? 0;
  if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp;
  return (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0);
}

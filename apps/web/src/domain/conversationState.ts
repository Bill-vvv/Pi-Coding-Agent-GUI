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
  if (deltas.length === 0) return messages;
  const tailApplied = applyTailConversationDeltas(messages, deltas);
  if (tailApplied) return tailApplied;

  const indexById = new Map<string, number>();
  for (const [index, message] of messages.entries()) indexById.set(message.id, index);

  let nextMessages = messages;
  for (const delta of deltas) {
    const existingIndex = indexById.get(delta.messageId);
    const current = existingIndex === undefined ? fallbackConversationMessage(delta) : nextMessages[existingIndex]!;
    const nextMessage = applyConversationDeltaToMessage(current, delta);

    if (nextMessages === messages) nextMessages = [...messages];
    if (existingIndex === undefined) {
      indexById.set(delta.messageId, nextMessages.length);
      nextMessages.push(nextMessage);
    } else {
      nextMessages[existingIndex] = nextMessage;
    }
  }

  return nextMessages;
}

export function applyConversationDelta(messages: ConversationMessage[], delta: ConversationDelta): ConversationMessage[] {
  return applyConversationDeltas(messages, [delta]);
}

function applyTailConversationDeltas(messages: ConversationMessage[], deltas: ConversationDelta[]): ConversationMessage[] | undefined {
  const firstDelta = deltas[0];
  if (!firstDelta || !deltas.every((delta) => delta.messageId === firstDelta.messageId)) return undefined;

  const lastMessage = messages.at(-1);
  if (lastMessage && lastMessage.id !== firstDelta.messageId) return undefined;
  if (!lastMessage && messages.length > 0) return undefined;

  let nextMessage = lastMessage ?? fallbackConversationMessage(firstDelta);
  for (const delta of deltas) nextMessage = applyConversationDeltaToMessage(nextMessage, delta);
  return lastMessage ? [...messages.slice(0, -1), nextMessage] : [nextMessage];
}

function fallbackConversationMessage(delta: ConversationDelta): ConversationMessage {
  return {
    id: delta.messageId,
    runtimeId: delta.runtimeId,
    projectId: delta.projectId,
    role: delta.role ?? "assistant",
    text: "",
    timestamp: delta.timestamp,
    updatedAt: delta.timestamp,
    isStreaming: delta.isStreaming,
  };
}

function applyConversationDeltaToMessage(current: ConversationMessage, delta: ConversationDelta): ConversationMessage {
  return {
    ...current,
    role: delta.role ?? current.role,
    title: delta.title ?? current.title,
    text: delta.text ?? `${current.text}${delta.appendText ?? ""}`,
    thinking: delta.thinking ?? (delta.appendThinking ? `${current.thinking ?? ""}${delta.appendThinking}` : current.thinking),
    isStreaming: delta.isStreaming ?? current.isStreaming,
    updatedAt: delta.timestamp,
  };
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

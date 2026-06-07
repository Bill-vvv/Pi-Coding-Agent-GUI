import type { ConversationMessage } from "@pi-gui/shared";

export function mergeConversationMessages(persistedMessages: ConversationMessage[], cachedMessages: ConversationMessage[], limit: number): { messages: ConversationMessage[]; hasMoreBefore: boolean } {
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  const ids: string[] = [];
  const messagesById = new Map<string, ConversationMessage>();

  for (const message of persistedMessages) {
    if (!messagesById.has(message.id)) ids.push(message.id);
    messagesById.set(message.id, message);
  }

  for (const message of cachedMessages) {
    if (!messagesById.has(message.id)) ids.push(message.id);
    messagesById.set(message.id, message);
  }

  const messages = ids.flatMap((id) => {
    const message = messagesById.get(id);
    return message ? [message] : [];
  });
  return { messages: messages.slice(-boundedLimit), hasMoreBefore: messages.length > boundedLimit };
}

export function snapshotDuplicateSignature(message: ConversationMessage): string | undefined {
  if (message.timestamp === undefined || !Number.isFinite(message.timestamp)) return undefined;
  if (!message.text && !message.thinking) return undefined;
  return JSON.stringify([message.role, message.timestamp, message.text, message.thinking ?? "", message.title ?? ""]);
}

export function isSyntheticSnapshotMessageId(id: string): boolean {
  return /^snapshot-\d+-\d+$/.test(id) || /^tool-snapshot-\d+-\d+$/.test(id) || /^bash-\d+-\d+$/.test(id);
}

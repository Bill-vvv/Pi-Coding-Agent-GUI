import type { ConversationMessage } from "@pi-gui/shared";

export class ConversationMessageCache {
  private readonly messages = new Map<string, ConversationMessage>();
  private readonly messageOrder: string[] = [];

  get size(): number {
    return this.messages.size;
  }

  get(messageId: string): ConversationMessage | undefined {
    return this.messages.get(messageId);
  }

  upsert(message: ConversationMessage): ConversationMessage {
    if (!this.messages.has(message.id)) this.messageOrder.push(message.id);
    this.messages.set(message.id, message);
    this.prunePersistedNonStreamingMessages();
    return message;
  }

  replace(messages: ConversationMessage[]): void {
    this.messages.clear();
    this.messageOrder.length = 0;
    for (const message of messages) this.upsert(message);
  }

  retain(messageId: string): void {
    const message = this.messages.get(messageId);
    if (!message) return;
    this.messages.delete(messageId);
    this.messageOrder.splice(this.messageOrder.indexOf(messageId), 1);
    this.upsert(message);
  }

  ordered(limit = 100): ConversationMessage[] {
    const messages = this.messageOrder.flatMap((id) => {
      const message = this.messages.get(id);
      return message ? [message] : [];
    });
    return messages.slice(-Math.max(1, Math.min(limit, 500)));
  }

  private prunePersistedNonStreamingMessages(): void {
    if (this.messageOrder.length <= MAX_CACHE_MESSAGES) return;
    for (let index = 0; index < this.messageOrder.length && this.messageOrder.length > MAX_CACHE_MESSAGES; ) {
      const id = this.messageOrder[index];
      const message = id ? this.messages.get(id) : undefined;
      if (message && !message.isStreaming) {
        this.messages.delete(id!);
        this.messageOrder.splice(index, 1);
        continue;
      }
      index += 1;
    }
  }
}

const MAX_CACHE_MESSAGES = 160;

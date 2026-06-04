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
    return message;
  }

  replace(messages: ConversationMessage[]): void {
    this.messages.clear();
    this.messageOrder.length = 0;
    for (const message of messages) this.upsert(message);
  }

  ordered(limit = 100): ConversationMessage[] {
    const messages = this.messageOrder.flatMap((id) => {
      const message = this.messages.get(id);
      return message ? [message] : [];
    });
    return messages.slice(-Math.max(1, Math.min(limit, 500)));
  }
}

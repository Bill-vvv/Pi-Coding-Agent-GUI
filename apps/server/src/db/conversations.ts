import type Database from "better-sqlite3";
import type { ConversationContextUsage, ConversationMessage, RuntimeConversationSummary } from "@pi-gui/shared";
import { conversationContextFromRow, conversationMessageFromRow } from "./mappers.js";
import type { ConversationMessageRow, RuntimeConversationStateRow, RuntimeConversationSummaryRow } from "./rows.js";
import { runtimeConversationSummaryFromRow } from "./summaries.js";

export class ConversationStore {
  constructor(private readonly db: Database.Database) {}

  upsertConversationMessage(message: ConversationMessage): ConversationMessage {
    const now = Date.now();
    const timestamp = message.timestamp ?? now;
    this.db
      .prepare(
        `insert into conversation_messages (runtime_id, project_id, message_id, role, text, thinking, title, is_streaming, timestamp, created_at, updated_at)
         values (@runtimeId, @projectId, @id, @role, @text, @thinking, @title, @isStreaming, @timestamp, @createdAt, @updatedAt)
         on conflict(runtime_id, message_id) do update set
           project_id = excluded.project_id,
           role = excluded.role,
           text = excluded.text,
           thinking = excluded.thinking,
           title = excluded.title,
           is_streaming = excluded.is_streaming,
           timestamp = excluded.timestamp,
           updated_at = excluded.updated_at`,
      )
      .run({
        runtimeId: message.runtimeId,
        projectId: message.projectId,
        id: message.id,
        role: message.role,
        text: message.text,
        thinking: message.thinking ?? null,
        title: message.title ?? null,
        isStreaming: message.isStreaming ? 1 : 0,
        timestamp,
        createdAt: timestamp,
        updatedAt: message.updatedAt ?? now,
      });
    return this.getConversationMessage(message.runtimeId, message.id) ?? message;
  }

  getConversationMessage(runtimeId: string, messageId: string): ConversationMessage | undefined {
    const row = this.db
      .prepare("select * from conversation_messages where runtime_id = ? and message_id = ?")
      .get(runtimeId, messageId) as ConversationMessageRow | undefined;
    return row ? conversationMessageFromRow(row) : undefined;
  }

  listConversationMessages(runtimeId: string, limit = 100): ConversationMessage[] {
    const boundedLimit = Math.max(1, Math.min(limit, 500));
    const rows = this.db
      .prepare(
        `select * from (
           select * from conversation_messages where runtime_id = ? order by created_at desc limit ?
         ) order by created_at asc`,
      )
      .all(runtimeId, boundedLimit) as ConversationMessageRow[];
    return rows.map(conversationMessageFromRow);
  }

  listRuntimeConversationSummaries(limit = 100): RuntimeConversationSummary[] {
    const rows = this.db
      .prepare(
        `select
           r.id as runtime_id,
           r.project_id,
           (
             select m.text from conversation_messages m
             where m.runtime_id = r.id and m.role = 'user' and trim(m.text) != ''
             order by m.created_at asc limit 1
           ) as first_user_text,
           (
             select m.text from conversation_messages m
             where m.runtime_id = r.id and m.role in ('user', 'assistant') and trim(m.text) != ''
             order by m.created_at asc limit 1
           ) as first_message_text,
           (
             select m.text from conversation_messages m
             where m.runtime_id = r.id and m.role in ('user', 'assistant') and trim(m.text) != ''
             order by m.created_at desc limit 1
           ) as latest_message_text,
           (
             select m.updated_at from conversation_messages m
             where m.runtime_id = r.id and m.role in ('user', 'assistant') and trim(m.text) != ''
             order by m.created_at desc limit 1
           ) as latest_updated_at,
           (
             select count(*) from conversation_messages m
             where m.runtime_id = r.id and m.role in ('user', 'assistant') and trim(m.text) != ''
           ) as message_count
         from runtimes r
         order by r.updated_at desc
         limit ?`,
      )
      .all(Math.max(1, Math.min(limit, 500))) as RuntimeConversationSummaryRow[];

    return rows.flatMap(runtimeConversationSummaryFromRow);
  }

  replaceConversationMessages(runtimeId: string, messages: ConversationMessage[]): void {
    const deleteMessages = this.db.prepare("delete from conversation_messages where runtime_id = ?");
    const insertMessage = this.db.prepare(
      `insert into conversation_messages (runtime_id, project_id, message_id, role, text, thinking, title, is_streaming, timestamp, created_at, updated_at)
       values (@runtimeId, @projectId, @id, @role, @text, @thinking, @title, @isStreaming, @timestamp, @createdAt, @updatedAt)`,
    );
    const now = Date.now();
    this.db.transaction((items: ConversationMessage[]) => {
      deleteMessages.run(runtimeId);
      items.forEach((message, index) => {
        const timestamp = message.timestamp ?? now + index;
        insertMessage.run({
          runtimeId: message.runtimeId,
          projectId: message.projectId,
          id: message.id,
          role: message.role,
          text: message.text,
          thinking: message.thinking ?? null,
          title: message.title ?? null,
          isStreaming: message.isStreaming ? 1 : 0,
          timestamp,
          createdAt: timestamp + index,
          updatedAt: message.updatedAt ?? now,
        });
      });
    })(messages);
  }

  getConversationContext(runtimeId: string): ConversationContextUsage | undefined {
    const row = this.getRuntimeConversationState(runtimeId);
    return row ? conversationContextFromRow(row) : undefined;
  }

  updateConversationContext(runtimeId: string, projectId: string, usage: ConversationContextUsage): ConversationContextUsage {
    const now = usage.updatedAt ?? Date.now();
    this.db
      .prepare(
        `insert into runtime_conversation_state (runtime_id, project_id, tokens, context_window, percent, updated_at, busy)
         values (@runtimeId, @projectId, @tokens, @contextWindow, @percent, @updatedAt, coalesce((select busy from runtime_conversation_state where runtime_id = @runtimeId), 0))
         on conflict(runtime_id) do update set
           project_id = excluded.project_id,
           tokens = excluded.tokens,
           context_window = excluded.context_window,
           percent = excluded.percent,
           updated_at = excluded.updated_at`,
      )
      .run({
        runtimeId,
        projectId,
        tokens: usage.tokens ?? null,
        contextWindow: usage.contextWindow ?? null,
        percent: usage.percent ?? null,
        updatedAt: now,
      });
    return this.getConversationContext(runtimeId) ?? { ...usage, updatedAt: now };
  }

  getConversationBusy(runtimeId: string): boolean {
    return this.getRuntimeConversationState(runtimeId)?.busy === 1;
  }

  setConversationBusy(runtimeId: string, projectId: string, busy: boolean, timestamp = Date.now()): boolean {
    this.db
      .prepare(
        `insert into runtime_conversation_state (runtime_id, project_id, tokens, context_window, percent, updated_at, busy)
         values (@runtimeId, @projectId, null, null, null, @updatedAt, @busy)
         on conflict(runtime_id) do update set
           project_id = excluded.project_id,
           updated_at = excluded.updated_at,
           busy = excluded.busy`,
      )
      .run({ runtimeId, projectId, updatedAt: timestamp, busy: busy ? 1 : 0 });
    return busy;
  }

  private getRuntimeConversationState(runtimeId: string): RuntimeConversationStateRow | undefined {
    return this.db
      .prepare("select * from runtime_conversation_state where runtime_id = ?")
      .get(runtimeId) as RuntimeConversationStateRow | undefined;
  }
}

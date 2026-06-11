import type Database from "better-sqlite3";
import type { ConversationContextUsage, ConversationMessage, ConversationTokenUsage, RuntimeConversationSummary } from "@pi-gui/shared";
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
        `insert into conversation_messages (runtime_id, project_id, message_id, role, text, thinking, title, is_streaming, tool_details_json, timestamp, created_at, updated_at)
         values (@runtimeId, @projectId, @id, @role, @text, @thinking, @title, @isStreaming, @toolDetailsJson, @timestamp, @createdAt, @updatedAt)
         on conflict(runtime_id, message_id) do update set
           project_id = excluded.project_id,
           role = excluded.role,
           text = excluded.text,
           thinking = excluded.thinking,
           title = excluded.title,
           is_streaming = excluded.is_streaming,
           tool_details_json = excluded.tool_details_json,
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
        toolDetailsJson: serializeToolDetails(message.toolDetails),
        timestamp,
        createdAt: timestamp,
        updatedAt: message.updatedAt ?? now,
      });
    this.refreshRuntimeConversationSummary(message.runtimeId);
    return this.getConversationMessage(message.runtimeId, message.id) ?? message;
  }

  getConversationMessage(runtimeId: string, messageId: string): ConversationMessage | undefined {
    const row = this.db
      .prepare("select * from conversation_messages where runtime_id = ? and message_id = ?")
      .get(runtimeId, messageId) as ConversationMessageRow | undefined;
    return row ? conversationMessageFromRow(row) : undefined;
  }

  listConversationMessages(runtimeId: string, limit = 100): ConversationMessage[] {
    return this.listLatestConversationMessages(runtimeId, limit).messages;
  }

  hasConversationMessages(runtimeId: string): boolean {
    return Boolean(this.db.prepare("select 1 from conversation_messages where runtime_id = ? limit 1").get(runtimeId));
  }

  listLatestConversationMessages(runtimeId: string, limit = 100): { messages: ConversationMessage[]; hasMoreBefore: boolean } {
    const boundedLimit = Math.max(1, Math.min(limit, 500));
    const rows = this.db
      .prepare(
        `select * from (
           select *, rowid as _rowid from conversation_messages where runtime_id = ? order by created_at desc, rowid desc limit ?
         ) order by created_at asc, _rowid asc`,
      )
      .all(runtimeId, boundedLimit + 1) as ConversationMessageRow[];
    const hasMoreBefore = rows.length > boundedLimit;
    const visibleRows = hasMoreBefore ? rows.slice(1) : rows;
    return { messages: visibleRows.map(conversationMessageFromRow), hasMoreBefore };
  }

  listConversationMessagesBefore(runtimeId: string, beforeMessageId: string, limit = 100): { messages: ConversationMessage[]; hasMoreBefore: boolean } {
    const boundedLimit = Math.max(1, Math.min(limit, 500));
    const anchor = this.db
      .prepare("select created_at, rowid as row_id from conversation_messages where runtime_id = ? and message_id = ?")
      .get(runtimeId, beforeMessageId) as { created_at: number; row_id: number } | undefined;
    if (!anchor) return { messages: [], hasMoreBefore: false };

    const rows = this.db
      .prepare(
        `select * from (
           select *, rowid as _rowid from conversation_messages
           where runtime_id = ? and (created_at < ? or (created_at = ? and rowid < ?))
           order by created_at desc, rowid desc limit ?
         ) order by created_at asc, _rowid asc`,
      )
      .all(runtimeId, anchor.created_at, anchor.created_at, anchor.row_id, boundedLimit + 1) as ConversationMessageRow[];
    const hasMoreBefore = rows.length > boundedLimit;
    const visibleRows = hasMoreBefore ? rows.slice(1) : rows;
    return { messages: visibleRows.map(conversationMessageFromRow), hasMoreBefore };
  }

  listRuntimeConversationSummaries(limit = 100): RuntimeConversationSummary[] {
    const rows = this.db
      .prepare(
        `select s.runtime_id, s.project_id, s.first_user_text, s.first_message_text, s.latest_message_text, s.latest_updated_at, s.latest_assistant_completed_at, s.message_count
         from runtime_conversation_summaries s
         join runtimes r on r.id = s.runtime_id
         order by r.updated_at desc
         limit ?`,
      )
      .all(Math.max(1, Math.min(limit, 500))) as RuntimeConversationSummaryRow[];

    return rows.flatMap(runtimeConversationSummaryFromRow);
  }

  replaceConversationMessages(runtimeId: string, messages: ConversationMessage[]): void {
    const deleteMessages = this.db.prepare("delete from conversation_messages where runtime_id = ?");
    const insertMessage = this.db.prepare(
      `insert into conversation_messages (runtime_id, project_id, message_id, role, text, thinking, title, is_streaming, tool_details_json, timestamp, created_at, updated_at)
       values (@runtimeId, @projectId, @id, @role, @text, @thinking, @title, @isStreaming, @toolDetailsJson, @timestamp, @createdAt, @updatedAt)`,
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
          toolDetailsJson: serializeToolDetails(message.toolDetails),
          timestamp,
          createdAt: timestamp + index,
          updatedAt: message.updatedAt ?? now,
        });
      });
    })(messages);
    this.refreshRuntimeConversationSummary(runtimeId);
  }

  markStreamingMessagesInterrupted(runtimeId: string, projectId: string, reasonText: string, timestamp = Date.now()): ConversationMessage[] {
    const rows = this.db
      .prepare("select * from conversation_messages where runtime_id = ? and is_streaming = 1 order by created_at asc, rowid asc")
      .all(runtimeId) as ConversationMessageRow[];
    if (rows.length === 0) return [];

    const updateMessage = this.db.prepare(
      `update conversation_messages
       set is_streaming = 0, title = @title, text = @text, updated_at = @updatedAt
       where runtime_id = @runtimeId and message_id = @messageId`,
    );
    const messages = rows.map((row) => {
      const title = row.role === "tool" ? interruptedToolTitle(row.title) : row.title;
      const text = row.role === "tool" && !row.text.trim() ? reasonText : row.text;
      return conversationMessageFromRow({ ...row, project_id: projectId, title, text, is_streaming: 0, updated_at: timestamp });
    });

    this.db.transaction((items: ConversationMessage[]) => {
      for (const message of items) {
        updateMessage.run({
          runtimeId,
          messageId: message.id,
          title: message.title ?? null,
          text: message.text,
          updatedAt: timestamp,
        });
      }
    })(messages);
    this.refreshRuntimeConversationSummary(runtimeId);

    return messages;
  }

  getConversationContext(runtimeId: string): ConversationContextUsage | undefined {
    const row = this.getRuntimeConversationState(runtimeId);
    return row ? conversationContextFromRow(row) : undefined;
  }

  updateConversationContext(runtimeId: string, projectId: string, usage: ConversationContextUsage): ConversationContextUsage {
    const now = usage.updatedAt ?? Date.now();
    const previous = this.getConversationContext(runtimeId);
    // Session token/cost usage is cumulative billing data; never let compacted Pi stats lower it.
    const sessionTokens = mergeCumulativeSessionTokens(previous?.sessionTokens, usage.sessionTokens);
    this.db
      .prepare(
        `insert into runtime_conversation_state (runtime_id, project_id, tokens, context_window, percent, session_tokens_json, updated_at, busy)
         values (@runtimeId, @projectId, @tokens, @contextWindow, @percent, @sessionTokensJson, @updatedAt, coalesce((select busy from runtime_conversation_state where runtime_id = @runtimeId), 0))
         on conflict(runtime_id) do update set
           project_id = excluded.project_id,
           tokens = excluded.tokens,
           context_window = excluded.context_window,
           percent = excluded.percent,
           session_tokens_json = excluded.session_tokens_json,
           updated_at = excluded.updated_at`,
      )
      .run({
        runtimeId,
        projectId,
        tokens: conversationContextValue(usage, "tokens", previous?.tokens),
        contextWindow: usage.contextWindow ?? previous?.contextWindow ?? null,
        percent: conversationContextValue(usage, "percent", previous?.percent),
        sessionTokensJson: serializeSessionTokens(sessionTokens),
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

  private refreshRuntimeConversationSummary(runtimeId: string): void {
    const row = this.db
      .prepare(
        `select
           runtime_id,
           project_id,
           (
             select m.text from conversation_messages m
             where m.runtime_id = conversation_messages.runtime_id and m.role = 'user' and trim(m.text) != ''
             order by m.created_at asc, m.rowid asc limit 1
           ) as first_user_text,
           (
             select m.text from conversation_messages m
             where m.runtime_id = conversation_messages.runtime_id and m.role in ('user', 'assistant') and trim(m.text) != ''
             order by m.created_at asc, m.rowid asc limit 1
           ) as first_message_text,
           (
             select m.text from conversation_messages m
             where m.runtime_id = conversation_messages.runtime_id and m.role in ('user', 'assistant') and trim(m.text) != ''
             order by m.created_at desc, m.rowid desc limit 1
           ) as latest_message_text,
           (
             select m.updated_at from conversation_messages m
             where m.runtime_id = conversation_messages.runtime_id and m.role in ('user', 'assistant') and trim(m.text) != ''
             order by m.created_at desc, m.rowid desc limit 1
           ) as latest_updated_at,
           (
             select m.updated_at from conversation_messages m
             where m.runtime_id = conversation_messages.runtime_id and m.role = 'assistant' and trim(m.text) != '' and m.is_streaming = 0
             order by m.created_at desc, m.rowid desc limit 1
           ) as latest_assistant_completed_at,
           (
             select count(*) from conversation_messages m
             where m.runtime_id = conversation_messages.runtime_id and m.role in ('user', 'assistant') and trim(m.text) != ''
           ) as message_count
         from conversation_messages
         where runtime_id = ?
         limit 1`,
      )
      .get(runtimeId) as RuntimeConversationSummaryRow | undefined;

    if (!row || runtimeConversationSummaryFromRow(row).length === 0) {
      this.db.prepare("delete from runtime_conversation_summaries where runtime_id = ?").run(runtimeId);
      return;
    }

    this.db
      .prepare(
        `insert into runtime_conversation_summaries (runtime_id, project_id, first_user_text, first_message_text, latest_message_text, latest_updated_at, latest_assistant_completed_at, message_count, refreshed_at)
         values (@runtimeId, @projectId, @firstUserText, @firstMessageText, @latestMessageText, @latestUpdatedAt, @latestAssistantCompletedAt, @messageCount, @refreshedAt)
         on conflict(runtime_id) do update set
           project_id = excluded.project_id,
           first_user_text = excluded.first_user_text,
           first_message_text = excluded.first_message_text,
           latest_message_text = excluded.latest_message_text,
           latest_updated_at = excluded.latest_updated_at,
           latest_assistant_completed_at = excluded.latest_assistant_completed_at,
           message_count = excluded.message_count,
           refreshed_at = excluded.refreshed_at`,
      )
      .run({
        runtimeId: row.runtime_id,
        projectId: row.project_id,
        firstUserText: row.first_user_text,
        firstMessageText: row.first_message_text,
        latestMessageText: row.latest_message_text,
        latestUpdatedAt: row.latest_updated_at,
        latestAssistantCompletedAt: row.latest_assistant_completed_at,
        messageCount: row.message_count,
        refreshedAt: Date.now(),
      });
  }
}

function interruptedToolTitle(title: string | null): string {
  const trimmed = title?.trim();
  if (!trimmed) return "工具 失败";
  if (trimmed.endsWith(" 运行中")) return `${trimmed.slice(0, -" 运行中".length)} 失败`;
  if (trimmed.endsWith(" 完成") || trimmed.endsWith(" 失败")) return trimmed;
  return `${trimmed} 失败`;
}

function serializeSessionTokens(usage: ConversationTokenUsage | undefined): string | null {
  if (!usage || !Object.values(usage).some((item) => item !== undefined)) return null;
  return JSON.stringify(usage);
}

function serializeToolDetails(details: ConversationMessage["toolDetails"]): string | null {
  if (!details || !Object.values(details).some((item) => item !== undefined)) return null;
  return JSON.stringify(details);
}

function conversationContextValue(
  usage: ConversationContextUsage,
  key: "tokens" | "percent",
  previous: number | null | undefined,
): number | null {
  if (Object.prototype.hasOwnProperty.call(usage, key)) {
    const value = usage[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  return typeof previous === "number" && Number.isFinite(previous) ? previous : null;
}

function mergeCumulativeSessionTokens(previous: ConversationTokenUsage | undefined, next: ConversationTokenUsage | undefined): ConversationTokenUsage | undefined {
  if (!previous) return next;
  if (!next) return previous;
  const merged: ConversationTokenUsage = {
    input: maxOptional(previous.input, next.input),
    output: maxOptional(previous.output, next.output),
    cacheRead: maxOptional(previous.cacheRead, next.cacheRead),
    cacheWrite: maxOptional(previous.cacheWrite, next.cacheWrite),
    total: maxOptional(previous.total, next.total),
    cost: maxOptional(previous.cost, next.cost),
  };
  return Object.values(merged).some((item) => item !== undefined) ? merged : undefined;
}

function maxOptional(previous: number | undefined, next: number | undefined): number | undefined {
  if (previous === undefined) return next;
  if (next === undefined) return previous;
  return Math.max(previous, next);
}

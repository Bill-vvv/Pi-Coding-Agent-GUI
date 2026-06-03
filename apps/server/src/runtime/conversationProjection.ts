import { randomUUID } from "node:crypto";
import type { ConversationContextUsage, ConversationDelta, ConversationMessage, Runtime, ServerEvent } from "@pi-gui/shared";
import { isRecord, stripSerializedToolCallsFromText } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";

type Broadcast = (event: ServerEvent) => void;
type RuntimeProvider = () => Runtime | undefined;

type ExtractedMessageContent = {
  text: string;
  thinking?: string;
};

type PiMessageRole = "user" | "assistant" | "tool" | "toolResult" | "bashExecution";

export class ConversationProjection {
  private currentAssistantMessageId?: string;
  private currentUserMessageId?: string;
  private readonly toolMessageIds = new Map<string, string>();
  private readonly messages = new Map<string, ConversationMessage>();
  private readonly messageOrder: string[] = [];

  constructor(
    private readonly db: AppDatabase,
    private readonly getRuntime: RuntimeProvider,
    private readonly broadcast: Broadcast,
  ) {}

  snapshot(limit = 100): ServerEvent | undefined {
    const runtime = this.getRuntime();
    if (!runtime) return undefined;
    const cachedMessages = this.orderedMessages(limit);
    return {
      type: "conversation.snapshot",
      runtimeId: runtime.id,
      projectId: runtime.projectId,
      messages: cachedMessages.length > 0 ? cachedMessages : this.db.listConversationMessages(runtime.id, limit),
      contextUsage: this.db.getConversationContext(runtime.id),
      busy: this.db.getConversationBusy(runtime.id),
    };
  }

  appendLog(role: "error" | "log", text: string, title?: string): void {
    if (!text.trim()) return;
    this.upsertMessage({
      id: `${role}-${randomUUID()}`,
      role,
      text: compactText(text),
      title,
      timestamp: Date.now(),
      isStreaming: false,
    });
  }

  handlePiPayload(payload: unknown): void {
    if (!isRecord(payload)) return;

    if (payload.type === "response") {
      this.handleResponse(payload);
    }

    switch (payload.type) {
      case "agent_start":
      case "compaction_start":
        this.setBusy(true);
        return;
      case "agent_end":
      case "compaction_end":
        this.setBusy(false);
        return;
      case "message_start":
        this.handleMessageStart(payload);
        return;
      case "message_update":
        this.handleMessageUpdate(payload);
        return;
      case "message_end":
        this.handleMessageEnd(payload);
        return;
      case "tool_execution_start":
        this.handleToolExecutionStart(payload);
        return;
      case "tool_execution_update":
        this.handleToolExecutionUpdate(payload);
        return;
      case "tool_execution_end":
        this.handleToolExecutionEnd(payload);
        return;
      default:
        return;
    }
  }

  private handleResponse(payload: Record<string, unknown>): void {
    if (payload.success !== true) return;
    const command = typeof payload.command === "string" ? payload.command : undefined;
    const data = isRecord(payload.data) ? payload.data : undefined;

    if (command === "get_messages" && data) {
      this.applyMessagesSnapshot(data.messages);
      return;
    }

    if (command === "get_session_stats" && data) {
      const nextUsage = contextUsageFromSessionStats(data, this.currentContextWindow());
      if (nextUsage) this.updateContext(nextUsage);
      return;
    }

    if (command === "get_state" && data) {
      const model = isRecord(data.model) ? data.model : undefined;
      const contextWindow = numberOrUndefined(model?.contextWindow) ?? numberOrUndefined(model?.context_window);
      if (contextWindow !== undefined) {
        this.updateContext({ ...this.db.getConversationContext(this.requireRuntime().id), contextWindow, updatedAt: Date.now() });
      }
      if (typeof data.isStreaming === "boolean") this.setBusy(data.isStreaming);
      if (typeof data.isCompacting === "boolean" && data.isCompacting) this.setBusy(true);
      return;
    }

    if (command === "set_model" && data) {
      const contextWindow = numberOrUndefined(data.contextWindow) ?? numberOrUndefined(data.context_window);
      if (contextWindow !== undefined) {
        this.updateContext({ ...this.db.getConversationContext(this.requireRuntime().id), contextWindow, updatedAt: Date.now() });
      }
    }
  }

  private handleMessageStart(payload: Record<string, unknown>): void {
    const message = isRecord(payload.message) ? payload.message : undefined;
    if (!message) return;
    const role = messageRoleFromPiMessage(message);
    const timestamp = timestampFromPiMessage(message, Date.now());
    const content = extractPiMessageContent(message);

    if (role === "user") {
      const id = messageIdFromPiMessage(message) ?? `user-${randomUUID()}`;
      this.currentUserMessageId = id;
      if (content.text) {
        this.upsertMessage({ id, role: "user", text: content.text, timestamp, isStreaming: false });
      }
      return;
    }

    if (role === "assistant") {
      const id = messageIdFromPiMessage(message) ?? `assistant-${randomUUID()}`;
      this.currentAssistantMessageId = id;
      if (content.text || content.thinking) {
        this.upsertMessage({
          id,
          role: "assistant",
          text: content.text,
          thinking: content.thinking,
          timestamp,
          isStreaming: true,
        }, false);
      }
    }
  }

  private handleMessageUpdate(payload: Record<string, unknown>): void {
    const assistantMessageEvent = isRecord(payload.assistantMessageEvent) ? payload.assistantMessageEvent : undefined;
    if (!assistantMessageEvent) return;

    if (assistantMessageEvent.type === "text_delta" && typeof assistantMessageEvent.delta === "string") {
      const message = this.ensureAssistantMessage(Date.now());
      this.applyDelta(message.id, { appendText: assistantMessageEvent.delta, isStreaming: true });
      return;
    }

    if (assistantMessageEvent.type === "text_end" && typeof assistantMessageEvent.content === "string") {
      const message = this.ensureAssistantMessage(Date.now());
      this.applyDelta(message.id, { text: assistantMessageEvent.content, isStreaming: true });
      return;
    }

    if (assistantMessageEvent.type === "thinking_delta" && typeof assistantMessageEvent.delta === "string") {
      const message = this.ensureAssistantMessage(Date.now());
      this.applyDelta(message.id, { appendThinking: assistantMessageEvent.delta, isStreaming: true });
      return;
    }

    if (assistantMessageEvent.type === "thinking_end" && typeof assistantMessageEvent.content === "string") {
      const message = this.ensureAssistantMessage(Date.now());
      this.applyDelta(message.id, { thinking: assistantMessageEvent.content, isStreaming: true });
      return;
    }

    if (assistantMessageEvent.type === "error") {
      const message = this.ensureAssistantMessage(Date.now());
      const reason = typeof assistantMessageEvent.reason === "string" ? assistantMessageEvent.reason : "stream_error";
      const errorText = typeof assistantMessageEvent.error === "string" ? assistantMessageEvent.error : JSON.stringify(assistantMessageEvent);
      this.upsertMessage({
        id: message.id,
        role: "error",
        text: message.text || `${reason}: ${errorText}`,
        thinking: message.thinking,
        timestamp: Date.now(),
        isStreaming: false,
      });
      this.currentAssistantMessageId = undefined;
    }
  }

  private handleMessageEnd(payload: Record<string, unknown>): void {
    const message = isRecord(payload.message) ? payload.message : undefined;
    if (!message) return;
    const role = messageRoleFromPiMessage(message);
    const timestamp = timestampFromPiMessage(message, Date.now());
    const content = extractPiMessageContent(message);
    const errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : undefined;

    if (role === "user") {
      const id = this.currentUserMessageId ?? messageIdFromPiMessage(message) ?? `user-${randomUUID()}`;
      if (content.text || errorMessage) {
        this.upsertMessage({ id, role: errorMessage ? "error" : "user", text: content.text || errorMessage || "", timestamp, isStreaming: false });
      }
      this.currentUserMessageId = undefined;
      return;
    }

    if (role === "assistant") {
      const id = this.currentAssistantMessageId ?? messageIdFromPiMessage(message) ?? `assistant-${randomUUID()}`;
      const existing = this.getMessage(id);
      const text = content.text || errorMessage || existing?.text || "";
      const thinking = content.thinking || existing?.thinking;
      if (text || thinking || errorMessage) {
        this.upsertMessage({
          id,
          role: errorMessage ? "error" : "assistant",
          text,
          thinking,
          timestamp,
          isStreaming: false,
        });
      }
      this.currentAssistantMessageId = undefined;
    }
  }

  private handleToolExecutionStart(payload: Record<string, unknown>): void {
    const key = toolKeyFromPayload(payload);
    const id = this.toolMessageIds.get(key) ?? `tool-${key}`;
    this.toolMessageIds.set(key, id);
    this.upsertMessage({
      id,
      role: "tool",
      title: `${toolNameFromPayload(payload)} 运行中`,
      text: "",
      timestamp: Date.now(),
      isStreaming: true,
    });
  }

  private handleToolExecutionUpdate(payload: Record<string, unknown>): void {
    const key = toolKeyFromPayload(payload);
    const id = this.toolMessageIds.get(key) ?? `tool-${key}`;
    this.toolMessageIds.set(key, id);
    this.upsertMessage({
      id,
      role: "tool",
      title: `${toolNameFromPayload(payload)} 运行中`,
      text: textFromResult(payload.partialResult) || textFromResult(payload.result),
      timestamp: Date.now(),
      isStreaming: true,
    });
  }

  private handleToolExecutionEnd(payload: Record<string, unknown>): void {
    const key = toolKeyFromPayload(payload);
    const id = this.toolMessageIds.get(key) ?? `tool-${key}`;
    this.toolMessageIds.set(key, id);
    const isError = payload.isError === true;
    this.upsertMessage({
      id,
      role: "tool",
      title: `${toolNameFromPayload(payload)} ${isError ? "失败" : "完成"}`,
      text: textFromResult(payload.result),
      timestamp: Date.now(),
      isStreaming: false,
    });
  }

  private applyMessagesSnapshot(value: unknown): void {
    const runtime = this.requireRuntime();
    if (!Array.isArray(value)) return;

    const messages: ConversationMessage[] = [];
    value.forEach((item, index) => {
      if (!isRecord(item)) return;
      const role = messageRoleFromPiMessage(item);
      const timestamp = timestampFromPiMessage(item, Date.now() + index);

      if (role === "user" || role === "assistant") {
        const content = extractPiMessageContent(item);
        const errorMessage = typeof item.errorMessage === "string" ? item.errorMessage : undefined;
        if (!content.text && !content.thinking && !errorMessage) return;
        messages.push({
          id: messageIdFromPiMessage(item) ?? `snapshot-${index}-${timestamp}`,
          runtimeId: runtime.id,
          projectId: runtime.projectId,
          role: errorMessage ? "error" : role,
          text: content.text || errorMessage || "",
          thinking: content.thinking,
          timestamp,
          updatedAt: Date.now(),
          isStreaming: false,
        });
        return;
      }

      if (role === "tool" || role === "toolResult" || role === "bashExecution") {
        const toolMessage = toolConversationMessageFromPiMessage(item, runtime, index, timestamp);
        if (toolMessage) messages.push(toolMessage);
      }
    });

    if (messages.length === 0) return;

    const existing = this.db.listConversationMessages(runtime.id, 1);
    if (existing.length === 0 && this.messages.size === 0) {
      this.db.replaceConversationMessages(runtime.id, messages);
      this.replaceCachedMessages(messages);
    } else {
      for (const message of messages) {
        this.db.upsertConversationMessage(message);
        this.cacheMessage(message);
      }
    }

    const snapshot = this.snapshot();
    if (snapshot) this.broadcast(snapshot);
  }

  private ensureAssistantMessage(timestamp: number): ConversationMessage {
    const runtime = this.requireRuntime();
    if (this.currentAssistantMessageId) {
      const existing = this.getMessage(this.currentAssistantMessageId);
      if (existing) return existing;
    }

    const id = this.currentAssistantMessageId ?? `assistant-${randomUUID()}`;
    this.currentAssistantMessageId = id;
    return this.upsertMessage({ id, role: "assistant", text: "", timestamp, isStreaming: true }, false);
  }

  private upsertMessage(input: Omit<ConversationMessage, "runtimeId" | "projectId" | "updatedAt"> & { updatedAt?: number }, persist = true): ConversationMessage {
    const runtime = this.requireRuntime();
    const existing = this.getMessage(input.id);
    const message = this.cacheMessage({
      ...existing,
      ...input,
      runtimeId: runtime.id,
      projectId: runtime.projectId,
      text: compactText(input.text ?? existing?.text ?? ""),
      updatedAt: input.updatedAt ?? Date.now(),
    });
    if (persist) this.db.upsertConversationMessage(message);
    this.broadcast({ type: "conversation.message", message });
    return message;
  }

  private applyDelta(messageId: string, input: Omit<ConversationDelta, "runtimeId" | "projectId" | "messageId" | "timestamp">): void {
    const runtime = this.requireRuntime();
    const current = this.getMessage(messageId) ?? this.ensureAssistantMessage(Date.now());
    const next: ConversationMessage = {
      ...current,
      role: input.role ?? current.role,
      title: input.title ?? current.title,
      text: compactText(input.text ?? `${current.text}${input.appendText ?? ""}`),
      thinking: input.thinking ?? (input.appendThinking ? `${current.thinking ?? ""}${input.appendThinking}` : current.thinking),
      isStreaming: input.isStreaming ?? current.isStreaming,
      updatedAt: Date.now(),
    };
    this.cacheMessage(next);
    this.broadcast({
      type: "conversation.delta",
      delta: {
        runtimeId: runtime.id,
        projectId: runtime.projectId,
        messageId,
        timestamp: next.updatedAt ?? Date.now(),
        ...input,
      },
    });
  }

  private updateContext(usage: ConversationContextUsage): void {
    const runtime = this.requireRuntime();
    const nextUsage = this.db.updateConversationContext(runtime.id, runtime.projectId, { ...usage, updatedAt: usage.updatedAt ?? Date.now() });
    this.broadcast({ type: "conversation.context", runtimeId: runtime.id, projectId: runtime.projectId, contextUsage: nextUsage });
  }

  private setBusy(busy: boolean): void {
    const runtime = this.requireRuntime();
    const previous = this.db.getConversationBusy(runtime.id);
    this.db.setConversationBusy(runtime.id, runtime.projectId, busy);
    if (previous !== busy) this.broadcast({ type: "conversation.busy", runtimeId: runtime.id, projectId: runtime.projectId, busy });
  }

  private getMessage(messageId: string): ConversationMessage | undefined {
    const runtime = this.requireRuntime();
    return this.messages.get(messageId) ?? this.db.getConversationMessage(runtime.id, messageId);
  }

  private cacheMessage(message: ConversationMessage): ConversationMessage {
    if (!this.messages.has(message.id)) this.messageOrder.push(message.id);
    this.messages.set(message.id, message);
    return message;
  }

  private replaceCachedMessages(messages: ConversationMessage[]): void {
    this.messages.clear();
    this.messageOrder.length = 0;
    for (const message of messages) this.cacheMessage(message);
  }

  private orderedMessages(limit = 100): ConversationMessage[] {
    const messages = this.messageOrder.flatMap((id) => {
      const message = this.messages.get(id);
      return message ? [message] : [];
    });
    return messages.slice(-Math.max(1, Math.min(limit, 500)));
  }

  private currentContextWindow(): number | undefined {
    return this.db.getConversationContext(this.requireRuntime().id)?.contextWindow;
  }

  private requireRuntime(): Runtime {
    const runtime = this.getRuntime();
    if (!runtime) throw new Error("Conversation runtime is unavailable");
    return runtime;
  }
}

function contextUsageFromSessionStats(data: Record<string, unknown>, currentContextWindow?: number): ConversationContextUsage | undefined {
  const contextUsage = isRecord(data.contextUsage) ? data.contextUsage : undefined;
  if (!contextUsage) return undefined;
  const tokens = numberOrUndefined(contextUsage.tokens);
  const contextWindow = numberOrUndefined(contextUsage.contextWindow) ?? currentContextWindow;
  const reportedPercent = numberOrUndefined(contextUsage.percent);
  return {
    tokens,
    contextWindow,
    percent: tokens !== undefined && contextWindow !== undefined && contextWindow > 0 ? (tokens / contextWindow) * 100 : reportedPercent,
    updatedAt: Date.now(),
  };
}

function extractPiMessageContent(message: Record<string, unknown>): ExtractedMessageContent {
  const content = message.content;
  if (typeof content === "string") return { text: stripSerializedToolCallsFromText(content) };
  if (isRecord(content) && isToolCallContentPart(content)) return { text: "" };
  if (!Array.isArray(content)) return { text: textFromResult(content) };

  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) {
      const text = textFromResult(part);
      if (text) textParts.push(text);
      continue;
    }
    if (part.type === "text" && typeof part.text === "string") {
      const text = stripSerializedToolCallsFromText(part.text);
      if (text) textParts.push(text);
      continue;
    }
    if (part.type === "thinking" && typeof part.thinking === "string") {
      if (part.thinking) thinkingParts.push(part.thinking);
      continue;
    }
    if (part.type === "output_text" && typeof part.text === "string") {
      const text = stripSerializedToolCallsFromText(part.text);
      if (text) textParts.push(text);
      continue;
    }
    if (isToolCallContentPart(part)) {
      continue;
    }
    const fallback = textFromResult(part);
    if (fallback && fallback !== "{}") textParts.push(fallback);
  }

  return {
    text: textParts.filter(Boolean).join("\n"),
    thinking: thinkingParts.filter(Boolean).join("\n") || undefined,
  };
}

function textFromResult(value: unknown): string {
  if (typeof value === "string") return stripSerializedToolCallsFromText(value);
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(textFromResult).filter(Boolean).join("\n");
  if (!isRecord(value)) return String(value);
  if (isToolCallContentPart(value)) return "";

  if (typeof value.text === "string") return stripSerializedToolCallsFromText(value.text);
  if (typeof value.content === "string") return stripSerializedToolCallsFromText(value.content);
  if (typeof value.output === "string") return stripSerializedToolCallsFromText(value.output);
  if (typeof value.result === "string") return stripSerializedToolCallsFromText(value.result);
  if (typeof value.thinking === "string") return "";

  const nestedContent = textFromResult(value.content);
  if (nestedContent) return nestedContent;
  const nestedResult = textFromResult(value.result);
  if (nestedResult) return nestedResult;

  return JSON.stringify(value, null, 2);
}

function isToolCallContentPart(part: Record<string, unknown>): boolean {
  return part.type === "toolCall" || part.type === "tool_call" || part.type === "tool_use" || part.type === "toolResult" || part.type === "tool_result";
}


function toolConversationMessageFromPiMessage(
  message: Record<string, unknown>,
  runtime: Runtime,
  index: number,
  timestamp: number,
): ConversationMessage | undefined {
  const text = toolResultTextFromPiMessage(message);
  const toolName = toolNameFromPiMessage(message);
  const isError = message.isError === true || (typeof message.exitCode === "number" && message.exitCode !== 0);
  const fallbackId = message.role === "bashExecution" ? `bash-${timestamp}-${index}` : `tool-snapshot-${index}-${timestamp}`;
  const id = toolConversationIdFromPiMessage(message) ?? fallbackId;

  if (!text && !toolName) return undefined;

  return {
    id,
    runtimeId: runtime.id,
    projectId: runtime.projectId,
    role: "tool",
    title: `${toolName || "tool"} ${isError ? "失败" : "完成"}`,
    text,
    timestamp,
    updatedAt: Date.now(),
    isStreaming: false,
  };
}

function toolConversationIdFromPiMessage(message: Record<string, unknown>): string | undefined {
  const rawToolCallId = message.toolCallId ?? message.tool_call_id ?? message.callId;
  if (typeof rawToolCallId === "string" || typeof rawToolCallId === "number") return `tool-${rawToolCallId}`;
  const messageId = messageIdFromPiMessage(message);
  return messageId ? `tool-${messageId}` : undefined;
}

function toolNameFromPiMessage(message: Record<string, unknown>): string {
  if (typeof message.toolName === "string") return message.toolName;
  if (typeof message.name === "string") return message.name;
  if (message.role === "bashExecution") return "bash";
  return "tool";
}

function toolResultTextFromPiMessage(message: Record<string, unknown>): string {
  if (message.role === "bashExecution") {
    const output = typeof message.output === "string" ? message.output : "";
    const exitCode = typeof message.exitCode === "number" ? `exitCode: ${message.exitCode}` : "";
    return output || exitCode;
  }
  return textFromResult(message.content) || textFromResult(message.result) || textFromResult(message.output);
}

function messageRoleFromPiMessage(message: Record<string, unknown>): PiMessageRole | undefined {
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

function messageIdFromPiMessage(message: Record<string, unknown>): string | undefined {
  const rawId = message.id ?? message.messageId ?? message.message_id;
  return typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : undefined;
}

function timestampFromPiMessage(message: Record<string, unknown>, fallback: number): number {
  if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) return message.timestamp;
  if (typeof message.createdAt === "number" && Number.isFinite(message.createdAt)) return message.createdAt;
  if (typeof message.updatedAt === "number" && Number.isFinite(message.updatedAt)) return message.updatedAt;
  if (typeof message.timestamp === "string") {
    const parsed = Date.parse(message.timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toolKeyFromPayload(payload: Record<string, unknown>): string {
  const rawKey = payload.toolCallId ?? payload.tool_call_id ?? payload.callId ?? payload.id ?? payload.requestId;
  return typeof rawKey === "string" || typeof rawKey === "number" ? String(rawKey) : randomUUID();
}

function toolNameFromPayload(payload: Record<string, unknown>): string {
  return typeof payload.toolName === "string" ? payload.toolName : typeof payload.name === "string" ? payload.name : "tool";
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const MAX_CONVERSATION_TEXT_CHARS = 200_000;

function compactText(text: string): string {
  if (text.length <= MAX_CONVERSATION_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_CONVERSATION_TEXT_CHARS)}\n…[truncated ${text.length - MAX_CONVERSATION_TEXT_CHARS} chars]`;
}

import { randomUUID } from "node:crypto";
import type { ConversationContextUsage, ConversationDelta, ConversationMessage, Runtime, ServerEvent } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import { ConversationMessageCache } from "./conversation/conversationMessageCache.js";
import { compactText } from "./conversation/conversationText.js";
import type { NormalizedConversationEvent, NormalizedMessage, NormalizedSnapshotMessage, NormalizedTool } from "./conversation/normalizedEvents.js";
import { normalizePiPayload } from "./conversation/piPayloadNormalizer.js";
import { toolStatusLabel, type ToolStatus } from "./conversation/toolStatus.js";

type Broadcast = (event: ServerEvent) => void;
export type RuntimeProvider = () => Runtime | undefined;

function mergeConversationMessages(persistedMessages: ConversationMessage[], cachedMessages: ConversationMessage[], limit: number): ConversationMessage[] {
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

  return ids.flatMap((id) => {
    const message = messagesById.get(id);
    return message ? [message] : [];
  }).slice(-boundedLimit);
}

export class ConversationProjection {
  private currentAssistantMessageId?: string;
  private currentUserMessageId?: string;
  private readonly toolMessageIds = new Map<string, string>();
  private readonly cache = new ConversationMessageCache();

  constructor(
    private readonly db: AppDatabase,
    private readonly getRuntime: RuntimeProvider,
    private readonly broadcast: Broadcast,
  ) {}

  snapshot(limit = 100): ServerEvent | undefined {
    const runtime = this.getRuntime();
    if (!runtime) return undefined;
    const messages = mergeConversationMessages(
      this.db.listConversationMessages(runtime.id, limit),
      this.cache.ordered(limit),
      limit,
    );
    return {
      type: "conversation.snapshot",
      runtimeId: runtime.id,
      projectId: runtime.projectId,
      messages,
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
    const normalizedEvents = normalizePiPayload(payload, { currentContextWindow: this.currentContextWindow() });
    if (normalizedEvents.length > 0) {
      for (const event of normalizedEvents) this.handleNormalizedEvent(event);
      return;
    }

    return;
  }

  private handleNormalizedEvent(event: NormalizedConversationEvent): void {
    switch (event.type) {
      case "busy.changed":
        this.setBusy(event.busy);
        return;
      case "context.usage":
        this.updateContext(event.usage);
        return;
      case "context.window":
        this.updateContext({ ...this.db.getConversationContext(this.requireRuntime().id), contextWindow: event.contextWindow, updatedAt: Date.now() });
        return;
      case "messages.snapshot":
        this.applyMessagesSnapshot(event.messages);
        return;
      case "message.started":
        this.handleNormalizedMessageStart(event.message);
        return;
      case "message.finished":
        this.handleNormalizedMessageEnd(event.message);
        return;
      case "assistant.delta": {
        const message = this.ensureAssistantMessage(Date.now());
        this.applyDelta(message.id, {
          appendText: event.appendText,
          appendThinking: event.appendThinking,
          text: event.text,
          thinking: event.thinking,
          isStreaming: event.isStreaming,
        });
        return;
      }
      case "assistant.error": {
        const message = this.ensureAssistantMessage(Date.now());
        this.upsertMessage({
          id: message.id,
          role: "error",
          text: message.text || `${event.reason}: ${event.errorText}`,
          thinking: message.thinking,
          timestamp: Date.now(),
          isStreaming: false,
        });
        this.currentAssistantMessageId = undefined;
        return;
      }
      case "tool.started":
        this.upsertToolMessage(event.tool, "running");
        return;
      case "tool.updated":
        this.upsertToolMessage(event.tool, "running");
        return;
      case "tool.finished":
        this.upsertToolMessage(event.tool, event.tool.isError ? "failed" : "completed");
        return;
    }
  }

  private handleNormalizedMessageStart(message: NormalizedMessage): void {
    if (message.role === "user") {
      const id = message.id ?? `user-${randomUUID()}`;
      this.currentUserMessageId = id;
      if (message.text) {
        this.upsertMessage({ id, role: "user", text: message.text, timestamp: message.timestamp, isStreaming: false });
      }
      return;
    }

    const id = message.id ?? `assistant-${randomUUID()}`;
    this.currentAssistantMessageId = id;
    if (message.text || message.thinking) {
      this.upsertMessage({
        id,
        role: "assistant",
        text: message.text,
        thinking: message.thinking,
        timestamp: message.timestamp,
        isStreaming: true,
      }, false);
    }
  }

  private handleNormalizedMessageEnd(message: NormalizedMessage): void {
    if (message.role === "user") {
      const id = this.currentUserMessageId ?? message.id ?? `user-${randomUUID()}`;
      if (message.text || message.errorMessage) {
        this.upsertMessage({ id, role: message.errorMessage ? "error" : "user", text: message.text || message.errorMessage || "", timestamp: message.timestamp, isStreaming: false });
      }
      this.currentUserMessageId = undefined;
      return;
    }

    const id = this.currentAssistantMessageId ?? message.id ?? `assistant-${randomUUID()}`;
    const existing = this.getMessage(id);
    const text = message.text || message.errorMessage || existing?.text || "";
    const thinking = message.thinking || existing?.thinking;
    if (text || thinking || message.errorMessage) {
      this.upsertMessage({
        id,
        role: message.errorMessage ? "error" : "assistant",
        text,
        thinking,
        timestamp: message.timestamp,
        isStreaming: false,
      });
    }
    this.currentAssistantMessageId = undefined;
  }

  private upsertToolMessage(tool: NormalizedTool, status: ToolStatus): void {
    const id = this.toolMessageIds.get(tool.key) ?? `tool-${tool.key}`;
    this.toolMessageIds.set(tool.key, id);
    this.upsertMessage({
      id,
      role: "tool",
      title: `${tool.name} ${toolStatusLabel(status)}`,
      text: tool.text,
      timestamp: tool.timestamp,
      isStreaming: status === "running",
    });
  }

  private applyMessagesSnapshot(snapshotMessages: NormalizedSnapshotMessage[]): void {
    const runtime = this.requireRuntime();
    const messages = snapshotMessages.map((message): ConversationMessage => ({
      id: message.id,
      runtimeId: runtime.id,
      projectId: runtime.projectId,
      role: message.role,
      text: message.text,
      thinking: message.thinking,
      title: message.title,
      timestamp: message.timestamp,
      updatedAt: Date.now(),
      isStreaming: message.isStreaming ?? false,
    }));

    if (messages.length === 0) return;

    const existing = this.db.listConversationMessages(runtime.id, 1);
    if (existing.length === 0 && this.cache.size === 0) {
      this.db.replaceConversationMessages(runtime.id, messages);
      this.cache.replace(messages);
    } else {
      for (const message of messages) {
        this.db.upsertConversationMessage(message);
        this.cache.upsert(message);
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
    const message = this.cache.upsert({
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
    this.cache.upsert(next);
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
    return this.cache.get(messageId) ?? this.db.getConversationMessage(runtime.id, messageId);
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

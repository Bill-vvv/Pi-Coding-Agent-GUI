import { randomUUID } from "node:crypto";
import type { ConversationContextUsage, ConversationDelta, ConversationMessage, Runtime, ServerEvent } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import { ConversationMessageCache } from "./conversation/conversationMessageCache.js";
import { mergeConversationMessages, snapshotDuplicateSignature, isSyntheticSnapshotMessageId } from "./conversation/conversationSnapshotMerge.js";
import { compactOptionalText, compactText } from "./conversation/conversationText.js";
import type { NormalizedConversationEvent, NormalizedMessage, NormalizedSnapshotMessage, NormalizedTool } from "./conversation/normalizedEvents.js";
import { buildRetryFinalErrorMessage, buildRetryStartedMessage } from "./conversation/retryProjection.js";
import { normalizePiPayload } from "./conversation/piPayloadNormalizer.js";
import { toolStatusLabel, type ToolStatus } from "./conversation/toolStatus.js";

type Broadcast = (event: ServerEvent) => void;
export type RuntimeProvider = () => Runtime | undefined;

const SYNTHETIC_USER_INPUT_DEDUPE_MS = 5000;

export class ConversationProjection {
  private currentAssistantMessageId?: string;
  private currentUserMessageId?: string;
  private lastAssistantErrorMessageId?: string;
  private activeRetryMessageId?: string;
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
    const persisted = this.db.listLatestConversationMessages(runtime.id, limit);
    const merged = mergeConversationMessages(persisted.messages, this.cache.ordered(limit), limit);
    return {
      type: "conversation.snapshot",
      runtimeId: runtime.id,
      projectId: runtime.projectId,
      messages: merged.messages,
      contextUsage: this.db.getConversationContext(runtime.id),
      busy: this.db.getConversationBusy(runtime.id),
      hasMoreBefore: persisted.hasMoreBefore || merged.hasMoreBefore,
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

  appendUserInput(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.upsertMessage({
      id: `user-gui-command-${randomUUID()}`,
      role: "user",
      text: compactText(trimmed),
      timestamp: Date.now(),
      isStreaming: false,
    });
  }

  markBusy(busy: boolean): void {
    this.setBusy(busy);
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
        this.lastAssistantErrorMessageId = message.id;
        this.currentAssistantMessageId = undefined;
        return;
      }
      case "retry.started":
        this.handleRetryStart(event.attempt, event.maxAttempts, event.errorMessage);
        return;
      case "retry.finished":
        this.handleRetryFinished(event.success, event.finalError);
        return;
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
      const id = this.userMessageIdForPiMessage(message);
      this.currentUserMessageId = id;
      if (message.text) {
        this.upsertMessage({ id, role: "user", text: message.text, timestamp: message.timestamp, isStreaming: false });
      }
      return;
    }

    const retryMessageId = this.activeRetryMessageId;
    const id = retryMessageId ?? message.id ?? `assistant-${randomUUID()}`;
    this.currentAssistantMessageId = id;
    if (retryMessageId) {
      this.upsertMessage({
        id,
        role: "assistant",
        text: message.text,
        thinking: message.thinking,
        timestamp: message.timestamp,
        isStreaming: true,
      }, false);
      return;
    }
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
      const id = this.userMessageIdForPiMessage(message, this.currentUserMessageId);
      if (message.text || message.errorMessage) {
        this.upsertMessage({ id, role: message.errorMessage ? "error" : "user", text: message.text || message.errorMessage || "", timestamp: message.timestamp, isStreaming: false });
      }
      this.currentUserMessageId = undefined;
      return;
    }

    const id = this.currentAssistantMessageId ?? this.activeRetryMessageId ?? message.id ?? `assistant-${randomUUID()}`;
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
      if (message.errorMessage) {
        this.lastAssistantErrorMessageId = id;
      } else {
        this.lastAssistantErrorMessageId = undefined;
      }
    }
    this.currentAssistantMessageId = undefined;
  }

  private handleRetryStart(attempt: number | undefined, maxAttempts: number | undefined, errorMessage: string | undefined): void {
    const id = this.lastAssistantErrorMessageId ?? this.activeRetryMessageId ?? `assistant-retry-${randomUUID()}`;
    this.activeRetryMessageId = id;
    this.lastAssistantErrorMessageId = undefined;
    this.upsertMessage(buildRetryStartedMessage({ id, attempt, maxAttempts, errorMessage, timestamp: Date.now() }));
  }

  private handleRetryFinished(success: boolean | undefined, finalError: string | undefined): void {
    if (success === false) {
      const id = this.activeRetryMessageId ?? this.lastAssistantErrorMessageId;
      if (id && finalError) {
        this.upsertMessage(buildRetryFinalErrorMessage({ id, finalError, timestamp: Date.now() }));
        this.lastAssistantErrorMessageId = id;
      }
    } else {
      this.lastAssistantErrorMessageId = undefined;
    }
    this.activeRetryMessageId = undefined;
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
    const messages = this.normalizeSnapshotMessageIds(snapshotMessages.map((message): ConversationMessage => ({
      id: message.id,
      runtimeId: runtime.id,
      projectId: runtime.projectId,
      role: message.role,
      text: compactText(message.text),
      thinking: compactOptionalText(message.thinking),
      title: message.title,
      timestamp: message.timestamp,
      updatedAt: Date.now(),
      isStreaming: message.isStreaming ?? false,
    })));

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

  private normalizeSnapshotMessageIds(messages: ConversationMessage[]): ConversationMessage[] {
    const runtime = this.requireRuntime();
    const existingBySignature = new Map<string, ConversationMessage>();
    for (const message of [...this.db.listConversationMessages(runtime.id, 500), ...this.cache.ordered(500)]) {
      const signature = snapshotDuplicateSignature(message);
      if (signature && !existingBySignature.has(signature)) existingBySignature.set(signature, message);
    }

    const normalizedMessages: ConversationMessage[] = [];
    const indexById = new Map<string, number>();
    for (const message of messages) {
      const signature = snapshotDuplicateSignature(message);
      const existing = this.matchRecentSyntheticUserInput(message) ?? (signature && isSyntheticSnapshotMessageId(message.id) ? existingBySignature.get(signature) : undefined);
      const normalized = existing ? { ...message, id: existing.id } : message;
      const existingIndex = indexById.get(normalized.id);
      if (existingIndex !== undefined) {
        normalizedMessages[existingIndex] = normalized;
      } else {
        indexById.set(normalized.id, normalizedMessages.length);
        normalizedMessages.push(normalized);
      }
      if (signature && !existingBySignature.has(signature)) existingBySignature.set(signature, normalized);
    }
    return normalizedMessages;
  }

  private userMessageIdForPiMessage(message: NormalizedMessage, fallbackId?: string): string {
    return this.matchRecentSyntheticUserInput({ role: "user", text: message.text, timestamp: message.timestamp })?.id ?? fallbackId ?? message.id ?? `user-${randomUUID()}`;
  }

  private matchRecentSyntheticUserInput(message: Pick<ConversationMessage, "role" | "text" | "timestamp">): ConversationMessage | undefined {
    if (message.role !== "user") return undefined;
    const text = message.text.trim();
    if (!text) return undefined;
    const timestamp = message.timestamp;
    const candidates = [...this.cache.ordered(100), ...this.db.listConversationMessages(this.requireRuntime().id, 100)];
    return candidates
      .filter((candidate) => candidate.role === "user" && candidate.id.startsWith("user-gui-command-") && candidate.text.trim() === text)
      .filter((candidate) => timestamp === undefined || candidate.timestamp === undefined || Math.abs(candidate.timestamp - timestamp) <= SYNTHETIC_USER_INPUT_DEDUPE_MS)
      .sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0))[0];
  }

  private ensureAssistantMessage(timestamp: number): ConversationMessage {
    const runtime = this.requireRuntime();
    if (this.currentAssistantMessageId) {
      const existing = this.getMessage(this.currentAssistantMessageId);
      if (existing) return existing;
    }

    const id = this.currentAssistantMessageId ?? this.activeRetryMessageId ?? `assistant-${randomUUID()}`;
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
      thinking: compactOptionalText(input.thinking ?? existing?.thinking),
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
      thinking: compactOptionalText(input.thinking ?? (input.appendThinking ? `${current.thinking ?? ""}${input.appendThinking}` : current.thinking)),
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

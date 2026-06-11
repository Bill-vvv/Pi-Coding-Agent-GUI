import { isRecord, type ConversationToolDetails } from "@pi-gui/shared";
import type { AppDatabase } from "../../db.js";
import { contextUsageFromSessionStats, numberOrUndefined } from "./contextUsage.js";
import type { NormalizedConversationEvent, NormalizedSnapshotMessage } from "./normalizedEvents.js";
import { extractPiMessageContent, textFromResult } from "./piMessageContent.js";
import { messageIdFromPiMessage, messageRoleFromPiMessage, timestampFromPiMessage } from "./piMessageMetadata.js";
import { toolConversationIdFromPiMessage, toolKeyFromPayload, toolNameFromPayload, toolNameFromPiMessage, toolResultTextFromPiMessage } from "./piToolMessages.js";

export type PiPayloadNormalizerOptions = {
  currentContextWindow?: number;
  db?: AppDatabase;
};

export function normalizePiPayload(payload: unknown, options: PiPayloadNormalizerOptions = {}): NormalizedConversationEvent[] {
  if (!isRecord(payload)) return [];

  if (payload.type === "agent_start" || payload.type === "compaction_start") {
    return [{ type: "busy.changed", busy: true }];
  }

  if (payload.type === "auto_retry_start") {
    return [
      {
        type: "retry.started",
        attempt: numberOrUndefined(payload.attempt),
        maxAttempts: numberOrUndefined(payload.maxAttempts),
        errorMessage: typeof payload.errorMessage === "string" ? payload.errorMessage : undefined,
      },
    ];
  }

  if (payload.type === "auto_retry_end") {
    return [
      {
        type: "retry.finished",
        attempt: numberOrUndefined(payload.attempt),
        success: typeof payload.success === "boolean" ? payload.success : undefined,
        finalError: typeof payload.finalError === "string" ? payload.finalError : undefined,
      },
    ];
  }

  if (payload.type === "agent_end" || payload.type === "compaction_end") {
    return [{ type: "busy.changed", busy: false }];
  }

  if (payload.type === "message_start" || payload.type === "message_end") {
    return normalizeMessageLifecycle(payload);
  }

  if (payload.type === "message_update") {
    return normalizeMessageUpdate(payload);
  }

  if (payload.type === "tool_execution_start" || payload.type === "tool_execution_update" || payload.type === "tool_execution_end") {
    return normalizeToolExecution(payload);
  }

  if (payload.type !== "response") return [];

  const command = typeof payload.command === "string" ? payload.command : undefined;
  if (payload.success !== true) {
    const errorText = typeof payload.error === "string" ? payload.error : undefined;
    return command === "prompt" && errorText
      ? [
          { type: "busy.changed", busy: false },
          { type: "assistant.error", reason: "prompt_failed", errorText },
        ]
      : [];
  }

  const data = isRecord(payload.data) ? payload.data : undefined;
  if (!data) return [];

  if (command === "get_messages") {
    return [{ type: "messages.snapshot", messages: normalizeMessagesSnapshot(data.messages) }];
  }

  if (command === "get_session_stats") {
    const usage = contextUsageFromSessionStats(data, options.currentContextWindow, options.db);
    return usage ? [{ type: "context.usage", usage }] : [];
  }

  if (command === "get_state") {
    return normalizeGetStateResponse(data);
  }

  if (command === "set_model") {
    const contextWindow = numberOrUndefined(data.contextWindow) ?? numberOrUndefined(data.context_window);
    return contextWindow !== undefined ? [{ type: "context.window", contextWindow }] : [];
  }

  return [];
}

function normalizeMessagesSnapshot(value: unknown): NormalizedSnapshotMessage[] {
  if (!Array.isArray(value)) return [];

  const messages: NormalizedSnapshotMessage[] = [];
  value.forEach((item, index) => {
    if (!isRecord(item)) return;
    const role = messageRoleFromPiMessage(item);
    const timestamp = timestampFromPiMessage(item, Date.now() + index);

    if (role === "user" || role === "assistant") {
      const content = extractPiMessageContent(item);
      const errorMessage = errorMessageFromPiMessage(item);
      if (!content.text && !content.thinking && !errorMessage) return;
      messages.push({
        id: messageIdFromPiMessage(item) ?? `snapshot-${index}-${timestamp}`,
        role: errorMessage ? "error" : role,
        text: content.text || errorMessage || "",
        thinking: content.thinking,
        timestamp,
        isStreaming: false,
      });
      return;
    }

    if (role === "tool" || role === "toolResult" || role === "bashExecution") {
      const text = toolResultTextFromPiMessage(item);
      const toolName = toolNameFromPiMessage(item);
      const isError = item.isError === true || (typeof item.exitCode === "number" && item.exitCode !== 0);
      const fallbackId = item.role === "bashExecution" ? `bash-${timestamp}-${index}` : `tool-snapshot-${index}-${timestamp}`;
      const id = toolConversationIdFromPiMessage(item) ?? fallbackId;
      if (!text && !toolName) return;
      const toolDetails = toolDetailsFromRecord(item, toolName);
      messages.push({
        id,
        role: "tool",
        title: `${toolName || "tool"} ${isError ? "失败" : "完成"}`,
        text,
        timestamp,
        isStreaming: false,
        ...(toolDetails ? { toolDetails } : {}),
      });
    }
  });

  return messages;
}

function normalizeMessageLifecycle(payload: Record<string, unknown>): NormalizedConversationEvent[] {
  const message = isRecord(payload.message) ? payload.message : undefined;
  if (!message) return [];
  const role = messageRoleFromPiMessage(message);
  if (role !== "user" && role !== "assistant") return [];

  const content = extractPiMessageContent(message);
  const errorMessage = errorMessageFromPiMessage(message);
  return [
    {
      type: payload.type === "message_start" ? "message.started" : "message.finished",
      message: {
        role,
        id: messageIdFromPiMessage(message),
        text: content.text,
        thinking: content.thinking,
        timestamp: timestampFromPiMessage(message, Date.now()),
        errorMessage,
      },
    },
  ];
}

function normalizeMessageUpdate(payload: Record<string, unknown>): NormalizedConversationEvent[] {
  const assistantMessageEvent = isRecord(payload.assistantMessageEvent) ? payload.assistantMessageEvent : undefined;
  if (!assistantMessageEvent) return [];

  if (assistantMessageEvent.type === "text_delta" && typeof assistantMessageEvent.delta === "string") {
    return [{ type: "assistant.delta", appendText: assistantMessageEvent.delta, isStreaming: true }];
  }

  if (assistantMessageEvent.type === "text_end" && typeof assistantMessageEvent.content === "string") {
    return [{ type: "assistant.delta", text: assistantMessageEvent.content, isStreaming: true }];
  }

  if (assistantMessageEvent.type === "thinking_delta" && typeof assistantMessageEvent.delta === "string") {
    return [{ type: "assistant.delta", appendThinking: assistantMessageEvent.delta, isStreaming: true }];
  }

  if (assistantMessageEvent.type === "thinking_end" && typeof assistantMessageEvent.content === "string") {
    return [{ type: "assistant.delta", thinking: assistantMessageEvent.content, isStreaming: true }];
  }

  if (assistantMessageEvent.type === "error") {
    const reason = typeof assistantMessageEvent.reason === "string" ? assistantMessageEvent.reason : "stream_error";
    const errorText = typeof assistantMessageEvent.error === "string" ? assistantMessageEvent.error : JSON.stringify(assistantMessageEvent);
    return [{ type: "assistant.error", reason, errorText }];
  }

  return [];
}

function normalizeToolExecution(payload: Record<string, unknown>): NormalizedConversationEvent[] {
  const key = toolKeyFromPayload(payload);
  const name = toolNameFromPayload(payload);
  const timestamp = Date.now();

  if (payload.type === "tool_execution_start") {
    return [{ type: "tool.started", tool: { key, name, text: "", timestamp } }];
  }

  if (payload.type === "tool_execution_update") {
    const toolDetails = toolDetailsFromRecord(payload, name);
    return [
      {
        type: "tool.updated",
        tool: {
          key,
          name,
          text: textFromResult(payload.partialResult) || textFromResult(payload.result),
          timestamp,
          ...(toolDetails ? { toolDetails } : {}),
        },
      },
    ];
  }

  const toolDetails = toolDetailsFromRecord(payload, name);
  return [
    {
      type: "tool.finished",
      tool: {
        key,
        name,
        text: textFromResult(payload.result),
        timestamp,
        isError: payload.isError === true,
        ...(toolDetails ? { toolDetails } : {}),
      },
    },
  ];
}

function toolDetailsFromRecord(record: Record<string, unknown>, toolName: string): ConversationToolDetails | undefined {
  if (toolName.toLowerCase() !== "edit") return undefined;
  const details = detailsRecord(record.result) ?? detailsRecord(record.partialResult) ?? detailsRecord(record.output) ?? detailsRecord(record.content) ?? detailsRecord(record);
  const diff = typeof details?.diff === "string" && details.diff.trim() ? details.diff : undefined;
  if (!diff) return undefined;

  const path = toolPathFromRecord(record);
  const firstChangedLine = numberOrUndefined(details?.firstChangedLine);
  return {
    ...(path ? { path } : {}),
    diff,
    ...(firstChangedLine !== undefined ? { firstChangedLine } : {}),
  };
}

function detailsRecord(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    return value.map(detailsRecord).find((item): item is Record<string, unknown> => Boolean(item));
  }
  if (!isRecord(value)) return undefined;
  if (isRecord(value.details)) return value.details;
  return detailsRecord(value.result) ?? detailsRecord(value.output) ?? detailsRecord(value.content);
}

function toolPathFromRecord(record: Record<string, unknown>): string | undefined {
  const candidates = [record.args, record.arguments, record.input, record.toolCall, record];
  for (const candidate of candidates) {
    const path = toolPathFromCandidate(candidate);
    if (path) return path;
  }
  return undefined;
}

function toolPathFromCandidate(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const path = typeof value.path === "string" ? value.path : typeof value.file_path === "string" ? value.file_path : undefined;
  if (path?.trim()) return path;
  return toolPathFromCandidate(value.args) ?? toolPathFromCandidate(value.arguments) ?? toolPathFromCandidate(value.input);
}

function errorMessageFromPiMessage(message: Record<string, unknown>): string | undefined {
  const base = typeof message.errorMessage === "string" && message.errorMessage.trim() ? message.errorMessage.trim() : undefined;
  const diagnostics = diagnosticsSummary(message.diagnostics);
  if (!diagnostics) return base;
  if (!base) return diagnostics;
  if (diagnostics.includes(base)) return diagnostics;
  if (base.includes(diagnostics)) return base;
  return `${base}\n${diagnostics}`;
}

function diagnosticsSummary(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const summaries = value.map(diagnosticSummary).filter(Boolean);
  return summaries.length ? summaries.join("\n").slice(0, 1200) : undefined;
}

function diagnosticSummary(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const type = typeof value.type === "string" ? value.type : "provider_diagnostic";
  const error = isRecord(value.error) ? value.error : undefined;
  const details = isRecord(value.details) ? value.details : undefined;
  const message = typeof error?.message === "string" && error.message.trim() ? error.message.trim() : undefined;
  const code = typeof error?.code === "number" || typeof error?.code === "string" ? `code ${String(error.code)}` : undefined;
  const phase = typeof details?.phase === "string" ? `phase ${details.phase}` : undefined;
  const requestBytes = typeof details?.requestBytes === "number" && Number.isFinite(details.requestBytes) ? `request ${formatBytes(details.requestBytes)}` : undefined;
  const configuredTransport = typeof details?.configuredTransport === "string" ? details.configuredTransport : undefined;
  const fallbackTransport = typeof details?.fallbackTransport === "string" ? details.fallbackTransport : undefined;
  const transport = configuredTransport && fallbackTransport
    ? `transport ${configuredTransport} → ${fallbackTransport}`
    : configuredTransport
      ? `transport ${configuredTransport}`
      : fallbackTransport
        ? `fallback transport ${fallbackTransport}`
        : undefined;
  const eventStatus = typeof details?.eventsEmitted === "boolean" ? (details.eventsEmitted ? "stream events emitted" : "no stream events before failure") : undefined;
  const detailText = [code, requestBytes, phase, transport, eventStatus].filter(Boolean).join(", ");
  if (message) return `Provider diagnostic (${type}): ${message}${detailText ? ` (${detailText})` : ""}`;
  return detailText ? `Provider diagnostic (${type}): ${detailText}` : undefined;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.floor(bytes)} B`;
}

function normalizeGetStateResponse(data: Record<string, unknown>): NormalizedConversationEvent[] {
  const events: NormalizedConversationEvent[] = [];
  const model = isRecord(data.model) ? data.model : undefined;
  const contextWindow = numberOrUndefined(model?.contextWindow) ?? numberOrUndefined(model?.context_window);
  if (contextWindow !== undefined) events.push({ type: "context.window", contextWindow });
  if (typeof data.isStreaming === "boolean") events.push({ type: "busy.changed", busy: data.isStreaming });
  if (typeof data.isCompacting === "boolean" && data.isCompacting) events.push({ type: "busy.changed", busy: true });
  return events;
}

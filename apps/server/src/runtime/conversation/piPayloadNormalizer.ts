import { isRecord } from "@pi-gui/shared";
import { contextUsageFromSessionStats, numberOrUndefined } from "./contextUsage.js";
import type { NormalizedConversationEvent, NormalizedSnapshotMessage } from "./normalizedEvents.js";
import { extractPiMessageContent, textFromResult } from "./piMessageContent.js";
import { messageIdFromPiMessage, messageRoleFromPiMessage, timestampFromPiMessage } from "./piMessageMetadata.js";
import { toolConversationIdFromPiMessage, toolKeyFromPayload, toolNameFromPayload, toolNameFromPiMessage, toolResultTextFromPiMessage } from "./piToolMessages.js";

export type PiPayloadNormalizerOptions = {
  currentContextWindow?: number;
};

export function normalizePiPayload(payload: unknown, options: PiPayloadNormalizerOptions = {}): NormalizedConversationEvent[] {
  if (!isRecord(payload)) return [];

  if (payload.type === "agent_start" || payload.type === "compaction_start") {
    return [{ type: "busy.changed", busy: true }];
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

  if (payload.type !== "response" || payload.success !== true) return [];

  const command = typeof payload.command === "string" ? payload.command : undefined;
  const data = isRecord(payload.data) ? payload.data : undefined;
  if (!data) return [];

  if (command === "get_messages") {
    return [{ type: "messages.snapshot", messages: normalizeMessagesSnapshot(data.messages) }];
  }

  if (command === "get_session_stats") {
    const usage = contextUsageFromSessionStats(data, options.currentContextWindow);
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
      const errorMessage = typeof item.errorMessage === "string" ? item.errorMessage : undefined;
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
      messages.push({
        id,
        role: "tool",
        title: `${toolName || "tool"} ${isError ? "失败" : "完成"}`,
        text,
        timestamp,
        isStreaming: false,
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
  const errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : undefined;
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
    return [{ type: "tool.updated", tool: { key, name, text: textFromResult(payload.partialResult) || textFromResult(payload.result), timestamp } }];
  }

  return [
    {
      type: "tool.finished",
      tool: {
        key,
        name,
        text: textFromResult(payload.result),
        timestamp,
        isError: payload.isError === true,
      },
    },
  ];
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

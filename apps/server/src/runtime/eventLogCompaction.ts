import type { GuiEvent } from "@pi-gui/shared";

const MAX_EVENT_LOG_STRING_CHARS = 64_000;
const MAX_EVENT_LOG_ARRAY_ITEMS = 200;
const EVENT_LOG_COMPACTION_MARKER = "[omitted by Pi GUI event log compaction]";
const BASE64_EVENT_LOG_COMPACTION_MARKER = "[omitted embedded image/base64 payload by Pi GUI event log compaction]";
const MAX_EVENT_LOG_INLINE_DATA_CHARS = 1024;

export function compactPayloadForEventLog(kind: GuiEvent["kind"], payload: unknown): unknown {
  return kind === "pi_event" ? compactPiPayload(payload) : compactValue(payload);
}

function compactPiPayload(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) return compactValue(payload);

  if (record.type === "response") {
    return compactResponsePayload(record);
  }

  if (record.type === "agent_start" || record.type === "agent_end" || record.type === "turn_end") {
    return { type: record.type };
  }

  if (record.type === "message_update") {
    const compacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === "message") continue;
      const eventRecord = asRecord(value);
      compacted[key] = key === "assistantMessageEvent" && eventRecord ? compactAssistantMessageEvent(eventRecord) : compactValue(value);
    }
    return compacted;
  }

  const message = asRecord(record.message);
  if ((record.type === "message_start" || record.type === "message_end") && message) {
    const role = message.role;
    if (role !== "user" && role !== "assistant") {
      return {
        type: record.type,
        message: compactValue({
          role,
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          timestamp: message.timestamp,
        }),
      };
    }
  }

  return compactValue(record);
}

function compactResponsePayload(response: Record<string, unknown>): Record<string, unknown> {
  const compacted: Record<string, unknown> = {
    id: response.id,
    type: response.type,
    command: response.command,
    success: response.success,
  };
  if (response.success !== true) {
    compacted.error = compactValue(response.error);
    return compacted;
  }

  const data = asRecord(response.data);
  if (!data) return compacted;

  if (response.command === "get_messages") {
    compacted.data = { messageCount: Array.isArray(data.messages) ? data.messages.length : undefined };
    return compacted;
  }

  if (response.command === "get_state") {
    compacted.data = compactValue({
      sessionId: data.sessionId,
      isStreaming: data.isStreaming,
      isCompacting: data.isCompacting,
      thinkingLevel: data.thinkingLevel,
      model: data.model,
    });
    return compacted;
  }

  if (response.command === "get_session_stats") {
    compacted.data = compactValue({
      contextUsage: data.contextUsage,
      tokens: data.tokens,
      cost: data.cost,
      sessionFile: data.sessionFile,
    });
    return compacted;
  }

  compacted.data = compactValue(data);
  return compacted;
}

function compactAssistantMessageEvent(event: Record<string, unknown>): Record<string, unknown> {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === "partial") continue;
    compacted[key] = compactValue(value);
  }
  return compacted;
}

function compactValue(value: unknown, depth = 0, key?: string): unknown {
  if (typeof value === "string") return compactString(value, key);
  if (typeof value !== "object" || value === null) return value;
  if (depth > 8) return EVENT_LOG_COMPACTION_MARKER;

  if (Array.isArray(value)) {
    const compacted = value.slice(0, MAX_EVENT_LOG_ARRAY_ITEMS).map((item) => compactValue(item, depth + 1, key));
    if (value.length > MAX_EVENT_LOG_ARRAY_ITEMS) {
      compacted.push(`${EVENT_LOG_COMPACTION_MARKER}: ${value.length - MAX_EVENT_LOG_ARRAY_ITEMS} array item(s)`);
    }
    return compacted;
  }

  const record = asRecord(value);
  if (!record) return value;

  const compacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(record)) {
    if (key === "thinkingSignature" || key === "signature") continue;
    compacted[key] = compactValue(nestedValue, depth + 1, key);
  }
  return compacted;
}

function compactString(value: string, key?: string): string {
  if (isEmbeddedDataKey(key) && value.length > MAX_EVENT_LOG_INLINE_DATA_CHARS) {
    return `${BASE64_EVENT_LOG_COMPACTION_MARKER}: ${value.length} chars`;
  }
  if (/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(value)) {
    return `${BASE64_EVENT_LOG_COMPACTION_MARKER}: ${value.length} chars`;
  }
  if (value.length <= MAX_EVENT_LOG_STRING_CHARS) return value;
  return `${value.slice(0, MAX_EVENT_LOG_STRING_CHARS)}\n…[truncated ${value.length - MAX_EVENT_LOG_STRING_CHARS} chars]`;
}

function isEmbeddedDataKey(key: string | undefined): boolean {
  return key === "data" || key === "image" || key === "base64";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

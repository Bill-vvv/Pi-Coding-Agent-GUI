import type { GuiEvent } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { ConversationContextUsage, ConversationMessage } from "../types";

export function isRuntimeBusy(events: GuiEvent[]): boolean {
  let busy = false;
  for (const event of events) {
    if (event.kind !== "pi_event" || !isRecord(event.payload)) continue;
    if (event.payload.type === "agent_start") busy = true;
    if (event.payload.type === "agent_end") busy = false;
  }
  return busy;
}

export function buildConversationContextUsage(events: GuiEvent[], initial?: ConversationContextUsage): ConversationContextUsage | undefined {
  let contextWindow = initial?.contextWindow;
  let latest = initial;

  for (const event of events) {
    if (event.kind !== "pi_event" || !isRecord(event.payload)) continue;

    const payload = event.payload;
    if (payload.type !== "response" || payload.success !== true) continue;

    const command = typeof payload.command === "string" ? payload.command : undefined;
    const data = isRecord(payload.data) ? payload.data : undefined;

    if (command === "get_state") {
      const model = isRecord(data?.model) ? data.model : undefined;
      const nextContextWindow = numberOrUndefined(model?.contextWindow) ?? numberOrUndefined(model?.context_window);
      if (nextContextWindow !== undefined) {
        contextWindow = nextContextWindow;
        latest = latest ? withContextWindow(latest, contextWindow) : { contextWindow, updatedAt: event.timestamp };
      }
      continue;
    }

    if (command === "set_model") {
      const nextContextWindow = numberOrUndefined(data?.contextWindow) ?? numberOrUndefined(data?.context_window);
      if (nextContextWindow !== undefined) {
        contextWindow = nextContextWindow;
        latest = latest ? withContextWindow(latest, contextWindow) : { contextWindow, updatedAt: event.timestamp };
      }
      continue;
    }

    if (command !== "get_session_stats") continue;

    const contextUsage = isRecord(data?.contextUsage) ? data.contextUsage : undefined;
    const tokens = nullableNumber(contextUsage?.tokens);
    const nextContextWindow = nullableNumber(contextUsage?.contextWindow) ?? contextWindow;
    const reportedPercent = nullableNumber(contextUsage?.percent);

    if (nextContextWindow !== undefined) contextWindow = nextContextWindow;
    latest = {
      tokens,
      contextWindow: nextContextWindow,
      percent: percentFromUsage(tokens, nextContextWindow, reportedPercent),
      updatedAt: event.timestamp,
    };
  }

  return latest;
}

export function buildConversationMessages(events: GuiEvent[]): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  let currentAssistantIndex: number | undefined;

  for (const event of events) {
    if (event.kind === "error") {
      messages.push({ id: `error-${event.id}`, role: "error", text: formatPayload(event.payload), timestamp: event.timestamp });
      currentAssistantIndex = undefined;
      continue;
    }

    if (event.kind === "stderr") {
      messages.push({ id: `stderr-${event.id}`, role: "log", text: formatPayload(event.payload), timestamp: event.timestamp });
      continue;
    }

    if (event.kind !== "pi_event" || !isRecord(event.payload)) continue;

    const payload = event.payload;
    const assistantMessageEvent = isRecord(payload.assistantMessageEvent) ? payload.assistantMessageEvent : undefined;
    if (assistantMessageEvent?.type === "text_delta" && typeof assistantMessageEvent.delta === "string") {
      if (currentAssistantIndex === undefined) {
        currentAssistantIndex = messages.length;
        messages.push({ id: `assistant-stream-${event.id}`, role: "assistant", text: "", timestamp: event.timestamp });
      }
      messages[currentAssistantIndex] = {
        ...messages[currentAssistantIndex],
        text: messages[currentAssistantIndex].text + assistantMessageEvent.delta,
      };
      continue;
    }

    if (payload.type === "message_end" && isRecord(payload.message)) {
      const message = payload.message;
      const role = message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : undefined;
      const text = textFromMessage(message);
      const errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : undefined;
      const timestamp = typeof message.timestamp === "number" ? message.timestamp : event.timestamp;

      if (role === "user" && text) {
        messages.push({ id: `user-${event.id}`, role, text, timestamp });
        currentAssistantIndex = undefined;
      } else if (role === "assistant") {
        if (currentAssistantIndex !== undefined) {
          messages[currentAssistantIndex] = {
            ...messages[currentAssistantIndex],
            text: text || messages[currentAssistantIndex].text || errorMessage || "（空响应）",
            timestamp,
          };
          if (errorMessage) messages[currentAssistantIndex].role = "error";
          currentAssistantIndex = undefined;
        } else if (text || errorMessage) {
          messages.push({ id: `assistant-${event.id}`, role: errorMessage ? "error" : "assistant", text: text || errorMessage || "", timestamp });
        }
      }
      continue;
    }

    if (payload.type === "response" && payload.success === false && !isInternalRpcResponse(payload)) {
      messages.push({ id: `response-error-${event.id}`, role: "error", text: typeof payload.error === "string" ? payload.error : formatPayload(payload), timestamp: event.timestamp });
    }
  }

  return messages.filter((message) => message.text.trim().length > 0);
}

function isInternalRpcResponse(payload: Record<string, unknown>): boolean {
  return payload.command === "get_state" || payload.command === "get_session_stats";
}

function withContextWindow(usage: ConversationContextUsage, contextWindow: number): ConversationContextUsage {
  return {
    ...usage,
    contextWindow,
    percent: percentFromUsage(usage.tokens, contextWindow, usage.percent),
  };
}

function percentFromUsage(tokens: number | undefined, contextWindow: number | undefined, reportedPercent?: number): number | undefined {
  if (tokens !== undefined && contextWindow !== undefined && contextWindow > 0) {
    return (tokens / contextWindow) * 100;
  }
  return reportedPercent;
}

function nullableNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return nullableNumber(value);
}

function textFromMessage(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function messageRoleLabel(role: ConversationMessage["role"]): string {
  if (role === "user") return "你";
  if (role === "assistant") return "Pi";
  if (role === "log") return "日志";
  return "错误";
}

export function formatPayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload, null, 2);
}

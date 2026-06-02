import type { GuiEvent } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { ConversationMessage } from "../types";

export function isRuntimeBusy(events: GuiEvent[]): boolean {
  let busy = false;
  for (const event of events) {
    if (event.kind !== "pi_event" || !isRecord(event.payload)) continue;
    if (event.payload.type === "agent_start") busy = true;
    if (event.payload.type === "agent_end") busy = false;
  }
  return busy;
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

    if (payload.type === "response" && payload.success === false) {
      messages.push({ id: `response-error-${event.id}`, role: "error", text: typeof payload.error === "string" ? payload.error : formatPayload(payload), timestamp: event.timestamp });
    }
  }

  return messages.filter((message) => message.text.trim().length > 0);
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

import { randomUUID } from "node:crypto";
import { textFromResult } from "./piMessageContent.js";
import { messageIdFromPiMessage } from "./piMessageMetadata.js";

export function toolConversationIdFromPiMessage(message: Record<string, unknown>): string | undefined {
  const rawToolCallId = message.toolCallId ?? message.tool_call_id ?? message.callId;
  if (typeof rawToolCallId === "string" || typeof rawToolCallId === "number") return `tool-${rawToolCallId}`;
  const messageId = messageIdFromPiMessage(message);
  return messageId ? `tool-${messageId}` : undefined;
}

export function toolNameFromPiMessage(message: Record<string, unknown>): string {
  if (typeof message.toolName === "string") return message.toolName;
  if (typeof message.name === "string") return message.name;
  if (message.role === "bashExecution") return "bash";
  return "tool";
}

export function toolResultTextFromPiMessage(message: Record<string, unknown>): string {
  if (message.role === "bashExecution") {
    const output = typeof message.output === "string" ? message.output : "";
    const exitCode = typeof message.exitCode === "number" ? `exitCode: ${message.exitCode}` : "";
    return output || exitCode;
  }
  return textFromResult(message.content) || textFromResult(message.result) || textFromResult(message.output);
}

export function toolKeyFromPayload(payload: Record<string, unknown>): string {
  const rawKey = payload.toolCallId ?? payload.tool_call_id ?? payload.callId ?? payload.id ?? payload.requestId;
  return typeof rawKey === "string" || typeof rawKey === "number" ? String(rawKey) : randomUUID();
}

export function toolNameFromPayload(payload: Record<string, unknown>): string {
  return typeof payload.toolName === "string" ? payload.toolName : typeof payload.name === "string" ? payload.name : "tool";
}

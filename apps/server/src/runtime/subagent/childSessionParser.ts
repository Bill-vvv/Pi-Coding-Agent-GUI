import { readFileSync, statSync } from "node:fs";
import type { ConversationMessage, SubagentRun } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import { extractPiMessageContent, textFromResult } from "../conversation/piMessageContent.js";
import { messageIdFromPiMessage, messageRoleFromPiMessage, timestampFromPiMessage } from "../conversation/piMessageMetadata.js";
import { toolConversationIdFromPiMessage, toolKeyFromPayload, toolNameFromPayload, toolNameFromPiMessage, toolResultTextFromPiMessage } from "../conversation/piToolMessages.js";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const MAX_SESSION_FILE_BYTES = 8 * 1024 * 1024;

export type ChildSessionDetail = {
  runId: string;
  childRunId: string;
  messages: ConversationMessage[];
  readAt: number;
  error?: string;
};

export function parseSubagentChildSession(run: SubagentRun, childRunId?: string, limit = DEFAULT_LIMIT): ChildSessionDetail {
  const childRun = childRunId ? run.runs.find((item) => item.id === childRunId) : run.runs[0];
  const resolvedChildRunId = childRun?.id ?? childRunId ?? "child-1";
  const readAt = Date.now();
  if (!childRun) {
    return { runId: run.id, childRunId: resolvedChildRunId, messages: [], readAt, error: "Sub-agent child run not found" };
  }
  if (!childRun.sessionFile) {
    return { runId: run.id, childRunId: resolvedChildRunId, messages: [], readAt, error: "Sub-agent session file is not available yet" };
  }

  try {
    const stat = statSync(childRun.sessionFile);
    if (stat.size > MAX_SESSION_FILE_BYTES) {
      return {
        runId: run.id,
        childRunId: resolvedChildRunId,
        messages: [],
        readAt,
        error: `Sub-agent session file is too large to parse (${stat.size} bytes)`,
      };
    }

    const parser = new ChildSessionParser(run, resolvedChildRunId);
    const content = readFileSync(childRun.sessionFile, "utf8");
    for (const line of content.split(/\r?\n/)) parser.applyLine(line);
    return {
      runId: run.id,
      childRunId: resolvedChildRunId,
      messages: parser.messages(Math.max(1, Math.min(limit, MAX_LIMIT))),
      readAt,
    };
  } catch (error) {
    return { runId: run.id, childRunId: resolvedChildRunId, messages: [], readAt, error: (error as Error).message };
  }
}

class ChildSessionParser {
  private readonly runtimeId: string;
  private readonly messagesById = new Map<string, ConversationMessage>();
  private readonly order: string[] = [];
  private currentAssistantMessageId?: string;
  private currentUserMessageId?: string;

  constructor(
    private readonly run: SubagentRun,
    childRunId: string,
  ) {
    this.runtimeId = `subagent:${run.id}:${childRunId}`;
  }

  applyLine(line: string): void {
    const record = parseJsonRecord(line);
    if (!record) return;

    if (record.type === "message" && isRecord(record.message)) {
      this.applyPiMessage(record.message, Date.now() + this.order.length, false);
      return;
    }

    if ((record.type === "message_start" || record.type === "message_end") && isRecord(record.message)) {
      this.applyMessageLifecycle(record.type, record.message);
      return;
    }

    if (record.type === "message_update") {
      this.applyMessageUpdate(record);
      return;
    }

    if (record.type === "tool_execution_start" || record.type === "tool_execution_update" || record.type === "tool_execution_end") {
      this.applyToolExecution(record);
    }
  }

  messages(limit: number): ConversationMessage[] {
    return this.order.map((id) => this.messagesById.get(id)).filter((message): message is ConversationMessage => Boolean(message)).slice(-limit);
  }

  private applyMessageLifecycle(type: unknown, message: Record<string, unknown>): void {
    const role = messageRoleFromPiMessage(message);
    if (role !== "user" && role !== "assistant") return;
    const timestamp = timestampFromPiMessage(message, Date.now() + this.order.length);
    const id = messageIdFromPiMessage(message) ?? (role === "user" ? this.currentUserMessageId : this.currentAssistantMessageId) ?? `${role}-${timestamp}`;
    if (role === "user") this.currentUserMessageId = type === "message_start" ? id : undefined;
    if (role === "assistant") this.currentAssistantMessageId = type === "message_start" ? id : undefined;
    const content = extractPiMessageContent(message);
    const errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : undefined;
    if (!content.text && !content.thinking && !errorMessage && type === "message_start") return;
    this.upsertMessage({
      id,
      role: errorMessage ? "error" : role,
      text: content.text || errorMessage || "",
      thinking: content.thinking,
      timestamp,
      isStreaming: type === "message_start",
    });
  }

  private applyPiMessage(message: Record<string, unknown>, fallbackTimestamp: number, isStreaming: boolean): void {
    const role = messageRoleFromPiMessage(message);
    const timestamp = timestampFromPiMessage(message, fallbackTimestamp);

    if (role === "user" || role === "assistant") {
      const content = extractPiMessageContent(message);
      const errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : undefined;
      if (!content.text && !content.thinking && !errorMessage) return;
      this.upsertMessage({
        id: messageIdFromPiMessage(message) ?? `${role}-${timestamp}`,
        role: errorMessage ? "error" : role,
        text: content.text || errorMessage || "",
        thinking: content.thinking,
        timestamp,
        isStreaming,
      });
      return;
    }

    if (role === "tool" || role === "toolResult" || role === "bashExecution") {
      const text = toolResultTextFromPiMessage(message);
      const toolName = toolNameFromPiMessage(message);
      const isError = message.isError === true || (typeof message.exitCode === "number" && message.exitCode !== 0);
      this.upsertMessage({
        id: toolConversationIdFromPiMessage(message) ?? `tool-${timestamp}-${this.order.length}`,
        role: "tool",
        text,
        title: `${toolName || "tool"} ${isError ? "失败" : "完成"}`,
        timestamp,
        isStreaming: false,
      });
    }
  }

  private applyMessageUpdate(record: Record<string, unknown>): void {
    const event = isRecord(record.assistantMessageEvent) ? record.assistantMessageEvent : undefined;
    if (!event) return;
    const timestamp = Date.now() + this.order.length;
    const id = this.currentAssistantMessageId ?? `assistant-live-${timestamp}`;
    this.currentAssistantMessageId = id;
    const current = this.messagesById.get(id);

    if (event.type === "text_delta" && typeof event.delta === "string") {
      this.upsertMessage({ id, role: "assistant", text: `${current?.text ?? ""}${event.delta}`, thinking: current?.thinking, timestamp, isStreaming: true });
      return;
    }
    if (event.type === "thinking_delta" && typeof event.delta === "string") {
      this.upsertMessage({ id, role: "assistant", text: current?.text ?? "", thinking: `${current?.thinking ?? ""}${event.delta}`, timestamp, isStreaming: true });
      return;
    }
    if (event.type === "text_end" && typeof event.content === "string") {
      this.upsertMessage({ id, role: "assistant", text: event.content, thinking: current?.thinking, timestamp, isStreaming: true });
      return;
    }
    if (event.type === "thinking_end" && typeof event.content === "string") {
      this.upsertMessage({ id, role: "assistant", text: current?.text ?? "", thinking: event.content, timestamp, isStreaming: true });
    }
  }

  private applyToolExecution(record: Record<string, unknown>): void {
    const key = toolKeyFromPayload(record);
    const name = toolNameFromPayload(record);
    const timestamp = Date.now() + this.order.length;
    const statusLabel = record.type === "tool_execution_end" ? (record.isError === true ? "失败" : "完成") : "运行中";
    const text = record.type === "tool_execution_update" ? textFromResult(record.partialResult) || textFromResult(record.result) : record.type === "tool_execution_end" ? textFromResult(record.result) : "";
    this.upsertMessage({
      id: `tool-${key}`,
      role: "tool",
      text,
      title: `${name} ${statusLabel}`,
      timestamp,
      isStreaming: record.type !== "tool_execution_end",
    });
  }

  private upsertMessage(input: Omit<ConversationMessage, "runtimeId" | "projectId" | "updatedAt">): void {
    const existing = this.messagesById.get(input.id);
    if (!existing) this.order.push(input.id);
    this.messagesById.set(input.id, {
      ...existing,
      ...input,
      runtimeId: this.runtimeId,
      projectId: this.run.projectId,
      updatedAt: Date.now(),
    });
  }
}

function parseJsonRecord(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

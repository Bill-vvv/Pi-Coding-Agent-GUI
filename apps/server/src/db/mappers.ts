import type { AppSettings, ConversationContextUsage, ConversationMessage, GuiEvent, GuiSession, Project, Runtime } from "@pi-gui/shared";
import type { ConversationMessageRow, EventRow, ProjectRow, RuntimeConversationStateRow, RuntimeRow, SessionRow } from "./rows.js";

export function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    cwd: row.cwd,
    lastOpenedAt: row.last_opened_at,
    defaultModel: row.default_model ?? undefined,
  };
}

export function parseThinkingLevel(value: string): AppSettings["defaultThinkingLevel"] {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : undefined;
}

export function sessionFromRow(row: SessionRow): GuiSession {
  return {
    id: row.id,
    projectId: row.project_id,
    piSessionFile: row.pi_session_file,
    title: row.title ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    runtimeId: row.runtime_id ?? undefined,
  };
}

export function runtimeFromRow(row: RuntimeRow): Runtime {
  return {
    id: row.id,
    projectId: row.project_id,
    cwd: row.cwd,
    status: row.status,
    pid: row.pid ?? undefined,
    sessionId: row.session_id ?? undefined,
    startedAt: row.started_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
  };
}

export function conversationMessageFromRow(row: ConversationMessageRow): ConversationMessage {
  return {
    id: row.message_id,
    runtimeId: row.runtime_id,
    projectId: row.project_id,
    role: row.role,
    text: row.text,
    timestamp: row.timestamp ?? undefined,
    updatedAt: row.updated_at,
    title: row.title ?? undefined,
    isStreaming: row.is_streaming === 1,
    thinking: row.thinking ?? undefined,
  };
}

export function conversationContextFromRow(row: RuntimeConversationStateRow): ConversationContextUsage | undefined {
  if (row.tokens === null && row.context_window === null && row.percent === null) return undefined;
  return {
    tokens: row.tokens ?? undefined,
    contextWindow: row.context_window ?? undefined,
    percent: row.percent ?? undefined,
    updatedAt: row.updated_at,
  };
}

export function eventFromRow(row: EventRow): GuiEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch (error) {
    throw new Error(`Failed to parse event payload JSON for event ${row.id}: ${(error as Error).message}`);
  }
  return {
    id: row.id,
    runtimeId: row.runtime_id,
    projectId: row.project_id,
    timestamp: row.timestamp,
    kind: row.kind,
    payload,
  };
}

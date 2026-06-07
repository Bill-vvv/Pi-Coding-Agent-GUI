import type { AppSettings, ConversationContextUsage, ConversationMessage, ConversationTokenUsage, GuiEvent, GuiSession, Project, Runtime, SubagentChildRun, SubagentContextMode, SubagentRun } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { ConversationMessageRow, EventRow, ProjectRow, RuntimeConversationStateRow, RuntimeRow, SessionRow, SubagentRunRow } from "./rows.js";

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
    model: row.model ?? undefined,
    thinkingLevel: row.thinking_level ? parseThinkingLevel(row.thinking_level) : undefined,
    responseMode: row.response_mode === "fast" ? "fast" : row.response_mode === "normal" ? "normal" : undefined,
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
  const sessionTokens = parseConversationTokenUsage(row.session_tokens_json);
  if (row.tokens === null && row.context_window === null && row.percent === null && !sessionTokens) return undefined;
  return {
    tokens: row.tokens ?? undefined,
    contextWindow: row.context_window ?? undefined,
    percent: row.percent ?? undefined,
    sessionTokens,
    updatedAt: row.updated_at,
  };
}

function parseConversationTokenUsage(value: string | null): ConversationTokenUsage | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return undefined;
    const usage: ConversationTokenUsage = {
      input: finiteNumber(parsed.input),
      output: finiteNumber(parsed.output),
      cacheRead: finiteNumber(parsed.cacheRead),
      cacheWrite: finiteNumber(parsed.cacheWrite),
      total: finiteNumber(parsed.total),
      cost: finiteNumber(parsed.cost),
    };
    return Object.values(usage).some((item) => item !== undefined) ? usage : undefined;
  } catch {
    return undefined;
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

export function subagentRunFromRow(row: SubagentRunRow): SubagentRun {
  return {
    id: row.id,
    projectId: row.project_id,
    parentRuntimeId: row.parent_runtime_id,
    parentToolCallId: row.parent_tool_call_id,
    parentToolMessageId: row.parent_tool_message_id,
    agent: row.agent,
    mode: row.mode,
    contextMode: parseSubagentContextMode(row.context_mode),
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at ?? undefined,
    finalText: row.final_text ?? undefined,
    errorMessage: row.error_message ?? undefined,
    runs: parseSubagentChildRuns(row.runs_json),
  };
}

function parseSubagentContextMode(value: string | null): SubagentContextMode | undefined {
  return value === "fork" || value === "isolated" ? value : undefined;
}

function parseSubagentChildRuns(value: string): SubagentChildRun[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSubagentChildRun);
  } catch {
    return [];
  }
}

function isSubagentChildRun(value: unknown): value is SubagentChildRun {
  return isRecord(value) && typeof value.id === "string" && typeof value.agent === "string" && isSubagentRunStatus(value.status);
}

function isSubagentRunStatus(value: unknown): value is SubagentRun["status"] {
  return value === "pending" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled";
}

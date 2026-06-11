import type { AppSettings, ConversationContextUsage, ConversationMessage, ConversationTokenUsage, ConversationToolDetails, ExecutionHostRef, GuiEvent, GuiSession, Project, Runtime, SubagentChildRun, SubagentContextMode, SubagentRun } from "@pi-gui/shared";
import { isRecord, isRuntimeProfileId } from "@pi-gui/shared";
import type { ConversationMessageRow, EventRow, ProjectRow, RuntimeConversationStateRow, RuntimeRow, SessionRow, SubagentRunRow } from "./rows.js";

export function projectFromRow(row: ProjectRow, cwd = row.cwd): Project {
  const host = hostFromRow(row);
  return {
    id: row.id,
    name: row.name,
    cwd,
    lastOpenedAt: row.last_opened_at,
    defaultModel: row.default_model ?? undefined,
    defaultRuntimeProfileId: row.default_runtime_profile_id && isRuntimeProfileId(row.default_runtime_profile_id) ? row.default_runtime_profile_id : undefined,
    ...(host ? { host } : {}),
  };
}

export function hostFromRow(row: { host_kind?: ExecutionHostRef["kind"] | null; host_id?: string | null; host_label?: string | null }): ExecutionHostRef | undefined {
  if (!row.host_kind || !row.host_id) return undefined;
  return { kind: row.host_kind, id: row.host_id, label: row.host_label ?? undefined };
}

export function parseThinkingLevel(value: string): AppSettings["defaultThinkingLevel"] {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : undefined;
}

export function sessionFromRow(row: SessionRow): GuiSession {
  const host = hostFromRow(row);
  return {
    id: row.id,
    projectId: row.project_id,
    piSessionFile: row.pi_session_file,
    ...(host ? { host } : {}),
    title: row.title ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    runtimeId: row.runtime_id ?? undefined,
  };
}

export function runtimeFromRow(row: RuntimeRow): Runtime {
  const host = hostFromRow(row);
  return {
    id: row.id,
    projectId: row.project_id,
    cwd: row.cwd,
    status: row.status,
    ...(host ? { host } : {}),
    pid: row.pid ?? undefined,
    sessionId: row.session_id ?? undefined,
    startedAt: row.started_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    model: row.model ?? undefined,
    thinkingLevel: row.thinking_level ? parseThinkingLevel(row.thinking_level) : undefined,
    responseMode: row.response_mode === "fast" ? "fast" : row.response_mode === "normal" ? "normal" : undefined,
    runtimeProfileId: row.runtime_profile_id && isRuntimeProfileId(row.runtime_profile_id) ? row.runtime_profile_id : undefined,
    enabledCapabilityIds: parseCapabilityIds(row.enabled_capability_ids_json),
  };
}

export function conversationMessageFromRow(row: ConversationMessageRow): ConversationMessage {
  const toolDetails = parseConversationToolDetails(row.tool_details_json);
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
    ...(toolDetails ? { toolDetails } : {}),
  };
}

function parseConversationToolDetails(value: string | null): ConversationToolDetails | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return undefined;
    const path = typeof parsed.path === "string" && parsed.path.trim() ? parsed.path : undefined;
    const diff = typeof parsed.diff === "string" && parsed.diff.trim() ? parsed.diff : undefined;
    const firstChangedLine = finiteNumber(parsed.firstChangedLine);
    if (!path && !diff && firstChangedLine === undefined) return undefined;
    return {
      ...(path ? { path } : {}),
      ...(diff ? { diff } : {}),
      ...(firstChangedLine !== undefined ? { firstChangedLine } : {}),
    };
  } catch {
    return undefined;
  }
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

function parseCapabilityIds(value: string | null): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const capabilityIds = parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    return capabilityIds.length > 0 ? capabilityIds : [];
  } catch {
    return undefined;
  }
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

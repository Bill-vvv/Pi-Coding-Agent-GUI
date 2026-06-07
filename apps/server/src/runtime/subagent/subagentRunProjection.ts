import type { ServerEvent, SubagentChildRun, SubagentRun, SubagentRunMode, SubagentRunStatus } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { AppDatabase } from "../../db.js";
import type { RuntimeProvider } from "../conversationProjection.js";
import {
  aggregateSubagentStatus,
  finalTextFromToolPayload,
  subagentAdapterForToolPayload,
  subagentProgressFromToolPayload,
  subagentRunWithDerivedFields,
  type SubagentProgressAdapter,
} from "./subagentProgress.js";
import { subagentRunForWire } from "./subagentWire.js";
import { defaultSubagentProgressAdapters } from "./trellisSubagentAdapter.js";

type Broadcast = (event: ServerEvent) => void;

export class SubagentRunProjection {
  constructor(
    private readonly db: AppDatabase,
    private readonly getRuntime: RuntimeProvider,
    private readonly broadcast: Broadcast,
    private readonly adapters: readonly SubagentProgressAdapter[] = defaultSubagentProgressAdapters,
  ) {}

  handlePiPayload(payload: unknown): void {
    if (!isRecord(payload)) return;
    if (payload.type !== "tool_execution_start" && payload.type !== "tool_execution_update" && payload.type !== "tool_execution_end") return;

    const toolCallId = toolCallIdFromPayload(payload);
    if (!toolCallId) return;

    const runtime = this.getRuntime();
    if (!runtime) return;

    const existing = this.db.getSubagentRunByParentToolCall(runtime.id, toolCallId);
    const progress = subagentProgressFromToolPayload(payload, this.adapters);
    const adapter = subagentAdapterForToolPayload(payload, this.adapters);
    if (!existing && !adapter && !progress) return;

    const now = Date.now();
    const finalText = finalTextFromToolPayload(payload, this.adapters);
    const isEnd = payload.type === "tool_execution_end";
    const fallbackStatus = fallbackStatusFromPayload(payload, existing?.status ?? "running");
    const startedAt = progress?.startedAt ?? existing?.startedAt ?? now;
    const mode = progress?.mode ?? existing?.mode ?? modeFromPayload(payload) ?? "single";
    const agent = progress?.agent ?? existing?.agent ?? agentFromPayload(payload) ?? adapter?.defaultAgent ?? "subagent";
    const runs = progress?.runs ? mergeChildRuns(existing?.runs ?? [], progress.runs) : existing?.runs ?? [];
    const status = aggregateSubagentStatus(runs, fallbackStatus, isEnd || progress?.final === true);
    const finishedAt = status === "running" || status === "pending" ? existing?.finishedAt : progress?.updatedAt ?? now;
    const errorMessage = errorMessageFromPayload(payload) ?? existing?.errorMessage;

    const next = subagentRunWithDerivedFields({
      id: subagentRunId(runtime.id, toolCallId),
      projectId: runtime.projectId,
      parentRuntimeId: runtime.id,
      parentToolCallId: toolCallId,
      parentToolMessageId: `tool-${toolCallId}`,
      agent,
      mode,
      contextMode: progress?.contextMode ?? existing?.contextMode,
      status,
      startedAt,
      updatedAt: progress?.updatedAt ?? now,
      finishedAt,
      finalText: finalText ?? existing?.finalText,
      errorMessage,
      runs,
    });

    const saved = this.db.upsertSubagentRun(next);
    this.broadcast({ type: "subagent.run", run: subagentRunForWire(saved) });
  }
}

export function subagentRunId(parentRuntimeId: string, parentToolCallId: string): string {
  return `${parentRuntimeId}:${parentToolCallId}`;
}

function mergeChildRuns(existingRuns: SubagentChildRun[], nextRuns: SubagentChildRun[]): SubagentChildRun[] {
  const existingById = new Map(existingRuns.map((run) => [run.id, run]));
  const nextIds = new Set(nextRuns.map((run) => run.id));
  const merged = nextRuns.map((run) => mergeDefinedChildRun(existingById.get(run.id), run));
  for (const existing of existingRuns) {
    if (!nextIds.has(existing.id)) merged.push(existing);
  }
  return merged;
}

function mergeDefinedChildRun(existing: SubagentChildRun | undefined, next: SubagentChildRun): SubagentChildRun {
  if (!existing) return next;
  return Object.fromEntries(
    Object.entries({ ...existing, ...next }).map(([key, value]) => [key, value === undefined ? existing[key as keyof SubagentChildRun] : value]),
  ) as SubagentChildRun;
}

function toolCallIdFromPayload(payload: Record<string, unknown>): string | undefined {
  const raw = payload.toolCallId ?? payload.tool_call_id ?? payload.callId ?? payload.id ?? payload.requestId;
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : undefined;
}

function fallbackStatusFromPayload(payload: Record<string, unknown>, current: SubagentRunStatus): SubagentRunStatus {
  if (payload.type !== "tool_execution_end") return current;
  if (payload.isError === true) return "failed";
  return "succeeded";
}

function agentFromPayload(payload: Record<string, unknown>): string | undefined {
  const args = isRecord(payload.args) ? payload.args : undefined;
  return typeof args?.agent === "string" ? args.agent : undefined;
}

function modeFromPayload(payload: Record<string, unknown>): SubagentRunMode | undefined {
  const args = isRecord(payload.args) ? payload.args : undefined;
  const mode = args?.mode;
  return mode === "single" || mode === "parallel" || mode === "chain" ? mode : undefined;
}

function errorMessageFromPayload(payload: Record<string, unknown>): string | undefined {
  if (payload.type !== "tool_execution_end" || payload.isError !== true) return undefined;
  if (typeof payload.error === "string") return payload.error;
  if (typeof payload.errorMessage === "string") return payload.errorMessage;
  if (typeof payload.result === "string") return payload.result;
  return "Sub-agent run failed";
}

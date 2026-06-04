import type { SubagentChildRun, SubagentContextMode, SubagentRun, SubagentRunMode, SubagentRunStatus, SubagentToolStatus, SubagentToolTrace, SubagentUsage } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import { textFromResult } from "../conversation/piMessageContent.js";

export type NormalizedSubagentProgress = {
  agent?: string;
  mode?: SubagentRunMode;
  contextMode?: SubagentContextMode;
  startedAt?: number;
  updatedAt?: number;
  final?: boolean;
  runs?: SubagentChildRun[];
};

export function subagentProgressFromToolPayload(payload: Record<string, unknown>): NormalizedSubagentProgress | undefined {
  const details = findProgressDetails(payload.result) ?? findProgressDetails(payload.partialResult) ?? findProgressDetails(payload.details) ?? findProgressDetails(payload);
  if (!details) return undefined;

  const runs = Array.isArray(details.runs) ? details.runs.flatMap((item, index) => normalizeChildRun(item, index, details)) : [];
  return {
    agent: stringOrUndefined(details.agent),
    mode: normalizeMode(details.mode),
    contextMode: normalizeContextMode(details.contextMode),
    startedAt: numberOrUndefined(details.startedAt),
    updatedAt: numberOrUndefined(details.updatedAt),
    final: details.final === true,
    runs,
  };
}

export function finalTextFromToolPayload(payload: Record<string, unknown>): string | undefined {
  const source = payload.result ?? payload.partialResult;
  const text = textFromResult(source).trim();
  if (!text || text === "subagent running") return undefined;
  return text;
}

export function aggregateSubagentStatus(runs: SubagentChildRun[], fallback: SubagentRunStatus, isFinal: boolean): SubagentRunStatus {
  const hasActiveChild = runs.some((run) => run.status === "pending" || run.status === "running");
  if (!isFinal && hasActiveChild && fallback !== "failed" && fallback !== "cancelled") return "running";
  if (runs.some((run) => run.status === "failed") || fallback === "failed") return "failed";
  if (runs.some((run) => run.status === "cancelled") || fallback === "cancelled") return "cancelled";
  if (runs.length > 0 && runs.every((run) => run.status === "succeeded")) return "succeeded";
  if (isFinal && runs.length === 0) return "succeeded";
  return fallback;
}

export function subagentRunWithDerivedFields(run: SubagentRun): SubagentRun {
  const finalText = run.finalText ?? aggregateFinalText(run.runs);
  const errorMessage = run.errorMessage ?? run.runs.find((child) => child.errorMessage)?.errorMessage;
  return {
    ...run,
    finalText,
    errorMessage,
  };
}

function aggregateFinalText(runs: SubagentChildRun[]): string | undefined {
  const completed = runs.map((run) => run.finalText?.trim()).filter((text): text is string => Boolean(text));
  if (completed.length === 0) return undefined;
  if (completed.length === 1) return completed[0];
  return completed.map((text, index) => `### Child ${index + 1}\n\n${text}`).join("\n\n---\n\n");
}

function findProgressDetails(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (depth > 4) return undefined;
  if (isRecord(value)) {
    if (value.kind === "trellis-subagent-progress") return value;
    return findProgressDetails(value.details, depth + 1) ?? findProgressDetails(value.result, depth + 1) ?? findProgressDetails(value.partialResult, depth + 1);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProgressDetails(item, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function normalizeChildRun(value: unknown, index: number, details: Record<string, unknown>): SubagentChildRun[] {
  if (!isRecord(value)) return [];
  const id = stringOrUndefined(value.id) ?? `${stringOrUndefined(details.agent) ?? "subagent"}-${index + 1}`;
  const agent = stringOrUndefined(value.agent) ?? stringOrUndefined(details.agent) ?? "subagent";
  const status = normalizeRunStatus(value.status) ?? "running";
  const tools = Array.isArray(value.tools) ? value.tools.flatMap(normalizeToolTrace) : undefined;
  return [
    {
      id,
      agent,
      prompt: stringOrUndefined(value.prompt),
      step: numberOrUndefined(value.step),
      status,
      startedAt: numberOrUndefined(value.startedAt),
      finishedAt: numberOrUndefined(value.finishedAt),
      sessionFile: stringOrUndefined(value.sessionFile),
      finalText: stringOrUndefined(value.finalText),
      textTail: stringOrUndefined(value.textTail),
      thinkingTail: stringOrUndefined(value.thinkingTail),
      stderrTail: stringOrUndefined(value.stderrTail),
      tools,
      usage: normalizeUsage(value.usage),
      model: stringOrUndefined(value.model),
      thinking: stringOrUndefined(value.thinking),
      errorMessage: stringOrUndefined(value.errorMessage),
    },
  ];
}

function normalizeToolTrace(value: unknown): SubagentToolTrace[] {
  if (!isRecord(value)) return [];
  const id = stringOrUndefined(value.id);
  const name = stringOrUndefined(value.name);
  const status = normalizeToolStatus(value.status);
  if (!id || !name || !status) return [];
  return [
    {
      id,
      name,
      args: stringOrUndefined(value.args),
      status,
      startedAt: numberOrUndefined(value.startedAt),
      finishedAt: numberOrUndefined(value.finishedAt),
    },
  ];
}

function normalizeUsage(value: unknown): SubagentUsage | undefined {
  if (!isRecord(value)) return undefined;
  const usage: SubagentUsage = {
    input: numberOrUndefined(value.input),
    output: numberOrUndefined(value.output),
    cacheRead: numberOrUndefined(value.cacheRead),
    cacheWrite: numberOrUndefined(value.cacheWrite),
    cost: numberOrUndefined(value.cost),
    ctxTokens: numberOrUndefined(value.ctxTokens),
    turns: numberOrUndefined(value.turns),
  };
  return Object.values(usage).some((item) => item !== undefined) ? usage : undefined;
}

function normalizeRunStatus(value: unknown): SubagentRunStatus | undefined {
  if (value === "pending" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled") return value;
  return undefined;
}

function normalizeToolStatus(value: unknown): SubagentToolStatus | undefined {
  if (value === "running" || value === "succeeded" || value === "failed") return value;
  return undefined;
}

function normalizeMode(value: unknown): SubagentRunMode | undefined {
  if (value === "single" || value === "parallel" || value === "chain") return value;
  return undefined;
}

function normalizeContextMode(value: unknown): SubagentContextMode | undefined {
  if (value === "fork" || value === "isolated") return value;
  return undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

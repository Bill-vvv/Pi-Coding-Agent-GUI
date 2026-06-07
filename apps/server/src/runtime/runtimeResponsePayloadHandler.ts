import { isRecord, type ServerEvent } from "@pi-gui/shared";
import type { ManagedRuntime } from "./managedRuntime.js";
import { updateRuntimeConfigFromPiResponse } from "./runtimeConfigProjection.js";
import type { RuntimeEventSink } from "./runtimeEventSink.js";
import type { RuntimeLiveState } from "./runtimeLiveState.js";
import { handleNativeRpcResponse } from "./runtimeNativeRpcResponse.js";
import { slashCommandsFromPiResponseData } from "./runtimePiPayload.js";
import type { RuntimeSessionLinker } from "./runtimeSessionLinker.js";
import { requestRuntimeMessages, requestRuntimeState, requestSessionStats } from "./runtimeStateRequester.js";

type Broadcast = (event: ServerEvent) => void;

export type RuntimeResponsePayloadHandlerDependencies = {
  managed: ManagedRuntime;
  response: Record<string, unknown>;
  events: RuntimeEventSink;
  liveState: RuntimeLiveState;
  sessionLinker: RuntimeSessionLinker;
  broadcast: Broadcast;
};

export function handleRuntimeResponsePayload({
  managed,
  response,
  events,
  liveState,
  sessionLinker,
  broadcast,
}: RuntimeResponsePayloadHandlerDependencies): void {
  const data = response.success === true && isRecord(response.data) ? response.data : undefined;

  const isCurrentStateResponse = Boolean(managed.stateRequestId && response.id === managed.stateRequestId);
  const isFreshStateConfigResponse = isCurrentStateResponse && managed.stateRequestConfigRevision === managed.configRevision;
  if (isCurrentStateResponse) {
    managed.stateRequestId = undefined;
    managed.stateRequestConfigRevision = undefined;
    if (data) {
      const sessionId = typeof data.sessionId === "string" ? data.sessionId : undefined;
      if (sessionId && managed.runtime.sessionId !== sessionId) {
        managed.runtime = { ...managed.runtime, sessionId };
        events.publishRuntimeStatus(managed.runtime);
      }
    }
  }

  const isCurrentStatsResponse = Boolean(managed.statsRequestId && response.id === managed.statsRequestId);
  if (isCurrentStatsResponse) {
    managed.statsRequestId = undefined;
  }

  if (managed.messageRequestId && response.id === managed.messageRequestId) {
    managed.messageRequestId = undefined;
  }

  if (typeof response.id === "string") {
    handleNativeRpcResponse(managed, response.id, response, broadcast, events);
  }

  const canApplyRuntimeConfigFromResponse =
    response.command === "get_state"
      ? isFreshStateConfigResponse
      : response.command === "set_model" || response.command === "cycle_model" || response.command === "cycle_thinking_level";
  if (data && canApplyRuntimeConfigFromResponse) {
    updateRuntimeConfigFromPiResponse(managed, data, events);
  }

  if (data && (response.command === "get_state" || response.command === "get_session_stats")) {
    sessionLinker.indexSessionFromPiResponse(managed, data);
  }

  if (data && response.command === "get_session_stats" && isCurrentStatsResponse) {
    appendPendingCompactStatsNotice(managed, data);
  }

  if (response.command === "get_commands" && data) {
    if (managed.commandsRequestId && response.id === managed.commandsRequestId) {
      managed.commandsRequestId = undefined;
    }
    liveState.publishCommands(managed, slashCommandsFromPiResponseData(data));
  }

  if (response.command === "set_model" && response.success === true) {
    requestSessionStats(managed, events);
  }

  if (response.command === "abort" && response.success === true) {
    requestRuntimeState(managed, events);
    requestRuntimeMessages(managed, events);
    requestSessionStats(managed, events);
  }
}

function appendPendingCompactStatsNotice(managed: ManagedRuntime, data: Record<string, unknown>): void {
  const notice = managed.pendingCompactStatsNotice;
  if (!notice) return;
  managed.pendingCompactStatsNotice = undefined;

  const contextUsage = isRecord(data.contextUsage) ? data.contextUsage : undefined;
  const tokensAfter = numberFromRecord(contextUsage, "tokens");
  const contextWindow = numberFromRecord(contextUsage, "contextWindow");
  const percent = numberFromRecord(contextUsage, "percent");
  const before = notice.tokensBefore !== undefined ? `，压缩前约 ${formatNumber(notice.tokensBefore)} tokens` : "";

  if (tokensAfter !== undefined) {
    const context = contextWindow !== undefined ? `${formatNumber(tokensAfter)} / ${formatNumber(contextWindow)} tokens` : `${formatNumber(tokensAfter)} tokens`;
    managed.projection.appendLog("log", `上下文压缩后约 ${context}${percent !== undefined ? `（${percent.toFixed(1)}%）` : ""}${before}`, "/compact");
    return;
  }

  managed.projection.appendLog(
    "log",
    `上下文压缩后 token 数等待下一次模型响应统计${contextWindow !== undefined ? `（窗口 ${formatNumber(contextWindow)} tokens）` : ""}${before}`,
    "/compact",
  );
}

function numberFromRecord(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

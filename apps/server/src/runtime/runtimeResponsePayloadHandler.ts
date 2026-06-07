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

  if (managed.statsRequestId && response.id === managed.statsRequestId) {
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

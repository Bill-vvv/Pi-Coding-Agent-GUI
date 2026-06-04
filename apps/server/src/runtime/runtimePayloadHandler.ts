import { isRecord, type ServerEvent } from "@pi-gui/shared";
import { isExtensionUiRequest } from "./extensionUiRequest.js";
import type { ManagedRuntime } from "./managedRuntime.js";
import { updateRuntimeConfigFromPiResponse } from "./runtimeConfigProjection.js";
import type { RuntimeEventSink } from "./runtimeEventSink.js";
import type { RuntimeLiveState } from "./runtimeLiveState.js";
import { handleNativeRpcResponse } from "./runtimeNativeRpcResponse.js";
import { runtimeQueueFromPiPayload, slashCommandsFromPiResponseData } from "./runtimePiPayload.js";
import type { RuntimeSessionLinker } from "./runtimeSessionLinker.js";
import { requestSessionStats } from "./runtimeStateRequester.js";

type Broadcast = (event: ServerEvent) => void;

export type RuntimePayloadHandlerDependencies = {
  runtimeId: string;
  managed: ManagedRuntime;
  payload: unknown;
  events: RuntimeEventSink;
  liveState: RuntimeLiveState;
  sessionLinker: RuntimeSessionLinker;
  broadcast: Broadcast;
};

export function handleRuntimePayload({
  runtimeId,
  managed,
  payload,
  events,
  liveState,
  sessionLinker,
  broadcast,
}: RuntimePayloadHandlerDependencies): void {
  const maybeRecord = isRecord(payload) ? payload : undefined;
  if (maybeRecord?.type === "response") {
    handleResponsePayload({ managed, response: maybeRecord, events, liveState, sessionLinker, broadcast });
  }

  if (isExtensionUiRequest(maybeRecord)) {
    broadcast({ type: "extension.ui.request", runtimeId, projectId: managed.runtime.projectId, request: maybeRecord });
  }

  managed.projection.handlePiPayload(payload);

  if (maybeRecord?.type === "agent_end" || maybeRecord?.type === "compaction_end") {
    requestSessionStats(managed, events);
  }

  if (maybeRecord?.type === "queue_update") {
    liveState.publishQueue(managed, runtimeQueueFromPiPayload(maybeRecord));
  }

  events.publishGuiEvent(managed.runtime, "pi_event", payload);
}

function handleResponsePayload({
  managed,
  response,
  events,
  liveState,
  sessionLinker,
  broadcast,
}: {
  managed: ManagedRuntime;
  response: Record<string, unknown>;
  events: RuntimeEventSink;
  liveState: RuntimeLiveState;
  sessionLinker: RuntimeSessionLinker;
  broadcast: Broadcast;
}): void {
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
}

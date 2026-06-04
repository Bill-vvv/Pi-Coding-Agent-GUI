import { isRecord, type ServerEvent } from "@pi-gui/shared";
import { isExtensionUiRequest } from "./extensionUiRequest.js";
import type { ManagedRuntime } from "./managedRuntime.js";
import type { RuntimeEventSink } from "./runtimeEventSink.js";
import type { RuntimeLiveState } from "./runtimeLiveState.js";
import { runtimeQueueFromPiPayload } from "./runtimePiPayload.js";
import { handleRuntimeResponsePayload } from "./runtimeResponsePayloadHandler.js";
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
    handleRuntimeResponsePayload({ managed, response: maybeRecord, events, liveState, sessionLinker, broadcast });
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

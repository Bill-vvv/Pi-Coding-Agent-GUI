import { isRecord, type ServerEvent } from "@pi-gui/shared";
import { randomUUID } from "node:crypto";
import { isExtensionUiDialogRequest, isExtensionUiRequest } from "./extensionUiRequest.js";
import type { ManagedRuntime } from "./managedRuntime.js";
import type { RuntimeEventSink } from "./runtimeEventSink.js";
import type { RuntimeLiveState } from "./runtimeLiveState.js";
import { runtimeQueueFromPiPayload } from "./runtimePiPayload.js";
import { handleRuntimeResponsePayload } from "./runtimeResponsePayloadHandler.js";
import type { RuntimeSessionLinker } from "./runtimeSessionLinker.js";
import { isProviderPayloadTooLargeErrorText, providerPayloadTooLargeUserMessage } from "./piCodexTransportMonitor.js";
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
  const staleInternalStatsResponse = isStaleInternalStatsResponse(managed, maybeRecord);
  if (handlePayloadTooLargeAutoRetry(managed, events, maybeRecord)) {
    events.publishGuiEvent(managed.runtime, "pi_event", payload);
    return;
  }
  if (maybeRecord?.type === "response" && !staleInternalStatsResponse) {
    handleRuntimeResponsePayload({ managed, response: maybeRecord, events, liveState, sessionLinker, broadcast });
  }

  if (isExtensionUiRequest(maybeRecord)) {
    if (isExtensionUiDialogRequest(maybeRecord)) managed.pendingExtensionUiRequest = maybeRecord;
    broadcast({ type: "extension.ui.request", runtimeId, projectId: managed.runtime.projectId, request: maybeRecord });
  }

  if (!staleInternalStatsResponse) {
    managed.subagents?.handlePiPayload(payload);
    managed.projection.handlePiPayload(payload);
  }

  if (maybeRecord?.type === "agent_end" || maybeRecord?.type === "compaction_end") {
    requestSessionStats(managed, events);
  }

  if (maybeRecord?.type === "queue_update") {
    liveState.publishQueue(managed, runtimeQueueFromPiPayload(maybeRecord));
  }

  events.publishGuiEvent(managed.runtime, "pi_event", payload);
}

function handlePayloadTooLargeAutoRetry(managed: ManagedRuntime, events: RuntimeEventSink, payload: Record<string, unknown> | undefined): boolean {
  if (payload?.type !== "auto_retry_start" || !isProviderPayloadTooLargeErrorText(payload.errorMessage)) return false;
  const errorText = typeof payload.errorMessage === "string" ? payload.errorMessage : undefined;
  const message = providerPayloadTooLargeUserMessage(errorText);
  managed.client.send({ id: `gui-${randomUUID()}`, type: "abort_retry" });
  managed.projection.markBusy(false);
  events.publishGuiEvent(managed.runtime, "error", { message, code: "provider_payload_too_large_retry_stopped" });
  managed.projection.appendLog("error", message, "provider transport");
  return true;
}

function isStaleInternalStatsResponse(managed: ManagedRuntime, payload: Record<string, unknown> | undefined): boolean {
  if (payload?.type !== "response" || payload.command !== "get_session_stats" || typeof payload.id !== "string") return false;
  if (!payload.id.startsWith("gui-stats-")) return false;
  return payload.id !== managed.statsRequestId;
}

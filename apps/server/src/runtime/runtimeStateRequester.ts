import { randomUUID } from "node:crypto";
import type { ManagedRuntime } from "./managedRuntime.js";
import type { RuntimeEventSink } from "./runtimeEventSink.js";

export function requestRuntimeState(managed: ManagedRuntime, events: RuntimeEventSink): void {
  if (requestRuntimeCommand(managed, events, "stateRequestId", "gui-state", "get_state")) {
    managed.stateRequestConfigRevision = managed.configRevision;
  }
}

export function requestSessionStats(managed: ManagedRuntime, events: RuntimeEventSink): void {
  requestRuntimeCommand(managed, events, "statsRequestId", "gui-stats", "get_session_stats");
}

export function requestRuntimeMessages(managed: ManagedRuntime, events: RuntimeEventSink): void {
  requestRuntimeCommand(managed, events, "messageRequestId", "gui-messages", "get_messages");
}

function requestRuntimeCommand(
  managed: ManagedRuntime,
  events: RuntimeEventSink,
  requestIdField: "stateRequestId" | "statsRequestId" | "messageRequestId",
  requestIdPrefix: string,
  commandType: "get_state" | "get_session_stats" | "get_messages",
): boolean {
  if (managed[requestIdField]) return false;
  managed[requestIdField] = `${requestIdPrefix}-${randomUUID()}`;
  try {
    managed.client.send({ id: managed[requestIdField], type: commandType });
    return true;
  } catch (error) {
    managed[requestIdField] = undefined;
    if (requestIdField === "stateRequestId") managed.stateRequestConfigRevision = undefined;
    events.publishGuiEvent(managed.runtime, "error", { message: (error as Error).message });
    return false;
  }
}

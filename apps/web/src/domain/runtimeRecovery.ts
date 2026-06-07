import type { GuiEvent, Runtime } from "@pi-gui/shared";

export const ORPHANED_RUNTIME_ON_STARTUP_REASON = "orphaned_runtime_on_startup";

export function isRecoverableRuntimeInterruption(runtime: Runtime | undefined, events: GuiEvent[]): boolean {
  return Boolean(runtime?.status === "crashed" && runtime.sessionId && hasOrphanedRuntimeStartupEvent(runtime.id, events));
}

function hasOrphanedRuntimeStartupEvent(runtimeId: string, events: GuiEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.runtimeId !== runtimeId) continue;
    if (event.kind === "error") return eventPayloadReason(event.payload) === ORPHANED_RUNTIME_ON_STARTUP_REASON;
    if (event.kind === "runtime_status" && eventPayloadStatus(event.payload) === "crashed") return false;
  }
  return false;
}

function eventPayloadReason(payload: unknown): string | undefined {
  return typeof payload === "object" && payload !== null && "reason" in payload && typeof payload.reason === "string" ? payload.reason : undefined;
}

function eventPayloadStatus(payload: unknown): string | undefined {
  return typeof payload === "object" && payload !== null && "status" in payload && typeof payload.status === "string" ? payload.status : undefined;
}

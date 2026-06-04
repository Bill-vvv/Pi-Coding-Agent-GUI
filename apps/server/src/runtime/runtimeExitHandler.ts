import type { ServerEvent } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import type { ManagedRuntime } from "./managedRuntime.js";
import type { RuntimeEventSink } from "./runtimeEventSink.js";
import type { RuntimeLiveState } from "./runtimeLiveState.js";

type Broadcast = (event: ServerEvent) => void;

export function handleRuntimeExit({
  runtimeId,
  code,
  signal,
  runtimes,
  db,
  broadcast,
  liveState,
  events,
}: {
  runtimeId: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  runtimes: Map<string, ManagedRuntime>;
  db: AppDatabase;
  broadcast: Broadcast;
  liveState: RuntimeLiveState;
  events: RuntimeEventSink;
}): void {
  const managed = runtimes.get(runtimeId);
  if (!managed) return;

  const stoppedByUser = managed.client.isStopping;
  const status = stoppedByUser || code === 0 ? "stopped" : "crashed";
  managed.runtime = {
    ...managed.runtime,
    status,
    pid: undefined,
    archivedAt: status === "stopped" && !managed.runtime.sessionId ? Date.now() : managed.runtime.archivedAt,
  };

  const exitPayload = {
    exitCode: code,
    signal,
    status,
  };
  events.publishGuiEvent(managed.runtime, status === "crashed" ? "error" : "runtime_status", exitPayload);
  if (status === "crashed") managed.projection.appendLog("error", JSON.stringify(exitPayload, null, 2), "runtime crashed");
  db.setConversationBusy(runtimeId, managed.runtime.projectId, false);
  broadcast({ type: "conversation.busy", runtimeId, projectId: managed.runtime.projectId, busy: false });
  liveState.deleteRuntime(runtimeId);
  events.publishRuntimeStatus(managed.runtime);
  runtimes.delete(runtimeId);
}

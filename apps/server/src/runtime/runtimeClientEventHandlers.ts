import type { ServerEvent } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import type { ManagedRuntime } from "./managedRuntime.js";
import type { RuntimeEventSink } from "./runtimeEventSink.js";
import { handleRuntimeExit } from "./runtimeExitHandler.js";
import type { RuntimeLiveState } from "./runtimeLiveState.js";
import { handleRuntimePayload } from "./runtimePayloadHandler.js";
import type { RuntimeSessionLinker } from "./runtimeSessionLinker.js";
import { stripModelDebugStderrLines } from "./stderrFilters.js";

type Broadcast = (event: ServerEvent) => void;

export type RuntimeClientHandlerDependencies = {
  db: AppDatabase;
  broadcast: Broadcast;
  runtimes: Map<string, ManagedRuntime>;
  events: RuntimeEventSink;
  liveState: RuntimeLiveState;
  sessionLinker: RuntimeSessionLinker;
};

export function attachRuntimeClientEventHandlers(dependencies: RuntimeClientHandlerDependencies, runtimeId: string, managed: ManagedRuntime): void {
  const { db, broadcast, runtimes, events, liveState } = dependencies;
  const { client } = managed;

  client.on("event", (payload) => handleRuntimeClientPayload(dependencies, runtimeId, payload));
  client.on("stderr", (chunk) => {
    events.publishGuiEvent(managed.runtime, "stderr", chunk);
    const visibleChunk = stripModelDebugStderrLines(chunk);
    if (visibleChunk.trim()) managed.projection.appendLog("log", visibleChunk, "stderr");
  });
  client.on("error", (error) => {
    events.publishGuiEvent(managed.runtime, "error", { message: error.message });
    managed.projection.appendLog("error", error.message);
  });
  client.on("exit", (code, signal) =>
    handleRuntimeExit({
      runtimeId,
      code,
      signal,
      runtimes,
      db,
      broadcast,
      liveState,
      events,
    }),
  );
}

export function handleRuntimeClientPayload(dependencies: RuntimeClientHandlerDependencies, runtimeId: string, payload: unknown): void {
  const { runtimes, events, liveState, sessionLinker, broadcast } = dependencies;
  const managed = runtimes.get(runtimeId);
  if (!managed) return;
  handleRuntimePayload({
    runtimeId,
    managed,
    payload,
    events,
    liveState,
    sessionLinker,
    broadcast,
  });
}

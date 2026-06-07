import assert from "node:assert/strict";
import test from "node:test";
import type { Runtime } from "@pi-gui/shared";
import type { ManagedRuntime } from "../src/runtime/managedRuntime.js";
import { handleRuntimePayload } from "../src/runtime/runtimePayloadHandler.js";

function createManaged(statsRequestId: string | undefined, projected: unknown[]): ManagedRuntime {
  const runtime: Runtime = {
    id: "runtime-1",
    projectId: "project-1",
    cwd: process.cwd(),
    status: "running",
    pid: 123,
    startedAt: 1,
  };
  return {
    runtime,
    client: { send: () => undefined },
    statsRequestId,
    pendingNativeRpcCommands: new Map(),
    configRevision: 0,
    projection: { handlePiPayload: (payload: unknown) => projected.push(payload) },
    subagents: { handlePiPayload: () => undefined },
  } as unknown as ManagedRuntime;
}

test("handleRuntimePayload ignores stale internal stats responses", () => {
  const projected: unknown[] = [];
  const indexed: unknown[] = [];
  const events: unknown[] = [];
  const managed = createManaged("gui-stats-current", projected);

  handleRuntimePayload({
    runtimeId: "runtime-1",
    managed,
    payload: { type: "response", id: "gui-stats-stale", command: "get_session_stats", success: true, data: { contextUsage: { tokens: 900 } } },
    events: { publishGuiEvent: (...args: unknown[]) => events.push(args) } as never,
    liveState: {} as never,
    sessionLinker: { indexSessionFromPiResponse: (...args: unknown[]) => indexed.push(args) } as never,
    broadcast: () => undefined,
  });

  assert.equal(managed.statsRequestId, "gui-stats-current");
  assert.deepEqual(projected, []);
  assert.deepEqual(indexed, []);
  assert.equal(events.length, 1);
});

test("handleRuntimePayload applies the current internal stats response", () => {
  const projected: unknown[] = [];
  const indexed: unknown[] = [];
  const managed = createManaged("gui-stats-current", projected);
  const payload = { type: "response", id: "gui-stats-current", command: "get_session_stats", success: true, data: { contextUsage: { tokens: 80 } } };

  handleRuntimePayload({
    runtimeId: "runtime-1",
    managed,
    payload,
    events: { publishGuiEvent: () => undefined } as never,
    liveState: {} as never,
    sessionLinker: { indexSessionFromPiResponse: (...args: unknown[]) => indexed.push(args) } as never,
    broadcast: () => undefined,
  });

  assert.equal(managed.statsRequestId, undefined);
  assert.deepEqual(projected, [payload]);
  assert.equal(indexed.length, 1);
});

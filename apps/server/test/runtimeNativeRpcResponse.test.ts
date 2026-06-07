import assert from "node:assert/strict";
import test from "node:test";
import type { Runtime } from "@pi-gui/shared";
import type { ManagedRuntime } from "../src/runtime/managedRuntime.js";
import { handleNativeRpcResponse } from "../src/runtime/runtimeNativeRpcResponse.js";

function createManaged(command: string): { managed: ManagedRuntime; sentCommands: unknown[]; logs: unknown[] } {
  const runtime: Runtime = {
    id: "runtime-1",
    projectId: "project-1",
    cwd: process.cwd(),
    status: "running",
    pid: 123,
    startedAt: 1,
  };
  const sentCommands: unknown[] = [];
  const logs: unknown[] = [];
  const managed = {
    runtime,
    client: { send: (commandPayload: unknown) => sentCommands.push(commandPayload) },
    pendingNativeRpcCommands: new Map([["native-1", { command, label: `/${command}` }]]),
    configRevision: 0,
    projection: { appendLog: (...args: unknown[]) => logs.push(args) },
    subagents: {},
  } as unknown as ManagedRuntime;
  return { managed, sentCommands, logs };
}

test("compact native RPC response refreshes post-compaction context stats", () => {
  const { managed, sentCommands, logs } = createManaged("compact");
  managed.statsRequestId = "gui-stats-stale";

  handleNativeRpcResponse(
    managed,
    "native-1",
    { type: "response", id: "native-1", command: "compact", success: true, data: { tokensBefore: 208440 } },
    () => undefined,
    { publishGuiEvent: () => undefined } as never,
  );

  assert.deepEqual(sentCommands.map((command) => (command as { type?: string }).type), ["get_state", "get_session_stats"]);
  assert.match(managed.statsRequestId ?? "", /^gui-stats-/);
  assert.notEqual(managed.statsRequestId, "gui-stats-stale");
  assert.equal(logs.length, 1);
});

test("session-name native RPC response still refreshes session stats immediately", () => {
  const { managed, sentCommands } = createManaged("set_session_name");

  handleNativeRpcResponse(
    managed,
    "native-1",
    { type: "response", id: "native-1", command: "set_session_name", success: true, data: {} },
    () => undefined,
    { publishGuiEvent: () => undefined } as never,
  );

  assert.deepEqual(sentCommands.map((command) => (command as { type?: string }).type), ["get_state", "get_session_stats"]);
  assert.equal(typeof managed.statsRequestId, "string");
});

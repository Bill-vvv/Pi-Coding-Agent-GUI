import assert from "node:assert/strict";
import test from "node:test";
import type { ServerEvent } from "@pi-gui/shared";
import { latestVisiblePendingCommandForTarget, pendingCommandRegistryReducer, summarizePendingCommands } from "../src/domain/pendingCommands";

test("pending command registry records and resolves command results", () => {
  const recorded = pendingCommandRegistryReducer([], {
    type: "record",
    command: { type: "runtime.prompt", requestId: "req-1", runtimeId: "runtime-1", message: "hello" },
    now: 1000,
    timeoutMs: 15_000,
  });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].status, "sent");
  assert.equal(recorded[0].command, "runtime.prompt");
  assert.equal(recorded[0].target.runtimeId, "runtime-1");

  const result = { type: "command.result", requestId: "req-1", command: "runtime.prompt", success: true } satisfies ServerEvent;
  const resolved = pendingCommandRegistryReducer(recorded, { type: "result", result, now: 1200 });
  assert.equal(resolved[0].status, "succeeded");
  assert.equal(resolved[0].result, result);
});

test("pending command registry exposes timeout and disconnect unknown states", () => {
  const recorded = pendingCommandRegistryReducer([], {
    type: "record",
    command: { type: "runtime.stop", requestId: "req-1", runtimeId: "runtime-1" },
    now: 1000,
    timeoutMs: 200,
  });
  const timedOut = pendingCommandRegistryReducer(recorded, { type: "timeout", now: 1300 });
  assert.equal(timedOut[0].status, "timeout");

  const second = pendingCommandRegistryReducer(timedOut, {
    type: "record",
    command: { type: "runtime.prompt", requestId: "req-2", runtimeId: "runtime-1", message: "later" },
    now: 1400,
  });
  const disconnected = pendingCommandRegistryReducer(second, { type: "disconnect", now: 1500 });
  assert.equal(disconnected.find((entry) => entry.requestId === "req-1")?.status, "timeout");
  assert.equal(disconnected.find((entry) => entry.requestId === "req-2")?.status, "unknown_after_disconnect");
});

test("pending command summaries and composer target selection use latest visible command", () => {
  let entries = pendingCommandRegistryReducer([], {
    type: "record",
    command: { type: "runtime.prompt", requestId: "req-1", runtimeId: "runtime-1", message: "hello" },
    now: 1000,
  });
  entries = pendingCommandRegistryReducer(entries, {
    type: "record",
    command: { type: "settings.update", requestId: "req-2", settings: {} },
    now: 1100,
  });
  entries = pendingCommandRegistryReducer(entries, {
    type: "result",
    result: { type: "command.result", requestId: "req-2", command: "settings.update", success: false, error: "nope" },
    now: 1200,
  });

  const summary = summarizePendingCommands(entries);
  assert.equal(summary.sent, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.latest?.requestId, "req-2");
  assert.equal(latestVisiblePendingCommandForTarget(entries, { runtimeId: "runtime-1" })?.requestId, "req-1");
  assert.equal(latestVisiblePendingCommandForTarget(entries, { projectId: "missing" }), undefined);
});

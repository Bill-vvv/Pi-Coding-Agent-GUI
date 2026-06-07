import assert from "node:assert/strict";
import test from "node:test";
import type { GuiEvent, Runtime } from "@pi-gui/shared";
import { isRecoverableRuntimeInterruption, ORPHANED_RUNTIME_ON_STARTUP_REASON } from "../src/domain/runtimeRecovery";
import { deriveRuntimeCrashSummary, runtimeLogActionState, runtimeLogEventText, runtimeLogsCopyText } from "../src/domain/runtimeLogs";

function runtime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    id: "runtime-1",
    projectId: "project-1",
    cwd: "/tmp/project-1",
    status: "crashed",
    startedAt: 1,
    ...overrides,
  };
}

function event(overrides: Partial<GuiEvent> = {}): GuiEvent {
  return {
    id: 1,
    runtimeId: "runtime-1",
    projectId: "project-1",
    timestamp: 100,
    kind: "error",
    payload: { message: "boom" },
    ...overrides,
  };
}

test("runtime log action state enables safe recovery actions", () => {
  assert.deepEqual(runtimeLogActionState(runtime({ status: "running" })), {
    canStop: true,
    canResume: false,
    canRestart: false,
    canArchive: true,
  });
  assert.deepEqual(runtimeLogActionState(runtime({ status: "crashed", sessionId: "session-1" })), {
    canStop: false,
    canResume: true,
    canRestart: false,
    canArchive: true,
  });
  assert.deepEqual(runtimeLogActionState(runtime({ status: "crashed" }), true), {
    canStop: false,
    canResume: false,
    canRestart: true,
    canArchive: false,
  });
});

test("runtime log text extracts compact diagnostic payloads", () => {
  assert.equal(runtimeLogEventText(event({ kind: "stderr", payload: " warning\n line " })), "warning line");
  assert.equal(runtimeLogEventText(event({ payload: { exitCode: 1, signal: "SIGTERM", status: "crashed" } })), "exitCode=1 signal=SIGTERM status=crashed");
  assert.equal(runtimeLogEventText(event({ kind: "runtime_status", payload: { status: "crashed" } })), "status: crashed");
});

test("runtime recovery classification detects orphaned restart interruptions", () => {
  assert.equal(
    isRecoverableRuntimeInterruption(runtime({ status: "crashed", sessionId: "session-1" }), [
      event({ payload: { reason: ORPHANED_RUNTIME_ON_STARTUP_REASON, status: "crashed" } }),
    ]),
    true,
  );
  assert.equal(
    isRecoverableRuntimeInterruption(runtime({ status: "crashed", sessionId: "session-1" }), [event({ payload: { message: "boom" } })]),
    false,
  );
  assert.equal(
    isRecoverableRuntimeInterruption(runtime({ status: "crashed" }), [event({ payload: { reason: ORPHANED_RUNTIME_ON_STARTUP_REASON } })]),
    false,
  );
  assert.equal(
    isRecoverableRuntimeInterruption(runtime({ status: "crashed", sessionId: "session-1" }), [
      event({ id: 1, payload: { reason: ORPHANED_RUNTIME_ON_STARTUP_REASON, status: "crashed" } }),
      event({ id: 2, kind: "runtime_status", payload: { status: "crashed" } }),
    ]),
    false,
  );
});

test("runtime crash summary derives from latest diagnostic event", () => {
  const summary = deriveRuntimeCrashSummary([
    event({ id: 1, timestamp: 10, kind: "stderr", payload: "first" }),
    event({ id: 2, timestamp: 20, kind: "error", payload: { message: "latest boom" } }),
  ]);
  assert.deepEqual(summary, { timestamp: 20, reason: "latest boom" });
});

test("runtime log copy text only includes displayed events", () => {
  const text = runtimeLogsCopyText(runtime(), [event({ id: 1, kind: "stderr", payload: "displayed" })]);
  assert.match(text, /Runtime runtime-1/);
  assert.match(text, /stderr: displayed/);
  assert.doesNotMatch(text, /conversation body/);
});

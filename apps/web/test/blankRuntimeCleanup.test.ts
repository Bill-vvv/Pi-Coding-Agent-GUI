import assert from "node:assert/strict";
import test from "node:test";
import type { Runtime } from "@pi-gui/shared";
import { shouldAutoArchiveBlankRuntime } from "../src/domain/blankRuntimeCleanup";

function runtime(overrides: Partial<Runtime> = {}): Runtime {
  return { id: "runtime-1", projectId: "project-1", cwd: "/tmp/project-1", status: "running", startedAt: 1, ...overrides };
}

test("allows auto archiving a running blank runtime with no draft or local activity", () => {
  assert.equal(shouldAutoArchiveBlankRuntime({ runtime: runtime(), messageCount: 0, isBusy: false, hasLocalUserActivity: false, draftPrompt: "" }), true);
});

test("allows auto archiving blank runtimes even after Pi assigns a session id", () => {
  assert.equal(shouldAutoArchiveBlankRuntime({ runtime: runtime({ sessionId: "session-1" }), messageCount: 0, isBusy: false, hasLocalUserActivity: false, draftPrompt: "" }), true);
});

test("blocks auto archiving contentful or in-flight runtimes", () => {
  assert.equal(shouldAutoArchiveBlankRuntime({ runtime: runtime(), messageCount: 1, isBusy: false, hasLocalUserActivity: false, draftPrompt: "" }), false);
  assert.equal(shouldAutoArchiveBlankRuntime({ runtime: runtime(), messageCount: 0, isBusy: true, hasLocalUserActivity: false, draftPrompt: "" }), false);
  assert.equal(shouldAutoArchiveBlankRuntime({ runtime: runtime(), messageCount: 0, isBusy: false, hasLocalUserActivity: true, draftPrompt: "" }), false);
  assert.equal(shouldAutoArchiveBlankRuntime({ runtime: runtime(), messageCount: 0, isBusy: false, hasLocalUserActivity: false, draftPrompt: "hello" }), false);
});

test("only running or starting visible runtimes are auto archived", () => {
  assert.equal(shouldAutoArchiveBlankRuntime({ runtime: runtime({ status: "starting" }), messageCount: 0, isBusy: false, hasLocalUserActivity: false, draftPrompt: "" }), true);
  assert.equal(shouldAutoArchiveBlankRuntime({ runtime: runtime({ status: "stopped" }), messageCount: 0, isBusy: false, hasLocalUserActivity: false, draftPrompt: "" }), false);
  assert.equal(shouldAutoArchiveBlankRuntime({ runtime: runtime({ status: "crashed" }), messageCount: 0, isBusy: false, hasLocalUserActivity: false, draftPrompt: "" }), false);
  assert.equal(shouldAutoArchiveBlankRuntime({ runtime: runtime({ archivedAt: 2 }), messageCount: 0, isBusy: false, hasLocalUserActivity: false, draftPrompt: "" }), false);
});

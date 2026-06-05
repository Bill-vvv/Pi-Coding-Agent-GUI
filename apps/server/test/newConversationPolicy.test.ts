import assert from "node:assert/strict";
import test from "node:test";
import type { Runtime } from "@pi-gui/shared";
import { reusableNewRuntimeForProject, unhandledNewRuntimeIdsToArchive } from "../src/runtime/newConversationPolicy.js";

function runtime(overrides: Partial<Runtime> & Pick<Runtime, "id" | "projectId">): Runtime {
  return {
    cwd: `/tmp/${overrides.projectId}`,
    status: "running",
    startedAt: 1,
    ...overrides,
  };
}

test("new conversation policy reuses the newest blank runtime for the requested project", () => {
  const runtimes = [
    runtime({ id: "old-blank", projectId: "project-1", startedAt: 10 }),
    runtime({ id: "new-blank", projectId: "project-1", startedAt: 20 }),
    runtime({ id: "other-project", projectId: "project-2", startedAt: 30 }),
  ];

  const reusable = reusableNewRuntimeForProject(runtimes, "project-1", () => false);

  assert.equal(reusable?.id, "new-blank");
});

test("new conversation policy never reuses runtimes with messages, sessions, archived state, or inactive status", () => {
  const runtimes = [
    runtime({ id: "with-message", projectId: "project-1", startedAt: 40 }),
    runtime({ id: "with-session", projectId: "project-1", sessionId: "session-1", startedAt: 30 }),
    runtime({ id: "archived", projectId: "project-1", archivedAt: 123, startedAt: 20 }),
    runtime({ id: "stopped", projectId: "project-1", status: "stopped", startedAt: 10 }),
  ];

  const reusable = reusableNewRuntimeForProject(runtimes, "project-1", (runtimeId) => runtimeId === "with-message");

  assert.equal(reusable, undefined);
});

test("new conversation policy archives only unhandled blank runtimes outside the kept runtime", () => {
  const runtimes = [
    runtime({ id: "keep", projectId: "project-1" }),
    runtime({ id: "blank-duplicate", projectId: "project-1" }),
    runtime({ id: "blank-other-project", projectId: "project-2" }),
    runtime({ id: "with-session", projectId: "project-2", sessionId: "session-1" }),
    runtime({ id: "with-message", projectId: "project-2" }),
    runtime({ id: "already-archived", projectId: "project-2", archivedAt: 123 }),
  ];

  const archiveIds = unhandledNewRuntimeIdsToArchive(runtimes, "keep", (runtimeId) => runtimeId === "with-message");

  assert.deepEqual(archiveIds, ["blank-duplicate", "blank-other-project"]);
});

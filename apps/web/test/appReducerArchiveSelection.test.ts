import assert from "node:assert/strict";
import test from "node:test";
import type { Project, Runtime, ServerEvent } from "@pi-gui/shared";
import { appReducer, initialAppState } from "../src/state/appReducer";

function project(id: string): Project {
  return { id, name: id, cwd: `/tmp/${id}`, lastOpenedAt: 1 };
}

function runtime(id: string, projectId: string, status: Runtime["status"] = "stopped"): Runtime {
  return { id, projectId, cwd: `/tmp/${projectId}`, status, startedAt: 1 };
}

function hello(projects: Project[], runtimes: Runtime[]): ServerEvent {
  return { type: "hello", serverTime: 1, projects, runtimes, settings: {}, lastEventId: 0, sessions: [], conversationSummaries: [] };
}

test("archiving the selected runtime keeps the replacement selected after command success", () => {
  const archivedRuntime = { ...runtime("runtime-1", "project-1"), archivedAt: 10 };
  const withSelectedRuntime = appReducer(initialAppState, {
    type: "server.event",
    event: hello([project("project-1")], [runtime("runtime-1", "project-1"), runtime("runtime-2", "project-1")]),
  });

  const afterCommandResult = appReducer(withSelectedRuntime, {
    type: "server.event",
    event: { type: "command.result", command: "runtime.archive", success: true, data: { runtime: archivedRuntime } },
  });

  assert.equal(afterCommandResult.selectedRuntimeId, "runtime-2");
  assert.equal(afterCommandResult.selectedRuntimeIdByProject["project-1"], "runtime-2");
});

test("archiving a non-selected runtime does not clear the selected runtime", () => {
  const withSelectedRuntime = appReducer(initialAppState, {
    type: "server.event",
    event: hello([project("project-1")], [runtime("runtime-1", "project-1"), runtime("runtime-2", "project-1")]),
  });
  const selectedRuntime2 = appReducer(withSelectedRuntime, {
    type: "select.runtime",
    projectId: "project-1",
    runtimeId: "runtime-2",
  });

  const state = appReducer(selectedRuntime2, {
    type: "server.event",
    event: { type: "command.result", command: "runtime.archive", success: true, data: { runtime: { ...runtime("runtime-1", "project-1"), archivedAt: 10 } } },
  });

  assert.equal(state.selectedRuntimeId, "runtime-2");
});

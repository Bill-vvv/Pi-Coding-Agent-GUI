import assert from "node:assert/strict";
import test from "node:test";
import type { GuiSession, Project, Runtime, ServerEvent, SubagentRun } from "@pi-gui/shared";
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

function session(id: string, piSessionFile = `/tmp/${id}.jsonl`): GuiSession {
  return { id, projectId: "project-1", piSessionFile, createdAt: 1, updatedAt: 1 };
}

function subagentRun(sessionFile: string): SubagentRun {
  return {
    id: "runtime-1:subagent-1",
    projectId: "project-1",
    parentRuntimeId: "runtime-1",
    parentToolCallId: "subagent-1",
    parentToolMessageId: "tool-subagent-1",
    agent: "review-agent",
    mode: "single",
    status: "running",
    startedAt: 1,
    updatedAt: 1,
    runs: [{ id: "child-1", agent: "review-agent", status: "running", sessionFile }],
  };
}

test("hello selects an available runtime on fresh frontend load", () => {
  const state = appReducer(initialAppState, {
    type: "server.event",
    event: hello([project("project-1")], [runtime("runtime-stopped", "project-1"), runtime("runtime-running", "project-1", "running")]),
  });

  assert.equal(state.selectedProjectId, "project-1");
  assert.equal(state.selectedRuntimeId, "runtime-running");
  assert.equal(state.selectedRuntimeIdByProject["project-1"], "runtime-running");
});

test("runtime.status selects the new runtime when the active project has no selection", () => {
  const withProject = appReducer(initialAppState, {
    type: "server.event",
    event: hello([project("project-1")], []),
  });

  const state = appReducer(withProject, {
    type: "server.event",
    event: { type: "runtime.status", runtime: runtime("runtime-1", "project-1", "running") },
  });

  assert.equal(state.selectedRuntimeId, "runtime-1");
  assert.equal(state.selectedRuntimeIdByProject["project-1"], "runtime-1");
});

test("hello keeps the remembered runtime instead of focusing a newly running runtime", () => {
  const state = appReducer(
    {
      ...initialAppState,
      selectedProjectId: "project-1",
      selectedRuntimeId: "runtime-stopped",
      selectedRuntimeIdByProject: { "project-1": "runtime-stopped" },
    },
    {
      type: "server.event",
      event: hello([project("project-1")], [runtime("runtime-stopped", "project-1"), runtime("runtime-running", "project-1", "running")]),
    },
  );

  assert.equal(state.selectedRuntimeId, "runtime-stopped");
  assert.equal(state.selectedRuntimeIdByProject["project-1"], "runtime-stopped");
});

test("runtime.status keeps the selected runtime instead of focusing a newly running runtime", () => {
  const withSelectedRuntime = appReducer(initialAppState, {
    type: "server.event",
    event: hello([project("project-1")], [runtime("runtime-stopped", "project-1")]),
  });

  const state = appReducer(withSelectedRuntime, {
    type: "server.event",
    event: { type: "runtime.status", runtime: runtime("runtime-running", "project-1", "running") },
  });

  assert.equal(state.selectedRuntimeId, "runtime-stopped");
  assert.equal(state.selectedRuntimeIdByProject["project-1"], "runtime-stopped");
});

test("runtime selection prefers running over starting regardless of array order", () => {
  const state = appReducer(initialAppState, {
    type: "server.event",
    event: hello([project("project-1")], [runtime("runtime-starting", "project-1", "starting"), runtime("runtime-running", "project-1", "running")]),
  });

  assert.equal(state.selectedRuntimeId, "runtime-running");
});

test("runtime launch command success explicitly focuses the launched runtime", () => {
  const withSelectedRuntime = appReducer(initialAppState, {
    type: "server.event",
    event: hello([project("project-1")], [runtime("runtime-stopped", "project-1")]),
  });

  const state = appReducer(withSelectedRuntime, {
    type: "server.event",
    event: { type: "command.result", command: "runtime.start", success: true, data: { runtime: runtime("runtime-running", "project-1", "running") } },
  });

  assert.equal(state.selectedRuntimeId, "runtime-running");
  assert.equal(state.selectedRuntimeIdByProject["project-1"], "runtime-running");
});

test("selecting a project or runtime clears a draft composer cwd", () => {
  const baseState = appReducer(initialAppState, {
    type: "server.event",
    event: hello([project("project-1")], [runtime("runtime-1", "project-1", "running")]),
  });
  const withDraftCwd = { ...baseState, projectCwd: "/tmp/draft" };

  const afterProjectSelect = appReducer(withDraftCwd, { type: "select.project", projectId: "project-1" });
  const afterRuntimeSelect = appReducer(withDraftCwd, { type: "select.runtime", projectId: "project-1", runtimeId: "runtime-1" });

  assert.equal(afterProjectSelect.projectCwd, "");
  assert.equal(afterRuntimeSelect.projectCwd, "");
});

test("frontend session state trusts backend visibility instead of filtering subagent child files", () => {
  const childSession = session("child-session", "/tmp/child.jsonl");
  const withSession = appReducer(initialAppState, {
    type: "server.event",
    event: { type: "session.list", sessions: [childSession] },
  });

  const state = appReducer(withSession, {
    type: "server.event",
    event: { type: "subagent.run", run: subagentRun("/tmp/child.jsonl") },
  });

  assert.deepEqual(state.sessions.map((item) => item.id), ["child-session"]);
});

test("conversation snapshots trust backend hasMoreBefore instead of message count", () => {
  const state = appReducer(initialAppState, {
    type: "server.event",
    event: {
      type: "conversation.snapshot",
      runtimeId: "runtime-1",
      projectId: "project-1",
      busy: false,
      hasMoreBefore: false,
      messages: [
        {
          id: "message-1",
          runtimeId: "runtime-1",
          projectId: "project-1",
          role: "user",
          text: "only message",
          timestamp: 1,
        },
      ],
    },
  });

  assert.equal(state.messagesByRuntime["runtime-1"]?.length, 1);
  assert.equal(state.hasMoreBeforeByRuntime["runtime-1"], false);
});

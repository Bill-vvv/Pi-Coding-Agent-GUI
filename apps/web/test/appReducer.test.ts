import assert from "node:assert/strict";
import test from "node:test";
import type { GuiSession, Project, RewindCheckpointOperation, RewindCheckpointSummary, RewindGarbageCollectResult, RewindJumpHistoryEntry, RewindStorageHealth, Runtime, ServerEvent, SubagentRun } from "@pi-gui/shared";
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

function checkpoint(id: string, createdAt: number): RewindCheckpointSummary {
  return {
    id,
    projectId: "project-1",
    root: "/tmp/project-1",
    createdAt,
    capturedFiles: 1,
    capturedSymlinks: 0,
    deletedEntries: 0,
    skipped: 0,
    capturedBytes: 10,
    newBytes: 10,
  };
}

function checkpointOperation(id: number, kind: RewindCheckpointOperation["kind"], snapshotId: string): RewindCheckpointOperation {
  return { id, projectId: "project-1", kind, snapshotId, createdAt: id, ok: true };
}

function checkpointJump(id: number, snapshotId: string): RewindJumpHistoryEntry {
  return { id, projectId: "project-1", snapshotId, runtimeId: "runtime-1", targetEntryId: `entry-${id}`, createdAt: id, ok: true, resultEntryId: `result-${id}` };
}

function checkpointHealth(snapshotCount = 2): RewindStorageHealth {
  return {
    projectId: "project-1",
    snapshotCount,
    objectCount: 5,
    manifestBytes: 128,
    objectBytes: 2048,
    referencedObjectCount: 4,
    unreferencedObjectCount: 1,
    unreferencedObjectBytes: 256,
  };
}

function checkpointGcResult(): RewindGarbageCollectResult {
  return { ...checkpointHealth(1), dryRun: false, deletedObjectCount: 1, deletedObjectBytes: 256, deletedSnapshotCount: 0 };
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

test("hello stores the current execution host for host-aware session actions", () => {
  const executionHost = { kind: "wsl" as const, id: "wsl:Ubuntu", label: "WSL (Ubuntu)" };
  const state = appReducer(initialAppState, {
    type: "server.event",
    event: { ...hello([project("project-1")], []), executionHost },
  });

  assert.deepEqual(state.executionHost, executionHost);
});

test("bootstrap chunks hydrate startup state after minimal hello", () => {
  const executionHost = { kind: "wsl" as const, id: "wsl:Ubuntu", label: "WSL (Ubuntu)" };
  const projectOne = project("project-1");
  const runtimeOne = runtime("runtime-1", "project-1", "running");
  const sessionOne = session("session-1");
  const afterHello = appReducer(initialAppState, {
    type: "server.event",
    event: { type: "hello", serverTime: 1, lastEventId: 10, connectionId: "1", protocolVersion: 2 },
  });
  const afterProjects = appReducer(afterHello, {
    type: "server.event",
    event: { type: "bootstrap.chunk", connectionId: "1", scope: "projects", projects: [projectOne], executionHost },
  });
  const afterRuntimes = appReducer(afterProjects, {
    type: "server.event",
    event: { type: "bootstrap.chunk", connectionId: "1", scope: "runtimes", runtimes: [runtimeOne] },
  });
  const afterSessions = appReducer(afterRuntimes, {
    type: "server.event",
    event: { type: "bootstrap.chunk", connectionId: "1", scope: "sessions", sessions: [sessionOne], hasMore: false },
  });
  const finalState = appReducer(afterSessions, {
    type: "server.event",
    event: { type: "bootstrap.chunk", connectionId: "1", scope: "settings", settings: { defaultModel: "model-a" } },
  });

  assert.equal(finalState.selectedProjectId, "project-1");
  assert.equal(finalState.selectedRuntimeId, "runtime-1");
  assert.deepEqual(finalState.executionHost, executionHost);
  assert.deepEqual(finalState.sessions.map((item) => item.id), ["session-1"]);
  assert.equal(finalState.selectedModelKey, "model-a");
});

test("hello seeds recent checkpoint operations and jumps for reconnect recovery", () => {
  const operation = checkpointOperation(1, "restore", "snap-1");
  const jump = checkpointJump(1, "snap-1");
  const state = appReducer(initialAppState, {
    type: "server.event",
    event: { ...hello([project("project-1")], []), checkpointOperations: [operation], checkpointJumps: [jump] },
  });

  assert.deepEqual(state.checkpointOperations, [operation]);
  assert.deepEqual(state.checkpointJumpsByProject["project-1"], [jump]);
});

test("checkpoint events update checkpoint reducer state", () => {
  const withList = appReducer(initialAppState, {
    type: "server.event",
    event: { type: "checkpoint.list", projectId: "project-1", checkpoints: [checkpoint("old", 1)] },
  });
  const withCaptured = appReducer(withList, {
    type: "server.event",
    event: { type: "checkpoint.captured", projectId: "project-1", checkpoint: checkpoint("new", 2) },
  });
  const withPreview = appReducer(withCaptured, {
    type: "server.event",
    event: { type: "checkpoint.preview", projectId: "project-1", preview: { projectId: "project-1", snapshotId: "new", changes: [], summary: { add: 0, modify: 0, delete: 0, recreate: 0, overwrite: 0, unchanged: 0, skip: 0, conflict: 0 } } },
  });
  const withRestore = appReducer(withPreview, {
    type: "server.event",
    event: { type: "checkpoint.restored", projectId: "project-1", result: { projectId: "project-1", snapshotId: "new", ok: true, applied: [] } },
  });
  const withOperation = appReducer(withRestore, {
    type: "server.event",
    event: { type: "checkpoint.operation", operation: checkpointOperation(2, "capture", "new") },
  });
  const withJumps = appReducer(withOperation, {
    type: "server.event",
    event: { type: "checkpoint.jumps", projectId: "project-1", jumps: [checkpointJump(2, "new")] },
  });
  const withHealth = appReducer(withJumps, {
    type: "server.event",
    event: { type: "checkpoint.health", projectId: "project-1", health: checkpointHealth() },
  });
  const finalState = appReducer(withHealth, {
    type: "server.event",
    event: { type: "checkpoint.gc", projectId: "project-1", result: checkpointGcResult() },
  });

  assert.deepEqual(finalState.checkpointsByProject["project-1"]?.map((item) => item.id), ["new", "old"]);
  assert.equal(finalState.checkpointPreviewsBySnapshot["new"]?.snapshotId, "new");
  assert.equal(finalState.checkpointRestoreResultsBySnapshot["new"]?.ok, true);
  assert.deepEqual(finalState.checkpointOperations.map((operation) => operation.id), [2]);
  assert.deepEqual(finalState.checkpointJumpsByProject["project-1"]?.map((jump) => jump.id), [2]);
  assert.equal(finalState.checkpointHealthByProject["project-1"]?.snapshotCount, 1);
  assert.equal(finalState.checkpointGcResultsByProject["project-1"]?.deletedObjectCount, 1);
  assert.match(finalState.notice ?? "", /已清理 Rewind 存储/);
});

test("git.status updates reducer state by project", () => {
  const state = appReducer(initialAppState, {
    type: "server.event",
    event: {
      type: "git.status",
      status: {
        projectId: "project-1",
        available: true,
        branch: "feat/branch-visibility",
        defaultBranch: "main",
        changedFiles: 2,
      },
    },
  });

  assert.equal(state.gitStatusByProject["project-1"]?.branch, "feat/branch-visibility");
  assert.equal(state.gitStatusByProject["project-1"]?.defaultBranch, "main");
});

test("event replay gap surfaces partial recovery and resync state", () => {
  const state = appReducer(initialAppState, {
    type: "server.event",
    event: {
      type: "event.replay.gap",
      requestedSinceEventId: 10,
      firstAvailableEventId: 20,
      lastEventId: 30,
      replayedEvents: 11,
      reason: "pruned",
    },
  });

  assert.match(state.notice ?? "", /较早事件已被清理/);
  assert.match(state.notice ?? "", /重新同步/);
  assert.equal(state.replayRecovery?.status, "degraded");
  assert.equal(state.replayRecovery?.gap.lastEventId, 30);
});

test("event replay stale cursor gap explains snapshot recovery", () => {
  const state = appReducer(initialAppState, {
    type: "server.event",
    event: {
      type: "event.replay.gap",
      requestedSinceEventId: 100,
      lastEventId: 30,
      replayedEvents: 0,
      reason: "stale_cursor",
    },
  });

  assert.match(state.notice ?? "", /回放游标已过期/);
  assert.match(state.notice ?? "", /重新同步/);
});

test("event replay gap resync request and snapshot clear recovery state", () => {
  const degraded = appReducer(initialAppState, {
    type: "server.event",
    event: {
      type: "event.replay.gap",
      requestedSinceEventId: 10,
      lastEventId: 30,
      replayedEvents: 0,
      reason: "truncated",
    },
  });

  const resyncing = appReducer(degraded, { type: "replayRecovery.resyncRequested", sequence: degraded.replayRecovery?.sequence ?? 0 });
  assert.equal(resyncing.replayRecovery?.status, "resyncing");

  const cleared = appReducer(resyncing, {
    type: "server.event",
    event: { type: "session.list", sessions: [], hasMore: false },
  });
  assert.equal(cleared.replayRecovery, undefined);
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

test("conversation pages increment a per-runtime page signal even when no new messages are prepended", () => {
  const withSnapshot = appReducer(initialAppState, {
    type: "server.event",
    event: {
      type: "conversation.snapshot",
      runtimeId: "runtime-1",
      projectId: "project-1",
      busy: false,
      hasMoreBefore: true,
      messages: [
        {
          id: "message-1",
          runtimeId: "runtime-1",
          projectId: "project-1",
          role: "assistant",
          text: "loaded",
          timestamp: 1,
        },
      ],
    },
  });

  const afterPage = appReducer(withSnapshot, {
    type: "server.event",
    event: {
      type: "conversation.page",
      runtimeId: "runtime-1",
      projectId: "project-1",
      beforeMessageId: "message-1",
      hasMoreBefore: false,
      messages: [
        {
          id: "message-1",
          runtimeId: "runtime-1",
          projectId: "project-1",
          role: "assistant",
          text: "loaded",
          timestamp: 1,
        },
      ],
    },
  });

  assert.equal(afterPage.pageSignalsByRuntime["runtime-1"], 1);
  assert.notEqual(afterPage.messagesByRuntime["runtime-1"], withSnapshot.messagesByRuntime["runtime-1"]);
  assert.deepEqual(afterPage.messagesByRuntime["runtime-1"]?.map((item) => item.id), ["message-1"]);
});

test("conversation pages are ignored when the requested anchor is no longer in the working set", () => {
  const withSnapshot = appReducer(initialAppState, {
    type: "server.event",
    event: {
      type: "conversation.snapshot",
      runtimeId: "runtime-1",
      projectId: "project-1",
      busy: false,
      hasMoreBefore: true,
      messages: [
        {
          id: "message-2",
          runtimeId: "runtime-1",
          projectId: "project-1",
          role: "assistant",
          text: "loaded",
          timestamp: 2,
        },
      ],
    },
  });

  const afterStalePage = appReducer(withSnapshot, {
    type: "server.event",
    event: {
      type: "conversation.page",
      runtimeId: "runtime-1",
      projectId: "project-1",
      beforeMessageId: "missing-anchor",
      hasMoreBefore: false,
      messages: [
        {
          id: "message-1",
          runtimeId: "runtime-1",
          projectId: "project-1",
          role: "assistant",
          text: "stale older page",
          timestamp: 1,
        },
      ],
    },
  });

  assert.equal(afterStalePage, withSnapshot);
});

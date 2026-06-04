import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Runtime, ServerEvent, SubagentRun } from "@pi-gui/shared";
import { AppDatabase } from "../src/db.js";
import { parseSubagentChildSession } from "../src/runtime/subagent/childSessionParser.js";
import { aggregateSubagentStatus } from "../src/runtime/subagent/subagentProgress.js";
import { SubagentRunProjection } from "../src/runtime/subagent/subagentRunProjection.js";

function createDb() {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-subagent-"));
  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  const runtime: Runtime = { id: "runtime-1", projectId: "project-1", cwd: dir, status: "running", pid: 101, startedAt: 1 };
  db.createProject({ id: runtime.projectId, name: "Project", cwd: dir, lastOpenedAt: 1 });
  db.upsertRuntime(runtime);
  return { dir, db, runtime };
}

function subagentRun(overrides: Partial<SubagentRun> = {}): SubagentRun {
  return {
    id: "runtime-1:subagent-1",
    projectId: "project-1",
    parentRuntimeId: "runtime-1",
    parentToolCallId: "subagent-1",
    parentToolMessageId: "tool-subagent-1",
    agent: "trellis-check",
    mode: "single",
    status: "running",
    startedAt: 100,
    updatedAt: 100,
    runs: [],
    ...overrides,
  };
}

test("AppDatabase persists subagent runs and marks orphaned running rows failed on startup", () => {
  const { dir, db } = createDb();
  db.upsertSubagentRun(subagentRun());

  assert.equal(db.listActiveSubagentRuns().length, 1);
  assert.equal(db.getSubagentRunByParentToolCall("runtime-1", "subagent-1")?.parentToolMessageId, "tool-subagent-1");
  db.close();

  const reopened = new AppDatabase(join(dir, "pi-gui.sqlite"));
  const run = reopened.getSubagentRun("runtime-1:subagent-1");
  assert.equal(run?.status, "failed");
  assert.match(run?.errorMessage ?? "", /GUI server restarted/);
  assert.equal(reopened.listActiveSubagentRuns().length, 0);
  reopened.close();
});

test("AppDatabase hides child subagent sessions from ordinary session lists", () => {
  const { db } = createDb();
  db.upsertSession({ id: "parent-session", projectId: "project-1", piSessionFile: "/tmp/parent.jsonl", createdAt: 1, updatedAt: 2 });
  db.upsertSession({ id: "child-session", projectId: "project-1", piSessionFile: "/tmp/child.jsonl", createdAt: 3, updatedAt: 4 });
  db.upsertSubagentRun(subagentRun({
    status: "succeeded",
    finishedAt: 5,
    runs: [{ id: "trellis-check-1", agent: "trellis-check", status: "succeeded", sessionFile: "/tmp/child.jsonl" }],
  }));

  assert.deepEqual(db.listSessions().map((session) => session.id), ["parent-session"]);
  db.close();
});

test("aggregateSubagentStatus stays active while parallel children are still running", () => {
  const runs: SubagentRun["runs"] = [
    { id: "trellis-check-1", agent: "trellis-check", status: "failed", errorMessage: "failed" },
    { id: "trellis-check-2", agent: "trellis-check", status: "running" },
  ];

  assert.equal(aggregateSubagentStatus(runs, "running", false), "running");
  assert.equal(aggregateSubagentStatus(runs, "running", true), "failed");
});

test("SubagentRunProjection accepts progress details even when the start event was missed", () => {
  const { db, runtime } = createDb();
  const events: ServerEvent[] = [];
  const projection = new SubagentRunProjection(db, () => runtime, (event) => events.push(event));

  projection.handlePiPayload({
    type: "tool_execution_update",
    toolCallId: "subagent-progress-only",
    partialResult: {
      details: {
        kind: "trellis-subagent-progress",
        agent: "trellis-check",
        mode: "single",
        final: false,
        runs: [{ id: "trellis-check-1", agent: "trellis-check", status: "running", sessionFile: "/tmp/child.jsonl" }],
      },
    },
  });

  const run = db.getSubagentRun("runtime-1:subagent-progress-only");
  assert.equal(run?.agent, "trellis-check");
  assert.equal(run?.status, "running");
  assert.equal(run?.parentToolMessageId, "tool-subagent-progress-only");
  assert.equal(run?.runs[0]?.sessionFile, "/tmp/child.jsonl");
  assert.ok(events.some((event) => event.type === "subagent.run" && event.run.id === "runtime-1:subagent-progress-only"));
  db.close();
});

test("SubagentRunProjection preserves existing child fields across partial progress updates", () => {
  const { db, runtime } = createDb();
  const projection = new SubagentRunProjection(db, () => runtime, () => undefined);

  projection.handlePiPayload({
    type: "tool_execution_start",
    toolCallId: "subagent-partial",
    toolName: "trellis_subagent",
    args: { agent: "trellis-check", mode: "single" },
  });
  projection.handlePiPayload({
    type: "tool_execution_update",
    toolCallId: "subagent-partial",
    partialResult: {
      details: {
        kind: "trellis-subagent-progress",
        agent: "trellis-check",
        mode: "single",
        final: false,
        runs: [{ id: "trellis-check-1", agent: "trellis-check", status: "running", sessionFile: "/tmp/child.jsonl" }],
      },
    },
  });
  projection.handlePiPayload({
    type: "tool_execution_update",
    toolCallId: "subagent-partial",
    partialResult: {
      details: {
        kind: "trellis-subagent-progress",
        agent: "trellis-check",
        mode: "single",
        final: false,
        runs: [{ id: "trellis-check-1", agent: "trellis-check", status: "running", textTail: "latest tail" }],
      },
    },
  });

  const run = db.getSubagentRun("runtime-1:subagent-partial");
  assert.equal(run?.runs[0]?.sessionFile, "/tmp/child.jsonl");
  assert.equal(run?.runs[0]?.textTail, "latest tail");
  db.close();
});

test("SubagentRunProjection normalizes trellis_subagent progress details", () => {
  const { db, runtime } = createDb();
  const events: ServerEvent[] = [];
  const projection = new SubagentRunProjection(db, () => runtime, (event) => events.push(event));

  projection.handlePiPayload({
    type: "tool_execution_start",
    toolCallId: "subagent-1",
    toolName: "trellis_subagent",
    args: { agent: "trellis-check", mode: "parallel" },
  });
  projection.handlePiPayload({
    type: "tool_execution_end",
    toolCallId: "subagent-1",
    toolName: "trellis_subagent",
    result: {
      content: [{ type: "text", text: "final report" }],
      details: {
        kind: "trellis-subagent-progress",
        agent: "trellis-check",
        mode: "parallel",
        contextMode: "isolated",
        final: true,
        startedAt: 100,
        updatedAt: 200,
        runs: [
          {
            id: "trellis-check-1",
            agent: "trellis-check",
            status: "succeeded",
            startedAt: 110,
            finishedAt: 190,
            finalText: "child final",
            sessionFile: "/tmp/child.jsonl",
            tools: [{ id: "tool-1", name: "read", args: "README.md", status: "succeeded", startedAt: 120, finishedAt: 130 }],
            usage: { input: 1, output: 2, turns: 1 },
          },
        ],
      },
    },
  });

  const run = db.getSubagentRun("runtime-1:subagent-1");
  assert.equal(run?.status, "succeeded");
  assert.equal(run?.agent, "trellis-check");
  assert.equal(run?.mode, "parallel");
  assert.equal(run?.contextMode, "isolated");
  assert.equal(run?.parentToolMessageId, "tool-subagent-1");
  assert.equal(run?.finalText, "final report");
  assert.equal(run?.runs[0]?.finalText, "child final");
  assert.equal(run?.runs[0]?.tools?.[0]?.name, "read");
  assert.ok(events.some((event) => event.type === "subagent.run" && event.run.status === "running"));
  assert.ok(events.some((event) => event.type === "subagent.run" && event.run.status === "succeeded"));
  db.close();
});

test("parseSubagentChildSession reads child Pi session JSONL into conversation messages", () => {
  const { dir, db } = createDb();
  const sessionFile = join(dir, "child-session.jsonl");
  writeFileSync(
    sessionFile,
    [
      JSON.stringify({ type: "session", id: "child-session", cwd: dir }),
      JSON.stringify({ type: "message", message: { id: "user-1", role: "user", content: "请检查代码", timestamp: 100 } }),
      JSON.stringify({ type: "tool_execution_start", toolCallId: "read-1", toolName: "read" }),
      JSON.stringify({ type: "tool_execution_end", toolCallId: "read-1", toolName: "read", result: "README.md", timestamp: 101 }),
      JSON.stringify({ type: "message", message: { id: "assistant-1", role: "assistant", content: [{ type: "thinking", thinking: "分析" }, { type: "text", text: "检查完成" }], timestamp: 102 } }),
    ].join("\n"),
    "utf8",
  );

  const detail = parseSubagentChildSession(
    subagentRun({
      runs: [{ id: "trellis-check-1", agent: "trellis-check", status: "succeeded", sessionFile, finalText: "检查完成" }],
    }),
    "trellis-check-1",
  );

  assert.equal(detail.error, undefined);
  assert.deepEqual(detail.messages.map((message) => message.role), ["user", "tool", "assistant"]);
  assert.equal(detail.messages[0]?.runtimeId, "subagent:runtime-1:subagent-1:trellis-check-1");
  assert.equal(detail.messages[1]?.title, "read 完成");
  assert.equal(detail.messages[1]?.text, "README.md");
  assert.equal(detail.messages[2]?.thinking, "分析");
  assert.equal(detail.messages[2]?.text, "检查完成");
  db.close();
});

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Runtime, ServerEvent, SubagentRun } from "@pi-gui/shared";
import { AppDatabase } from "../src/db.js";
import { parseSubagentChildSession, SubagentChildSessionCache } from "../src/runtime/subagent/childSessionParser.js";
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

test("AppDatabase hides child subagent sessions beyond recent run windows", () => {
  const { db } = createDb();
  db.upsertSession({ id: "parent-session", projectId: "project-1", piSessionFile: "/tmp/parent.jsonl", createdAt: 1, updatedAt: 2 });
  db.upsertSession({ id: "old-child-session", projectId: "project-1", piSessionFile: "/tmp/old-child.jsonl", createdAt: 1, updatedAt: 1 });
  db.upsertSubagentRun(subagentRun({
    id: "runtime-1:old-subagent",
    parentToolCallId: "old-subagent",
    parentToolMessageId: "tool-old-subagent",
    status: "succeeded",
    updatedAt: 1,
    finishedAt: 1,
    runs: [{ id: "trellis-check-old", agent: "trellis-check", status: "succeeded", sessionFile: "/tmp/old-child.jsonl" }],
  }));

  for (let index = 0; index < 2000; index += 1) {
    db.upsertSubagentRun(subagentRun({
      id: `runtime-1:newer-subagent-${index}`,
      parentToolCallId: `newer-subagent-${index}`,
      parentToolMessageId: `tool-newer-subagent-${index}`,
      status: "succeeded",
      updatedAt: 10 + index,
      finishedAt: 10 + index,
      runs: [],
    }));
  }

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

test("aggregateSubagentStatus keeps all-succeeded progress running until final", () => {
  const runs: SubagentRun["runs"] = [
    { id: "trellis-check-1", agent: "trellis-check", status: "succeeded" },
    { id: "trellis-check-2", agent: "trellis-check", status: "succeeded" },
  ];

  assert.equal(aggregateSubagentStatus(runs, "running", false), "running");
  assert.equal(aggregateSubagentStatus(runs, "running", true), "succeeded");
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
  assert.equal(run?.finalText, undefined);
  assert.equal(run?.runs[0]?.sessionFile, "/tmp/child.jsonl");
  assert.ok(events.some((event) => event.type === "subagent.run" && event.run.id === "runtime-1:subagent-progress-only"));
  db.close();
});

test("SubagentRunProjection ignores Trellis payloads when no progress adapter is registered", () => {
  const { db, runtime } = createDb();
  const events: ServerEvent[] = [];
  const projection = new SubagentRunProjection(db, () => runtime, (event) => events.push(event), []);

  projection.handlePiPayload({
    type: "tool_execution_update",
    toolCallId: "subagent-disabled",
    toolName: "trellis_subagent",
    partialResult: {
      details: {
        kind: "trellis-subagent-progress",
        agent: "trellis-check",
        mode: "single",
        runs: [{ id: "trellis-check-1", agent: "trellis-check", status: "running" }],
      },
    },
  });

  assert.equal(db.getSubagentRun("runtime-1:subagent-disabled"), undefined);
  assert.equal(events.length, 0);
  db.close();
});

test("SubagentRunProjection keeps child finals out of parent finalText until final", () => {
  const { db, runtime } = createDb();
  const projection = new SubagentRunProjection(db, () => runtime, () => undefined);

  projection.handlePiPayload({
    type: "tool_execution_update",
    toolCallId: "subagent-child-final-progress",
    partialResult: {
      details: {
        kind: "trellis-subagent-progress",
        agent: "trellis-check",
        mode: "single",
        final: false,
        runs: [{ id: "trellis-check-1", agent: "trellis-check", status: "succeeded", finalText: "child final" }],
      },
    },
  });

  const run = db.getSubagentRun("runtime-1:subagent-child-final-progress");
  assert.equal(run?.status, "running");
  assert.equal(run?.runs[0]?.finalText, "child final");
  assert.equal(run?.finalText, undefined);

  projection.handlePiPayload({
    type: "tool_execution_update",
    toolCallId: "subagent-child-final-progress",
    partialResult: {
      details: {
        kind: "trellis-subagent-progress",
        agent: "trellis-check",
        mode: "single",
        final: true,
        runs: [{ id: "trellis-check-1", agent: "trellis-check", status: "succeeded", finalText: "child final" }],
      },
    },
  });

  const finalRun = db.getSubagentRun("runtime-1:subagent-child-final-progress");
  assert.equal(finalRun?.status, "succeeded");
  assert.equal(finalRun?.finalText, "child final");
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

test("SubagentChildSessionCache reads appended child session content incrementally", () => {
  const { db } = createDb();
  const sessionFile = join(mkdtempSync(join(tmpdir(), "pi-gui-child-session-")), "child.jsonl");
  writeFileSync(sessionFile, JSON.stringify({ type: "message", message: { id: "user-1", role: "user", content: "first", timestamp: 1 } }) + "\n");
  const run = subagentRun({ runs: [{ id: "child-1", agent: "trellis-check", status: "running", sessionFile }] });
  const cache = new SubagentChildSessionCache();

  const first = cache.parse(run, "child-1", 10);
  writeFileSync(sessionFile, JSON.stringify({ type: "message", message: { id: "user-1", role: "user", content: "first", timestamp: 1 } }) + "\n" + JSON.stringify({ type: "message", message: { id: "assistant-1", role: "assistant", content: "second", timestamp: 2 } }) + "\n");
  const second = cache.parse(run, "child-1", 10);

  assert.deepEqual(first.messages.map((message) => message.text), ["first"]);
  assert.deepEqual(second.messages.map((message) => message.text), ["first", "second"]);
  db.close();
});

test("SubagentChildSessionCache preserves partial trailing JSONL lines until completion", () => {
  const { db } = createDb();
  const sessionFile = join(mkdtempSync(join(tmpdir(), "pi-gui-child-session-")), "child.jsonl");
  const firstLine = JSON.stringify({ type: "message", message: { id: "user-1", role: "user", content: "first", timestamp: 1 } }) + "\n";
  const secondLine = JSON.stringify({ type: "message", message: { id: "assistant-1", role: "assistant", content: "second", timestamp: 2 } }) + "\n";
  writeFileSync(sessionFile, firstLine + secondLine.slice(0, 32));
  const run = subagentRun({ runs: [{ id: "child-1", agent: "trellis-check", status: "running", sessionFile }] });
  const cache = new SubagentChildSessionCache();

  const partial = cache.parse(run, "child-1", 10);
  writeFileSync(sessionFile, firstLine + secondLine);
  const completed = cache.parse(run, "child-1", 10);

  assert.deepEqual(partial.messages.map((message) => message.text), ["first"]);
  assert.deepEqual(completed.messages.map((message) => message.text), ["first", "second"]);
  db.close();
});

test("SubagentChildSessionCache reparses after child session file shrink", () => {
  const { db } = createDb();
  const sessionFile = join(mkdtempSync(join(tmpdir(), "pi-gui-child-session-")), "child.jsonl");
  const firstLine = JSON.stringify({ type: "message", message: { id: "user-1", role: "user", content: "first", timestamp: 1 } }) + "\n";
  const secondLine = JSON.stringify({ type: "message", message: { id: "assistant-1", role: "assistant", content: "second", timestamp: 2 } }) + "\n";
  writeFileSync(sessionFile, firstLine + secondLine);
  const run = subagentRun({ runs: [{ id: "child-1", agent: "trellis-check", status: "running", sessionFile }] });
  const cache = new SubagentChildSessionCache();

  const full = cache.parse(run, "child-1", 10);
  writeFileSync(sessionFile, secondLine);
  const reparsed = cache.parse(run, "child-1", 10);

  assert.deepEqual(full.messages.map((message) => message.text), ["first", "second"]);
  assert.deepEqual(reparsed.messages.map((message) => message.text), ["second"]);
  db.close();
});

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ServerEvent, SubagentRun } from "@pi-gui/shared";
import { AppDatabase } from "../src/db.js";
import type { ManagedRuntime } from "../src/runtime/managedRuntime.js";
import { RuntimeSessionLinker } from "../src/runtime/runtimeSessionLinker.js";

function managedRuntime(cwd: string, sessionId?: string): ManagedRuntime {
  return {
    runtime: {
      id: "runtime-1",
      projectId: "project-1",
      cwd,
      status: "running",
      startedAt: 1,
      sessionId,
    },
  } as ManagedRuntime;
}

function subagentRunWithChildSession(sessionFile: string): SubagentRun {
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

test("runtime session linker does not index empty Pi sessions", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-runtime-session-linker-empty-"));
  const sessionFile = join(dir, "empty-session.jsonl");
  writeFileSync(sessionFile, JSON.stringify({ type: "session", id: "empty-session", cwd: dir }) + "\n", "utf8");
  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  db.createProject({ id: "project-1", name: "Project", cwd: dir, lastOpenedAt: 1 });
  const events: ServerEvent[] = [];
  const linker = new RuntimeSessionLinker(db, (event) => events.push(event), new Map());

  linker.indexSessionFromPiResponse(managedRuntime(dir, "empty-session"), { sessionId: "empty-session", sessionFile });

  assert.equal(db.getSession("empty-session"), undefined);
  assert.deepEqual(events, []);
  db.close();
});

test("runtime session linker does not broadcast hidden child subagent session updates", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-runtime-session-linker-child-"));
  const sessionFile = join(dir, "child-session.jsonl");
  writeFileSync(
    sessionFile,
    [
      JSON.stringify({ type: "session", id: "child-session", cwd: dir }),
      JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "child task" }] } }),
    ].join("\n"),
    "utf8",
  );
  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  db.createProject({ id: "project-1", name: "Project", cwd: dir, lastOpenedAt: 1 });
  db.upsertSubagentRun(subagentRunWithChildSession(sessionFile));
  const events: ServerEvent[] = [];
  const linker = new RuntimeSessionLinker(db, (event) => events.push(event), new Map());

  linker.indexSessionFromPiResponse(managedRuntime(dir, "child-session"), { sessionId: "child-session", sessionFile });

  assert.equal(db.getSession("child-session")?.title, "child task");
  assert.deepEqual(db.listSessions().map((session) => session.id), []);
  assert.deepEqual(events, []);
  db.close();
});

test("runtime session linker indexes Pi sessions once conversation content exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-runtime-session-linker-content-"));
  const sessionFile = join(dir, "content-session.jsonl");
  writeFileSync(
    sessionFile,
    [
      JSON.stringify({ type: "session", id: "content-session", cwd: dir }),
      JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "请检查这个项目" }] } }),
    ].join("\n"),
    "utf8",
  );
  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  db.createProject({ id: "project-1", name: "Project", cwd: dir, lastOpenedAt: 1 });
  const events: ServerEvent[] = [];
  const linker = new RuntimeSessionLinker(db, (event) => events.push(event), new Map());

  linker.indexSessionFromPiResponse(managedRuntime(dir, "content-session"), { sessionId: "content-session", sessionFile });

  const session = db.getSession("content-session");
  assert.equal(session?.title, "请检查这个项目");
  assert.equal(session?.runtimeId, "runtime-1");
  assert.equal(events[0]?.type, "session.updated");
  db.close();
});

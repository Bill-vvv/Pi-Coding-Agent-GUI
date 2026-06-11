import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ServerEvent } from "@pi-gui/shared";
import { AppDatabase } from "../src/db.js";
import { RuntimeSupervisor } from "../src/runtime/runtimeSupervisor.js";

function createHarness() {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-runtime-config-"));
  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  const broadcasted: ServerEvent[] = [];
  const supervisor = new RuntimeSupervisor(db, (event) => broadcasted.push(event));
  return { db, supervisor, broadcasted };
}

test("RuntimeSupervisor persists runtime.configure for stopped runtimes", () => {
  const { db, supervisor, broadcasted } = createHarness();
  db.createProject({ id: "project-1", name: "Project", cwd: process.cwd(), lastOpenedAt: 1 });
  db.upsertRuntime({
    id: "runtime-1",
    projectId: "project-1",
    cwd: process.cwd(),
    status: "stopped",
    sessionId: "session-1",
    startedAt: 100,
    model: "openai-codex/gpt-5.2",
    thinkingLevel: "medium",
    responseMode: "normal",
  });

  supervisor.configureRuntime("runtime-1", {
    modelProvider: "openai-codex",
    modelId: "gpt-5.4",
    thinkingLevel: "high",
    responseMode: "fast",
  });

  const runtime = db.getRuntime("runtime-1");
  assert.equal(runtime?.model, "openai-codex/gpt-5.4");
  assert.equal(runtime?.thinkingLevel, "high");
  assert.equal(runtime?.responseMode, "fast");
  assert.ok(broadcasted.some((event) => event.type === "runtime.status" && event.runtime.id === "runtime-1" && event.runtime.model === "openai-codex/gpt-5.4"));
  db.close();
});

test("RuntimeSupervisor runtime.configure preserves omitted runtime config fields", () => {
  const { db, supervisor } = createHarness();
  db.createProject({ id: "project-1", name: "Project", cwd: process.cwd(), lastOpenedAt: 1 });
  db.upsertRuntime({
    id: "runtime-1",
    projectId: "project-1",
    cwd: process.cwd(),
    status: "stopped",
    sessionId: "session-1",
    startedAt: 100,
    model: "openai-codex/gpt-5.2",
    thinkingLevel: "medium",
    responseMode: "normal",
  });

  supervisor.configureRuntime("runtime-1", { thinkingLevel: "xhigh" });

  const runtime = db.getRuntime("runtime-1");
  assert.equal(runtime?.model, "openai-codex/gpt-5.2");
  assert.equal(runtime?.thinkingLevel, "xhigh");
  assert.equal(runtime?.responseMode, "normal");
  db.close();
});

test("RuntimeSupervisor rejects resume when the Pi session file is unsafe to send to provider", () => {
  const { db, supervisor } = createHarness();
  const cwd = mkdtempSync(join(tmpdir(), "pi-gui-unsafe-pi-session-"));
  const sessionFile = join(cwd, "2026-06-08T00-00-00_unsafe-session.jsonl");
  writeFileSync(sessionFile, `${JSON.stringify({ type: "message", message: { role: "toolResult", content: [{ type: "image", data: "a".repeat(17 * 1024 * 1024) }] } })}\n`, "utf8");
  db.createProject({ id: "project-1", name: "Project", cwd, lastOpenedAt: 1 });
  db.upsertSession({ id: "unsafe-session", projectId: "project-1", piSessionFile: sessionFile, createdAt: 1, updatedAt: 1 });
  db.upsertRuntime({
    id: "runtime-1",
    projectId: "project-1",
    cwd,
    status: "crashed",
    sessionId: "unsafe-session",
    startedAt: 100,
  });

  assert.throws(
    () => supervisor.resumeRuntime("runtime-1"),
    /Pi session is too large to resume safely.*WebSocket 1009.*sanitize-pi-session/s,
  );
  db.close();
});

test("RuntimeSupervisor rejects prompt when the running Pi session file is unsafe to send to provider", async () => {
  const { db, supervisor } = createHarness();
  const cwd = mkdtempSync(join(tmpdir(), "pi-gui-unsafe-running-session-"));
  const sessionFile = join(cwd, "2026-06-08T00-00-00_running-unsafe.jsonl");
  writeFileSync(sessionFile, `${JSON.stringify({ type: "message", message: { role: "toolResult", content: [{ type: "image", data: "a".repeat(17 * 1024 * 1024) }] } })}\n`, "utf8");
  db.createProject({ id: "project-1", name: "Project", cwd, lastOpenedAt: 1 });
  db.upsertSession({ id: "running-unsafe", projectId: "project-1", piSessionFile: sessionFile, createdAt: 1, updatedAt: 1, runtimeId: "runtime-1" });
  const runtime = db.upsertRuntime({ id: "runtime-1", projectId: "project-1", cwd, status: "running", sessionId: "running-unsafe", startedAt: 100 });
  const logs: Array<{ role: string; text: string; title?: string }> = [];
  (supervisor as unknown as { runtimes: Map<string, unknown> }).runtimes.set("runtime-1", {
    runtime,
    projection: {
      appendLog: (role: string, text: string, title?: string) => logs.push({ role, text, title }),
      markBusy: () => undefined,
    },
    pendingNativeRpcCommands: new Map(),
  });

  await assert.rejects(
    () => supervisor.prompt("runtime-1", "continue"),
    /Pi session is too large to resume safely.*WebSocket 1009.*sanitize-pi-session/s,
  );
  assert.equal(logs.at(-1)?.title, "session safety");
  db.close();
});

test("RuntimeSupervisor captures a rewind checkpoint before sending a prompt", async (t) => {
  const { db, supervisor, broadcasted } = createHarness();
  const cwd = mkdtempSync(join(tmpdir(), "pi-gui-prompt-checkpoint-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  db.createProject({ id: "project-1", name: "Project", cwd, lastOpenedAt: 1 });
  writeFileSync(join(cwd, "before.txt"), "before", "utf8");
  const runtime = db.upsertRuntime({ id: "runtime-1", projectId: "project-1", cwd, status: "running", startedAt: 100, sessionId: "session-1" });
  const sentCommands: unknown[] = [];
  (supervisor as unknown as { runtimes: Map<string, unknown> }).runtimes.set("runtime-1", {
    runtime,
    client: { send: (command: unknown) => sentCommands.push(command) },
    projection: {
      appendUserInput: () => undefined,
      markBusy: () => undefined,
    },
    pendingNativeRpcCommands: new Map(),
  });

  await supervisor.prompt("runtime-1", "continue");

  assert.equal(sentCommands.length, 1);
  assert.equal(db.listRewindCheckpoints("project-1").length, 1);
  const checkpoint = db.listRewindCheckpoints("project-1")[0];
  assert.ok(checkpoint);
  assert.deepEqual(db.getRewindCheckpointConversationLink("project-1", checkpoint.id), {
    projectId: "project-1",
    snapshotId: checkpoint.id,
    runtimeId: "runtime-1",
    sessionId: "session-1",
    targetEntryId: undefined,
    captureSource: "prompt",
    createdAt: checkpoint.createdAt,
  });
  assert.ok(broadcasted.some((event) => event.type === "checkpoint.captured" && event.checkpoint.capturedFiles === 1));
  assert.ok(db.listRecentEvents(10, { runtimeId: "runtime-1", kinds: ["checkpoint"] }).some((event) => event.kind === "checkpoint"));
  db.close();
});

test("RuntimeSupervisor rejects resume when the Pi session file is missing", () => {
  const { db, supervisor } = createHarness();
  const cwd = mkdtempSync(join(tmpdir(), "pi-gui-missing-pi-session-"));
  db.createProject({ id: "project-1", name: "Project", cwd, lastOpenedAt: 1 });
  db.upsertRuntime({
    id: "runtime-1",
    projectId: "project-1",
    cwd,
    status: "crashed",
    sessionId: "missing-session-id",
    startedAt: 100,
    model: "openai-codex/gpt-5.2",
    thinkingLevel: "medium",
    responseMode: "normal",
  });

  assert.throws(
    () => supervisor.resumeRuntime("runtime-1"),
    /Pi session file not found for 'missing-session-id'.*Start a new conversation/s,
  );
  db.close();
});

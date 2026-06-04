import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ClientCommand, ServerEvent } from "@pi-gui/shared";
import { AppDatabase } from "../src/db.js";
import type { RuntimeSupervisor } from "../src/runtime/runtimeSupervisor.js";
import { createSocketMessageHandler } from "../src/ws/commandHandler.js";
import type { WsClient } from "../src/ws/wsHub.js";

function createHarness(supervisorOverrides: Partial<RuntimeSupervisor> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-command-"));
  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  const sent: ServerEvent[] = [];
  const broadcasted: ServerEvent[] = [];
  const socket: WsClient = {
    send: () => undefined,
    on: () => undefined,
  };
  const supervisor = supervisorOverrides as RuntimeSupervisor;
  const handle = createSocketMessageHandler({
    db,
    supervisor,
    send: (_socket, event) => sent.push(event),
    broadcast: (event) => broadcasted.push(event),
  });
  return { db, sent, broadcasted, socket, handle };
}

async function sendCommand(handle: (socket: WsClient, data: Buffer | string) => Promise<void>, socket: WsClient, command: ClientCommand | Record<string, unknown> | string) {
  await handle(socket, typeof command === "string" ? command : JSON.stringify(command));
}

function writeCheckpointStore(cwd: string, records: unknown[]): void {
  const dir = join(cwd, ".pi", "rewind");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "checkpoints.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

test("command handler rejects invalid JSON commands with an unknown command result", async () => {
  const { db, sent, socket, handle } = createHarness();

  await sendCommand(handle, socket, "not-json");

  assert.equal(sent.length, 1);
  const result = sent[0];
  assert.equal(result?.type, "command.result");
  assert.equal(result.command, "unknown");
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /not-json|Unexpected token|JSON/);
  db.close();
});

test("command handler creates projects only for valid directory cwd", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-project-"));
  const { db, sent, broadcasted, socket, handle } = createHarness();

  await sendCommand(handle, socket, { type: "project.create", requestId: "req-1", cwd: projectDir });

  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.equal(result?.requestId, "req-1");
  assert.equal(db.listProjects().length, 1);
  assert.equal(db.listProjects()[0]?.cwd, projectDir);
  assert.ok(broadcasted.some((event) => event.type === "project.created" && event.project.cwd === projectDir));
  assert.ok(broadcasted.some((event) => event.type === "project.list" && event.projects.length === 1));
  db.close();
});

test("command handler returns command.result errors for invalid project cwd", async () => {
  const { db, sent, socket, handle } = createHarness();

  await sendCommand(handle, socket, { type: "project.create", requestId: "req-2", cwd: join(tmpdir(), "missing-pi-gui-dir") });

  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, false);
  assert.equal(result?.requestId, "req-2");
  assert.match(result?.error ?? "", /no such file or directory|ENOENT/);
  assert.equal(db.listProjects().length, 0);
  db.close();
});

test("command handler lists sessions with optional project filtering", async () => {
  const { db, sent, socket, handle } = createHarness();
  db.createProject({ id: "project-1", name: "Project", cwd: process.cwd(), lastOpenedAt: 1 });
  db.upsertSession({ id: "session-1", projectId: "project-1", piSessionFile: "/tmp/session-1.jsonl", createdAt: 1, updatedAt: 2 });

  await sendCommand(handle, socket, { type: "session.list", requestId: "req-sessions", projectId: "project-1" });

  const listEvent = sent.find((event) => event.type === "session.list");
  assert.equal(listEvent?.projectId, "project-1");
  assert.deepEqual(listEvent?.sessions.map((session) => session.id), ["session-1"]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.equal(result?.requestId, "req-sessions");
  db.close();
});

test("command handler delegates session.resume with model options", async () => {
  const calls: unknown[] = [];
  const runtime = { id: "runtime-from-session", projectId: "project-1", cwd: process.cwd(), status: "running" as const };
  const { db, sent, socket, handle } = createHarness({
    resumeSession: (sessionId: string, options: unknown) => {
      calls.push({ sessionId, options });
      return runtime;
    },
  } as Partial<RuntimeSupervisor>);

  await sendCommand(handle, socket, {
    type: "session.resume",
    requestId: "req-session-resume",
    sessionId: "session-1",
    model: "openai:gpt-5",
    thinkingLevel: "high",
    responseMode: "fast",
  });

  assert.deepEqual(calls, [{ sessionId: "session-1", options: { model: "openai:gpt-5", thinkingLevel: "high", responseMode: "fast" } }]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.deepEqual(result?.data, { runtime });
  db.close();
});

test("command handler delegates runtime.restart with model options", async () => {
  const calls: unknown[] = [];
  const runtime = { id: "runtime-restarted", projectId: "project-1", cwd: process.cwd(), status: "running" as const };
  const { db, sent, socket, handle } = createHarness({
    restartRuntime: (runtimeId: string, options: unknown) => {
      calls.push({ runtimeId, options });
      return runtime;
    },
  } as Partial<RuntimeSupervisor>);

  await sendCommand(handle, socket, {
    type: "runtime.restart",
    requestId: "req-runtime-restart",
    runtimeId: "runtime-crashed",
    model: "openai:gpt-5",
    thinkingLevel: "high",
    responseMode: "fast",
  });

  assert.deepEqual(calls, [{ runtimeId: "runtime-crashed", options: { model: "openai:gpt-5", thinkingLevel: "high", responseMode: "fast" } }]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.deepEqual(result?.data, { runtime });
  db.close();
});

test("command handler delegates runtime.commands.list", async () => {
  const calls: string[] = [];
  const commands = [{ name: "fix-tests", description: "Fix tests", source: "prompt" as const }];
  const { db, sent, socket, handle } = createHarness({
    requestSlashCommands: (runtimeId: string) => {
      calls.push(runtimeId);
      return commands;
    },
  } as Partial<RuntimeSupervisor>);

  await sendCommand(handle, socket, { type: "runtime.commands.list", requestId: "req-commands", runtimeId: "runtime-1" });

  assert.deepEqual(calls, ["runtime-1"]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.deepEqual(result?.data, { commands });
  db.close();
});

test("command handler delegates native runtime RPC commands", async () => {
  const calls: unknown[] = [];
  const { db, sent, socket, handle } = createHarness({
    executeRpcCommand: (runtimeId: string, command: unknown, label: unknown) => calls.push({ runtimeId, command, label }),
  } as Partial<RuntimeSupervisor>);

  await sendCommand(handle, socket, { type: "runtime.rpc", requestId: "req-rpc", runtimeId: "runtime-1", command: { type: "compact" }, label: "/compact" });

  assert.deepEqual(calls, [{ runtimeId: "runtime-1", command: { type: "compact" }, label: "/compact" }]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  db.close();
});

test("command handler delegates extension UI responses", async () => {
  const calls: unknown[] = [];
  const { db, sent, socket, handle } = createHarness({
    respondExtensionUi: (runtimeId: string, responseId: string, response: unknown) => calls.push({ runtimeId, responseId, response }),
  } as Partial<RuntimeSupervisor>);

  await sendCommand(handle, socket, { type: "extension.ui.respond", requestId: "req-ui", runtimeId: "runtime-1", responseId: "ui-1", response: { value: "ok" } });

  assert.deepEqual(calls, [{ runtimeId: "runtime-1", responseId: "ui-1", response: { value: "ok" } }]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  db.close();
});

test("command handler sends subagent detail snapshots", async () => {
  const calls: unknown[] = [];
  const detail: Extract<ServerEvent, { type: "subagent.detail" }> = { type: "subagent.detail", runId: "run-1", childRunId: "child-1", messages: [], readAt: 123 };
  const { db, sent, socket, handle } = createHarness({
    subagentDetail: (runId: string, childRunId: string | undefined, limit: number | undefined) => {
      calls.push({ runId, childRunId, limit });
      return detail;
    },
  } as Partial<RuntimeSupervisor>);

  await sendCommand(handle, socket, { type: "subagent.detail.open", requestId: "req-subagent-detail", runId: "run-1", childRunId: "child-1", limit: 12 });

  assert.deepEqual(calls, [{ runId: "run-1", childRunId: "child-1", limit: 12 }]);
  assert.deepEqual(sent.find((event) => event.type === "subagent.detail"), detail);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.deepEqual(result?.data, { count: 0 });
  db.close();
});

test("command handler delegates runtime.start with model options", async () => {
  const calls: unknown[] = [];
  const runtime = { id: "runtime-1", projectId: "project-1", cwd: process.cwd(), status: "running" as const };
  const { db, sent, socket, handle } = createHarness({
    startRuntime: (projectId: string, options: unknown) => {
      calls.push({ projectId, options });
      return runtime;
    },
  } as Partial<RuntimeSupervisor>);

  await sendCommand(handle, socket, {
    type: "runtime.start",
    requestId: "req-3",
    projectId: "project-1",
    model: "openai:gpt-5",
    thinkingLevel: "high",
    responseMode: "fast",
  });

  assert.deepEqual(calls, [{ projectId: "project-1", options: { model: "openai:gpt-5", thinkingLevel: "high", responseMode: "fast" } }]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.deepEqual(result?.data, { runtime });
  db.close();
});

test("command handler replays events through gui.event envelopes", async () => {
  const { db, sent, socket, handle } = createHarness();
  const first = db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "stderr", payload: "one" });
  const second = db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "stderr", payload: "two" });

  await sendCommand(handle, socket, { type: "event.replay", requestId: "req-4", afterEventId: first.id, limit: 10 });

  assert.deepEqual(
    sent.filter((event) => event.type === "gui.event").map((event) => event.event),
    [second],
  );
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.deepEqual(result?.data, { count: 1 });
  db.close();
});

test("command handler filters replayed events by runtime and project", async () => {
  const { db, sent, socket, handle } = createHarness();
  const first = db.appendEvent({ runtimeId: "runtime-1", projectId: "project-1", kind: "stderr", payload: "one" });
  db.appendEvent({ runtimeId: "runtime-2", projectId: "project-1", kind: "stderr", payload: "two" });
  const third = db.appendEvent({ runtimeId: "runtime-3", projectId: "project-2", kind: "stderr", payload: "three" });

  await sendCommand(handle, socket, { type: "event.replay", requestId: "req-filter", afterEventId: first.id, limit: 10, projectId: "project-2" });

  assert.deepEqual(
    sent.filter((event) => event.type === "gui.event").map((event) => event.event),
    [third],
  );
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.deepEqual(result?.data, { count: 1 });
  db.close();
});

test("command handler lists rewind checkpoints for a project", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-checkpoint-command-"));
  const { db, sent, socket, handle } = createHarness();
  db.createProject({ id: "project-1", name: "Project", cwd: projectDir, lastOpenedAt: 1 });
  await writeCheckpointStore(projectDir, [
    { kind: "checkpoint", version: 1, id: "checkpoint-1", entryId: "entry-1", prompt: "Do work", createdAt: 10, cwd: projectDir, git: { available: true, dirty: false, backend: "patch" } },
  ]);

  await sendCommand(handle, socket, { type: "checkpoint.list", requestId: "req-checkpoints", projectId: "project-1" });

  const listEvent = sent.find((event) => event.type === "checkpoint.list");
  assert.equal(listEvent?.projectId, "project-1");
  assert.deepEqual(listEvent?.checkpoints.map((checkpoint) => checkpoint.id), ["checkpoint-1"]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.equal(result?.requestId, "req-checkpoints");
  db.close();
});

test("command handler restores checkpoints through runtime prompt", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-checkpoint-restore-"));
  const calls: unknown[] = [];
  const runtime = { id: "runtime-1", projectId: "project-1", cwd: projectDir, status: "running" as const };
  const { db, sent, socket, handle } = createHarness({
    getRuntime: (runtimeId: string) => (runtimeId === runtime.id ? runtime : undefined),
    prompt: async (runtimeId: string, message: string) => {
      calls.push({ runtimeId, message });
    },
  } as Partial<RuntimeSupervisor>);
  db.createProject({ id: "project-1", name: "Project", cwd: projectDir, lastOpenedAt: 1 });
  await writeCheckpointStore(projectDir, [
    { kind: "checkpoint", version: 1, id: "checkpoint-restore", entryId: "entry-1", prompt: "Do work", createdAt: 10, cwd: projectDir, git: { available: true, dirty: false, backend: "patch" } },
  ]);

  await sendCommand(handle, socket, { type: "checkpoint.restore", requestId: "req-restore", runtimeId: "runtime-1", checkpointId: "checkpoint-restore", restoreFiles: false });

  assert.deepEqual(calls, [{ runtimeId: "runtime-1", message: "/restore checkpoint-restore --no-restore --force" }]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.deepEqual(result?.data, { checkpointId: "checkpoint-restore", restoreFiles: false });
  db.close();
});

test("command handler fast-forwards through runtime prompt", async () => {
  const calls: unknown[] = [];
  const runtime = { id: "runtime-1", projectId: "project-1", cwd: process.cwd(), status: "running" as const };
  const { db, sent, socket, handle } = createHarness({
    getRuntime: (runtimeId: string) => (runtimeId === runtime.id ? runtime : undefined),
    prompt: async (runtimeId: string, message: string) => {
      calls.push({ runtimeId, message });
    },
  } as Partial<RuntimeSupervisor>);

  await sendCommand(handle, socket, { type: "checkpoint.fastForward", requestId: "req-ff", runtimeId: "runtime-1", restoreFiles: true });

  assert.deepEqual(calls, [{ runtimeId: "runtime-1", message: "/ff --force" }]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.deepEqual(result?.data, { restoreFiles: true });
  db.close();
});

test("command handler sends older conversation pages", async () => {
  const page: Extract<ServerEvent, { type: "conversation.page" }> = {
    type: "conversation.page",
    runtimeId: "runtime-1",
    projectId: "project-1",
    beforeMessageId: "message-3",
    messages: [],
    hasMoreBefore: false,
  };
  const calls: unknown[] = [];
  const { db, sent, socket, handle } = createHarness({
    conversationPageBefore: (runtimeId: string, beforeMessageId: string, limit: number | undefined) => {
      calls.push({ runtimeId, beforeMessageId, limit });
      return page;
    },
  } as Partial<RuntimeSupervisor>);

  await sendCommand(handle, socket, { type: "conversation.page", requestId: "req-page", runtimeId: "runtime-1", beforeMessageId: "message-3", limit: 20 });

  assert.deepEqual(calls, [{ runtimeId: "runtime-1", beforeMessageId: "message-3", limit: 20 }]);
  assert.deepEqual(sent.find((event) => event.type === "conversation.page"), page);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.deepEqual(result?.data, { count: 0 });
  db.close();
});

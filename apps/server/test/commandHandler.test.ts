import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
  assert.deepEqual(listEvent?.sessions.map((session) => session.id), ["session-1"]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.equal(result?.requestId, "req-sessions");
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

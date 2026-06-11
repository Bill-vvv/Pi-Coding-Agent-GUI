import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ClientCommand, ExecutionHostRef, ServerEvent } from "@pi-gui/shared";
import { AppDatabase } from "../src/db.js";
import type { RuntimeSupervisor } from "../src/runtime/runtimeSupervisor.js";
import { createSocketMessageHandler } from "../src/ws/commandHandler.js";
import type { WsClient } from "../src/ws/wsHub.js";

function createHarness(supervisorOverrides: Partial<RuntimeSupervisor> = {}, executionHost?: ExecutionHostRef) {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-command-"));
  const db = new AppDatabase(join(dir, "pi-gui.sqlite"), executionHost);
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

test("command handler configures project runtime profile override", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-project-profile-"));
  const { db, sent, broadcasted, socket, handle } = createHarness();
  const project = db.createProject({ id: "project-1", name: "Project", cwd: projectDir, lastOpenedAt: 1 });

  await sendCommand(handle, socket, { type: "project.configure", requestId: "req-project-profile", projectId: project.id, defaultRuntimeProfileId: "trellis-workflow" });

  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.equal(db.getProject(project.id)?.defaultRuntimeProfileId, "trellis-workflow");
  assert.ok(broadcasted.some((event) => event.type === "project.list" && event.projects[0]?.defaultRuntimeProfileId === "trellis-workflow"));
  db.close();
});

test("command handler creates projects using resolved backend cwd", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-project-resolved-"));
  const { db, sent, broadcasted, socket, handle } = createHarness();
  const handleWithResolver = createSocketMessageHandler({
    db,
    supervisor: {} as RuntimeSupervisor,
    send: (_socket, event) => sent.push(event),
    broadcast: (event) => broadcasted.push(event),
    resolvePath: async (inputPath: string) => ({ inputPath, cwd: projectDir, source: "windows-drive", exists: true, isDirectory: true }),
  });

  await sendCommand(handleWithResolver, socket, { type: "project.create", requestId: "req-resolved", cwd: "C:\\Users\\me\\project" });

  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.equal(db.listProjects()[0]?.cwd, projectDir);
  assert.ok(broadcasted.some((event) => event.type === "project.created" && event.project.cwd === projectDir));
  db.close();
});

test("command handler creates remote SSH projects without local stat", async () => {
  const { db, sent, broadcasted, socket, handle } = createHarness();

  await sendCommand(handle, socket, { type: "project.create", requestId: "req-ssh", cwd: "devbox:/srv/app" });

  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.equal(db.listProjects()[0]?.cwd, "devbox:/srv/app");
  assert.ok(broadcasted.some((event) => event.type === "project.created" && event.project.cwd === "devbox:/srv/app"));
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
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-session-list-project-"));
  const { db, sent, socket, handle } = createHarness();
  db.createProject({ id: "project-1", name: "Project", cwd: projectDir, lastOpenedAt: 1 });
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

  assert.deepEqual(calls, [{ sessionId: "session-1", options: { model: "openai:gpt-5", thinkingLevel: "high", responseMode: "fast", runtimeProfileId: undefined } }]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.deepEqual(result?.data, { runtime });
  db.close();
});

test("command handler rejects session.resume for a different execution host", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "pi-gui-session-host-project-"));
  const calls: unknown[] = [];
  const { db, sent, socket, handle } = createHarness(
    {
      resumeSession: (sessionId: string) => {
        calls.push(sessionId);
        return { id: "runtime-from-session", projectId: "project-1", cwd: projectDir, status: "running" as const };
      },
    } as Partial<RuntimeSupervisor>,
    { kind: "wsl", id: "wsl:Ubuntu", label: "WSL (Ubuntu)" },
  );
  db.createProject({ id: "project-1", name: "Project", cwd: projectDir, lastOpenedAt: 1 });
  db.upsertSession({
    id: "session-1",
    projectId: "project-1",
    piSessionFile: "C:\\Users\\me\\.pi\\sessions\\session-1.jsonl",
    host: { kind: "windows", id: "windows:local", label: "Windows native" },
    createdAt: 1,
    updatedAt: 2,
  });

  await sendCommand(handle, socket, { type: "session.resume", requestId: "req-host-mismatch", sessionId: "session-1" });

  assert.deepEqual(calls, []);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, false);
  assert.equal(result?.requestId, "req-host-mismatch");
  assert.match(result?.error ?? "", /belongs to Windows native/);
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

  assert.deepEqual(calls, [{ runtimeId: "runtime-crashed", options: { model: "openai:gpt-5", thinkingLevel: "high", responseMode: "fast", runtimeProfileId: undefined } }]);
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

test("command handler delegates runtime queue dequeue and returns restored messages", async () => {
  const calls: string[] = [];
  const queue = { steering: ["adjust"], followUp: ["next"] };
  const { db, sent, socket, handle } = createHarness({
    dequeueQueue: async (runtimeId: string) => {
      calls.push(runtimeId);
      return queue;
    },
  } as Partial<RuntimeSupervisor>);

  await sendCommand(handle, socket, { type: "runtime.queue.dequeue", requestId: "req-dequeue", runtimeId: "runtime-1" });

  assert.deepEqual(calls, ["runtime-1"]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.equal(result?.requestId, "req-dequeue");
  assert.deepEqual(result?.data, { queue });
  db.close();
});

test("command handler delegates runtime queue reorder", async () => {
  const calls: unknown[] = [];
  const queue = { steering: ["second", "first"], followUp: ["later"] };
  const { db, sent, socket, handle } = createHarness({
    reorderQueue: async (runtimeId: string, nextQueue: unknown) => {
      calls.push({ runtimeId, queue: nextQueue });
    },
  } as Partial<RuntimeSupervisor>);

  await sendCommand(handle, socket, { type: "runtime.queue.reorder", requestId: "req-reorder", runtimeId: "runtime-1", queue });

  assert.deepEqual(calls, [{ runtimeId: "runtime-1", queue }]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.equal(result?.requestId, "req-reorder");
  assert.deepEqual(result?.data, { queue });
  db.close();
});

test("command handler rejects malformed runtime queue reorder payloads", async () => {
  const { db, sent, socket, handle } = createHarness();

  await sendCommand(handle, socket, { type: "runtime.queue.reorder", requestId: "req-reorder", runtimeId: "runtime-1", queue: { steering: "bad", followUp: [] } });

  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.command, "unknown");
  assert.equal(result?.success, false);
  assert.match(result?.error ?? "", /queue\.steering must be an array/);
  db.close();
});

test("command handler delegates native runtime RPC commands with display text", async () => {
  const calls: unknown[] = [];
  const { db, sent, socket, handle } = createHarness({
    executeRpcCommand: (runtimeId: string, command: unknown, label: unknown, displayMessage: unknown) => calls.push({ runtimeId, command, label, displayMessage }),
  } as Partial<RuntimeSupervisor>);

  await sendCommand(handle, socket, { type: "runtime.rpc", requestId: "req-rpc", runtimeId: "runtime-1", command: { type: "compact" }, label: "/compact", displayMessage: "/compact now" });

  assert.deepEqual(calls, [{ runtimeId: "runtime-1", command: { type: "compact" }, label: "/compact", displayMessage: "/compact now" }]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  db.close();
});

test("command handler delegates runtime prompts with display text", async () => {
  const calls: unknown[] = [];
  const { db, sent, socket, handle } = createHarness({
    prompt: async (runtimeId: string, message: string, streamingBehavior: unknown, displayMessage: unknown) => {
      calls.push({ runtimeId, message, streamingBehavior, displayMessage });
    },
  } as Partial<RuntimeSupervisor>);

  await sendCommand(handle, socket, {
    type: "runtime.prompt",
    requestId: "req-prompt-display",
    runtimeId: "runtime-1",
    message: "/goal ship it",
    displayMessage: "/goal ship it",
  });

  assert.deepEqual(calls, [{ runtimeId: "runtime-1", message: "/goal ship it", streamingBehavior: undefined, displayMessage: "/goal ship it" }]);
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
    runtimeProfileId: "pi-gui-enhanced",
  });

  assert.deepEqual(calls, [{ projectId: "project-1", options: { model: "openai:gpt-5", thinkingLevel: "high", responseMode: "fast", runtimeProfileId: "pi-gui-enhanced" } }]);
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

test("command handler returns sanitized default runtime logs", async () => {
  const runtime = { id: "runtime-1", projectId: "project-1", cwd: process.cwd(), status: "crashed" as const };
  const { db, sent, socket, handle } = createHarness({
    getRuntime: (runtimeId: string) => (runtimeId === runtime.id ? runtime : undefined),
  } as Partial<RuntimeSupervisor>);
  const status = db.appendEvent({ runtimeId: runtime.id, projectId: runtime.projectId, kind: "runtime_status", payload: { status: "crashed" } });
  db.appendEvent({ runtimeId: runtime.id, projectId: runtime.projectId, kind: "pi_event", payload: { type: "message", text: "conversation body" } });
  const stderr = db.appendEvent({ runtimeId: runtime.id, projectId: runtime.projectId, kind: "stderr", payload: "warning" });
  db.appendEvent({ runtimeId: "runtime-2", projectId: runtime.projectId, kind: "error", payload: { message: "other" } });

  await sendCommand(handle, socket, { type: "runtime.logs", requestId: "req-runtime-logs", runtimeId: runtime.id, limit: 20 });

  const logs = sent.find((event): event is Extract<ServerEvent, { type: "runtime.logs" }> => event.type === "runtime.logs");
  assert.equal(logs?.runtimeId, runtime.id);
  assert.equal(logs?.projectId, runtime.projectId);
  assert.deepEqual(logs?.events.map((event) => event.id), [status.id, stderr.id]);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.deepEqual(result?.data, { count: 2, hasMore: false });
  db.close();
});

test("command handler returns recent runtime logs by default", async () => {
  const runtime = { id: "runtime-1", projectId: "project-1", cwd: process.cwd(), status: "crashed" as const };
  const { db, sent, socket, handle } = createHarness({
    getRuntime: (runtimeId: string) => (runtimeId === runtime.id ? runtime : undefined),
  } as Partial<RuntimeSupervisor>);
  db.appendEvent({ runtimeId: runtime.id, projectId: runtime.projectId, kind: "stderr", payload: "old" });
  const error = db.appendEvent({ runtimeId: runtime.id, projectId: runtime.projectId, kind: "error", payload: { message: "newer" } });
  const crashed = db.appendEvent({ runtimeId: runtime.id, projectId: runtime.projectId, kind: "runtime_status", payload: { status: "crashed" } });

  await sendCommand(handle, socket, { type: "runtime.logs", requestId: "req-runtime-recent-logs", runtimeId: runtime.id, limit: 2 });

  const logs = sent.find((event): event is Extract<ServerEvent, { type: "runtime.logs" }> => event.type === "runtime.logs");
  assert.deepEqual(logs?.events.map((event) => event.id), [error.id, crashed.id]);
  assert.equal(logs?.hasMore, true);
  db.close();
});

test("command handler supports opt-in runtime pi_event logs and hasMore", async () => {
  const runtime = { id: "runtime-1", projectId: "project-1", cwd: process.cwd(), status: "running" as const };
  const { db, sent, socket, handle } = createHarness({
    getRuntime: (runtimeId: string) => (runtimeId === runtime.id ? runtime : undefined),
  } as Partial<RuntimeSupervisor>);
  db.appendEvent({ runtimeId: runtime.id, projectId: runtime.projectId, kind: "pi_event", payload: { type: "tool" } });
  const latest = db.appendEvent({ runtimeId: runtime.id, projectId: runtime.projectId, kind: "pi_event", payload: { type: "tool_end" } });

  await sendCommand(handle, socket, { type: "runtime.logs", requestId: "req-runtime-pi-events", runtimeId: runtime.id, limit: 1, kinds: ["pi_event"] });

  const logs = sent.find((event): event is Extract<ServerEvent, { type: "runtime.logs" }> => event.type === "runtime.logs");
  assert.deepEqual(logs?.events.map((event) => event.id), [latest.id]);
  assert.equal(logs?.hasMore, true);
  const result = sent.find((event) => event.type === "command.result");
  assert.equal(result?.success, true);
  assert.deepEqual(result?.data, { count: 1, hasMore: true });
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

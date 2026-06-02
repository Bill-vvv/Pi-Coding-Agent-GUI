import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { ClientCommand, ModelSummary, ServerEvent, ThinkingLevel } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import { AppDatabase } from "./db.js";
import { RuntimeSupervisor } from "./runtime/runtimeSupervisor.js";

type WsClient = {
  send(data: string): void;
  on(event: "message", listener: (data: Buffer | string) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);
const initialEventReplayLimit = boundedIntegerEnv("PI_GUI_INITIAL_EVENT_REPLAY_LIMIT", 20_000, 1_000, 50_000);
const allowedCorsOrigins = [
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^http:\/\/\[::1\](?::\d+)?$/,
];

const fastify = Fastify({ logger: true });
const db = new AppDatabase();
const clients = new Set<WsClient>();
const supervisor = new RuntimeSupervisor(db, broadcast);

await fastify.register(cors, { origin: allowedCorsOrigins });
await fastify.register(websocket);

fastify.get("/health", async () => ({ ok: true, time: Date.now() }));

fastify.get("/api/projects", async () => ({ projects: db.listProjects() }));

fastify.get("/api/models", async () => ({ models: await listPiModels() }));

fastify.get("/api/fs/list", async (request) => {
  const query = request.query as { path?: string };
  const requestedPath = query.path?.trim() || process.env.HOME || "/";
  const cwd = resolve(requestedPath);
  const cwdStat = await stat(cwd);
  if (!cwdStat.isDirectory()) throw new Error(`path is not a directory: ${cwd}`);

  const entries = await readdir(cwd, { withFileTypes: true });
  return {
    cwd,
    parent: cwd === "/" ? undefined : dirname(cwd),
    entries: entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, path: resolve(cwd, entry.name), type: "directory" as const }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
});

fastify.get("/ws", { websocket: true }, (socket: WsClient) => {
  clients.add(socket);
  send(socket, {
    type: "hello",
    serverTime: Date.now(),
    projects: db.listProjects(),
    runtimes: supervisor.listRuntimes(),
    recentEvents: db.recentEvents(initialEventReplayLimit),
    settings: db.getSettings(),
  });

  socket.on("message", (data) => {
    void handleSocketMessage(socket, data).catch((error) => {
      fastify.log.error(error);
      send(socket, {
        type: "command.result",
        command: "unknown",
        success: false,
        error: (error as Error).message,
      });
    });
  });

  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});

await fastify.listen({ host, port });

async function handleSocketMessage(socket: WsClient, data: Buffer | string): Promise<void> {
  const raw = typeof data === "string" ? data : data.toString("utf8");
  let command: ClientCommand;
  try {
    command = parseClientCommand(JSON.parse(raw));
  } catch (error) {
    send(socket, {
      type: "command.result",
      command: "unknown",
      success: false,
      error: (error as Error).message,
    });
    return;
  }

  try {
    switch (command.type) {
      case "project.list": {
        const projects = db.listProjects();
        send(socket, { type: "project.list", projects });
        sendResult(socket, command, true, { projects });
        break;
      }
      case "project.create": {
        const cwd = resolve(command.cwd);
        const stat = statSync(cwd);
        if (!stat.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
        const project = db.createProject({
          id: randomUUID(),
          name: command.name?.trim() || basename(cwd) || cwd,
          cwd,
          defaultModel: command.defaultModel?.trim() || undefined,
          lastOpenedAt: Date.now(),
        });
        broadcast({ type: "project.created", project });
        broadcast({ type: "project.list", projects: db.listProjects() });
        sendResult(socket, command, true, { project });
        break;
      }
      case "settings.get": {
        const settings = db.getSettings();
        send(socket, { type: "settings.updated", settings });
        sendResult(socket, command, true, { settings });
        break;
      }
      case "settings.update": {
        const settings = db.updateSettings(command.settings);
        broadcast({ type: "settings.updated", settings });
        sendResult(socket, command, true, { settings });
        break;
      }
      case "runtime.start": {
        const runtime = supervisor.startRuntime(command.projectId, { model: command.model, thinkingLevel: command.thinkingLevel, responseMode: command.responseMode });
        sendResult(socket, command, true, { runtime });
        break;
      }
      case "runtime.configure": {
        supervisor.configureRuntime(command.runtimeId, {
          modelProvider: command.modelProvider,
          modelId: command.modelId,
          thinkingLevel: command.thinkingLevel,
          responseMode: command.responseMode,
        });
        sendResult(socket, command, true);
        break;
      }
      case "runtime.stop": {
        const runtime = supervisor.stopRuntime(command.runtimeId);
        sendResult(socket, command, true, { runtime });
        break;
      }
      case "runtime.archive": {
        const runtime = supervisor.archiveRuntime(command.runtimeId);
        sendResult(socket, command, true, { runtime });
        break;
      }
      case "runtime.prompt": {
        supervisor.prompt(command.runtimeId, command.message, command.streamingBehavior);
        sendResult(socket, command, true);
        break;
      }
      case "runtime.abort": {
        supervisor.abort(command.runtimeId);
        sendResult(socket, command, true);
        break;
      }
      case "event.replay": {
        const events = db.listEvents(command.afterEventId ?? 0, command.limit ?? 500);
        for (const event of events) send(socket, { type: "gui.event", event });
        sendResult(socket, command, true, { count: events.length });
        break;
      }
    }
  } catch (error) {
    sendResult(socket, command, false, undefined, (error as Error).message);
  }
}

function parseClientCommand(value: unknown): ClientCommand {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Invalid command: missing type");
  }

  switch (value.type) {
    case "project.list":
      return { type: "project.list", requestId: stringOrUndefined(value.requestId) };
    case "project.create":
      if (value.name !== undefined && typeof value.name !== "string") throw new Error("project.create name must be a string");
      if (typeof value.cwd !== "string") throw new Error("project.create requires cwd");
      return {
        type: "project.create",
        requestId: stringOrUndefined(value.requestId),
        name: stringOrUndefined(value.name),
        cwd: value.cwd,
        defaultModel: stringOrUndefined(value.defaultModel),
      };
    case "settings.get":
      return { type: "settings.get", requestId: stringOrUndefined(value.requestId) };
    case "settings.update":
      if (!isRecord(value.settings)) throw new Error("settings.update requires settings");
      return {
        type: "settings.update",
        requestId: stringOrUndefined(value.requestId),
        settings: {
          defaultModel: stringOrUndefined(value.settings.defaultModel) ?? "",
          defaultThinkingLevel: thinkingLevelOrUndefined(value.settings.defaultThinkingLevel),
          responseMode: value.settings.responseMode === "fast" ? "fast" : value.settings.responseMode === "normal" ? "normal" : undefined,
        },
      };
    case "runtime.start":
      if (typeof value.projectId !== "string") throw new Error("runtime.start requires projectId");
      return {
        type: "runtime.start",
        requestId: stringOrUndefined(value.requestId),
        projectId: value.projectId,
        model: stringOrUndefined(value.model),
        thinkingLevel: thinkingLevelOrUndefined(value.thinkingLevel),
        responseMode: responseModeOrUndefined(value.responseMode),
      };
    case "runtime.configure":
      if (typeof value.runtimeId !== "string") throw new Error("runtime.configure requires runtimeId");
      return {
        type: "runtime.configure",
        requestId: stringOrUndefined(value.requestId),
        runtimeId: value.runtimeId,
        modelProvider: stringOrUndefined(value.modelProvider),
        modelId: stringOrUndefined(value.modelId),
        thinkingLevel: thinkingLevelOrUndefined(value.thinkingLevel),
        responseMode: responseModeOrUndefined(value.responseMode),
      };
    case "runtime.stop":
      if (typeof value.runtimeId !== "string") throw new Error("runtime.stop requires runtimeId");
      return { type: "runtime.stop", requestId: stringOrUndefined(value.requestId), runtimeId: value.runtimeId };
    case "runtime.archive":
      if (typeof value.runtimeId !== "string") throw new Error("runtime.archive requires runtimeId");
      return { type: "runtime.archive", requestId: stringOrUndefined(value.requestId), runtimeId: value.runtimeId };
    case "runtime.prompt":
      if (typeof value.runtimeId !== "string") throw new Error("runtime.prompt requires runtimeId");
      if (typeof value.message !== "string") throw new Error("runtime.prompt requires message");
      if (value.streamingBehavior !== undefined && value.streamingBehavior !== "steer" && value.streamingBehavior !== "followUp") {
        throw new Error("runtime.prompt streamingBehavior must be steer or followUp");
      }
      return {
        type: "runtime.prompt",
        requestId: stringOrUndefined(value.requestId),
        runtimeId: value.runtimeId,
        message: value.message,
        streamingBehavior: value.streamingBehavior,
      };
    case "runtime.abort":
      if (typeof value.runtimeId !== "string") throw new Error("runtime.abort requires runtimeId");
      return { type: "runtime.abort", requestId: stringOrUndefined(value.requestId), runtimeId: value.runtimeId };
    case "event.replay":
      return {
        type: "event.replay",
        requestId: stringOrUndefined(value.requestId),
        afterEventId: numberOrUndefined(value.afterEventId),
        limit: numberOrUndefined(value.limit),
      };
    default:
      throw new Error(`Unknown command type: ${value.type}`);
  }
}

async function listPiModels(): Promise<ModelSummary[]> {
  const fromRpc = await listPiModelsViaRpc().catch(() => []);
  if (fromRpc.length > 0) return fromRpc;

  try {
    const { stdout } = await execFileAsync("pi", ["--list-models"]);
    return parsePiModelList(stdout);
  } catch {
    return [];
  }
}

function listPiModelsViaRpc(timeoutMs = 12_000): Promise<ModelSummary[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pi", ["--mode", "rpc", "--no-session"], {
      cwd: process.env.HOME || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

    const settle = (models: ModelSummary[], error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.kill("SIGTERM");
      if (error) reject(error);
      else resolve(models);
    };

    const timer = setTimeout(() => settle([], new Error("Timed out while reading Pi models")), timeoutMs);
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf8");
    });
    proc.on("error", (error) => settle([], error));
    proc.on("exit", () => {
      if (!settled) settle([], new Error(stderrBuffer || "Pi RPC exited before model list response"));
    });
    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      while (true) {
        const newlineIndex = stdoutBuffer.indexOf("\n");
        if (newlineIndex === -1) break;
        let line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line) continue;
        const message = JSON.parse(line) as unknown;
        if (!isRecord(message) || message.type !== "response" || message.id !== "gui-models") continue;
        if (message.success !== true) {
          settle([], new Error(typeof message.error === "string" ? message.error : "get_available_models failed"));
          return;
        }
        const data = isRecord(message.data) ? message.data : undefined;
        const models = Array.isArray(data?.models) ? data.models : [];
        settle(models.map(modelSummaryFromRpcModel).filter((model): model is ModelSummary => Boolean(model)));
      }
    });
    proc.stdin.write(`${JSON.stringify({ id: "gui-models", type: "get_available_models" })}\n`);
  });
}

function modelSummaryFromRpcModel(value: unknown): ModelSummary | undefined {
  if (!isRecord(value) || typeof value.provider !== "string" || typeof value.id !== "string") return undefined;
  const name = typeof value.name === "string" ? value.name : value.id;
  const input = Array.isArray(value.input) ? value.input : [];
  const supportedThinkingLevels = supportedThinkingLevelsFromRpcModel(value);
  return {
    provider: value.provider,
    id: value.id,
    label: `${value.provider}/${name}`,
    supportsThinking: value.reasoning === true,
    supportedThinkingLevels,
    supportsImages: input.includes("image"),
    supportsFast: supportsPriorityServiceTier(value),
    contextWindow: numberOrUndefined(value.contextWindow),
  };
}

function parsePiModelList(output: string): ModelSummary[] {
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const [, ...rows] = lines;
  return rows.flatMap((line) => {
    const columns = line.split(/\s+/);
    const [provider, id, , , thinking, images] = columns;
    if (!provider || !id) return [];
    return [
      {
        provider,
        id,
        label: `${provider}/${id}`,
        supportsThinking: thinking === "yes",
        supportsImages: images === "yes",
        supportsFast: supportsPriorityServiceTier({ provider, id }),
      },
    ];
  });
}

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function supportedThinkingLevelsFromRpcModel(model: Record<string, unknown>): ThinkingLevel[] | undefined {
  if (model.reasoning !== true) return undefined;
  const thinkingLevelMap = isRecord(model.thinkingLevelMap) ? model.thinkingLevelMap : undefined;
  return THINKING_LEVELS.filter((level) => {
    const mapped = thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh") return mapped !== undefined;
    return true;
  });
}

function supportsPriorityServiceTier(model: Record<string, unknown>): boolean {
  const provider = typeof model.provider === "string" ? model.provider : "";
  const api = typeof model.api === "string" ? model.api : undefined;
  if (api) return (provider === "openai" && api === "openai-responses") || (provider === "openai-codex" && api === "openai-codex-responses");
  return provider === "openai" || provider === "openai-codex";
}

function execFileAsync(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

function sendResult(socket: WsClient, command: ClientCommand, success: boolean, data?: unknown, error?: string): void {
  send(socket, {
    type: "command.result",
    requestId: command.requestId,
    command: command.type,
    success,
    data,
    error,
  });
}

function broadcast(event: ServerEvent): void {
  const serialized = JSON.stringify(event);
  for (const client of clients) {
    try {
      client.send(serialized);
    } catch {
      clients.delete(client);
    }
  }
}

function send(socket: WsClient, event: ServerEvent): void {
  socket.send(JSON.stringify(event));
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function thinkingLevelOrUndefined(value: unknown): ThinkingLevel | undefined {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boundedIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const rawValue = process.env[name];
  if (!rawValue) return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function responseModeOrUndefined(value: unknown): "normal" | "fast" | undefined {
  return value === "normal" || value === "fast" ? value : undefined;
}

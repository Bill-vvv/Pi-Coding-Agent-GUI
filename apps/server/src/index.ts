import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { spawn } from "node:child_process";
import Fastify, { type FastifyRequest } from "fastify";
import { AppDatabase } from "./db.js";
import { registerBuiltWebUiRoutes } from "./routes/builtWebRoutes.js";
import { registerEnvironmentRoutes } from "./routes/environmentRoutes.js";
import { registerFsRoutes } from "./routes/fsRoutes.js";
import { registerImportRoutes } from "./routes/importRoutes.js";
import { registerRemoteAccessRoutes } from "./routes/remoteAccessRoutes.js";
import { registerUsageRoutes } from "./routes/usageRoutes.js";
import { registerVoiceRoutes } from "./routes/voiceRoutes.js";
import { runtimeConversationBusyEvents } from "./runtime/runtimeConversationViews.js";
import { RuntimeSupervisor } from "./runtime/runtimeSupervisor.js";
import { isWebSocketRequestAuthorized, redactTokenInUrl, registerApiAuth } from "./services/authService.js";
import { listPiModels } from "./services/modelService.js";
import { readPersistedRemoteAccessConfig, remoteAccessAuthToken, RemoteAccessService } from "./services/remoteAccessService.js";
import { readServerRuntimeConfig } from "./services/serverConfig.js";
import { indexKnownPiSessions } from "./services/sessionIndexService.js";
import { VoiceTranscriptionService } from "./services/voiceInput/index.js";
import { createSocketMessageHandler } from "./ws/commandHandler.js";
import { WsHub, type WsClient } from "./ws/wsHub.js";

const db = new AppDatabase();
const serverConfig = readServerRuntimeConfig(process.env, readPersistedRemoteAccessConfig(db));
const { host, port } = serverConfig;
const remoteAccessService = new RemoteAccessService(db, serverConfig);
const voiceTranscriptionService = new VoiceTranscriptionService({ getSettings: () => db.getSettings() });
const authProvider = {
  authRequired: () => serverConfig.authRequired,
  getAuthToken: () => remoteAccessAuthToken(db, serverConfig),
};
const allowedCorsOrigins = [
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^http:\/\/\[::1\](?::\d+)?$/,
];

const fastify = Fastify({
  logger: {
    redact: ["req.headers.authorization", "headers.authorization", "request.headers.authorization"],
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: redactTokenInUrl(request.url),
          host: request.hostname,
          remoteAddress: request.ip,
          remotePort: request.socket.remotePort,
        };
      },
    },
  },
});
indexKnownPiSessions(db);
const wsHub = new WsHub();
const supervisor = new RuntimeSupervisor(db, (event) => wsHub.broadcast(event));
const handleSocketMessage = createSocketMessageHandler({
  db,
  supervisor,
  send: (socket, event) => wsHub.send(socket, event),
  broadcast: (event) => wsHub.broadcast(event),
});

await fastify.register(cors, { origin: allowedCorsOrigins });
registerApiAuth(fastify, authProvider);
await fastify.register(websocket);
await registerFsRoutes(fastify);
await registerImportRoutes(fastify);
await registerRemoteAccessRoutes(fastify, remoteAccessService, { restartServer: restartCurrentServer });
await registerEnvironmentRoutes(fastify);
await registerUsageRoutes(fastify, { db });
await registerVoiceRoutes(fastify, voiceTranscriptionService);
fastify.addHook("onClose", async () => {
  voiceTranscriptionService.stop();
});

fastify.get("/health", async () => ({ ok: true, time: Date.now() }));

fastify.get("/api/projects", async () => ({ projects: db.listProjects() }));

fastify.get("/api/models", async () => ({ models: await listPiModels() }));

fastify.get("/ws", { websocket: true }, (socket: WsClient, request: FastifyRequest) => {
  if (!isWebSocketRequestAuthorized(request, authProvider)) {
    closeUnauthorizedSocket(socket);
    return;
  }

  wsHub.add(socket);
  wsHub.send(socket, {
    type: "hello",
    serverTime: Date.now(),
    projects: db.listProjects(),
    runtimes: supervisor.listRuntimes(),
    settings: db.getSettings(),
    lastEventId: db.lastEventId(),
    conversationSummaries: supervisor.listRuntimeConversationSummaries(),
    sessions: db.listSessions(),
    subagentRuns: supervisor.listSubagentRuns(undefined, 500),
  });
  sendRuntimeBusyStates(socket);
  sendRuntimeQueues(socket);
  sendRuntimeCommands(socket);
  replayEventsForConnection(socket, parseSinceEventId(request));

  socket.on("message", (data) => {
    void handleSocketMessage(socket, data).catch((error) => {
      fastify.log.error(error);
      wsHub.send(socket, {
        type: "command.result",
        command: "unknown",
        success: false,
        error: (error as Error).message,
      });
    });
  });

  socket.on("close", () => wsHub.remove(socket));
  socket.on("error", () => wsHub.remove(socket));
});

await registerBuiltWebUiRoutes(fastify, { remoteLan: serverConfig.remoteLan });

await fastify.listen({ host, port });
logRemoteAccessStartupHint();

function logRemoteAccessStartupHint(): void {
  const status = remoteAccessService.getStatus();
  if (!status.enabled && !status.active) return;
  const pairing = remoteAccessService.getPairingInfo(status);
  fastify.log.warn({ remoteAccessUrl: pairing.pairingUrl, warnings: pairing.warnings, setupHints: status.setupHints }, "Pi GUI Remote Access is enabled for trusted LAN use");
}

async function restartCurrentServer(): Promise<void> {
  fastify.log.warn("Remote Access requested Pi GUI server restart");
  await fastify.close();
  voiceTranscriptionService.stop();
  db.close();
  const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    cwd: process.cwd(),
    env: restartEnvironment(),
    stdio: "inherit",
  });
  child.unref();
  process.exit(0);
}

function restartEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const persisted = remoteAccessService.getPersistedConfig();
  env.PORT = String(serverConfig.port);
  if (persisted.enabled) {
    env.PI_GUI_MODE = "remote-lan";
    env.PI_GUI_HOST = "0.0.0.0";
    env.PI_GUI_SERVE_WEB = env.PI_GUI_SERVE_WEB?.trim() || "1";
    return env;
  }

  if (serverConfig.remoteLan) {
    delete env.PI_GUI_MODE;
    delete env.PI_GUI_HOST;
    if (env.HOST?.trim() === "0.0.0.0") delete env.HOST;
  }
  return env;
}

function closeUnauthorizedSocket(socket: WsClient): void {
  const closable = socket as WsClient & { close?: (code?: number, reason?: string) => void };
  closable.close?.(1008, "Unauthorized");
}

function sendRuntimeBusyStates(socket: WsClient): void {
  // `hello` intentionally carries lightweight runtime metadata only. Seed the
  // conversation-busy projection separately so a fresh/reconnected frontend can
  // color sidebar status dots without fetching every background conversation.
  for (const event of runtimeConversationBusyEvents(db, supervisor.listRuntimes())) {
    wsHub.send(socket, event);
  }
}

function sendRuntimeQueues(socket: WsClient): void {
  for (const snapshot of supervisor.listRuntimeQueues()) {
    wsHub.send(socket, { type: "runtime.queue", ...snapshot });
  }
}

function sendRuntimeCommands(socket: WsClient): void {
  for (const snapshot of supervisor.listRuntimeCommands()) {
    wsHub.send(socket, { type: "runtime.commands", ...snapshot });
  }
}

function replayEventsForConnection(socket: WsClient, sinceEventId: number | undefined): void {
  const events = sinceEventId !== undefined ? db.listEvents(sinceEventId, 1000) : db.recentEvents(300, 512 * 1024);
  for (const event of events) {
    wsHub.send(socket, { type: "gui.event", event });
  }
}

function parseSinceEventId(request: FastifyRequest): number | undefined {
  const query = request.query;
  if (!query || typeof query !== "object" || !("sinceEventId" in query)) return undefined;
  const value = (query as { sinceEventId?: unknown }).sinceEventId;
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

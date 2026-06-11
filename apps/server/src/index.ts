import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { spawn } from "node:child_process";
import Fastify, { type FastifyRequest } from "fastify";
import { AppDatabase } from "./db.js";
import { registerBuiltWebUiRoutes } from "./routes/builtWebRoutes.js";
import { registerCapabilityRoutes } from "./routes/capabilityRoutes.js";
import { registerEnvironmentRoutes } from "./routes/environmentRoutes.js";
import { registerFsRoutes } from "./routes/fsRoutes.js";
import { registerImportRoutes } from "./routes/importRoutes.js";
import { registerRemoteAccessRoutes } from "./routes/remoteAccessRoutes.js";
import { registerUsageRoutes } from "./routes/usageRoutes.js";
import { replayGapEventForReconnect, RECONNECT_REPLAY_LIMIT } from "./runtime/eventReplay.js";
import { runtimeConversationBusyEvents } from "./runtime/runtimeConversationViews.js";
import { RuntimeSupervisor } from "./runtime/runtimeSupervisor.js";
import { isWebSocketRequestAuthorized, redactTokenInUrl, registerApiAuth } from "./services/authService.js";
import { listPiModels } from "./services/modelService.js";
import { decorateProjectsWithGitSummary } from "./services/projectGitSummary.js";
import { readPersistedRemoteAccessConfig, remoteAccessAuthToken, RemoteAccessService } from "./services/remoteAccessService.js";
import { readServerRuntimeConfig } from "./services/serverConfig.js";
import { indexKnownPiSessions } from "./services/sessionIndexService.js";
import { createSocketMessageHandler } from "./ws/commandHandler.js";
import { WsHub, type WsClient } from "./ws/wsHub.js";

const db = new AppDatabase();
const serverConfig = readServerRuntimeConfig(process.env, readPersistedRemoteAccessConfig(db));
const { host, port } = serverConfig;
const remoteAccessService = new RemoteAccessService(db, serverConfig);
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
const socketIds = new WeakMap<WsClient, number>();
let nextSocketId = 1;
const wsHub = new WsHub({
  onClientClosed: ({ socket, reason, bufferedAmount, mode }) => {
    fastify.log.warn(
      { socketId: socketIds.get(socket), reason, bufferedAmount, closeMode: mode, activeSockets: wsHub.clientCount() },
      "WebSocket client closed by hub",
    );
  },
});
const supervisor = new RuntimeSupervisor(db, (event) => wsHub.broadcast(event));
const handleSocketMessage = createSocketMessageHandler({
  db,
  supervisor,
  send: (socket, event) => wsHub.send(socket, event),
  broadcast: (event) => wsHub.broadcast(event),
});

await fastify.register(cors, { origin: allowedCorsOrigins });
registerApiAuth(fastify, authProvider);
await fastify.register(websocket, {
  options: {
    perMessageDeflate: {
      threshold: 1024,
    },
  },
});
await registerFsRoutes(fastify);
await registerImportRoutes(fastify);
await registerRemoteAccessRoutes(fastify, remoteAccessService, { restartServer: restartCurrentServer });
await registerEnvironmentRoutes(fastify);
await registerUsageRoutes(fastify, { db });
await registerCapabilityRoutes(fastify, { db });

fastify.get("/health", async () => ({ ok: true, time: Date.now() }));

fastify.get("/api/desktop/ready", async () => ({
  ok: serverConfig.mode === "desktop",
  mode: serverConfig.mode,
  launchId: serverConfig.desktopLaunchId,
  time: Date.now(),
}));

fastify.get("/api/projects", async () => ({ projects: decorateProjectsWithGitSummary(db.listProjects()) }));

fastify.get("/api/models", async () => ({ models: await listPiModels() }));

fastify.get("/ws", { websocket: true }, (socket: WsClient, request: FastifyRequest) => {
  if (!isWebSocketRequestAuthorized(request, authProvider)) {
    fastify.log.warn({ remoteAddress: request.ip, remotePort: request.socket.remotePort }, "Rejected unauthorized WebSocket connection");
    closeUnauthorizedSocket(socket);
    return;
  }

  const socketId = nextSocketId++;
  const sinceEventId = parseSinceEventId(request);
  socketIds.set(socket, socketId);
  fastify.log.info(
    { socketId, sinceEventId, activeSockets: wsHub.clientCount() + 1, remoteAddress: request.ip, remotePort: request.socket.remotePort },
    "WebSocket connected",
  );

  wsHub.add(socket);
  const bootstrap = buildConnectionBootstrap();
  const connectionId = String(socketId);
  wsHub.send(socket, {
    type: "hello",
    connectionId,
    protocolVersion: 2,
    capabilities: ["bootstrap-chunks", "replay-complete", "connection-ready"],
    serverTime: Date.now(),
    lastEventId: db.lastEventId(),
  });
  wsHub.send(socket, { type: "bootstrap.begin", connectionId, serverTime: Date.now(), lastEventId: db.lastEventId() });
  sendBootstrapChunks(socket, connectionId, bootstrap);
  sendRuntimeBusyStates(socket, bootstrap.runtimes);
  sendRuntimeQueues(socket);
  sendRuntimeCommands(socket);
  sendPendingExtensionUiRequests(socket);
  wsHub.send(socket, { type: "bootstrap.complete", connectionId, serverTime: Date.now(), lastEventId: db.lastEventId() });
  const replayedEvents = replayEventsForConnection(socket, sinceEventId);
  wsHub.send(socket, { type: "replay.complete", connectionId, serverTime: Date.now(), lastEventId: db.lastEventId(), replayedEvents });
  wsHub.send(socket, {
    type: "connection.ready",
    connectionId,
    serverTime: Date.now(),
    lastEventId: db.lastEventId(),
  });

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

  const lifecycleSocket = socket as WsClient & {
    on(event: "close", listener: (code: number, reason: Buffer) => void): void;
    on(event: "error", listener: (error: Error) => void): void;
  };
  lifecycleSocket.on("close", (code: number, reason: Buffer) => {
    wsHub.remove(socket);
    fastify.log.info(
      { socketId, code, reason: reason?.toString("utf8") || undefined, activeSockets: wsHub.clientCount() },
      "WebSocket closed",
    );
  });
  lifecycleSocket.on("error", (error: Error) => {
    wsHub.remove(socket);
    fastify.log.warn({ socketId, error, activeSockets: wsHub.clientCount() }, "WebSocket error");
  });
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

function buildConnectionBootstrap() {
  const runtimes = supervisor.listRuntimes();
  const childSessionFiles = db.listChildSessionFiles();
  return {
    projects: decorateProjectsWithGitSummary(db.listProjects()),
    runtimes,
    settings: db.getSettings(),
    executionHost: db.getExecutionHost(),
    conversationSummaries: supervisor.listRuntimeConversationSummaries(100, runtimes),
    sessions: db.listSessionsPage(undefined, 200, undefined, { childSessionFiles }),
    // Keep bootstrap active-only for sub-agents; historical per-runtime runs are
    // still sent by `conversation.open` to keep initial payloads bounded.
    subagentRuns: supervisor.listActiveSubagentRuns(100),
    checkpointOperations: db.listRecentRewindCheckpointOperations(20),
    checkpointJumps: db.listRecentRewindJumpHistory(20),
  };
}

function sendBootstrapChunks(socket: WsClient, connectionId: string, bootstrap: ReturnType<typeof buildConnectionBootstrap>): void {
  wsHub.send(socket, { type: "bootstrap.chunk", connectionId, scope: "projects", projects: bootstrap.projects, executionHost: bootstrap.executionHost });
  wsHub.send(socket, { type: "bootstrap.chunk", connectionId, scope: "runtimes", runtimes: bootstrap.runtimes });
  wsHub.send(socket, { type: "bootstrap.chunk", connectionId, scope: "settings", settings: bootstrap.settings });
  wsHub.send(socket, {
    type: "bootstrap.chunk",
    connectionId,
    scope: "sessions",
    sessions: bootstrap.sessions.sessions,
    hasMore: bootstrap.sessions.hasMore,
    nextCursor: bootstrap.sessions.nextCursor,
  });
  wsHub.send(socket, { type: "bootstrap.chunk", connectionId, scope: "conversationSummaries", conversationSummaries: bootstrap.conversationSummaries });
  wsHub.send(socket, { type: "bootstrap.chunk", connectionId, scope: "subagents", subagentRuns: bootstrap.subagentRuns });
  wsHub.send(socket, {
    type: "bootstrap.chunk",
    connectionId,
    scope: "checkpoints",
    checkpointOperations: bootstrap.checkpointOperations,
    checkpointJumps: bootstrap.checkpointJumps,
  });
}

function sendRuntimeBusyStates(socket: WsClient, runtimes = supervisor.listRuntimes()): void {
  // `hello` intentionally carries lightweight runtime metadata only. Seed the
  // conversation-busy projection separately so a fresh/reconnected frontend can
  // color sidebar status dots without fetching every background conversation.
  for (const event of runtimeConversationBusyEvents(db, runtimes)) {
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

function sendPendingExtensionUiRequests(socket: WsClient): void {
  for (const pending of supervisor.listPendingExtensionUiRequests()) {
    wsHub.send(socket, { type: "extension.ui.request", ...pending });
  }
}

function replayEventsForConnection(socket: WsClient, sinceEventId: number | undefined): number {
  const replay = sinceEventId !== undefined
    ? db.listEventsBudgeted(sinceEventId, RECONNECT_REPLAY_LIMIT, 512 * 1024)
    : { events: db.recentEvents(300, 512 * 1024), truncated: false };
  const events = replay.events;
  if (sinceEventId !== undefined) {
    const gap = replayGapEventForReconnect({
      requestedSinceEventId: sinceEventId,
      firstEventId: db.firstEventId(),
      lastEventId: db.lastEventId(),
      replayedEventCount: events.length,
      lastReplayedEventId: events.at(-1)?.id,
      truncated: replay.truncated,
    });
    if (gap) wsHub.send(socket, gap);
  }
  for (const event of events) {
    wsHub.send(socket, { type: "gui.event", event });
  }
  return events.length;
}

function parseSinceEventId(request: FastifyRequest): number | undefined {
  const query = request.query;
  if (!query || typeof query !== "object" || !("sinceEventId" in query)) return undefined;
  const value = (query as { sinceEventId?: unknown }).sinceEventId;
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

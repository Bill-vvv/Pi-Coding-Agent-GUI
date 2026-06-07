import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyRequest } from "fastify";
import { AppDatabase } from "./db.js";
import { registerEnvironmentRoutes } from "./routes/environmentRoutes.js";
import { registerFsRoutes } from "./routes/fsRoutes.js";
import { registerImportRoutes } from "./routes/importRoutes.js";
import { registerUsageRoutes } from "./routes/usageRoutes.js";
import { registerVoiceRoutes } from "./routes/voiceRoutes.js";
import { RuntimeSupervisor } from "./runtime/runtimeSupervisor.js";
import { listPiModels } from "./services/modelService.js";
import { indexKnownPiSessions } from "./services/sessionIndexService.js";
import { VoiceTranscriptionService } from "./services/voiceInput/index.js";
import { createSocketMessageHandler } from "./ws/commandHandler.js";
import { WsHub, type WsClient } from "./ws/wsHub.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);
const allowedCorsOrigins = [
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^http:\/\/\[::1\](?::\d+)?$/,
];

const fastify = Fastify({ logger: true });
const db = new AppDatabase();
indexKnownPiSessions(db);
const wsHub = new WsHub();
const supervisor = new RuntimeSupervisor(db, (event) => wsHub.broadcast(event));
const voiceTranscriptionService = new VoiceTranscriptionService({ getSettings: () => db.getSettings() });
const handleSocketMessage = createSocketMessageHandler({
  db,
  supervisor,
  send: (socket, event) => wsHub.send(socket, event),
  broadcast: (event) => wsHub.broadcast(event),
});

await fastify.register(cors, { origin: allowedCorsOrigins });
await fastify.register(websocket);
await registerFsRoutes(fastify);
await registerImportRoutes(fastify);
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

await fastify.listen({ host, port });

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

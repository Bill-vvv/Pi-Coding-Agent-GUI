import type { RemoteAccessRestartResponse, RemoteAccessUpdateRequest } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { FastifyInstance } from "fastify";
import { isHttpRequestAuthorized } from "../services/authService.js";
import type { RemoteAccessService } from "../services/remoteAccessService.js";

export type RemoteAccessRouteOptions = {
  restartServer?: () => void | Promise<void>;
  restartDelayMs?: number;
};

const DEFAULT_RESTART_DELAY_MS = 250;
const RECONNECT_DELAY_MS = 1200;

export async function registerRemoteAccessRoutes(fastify: FastifyInstance, service: RemoteAccessService, options: RemoteAccessRouteOptions = {}): Promise<void> {
  fastify.get("/api/remote-access/status", async () => service.getStatus());
  fastify.get("/api/remote-access/pairing", async () => service.getPairingInfo());
  fastify.post("/api/remote-access/windows-portproxy", async (request, reply) => {
    if (!isHttpRequestAuthorized(request, { authRequired: () => true, getAuthToken: () => service.windowsPortProxySetupAuthToken() })) {
      await reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    return service.configureWindowsPortProxy();
  });
  fastify.post("/api/remote-access", async (request) => service.update(parseRemoteAccessUpdateRequest(request.body)));
  fastify.post("/api/remote-access/restart", async () => {
    if (!options.restartServer) throw new Error("Pi GUI server restart is not available in this launch mode");
    const response: RemoteAccessRestartResponse = {
      accepted: true,
      reconnectDelayMs: RECONNECT_DELAY_MS,
      message: "Pi GUI server restart requested. The connection may drop briefly while the server relaunches.",
      status: service.getStatus(),
    };
    setTimeout(() => {
      void Promise.resolve(options.restartServer?.()).catch((error) => fastify.log.error({ error }, "Remote Access server restart failed"));
    }, options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS).unref?.();
    return response;
  });
}

function parseRemoteAccessUpdateRequest(value: unknown): RemoteAccessUpdateRequest {
  if (!isRecord(value)) throw new Error("remote access update requires an object body");
  return {
    enabled: booleanOrUndefined(value.enabled, "enabled"),
    selectedHost: stringOrUndefined(value.selectedHost, "selectedHost"),
    rotateToken: booleanOrUndefined(value.rotateToken, "rotateToken"),
    clearToken: booleanOrUndefined(value.clearToken, "clearToken"),
  };
}

function booleanOrUndefined(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`remote access ${field} must be a boolean`);
  return value;
}

function stringOrUndefined(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`remote access ${field} must be a string`);
  return value;
}

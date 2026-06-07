import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ServerRuntimeConfig } from "./serverConfig.js";

const TOKEN_QUERY_KEYS = new Set(["token", "authToken", "access_token"]);

export type AuthTokenProvider = {
  authRequired(): boolean;
  getAuthToken(): string | undefined;
};

export function authProviderFromConfig(config: ServerRuntimeConfig): AuthTokenProvider {
  return {
    authRequired: () => config.authRequired,
    getAuthToken: () => config.authToken,
  };
}

export function registerApiAuth(fastify: FastifyInstance, configOrProvider: ServerRuntimeConfig | AuthTokenProvider): void {
  const provider = normalizeAuthProvider(configOrProvider);

  fastify.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    if (request.method === "OPTIONS") return;
    if (isHttpRequestAuthorized(request, provider)) return;
    await reply.code(401).send({ error: "Unauthorized" });
  });
}

export function isHttpRequestAuthorized(request: FastifyRequest, configOrProvider: ServerRuntimeConfig | AuthTokenProvider): boolean {
  const provider = normalizeAuthProvider(configOrProvider);
  if (!provider.authRequired()) return true;
  return tokenMatches(bearerToken(request.headers.authorization), provider.getAuthToken());
}

export function isWebSocketRequestAuthorized(request: FastifyRequest, configOrProvider: ServerRuntimeConfig | AuthTokenProvider): boolean {
  const provider = normalizeAuthProvider(configOrProvider);
  if (!provider.authRequired()) return true;
  const queryToken = queryStringValue((request.query as Record<string, unknown> | undefined)?.token);
  const expectedToken = provider.getAuthToken();
  return tokenMatches(queryToken, expectedToken) || tokenMatches(bearerToken(request.headers.authorization), expectedToken);
}

export function redactTokenInUrl(url: string): string {
  if (!url.includes("?")) return url;
  try {
    const parsed = new URL(url, "http://pi-gui.local");
    let changed = false;
    for (const key of TOKEN_QUERY_KEYS) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }
    return changed ? `${parsed.pathname}${parsed.search}` : url;
  } catch {
    return url.replace(/([?&](?:token|authToken|access_token)=)[^&]*/gi, "$1[redacted]");
  }
}

function normalizeAuthProvider(configOrProvider: ServerRuntimeConfig | AuthTokenProvider): AuthTokenProvider {
  if ("authRequired" in configOrProvider && typeof configOrProvider.authRequired === "function") return configOrProvider;
  return authProviderFromConfig(configOrProvider);
}

function bearerToken(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function queryStringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function tokenMatches(candidate: string | undefined, expected: string | undefined): boolean {
  if (!expected || !candidate) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  if (candidateBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}

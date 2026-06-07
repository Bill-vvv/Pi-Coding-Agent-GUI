import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type BuiltWebRouteOptions = {
  remoteLan: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  moduleDir?: string;
};

export async function registerBuiltWebUiRoutes(fastify: FastifyInstance, options: BuiltWebRouteOptions): Promise<void> {
  if (!shouldServeBuiltWebUi(options.remoteLan, options.env)) return;
  const webDistDir = resolveWebDistDir(options);
  if (!webDistDir) {
    fastify.log.warn("PI GUI remote-lan mode is active but apps/web/dist was not found; run `npm run build -w @pi-gui/web` before serving the phone UI");
    return;
  }

  await fastify.register(fastifyStatic, { root: webDistDir, wildcard: false });
  fastify.get("/*", async (request, reply) => {
    const pathname = requestPathname(request.url);
    if (isReservedBackendPath(pathname)) {
      await reply.code(404).send({ error: "Not Found" });
      return;
    }
    if (looksLikeStaticAsset(pathname)) {
      await reply.sendFile(pathname.slice(1));
      return;
    }
    await reply.sendFile("index.html");
  });
  fastify.log.info({ webDistDir }, "Serving built Pi GUI web UI from backend same-origin route");
}

export function shouldServeBuiltWebUi(remoteLan: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return remoteLan || env.PI_GUI_SERVE_WEB === "1";
}

export function resolveWebDistDir({ env = process.env, cwd = process.cwd(), moduleDir = dirname(fileURLToPath(import.meta.url)) }: BuiltWebRouteOptions): string | undefined {
  const candidates = [
    env.PI_GUI_WEB_DIST?.trim(),
    resolve(cwd, "apps/web/dist"),
    resolve(cwd, "../web/dist"),
    resolve(moduleDir, "../../web/dist"),
    resolve(moduleDir, "../../../apps/web/dist"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(resolve(candidate, "index.html")));
}

export function isReservedBackendPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/") || pathname === "/ws" || pathname.startsWith("/ws/") || pathname === "/health" || pathname.startsWith("/health/");
}

function requestPathname(url: string): string {
  try {
    return new URL(url, "http://pi-gui.local").pathname;
  } catch {
    return url.split("?")[0] || "/";
  }
}

function looksLikeStaticAsset(pathname: string): boolean {
  return /\.[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(pathname);
}

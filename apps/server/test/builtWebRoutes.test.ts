import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { isReservedBackendPath, registerBuiltWebUiRoutes, resolveWebDistDir, shouldServeBuiltWebUi } from "../src/routes/builtWebRoutes.js";

test("built web routes serve SPA and assets without shadowing backend routes", async (t) => {
  const { rootDir, distDir, cleanup } = await createWebDist(t);
  const fastify = Fastify({ logger: false });
  fastify.get("/api/projects", async () => ({ projects: [] }));
  fastify.get("/health", async () => ({ ok: true }));
  await registerBuiltWebUiRoutes(fastify, { remoteLan: true, env: {}, cwd: rootDir, moduleDir: rootDir });
  t.after(() => fastify.close());

  assert.equal(resolveWebDistDir({ remoteLan: true, env: {}, cwd: rootDir, moduleDir: rootDir }), distDir);

  const index = await fastify.inject({ method: "GET", url: "/" });
  assert.equal(index.statusCode, 200);
  assert.match(index.body, /Pi GUI shell/);

  const nestedSpaRoute = await fastify.inject({ method: "GET", url: "/projects/demo/session" });
  assert.equal(nestedSpaRoute.statusCode, 200);
  assert.match(nestedSpaRoute.body, /Pi GUI shell/);

  const asset = await fastify.inject({ method: "GET", url: "/assets/app.js" });
  assert.equal(asset.statusCode, 200);
  assert.match(asset.body, /asset-ok/);

  const api = await fastify.inject({ method: "GET", url: "/api/projects" });
  assert.equal(api.statusCode, 200);
  assert.deepEqual(api.json(), { projects: [] });

  const missingApi = await fastify.inject({ method: "GET", url: "/api/missing" });
  assert.equal(missingApi.statusCode, 404);
  assert.doesNotMatch(missingApi.body, /Pi GUI shell/);

  const health = await fastify.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { ok: true });

  await cleanup();
});

test("built web route helpers gate serving to remote-lan or explicit env", () => {
  assert.equal(shouldServeBuiltWebUi(false, {}), false);
  assert.equal(shouldServeBuiltWebUi(true, {}), true);
  assert.equal(shouldServeBuiltWebUi(false, { PI_GUI_SERVE_WEB: "1" }), true);
  assert.equal(isReservedBackendPath("/api/remote-access/status"), true);
  assert.equal(isReservedBackendPath("/ws"), true);
  assert.equal(isReservedBackendPath("/health"), true);
  assert.equal(isReservedBackendPath("/projects/demo"), false);
});

async function createWebDist(t: { after: (fn: () => unknown) => void }) {
  const rootDir = await mkdtemp(join(tmpdir(), "pi-gui-built-web-test-"));
  const distDir = join(rootDir, "apps", "web", "dist");
  await mkdir(join(distDir, "assets"), { recursive: true });
  await writeFile(join(distDir, "index.html"), "<!doctype html><title>Pi GUI shell</title>", "utf8");
  await writeFile(join(distDir, "assets", "app.js"), "console.log('asset-ok')", "utf8");
  let cleaned = false;
  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    await rm(rootDir, { recursive: true, force: true });
  }
  t.after(() => cleanup());
  return { rootDir, distDir, cleanup };
}

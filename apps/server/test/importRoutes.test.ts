import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { registerImportRoutes } from "../src/routes/importRoutes.js";

test("import route stores dropped file bytes with a sanitized name", async (t) => {
  const importDir = await mkdtemp(join(tmpdir(), "pi-gui-import-route-"));
  const env = installImportEnv({ PI_GUI_IMPORT_DIR: importDir });
  t.after(async () => {
    env.restore();
    await rm(importDir, { recursive: true, force: true });
  });

  const fastify = Fastify({ logger: false });
  await registerImportRoutes(fastify);
  t.after(() => fastify.close());

  const payload = Buffer.from("hello from drag drop", "utf8");
  const response = await fastify.inject({
    method: "POST",
    url: "/api/imports/file?name=../bad\\name.txt",
    headers: { "content-type": "application/octet-stream" },
    payload,
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { path?: unknown; name?: unknown; size?: unknown };
  assert.equal(body.name, ".._bad_name.txt");
  assert.equal(body.size, payload.length);
  const importedPath = body.path;
  assert.ok(typeof importedPath === "string");
  assert.ok(importedPath.startsWith(`${importDir}/`));
  assert.equal(await readFile(importedPath, "utf8"), payload.toString("utf8"));
});

test("import route rejects oversized raster images before staging provider-context hazards", async (t) => {
  const importDir = await mkdtemp(join(tmpdir(), "pi-gui-import-route-"));
  const env = installImportEnv({ PI_GUI_IMPORT_DIR: importDir });
  t.after(async () => {
    env.restore();
    await rm(importDir, { recursive: true, force: true });
  });

  const fastify = Fastify({ logger: false });
  await registerImportRoutes(fastify);
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: "POST",
    url: "/api/imports/file?name=page.png",
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.alloc(7 * 1024 * 1024),
  });

  assert.equal(response.statusCode, 413);
  const body = response.json() as { message?: unknown };
  assert.match(typeof body.message === "string" ? body.message : "", /message too big/);
  assert.deepEqual(await readdir(importDir).catch(() => []), []);
});

test("import route resolves relative import directories to absolute response paths", async (t) => {
  const importDir = `relative-pi-gui-import-${Date.now()}`;
  const env = installImportEnv({ PI_GUI_IMPORT_DIR: importDir });
  t.after(async () => {
    env.restore();
    await rm(importDir, { recursive: true, force: true });
  });

  const fastify = Fastify({ logger: false });
  await registerImportRoutes(fastify);
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: "POST",
    url: "/api/imports/file?name=relative.txt",
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from("relative", "utf8"),
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { path?: unknown };
  assert.ok(typeof body.path === "string");
  assert.ok(isAbsolute(body.path));
  assert.equal(await readFile(body.path, "utf8"), "relative");
});

test("import route removes expired staged files before storing a new drop", async (t) => {
  const importDir = await mkdtemp(join(tmpdir(), "pi-gui-import-route-"));
  const env = installImportEnv({ PI_GUI_IMPORT_DIR: importDir, PI_GUI_IMPORT_TTL_MS: "1000" });
  t.after(async () => {
    env.restore();
    await rm(importDir, { recursive: true, force: true });
  });

  const stalePath = join(importDir, "stale.txt");
  await writeFile(stalePath, "old", "utf8");
  const oldDate = new Date(Date.now() - 10_000);
  await utimes(stalePath, oldDate, oldDate);

  const fastify = Fastify({ logger: false });
  await registerImportRoutes(fastify);
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: "POST",
    url: "/api/imports/file?name=fresh.txt",
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from("fresh", "utf8"),
  });

  assert.equal(response.statusCode, 200);
  const entries = await readdir(importDir);
  assert.ok(entries.some((entry) => entry.endsWith("fresh.txt")));
  assert.ok(!entries.includes("stale.txt"));
});

test("import route enforces directory quota while preserving the newly uploaded file", async (t) => {
  const importDir = await mkdtemp(join(tmpdir(), "pi-gui-import-route-"));
  const env = installImportEnv({ PI_GUI_IMPORT_DIR: importDir, PI_GUI_IMPORT_MAX_DIR_BYTES: "12" });
  t.after(async () => {
    env.restore();
    await rm(importDir, { recursive: true, force: true });
  });

  const oldPath = join(importDir, "old.txt");
  await writeFile(oldPath, "old-old-old", "utf8");
  const oldDate = new Date(Date.now() - 10_000);
  await utimes(oldPath, oldDate, oldDate);

  const fastify = Fastify({ logger: false });
  await registerImportRoutes(fastify);
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: "POST",
    url: "/api/imports/file?name=new.txt",
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from("new", "utf8"),
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { path?: unknown };
  assert.ok(typeof body.path === "string");
  assert.equal(await readFile(body.path, "utf8"), "new");
  const entries = await readdir(importDir);
  assert.ok(entries.some((entry) => entry.endsWith("new.txt")));
  assert.ok(!entries.includes("old.txt"));
});

function installImportEnv(values: Record<string, string>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return {
    restore() {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

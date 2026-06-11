import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { registerFsRoutes, resetFileSearchCacheForTest } from "../src/routes/fsRoutes.js";

test("fs resolve route resolves existing Linux directories", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-gui-fs-route-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fastify = Fastify({ logger: false });
  await registerFsRoutes(fastify);
  t.after(() => fastify.close());

  const response = await fastify.inject({ method: "POST", url: "/api/fs/resolve", payload: { path: dir } });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { cwd?: unknown; exists?: unknown; isDirectory?: unknown; source?: unknown };
  assert.equal(body.cwd, dir);
  assert.equal(body.exists, true);
  assert.equal(body.isDirectory, true);
  assert.equal(body.source, "linux");
});

test("fs resolve route resolves SSH project specs without local filesystem checks", async (t) => {
  const fastify = Fastify({ logger: false });
  await registerFsRoutes(fastify);
  t.after(() => fastify.close());

  const response = await fastify.inject({ method: "POST", url: "/api/fs/resolve", payload: { path: "devbox:/srv/app" } });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { cwd?: unknown; exists?: unknown; isDirectory?: unknown; source?: unknown };
  assert.equal(body.cwd, "devbox:/srv/app");
  assert.equal(body.exists, true);
  assert.equal(body.isDirectory, true);
  assert.equal(body.source, "ssh");
});

test("fs resolve route returns stable errors for relative and non-directory paths", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-gui-fs-route-"));
  const file = join(dir, "file.txt");
  await writeFile(file, "not a directory");
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fastify = Fastify({ logger: false });
  await registerFsRoutes(fastify);
  t.after(() => fastify.close());

  const relative = await fastify.inject({ method: "POST", url: "/api/fs/resolve", payload: { path: "relative/project" } });
  assert.equal(relative.statusCode, 200);
  assert.equal((relative.json() as { errorCode?: unknown }).errorCode, "relative_path");

  const nonDirectory = await fastify.inject({ method: "POST", url: "/api/fs/resolve", payload: { path: file } });
  assert.equal(nonDirectory.statusCode, 200);
  const body = nonDirectory.json() as { exists?: unknown; isDirectory?: unknown; errorCode?: unknown };
  assert.equal(body.exists, true);
  assert.equal(body.isDirectory, false);
  assert.equal(body.errorCode, "path_not_directory");
});

test("fs search route returns bounded file and directory matches", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-gui-fs-route-"));
  await mkdir(join(dir, "src"));
  await writeFile(join(dir, "src", "App.tsx"), "export function App() {}");
  await writeFile(join(dir, "README.md"), "readme");
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fastify = Fastify({ logger: false });
  await registerFsRoutes(fastify);
  t.after(() => fastify.close());

  const response = await fastify.inject({ method: "GET", url: `/api/fs/search?root=${encodeURIComponent(dir)}&q=app&limit=5` });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { root?: unknown; entries?: Array<{ relativePath?: unknown; type?: unknown }> };
  assert.equal(body.root, dir);
  assert.deepEqual(body.entries, [{ name: "App.tsx", path: join(dir, "src", "App.tsx"), relativePath: "src/App.tsx", type: "file" }]);
});

test("fs search route cache invalidates when root directory changes", async (t) => {
  resetFileSearchCacheForTest();
  const dir = await mkdtemp(join(tmpdir(), "pi-gui-fs-route-cache-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => resetFileSearchCacheForTest());
  const fastify = Fastify({ logger: false });
  await registerFsRoutes(fastify);
  t.after(() => fastify.close());

  const before = await fastify.inject({ method: "GET", url: `/api/fs/search?root=${encodeURIComponent(dir)}&q=new&limit=5` });
  assert.equal(before.statusCode, 200);
  assert.deepEqual((before.json() as { entries?: unknown[] }).entries, []);

  await writeFile(join(dir, "new-file.txt"), "x");
  const after = await fastify.inject({ method: "GET", url: `/api/fs/search?root=${encodeURIComponent(dir)}&q=new&limit=5` });
  assert.equal(after.statusCode, 200);
  assert.deepEqual((after.json() as { entries?: Array<{ relativePath?: unknown }> }).entries?.map((entry) => entry.relativePath), ["new-file.txt"]);
});

test("fs search route clamps oversized result limits", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-gui-fs-route-"));
  for (let index = 0; index < 120; index += 1) {
    await writeFile(join(dir, `file-${index}.txt`), "x");
  }
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fastify = Fastify({ logger: false });
  await registerFsRoutes(fastify);
  t.after(() => fastify.close());

  const response = await fastify.inject({ method: "GET", url: `/api/fs/search?root=${encodeURIComponent(dir)}&limit=500` });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { entries?: unknown[] };
  assert.equal(body.entries?.length, 100);
});

test("fs mkdir route creates a child directory and returns its listing", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-gui-fs-route-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fastify = Fastify({ logger: false });
  await registerFsRoutes(fastify);
  t.after(() => fastify.close());

  const response = await fastify.inject({ method: "POST", url: "/api/fs/mkdir", payload: { parent: dir, name: "new-project" } });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { cwd?: unknown; parent?: unknown; entries?: unknown };
  const created = join(dir, "new-project");
  assert.equal(body.cwd, created);
  assert.equal(body.parent, dir);
  assert.deepEqual(body.entries, []);
  assert.equal((await stat(created)).isDirectory(), true);
});

test("fs mkdir route rejects invalid folder names and existing targets", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-gui-fs-route-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fastify = Fastify({ logger: false });
  await registerFsRoutes(fastify);
  t.after(() => fastify.close());

  const missingParent = await fastify.inject({ method: "POST", url: "/api/fs/mkdir", payload: { name: "new-project" } });
  assert.equal(missingParent.statusCode, 500);
  assert.match(missingParent.body, /parent path is required/);

  for (const name of ["nested/project", "/absolute", ".", ".."] as const) {
    const invalid = await fastify.inject({ method: "POST", url: "/api/fs/mkdir", payload: { parent: dir, name } });
    assert.equal(invalid.statusCode, 500);
    assert.match(invalid.body, /single directory name|must not be/);
  }

  const ok = await fastify.inject({ method: "POST", url: "/api/fs/mkdir", payload: { parent: dir, name: "existing" } });
  assert.equal(ok.statusCode, 200);
  const existing = await fastify.inject({ method: "POST", url: "/api/fs/mkdir", payload: { parent: dir, name: "existing" } });
  assert.equal(existing.statusCode, 500);
  assert.match(existing.body, /already exists/);
});

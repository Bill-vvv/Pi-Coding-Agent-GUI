import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { registerImportRoutes } from "../src/routes/importRoutes.js";

test("import route stores dropped file bytes with a sanitized name", async (t) => {
  const importDir = await mkdtemp(join(tmpdir(), "pi-gui-import-route-"));
  const previousImportDir = process.env.PI_GUI_IMPORT_DIR;
  process.env.PI_GUI_IMPORT_DIR = importDir;
  t.after(async () => {
    if (previousImportDir === undefined) delete process.env.PI_GUI_IMPORT_DIR;
    else process.env.PI_GUI_IMPORT_DIR = previousImportDir;
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

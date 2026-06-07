import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { AppDatabase } from "../src/db.js";
import { registerUsageRoutes } from "../src/routes/usageRoutes.js";
import { TokenUsageService } from "../src/services/tokenUsageService.js";

test("usage route returns a safe empty overview when scanning fails", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-usage-route-"));
  const db = new AppDatabase(join(dir, "pi-gui.sqlite"));
  const service = new TokenUsageService();
  service.getOverview = () => {
    throw new Error("scan failed");
  };

  const fastify = Fastify({ logger: false });
  await registerUsageRoutes(fastify, { db, service });
  t.after(async () => {
    await fastify.close();
    db.close();
  });

  const response = await fastify.inject({ method: "GET", url: "/api/usage/overview?range=all&projectId=project-a" });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { usage?: { range?: unknown; projectId?: unknown; summary?: { totalTokens?: unknown; quality?: unknown } } };
  assert.equal(body.usage?.range, "all");
  assert.equal(body.usage?.projectId, "project-a");
  assert.equal(body.usage?.summary?.totalTokens, 0);
  assert.equal(body.usage?.summary?.quality, "empty");
});

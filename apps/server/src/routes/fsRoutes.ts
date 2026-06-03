import type { FastifyInstance } from "fastify";
import { readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function registerFsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/fs/list", async (request) => {
    const query = request.query as { path?: string };
    const requestedPath = query.path?.trim() || process.env.HOME || "/";
    const cwd = resolve(requestedPath);
    const cwdStat = await stat(cwd);
    if (!cwdStat.isDirectory()) throw new Error(`path is not a directory: ${cwd}`);

    const entries = await readdir(cwd, { withFileTypes: true });
    return {
      cwd,
      parent: cwd === "/" ? undefined : dirname(cwd),
      entries: entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({ name: entry.name, path: resolve(cwd, entry.name), type: "directory" as const }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  });
}

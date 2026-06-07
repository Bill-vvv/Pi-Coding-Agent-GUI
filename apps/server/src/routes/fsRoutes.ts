import type { DirectoryListing, ResolvedPath } from "@pi-gui/shared";
import type { FastifyInstance } from "fastify";
import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { resolveProjectPath } from "../services/pathResolutionService.js";

type FsRouteOptions = {
  resolvePath?: typeof resolveProjectPath;
};

type FileSearchEntry = {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory";
};

type FileSearchResponse = {
  root: string;
  query: string;
  entries: FileSearchEntry[];
};

export async function registerFsRoutes(fastify: FastifyInstance, options: FsRouteOptions = {}): Promise<void> {
  const resolvePath = options.resolvePath ?? resolveProjectPath;
  fastify.post("/api/fs/resolve", async (request): Promise<ResolvedPath> => {
    const body = request.body as { path?: unknown } | undefined;
    const path = typeof body?.path === "string" ? body.path : "";
    return resolvePath(path);
  });

  fastify.get("/api/fs/list", async (request) => {
    const query = request.query as { path?: string };
    const requestedPath = query.path?.trim() || process.env.HOME || "/";
    return listDirectory(requestedPath);
  });

  fastify.get("/api/fs/search", async (request): Promise<FileSearchResponse> => {
    const query = request.query as { root?: string; q?: string; limit?: string };
    const root = query.root?.trim();
    if (!root) throw new Error("root path is required");
    const limit = boundedLimit(query.limit);
    return searchProjectFiles(root, query.q ?? "", limit);
  });

  fastify.post("/api/fs/mkdir", async (request) => {
    const body = request.body as { parent?: unknown; name?: unknown } | undefined;
    const parent = typeof body?.parent === "string" ? body.parent.trim() : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!parent) throw new Error("parent path is required");
    validateDirectoryName(name);

    const parentListing = await listDirectory(parent);
    const target = resolve(parentListing.cwd, name);
    try {
      await mkdir(target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") throw new Error(`directory already exists: ${target}`);
      throw error;
    }
    return listDirectory(target);
  });
}

async function listDirectory(path: string): Promise<DirectoryListing> {
  const cwd = resolve(path);
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
}

async function searchProjectFiles(rootPath: string, query: string, limit: number): Promise<FileSearchResponse> {
  const root = resolve(rootPath);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error(`root is not a directory: ${root}`);

  const normalizedQuery = query.trim().toLowerCase().replace(/^@/, "");
  const entries: FileSearchEntry[] = [];
  await walkSearch(root, root, normalizedQuery, entries, { limit, visited: 0, maxVisited: FILE_SEARCH_MAX_VISITED });
  entries.sort((left, right) => fileSearchRank(left.relativePath, normalizedQuery) - fileSearchRank(right.relativePath, normalizedQuery) || left.relativePath.localeCompare(right.relativePath));
  return { root, query, entries: entries.slice(0, limit) };
}

async function walkSearch(root: string, cwd: string, query: string, entries: FileSearchEntry[], budget: { limit: number; visited: number; maxVisited: number }): Promise<void> {
  if (entries.length >= budget.limit || budget.visited >= budget.maxVisited) return;
  let children: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    children = await readdir(cwd, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return;
  }

  for (const child of children) {
    if (entries.length >= budget.limit || budget.visited >= budget.maxVisited) return;
    if (shouldSkipSearchEntry(child.name)) continue;
    budget.visited += 1;
    const absolutePath = resolve(cwd, child.name);
    const relativePath = relative(root, absolutePath);
    if (child.isDirectory()) {
      if (matchesFileQuery(relativePath, query)) entries.push({ name: child.name, path: absolutePath, relativePath, type: "directory" });
      await walkSearch(root, absolutePath, query, entries, budget);
      continue;
    }
    if (!child.isFile() || !matchesFileQuery(relativePath, query)) continue;
    entries.push({ name: child.name, path: absolutePath, relativePath, type: "file" });
  }
}

function matchesFileQuery(relativePath: string, query: string): boolean {
  if (!query) return true;
  return relativePath.toLowerCase().includes(query);
}

function fileSearchRank(relativePath: string, query: string): number {
  const lower = relativePath.toLowerCase();
  if (!query) return relativePath.split("/").length;
  if (lower === query) return 0;
  if (lower.startsWith(query)) return 1;
  if (lower.split("/").some((part) => part.startsWith(query))) return 2;
  return 3;
}

function shouldSkipSearchEntry(name: string): boolean {
  return name === ".git" || name === "node_modules" || name === "dist" || name === "build" || name === ".next" || name === ".turbo";
}

function boundedLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return 40;
  return Math.min(100, Math.max(1, parsed));
}

const FILE_SEARCH_MAX_VISITED = 2000;

function validateDirectoryName(name: string): void {
  if (!name) throw new Error("folder name is required");
  if (name === "." || name === "..") throw new Error("folder name must not be . or ..");
  if (isAbsolute(name) || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error("folder name must be a single directory name");
  }
}

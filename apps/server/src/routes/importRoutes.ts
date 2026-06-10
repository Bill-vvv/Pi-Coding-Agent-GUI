import type { ImportedFileResponse } from "@pi-gui/shared";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";

const MAX_IMPORT_FILE_BYTES = 100 * 1024 * 1024;
const MAX_SAFE_IMAGE_IMPORT_FILE_BYTES = 6 * 1024 * 1024;
const DEFAULT_IMPORT_FILE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_IMPORT_DIR_MAX_BYTES = 512 * 1024 * 1024;

export async function registerImportRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_IMPORT_FILE_BYTES }, (_request, body, done) => {
    done(null, body);
  });

  fastify.post("/api/imports/file", { bodyLimit: MAX_IMPORT_FILE_BYTES }, async (request): Promise<ImportedFileResponse> => {
    const query = request.query as { name?: unknown };
    const body = request.body;
    if (!Buffer.isBuffer(body)) {
      throw new Error("Expected application/octet-stream file body");
    }

    const name = sanitizeImportFileName(typeof query.name === "string" ? query.name : "dropped-file");
    assertSafeImportedFile(name, body);

    const importDir = importDirectory();
    await mkdir(importDir, { recursive: true });
    await cleanupImportDirectory(importDir, { now: Date.now() });

    const path = join(importDir, `${Date.now()}-${randomUUID()}-${name}`);
    await writeFile(path, body);
    await cleanupImportDirectory(importDir, { now: Date.now(), preservePath: path });

    return { path, name, size: body.length };
  });
}

export async function cleanupImportDirectory(importDir: string, options: { now: number; preservePath?: string }): Promise<void> {
  const ttlMs = importFileTtlMs();
  const maxBytes = importDirectoryMaxBytes();
  const files = await importDirectoryFiles(importDir);
  const remaining: ImportDirectoryFile[] = [];

  for (const file of files) {
    if (file.path !== options.preservePath && options.now - file.mtimeMs > ttlMs) {
      await rm(file.path, { force: true }).catch(() => undefined);
    } else {
      remaining.push(file);
    }
  }

  let totalBytes = remaining.reduce((total, file) => total + file.size, 0);
  if (totalBytes <= maxBytes) return;

  for (const file of remaining.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (totalBytes <= maxBytes) break;
    if (file.path === options.preservePath) continue;
    await rm(file.path, { force: true }).catch(() => undefined);
    totalBytes -= file.size;
  }
}

function importDirectory(): string {
  return resolve(process.env.PI_GUI_IMPORT_DIR || join(tmpdir(), "pi-gui-imports"));
}

function importFileTtlMs(): number {
  return positiveEnvNumber("PI_GUI_IMPORT_TTL_MS", DEFAULT_IMPORT_FILE_TTL_MS);
}

function importDirectoryMaxBytes(): number {
  return positiveEnvNumber("PI_GUI_IMPORT_MAX_DIR_BYTES", DEFAULT_IMPORT_DIR_MAX_BYTES);
}

function positiveEnvNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeImportFileName(name: string): string {
  const normalized = name.normalize("NFC").replace(/[\\/\0\r\n\t]/g, "_").trim();
  const withoutControlChars = normalized.replace(/[\u0000-\u001f\u007f]/g, "_");
  return withoutControlChars.slice(0, 160) || "dropped-file";
}

function assertSafeImportedFile(name: string, body: Buffer): void {
  if (!isRasterImageImportName(name) || body.length <= MAX_SAFE_IMAGE_IMPORT_FILE_BYTES) return;
  const error = new Error(
    `Image import is too large (${formatBytes(body.length)}). High-resolution image batches can be resent as embedded base64 context and trigger WebSocket 1009/message too big; compress, reduce resolution, split the batch, or use a file path reference before sending.`,
  );
  (error as Error & { statusCode?: number }).statusCode = 413;
  throw error;
}

function isRasterImageImportName(name: string): boolean {
  return /\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.floor(bytes)} B`;
}

type ImportDirectoryFile = {
  path: string;
  size: number;
  mtimeMs: number;
};

async function importDirectoryFiles(importDir: string): Promise<ImportDirectoryFile[]> {
  const entries = await readdir(importDir, { withFileTypes: true }).catch(() => []);
  const files: ImportDirectoryFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(importDir, entry.name);
    const fileStat = await stat(path).catch(() => undefined);
    if (!fileStat?.isFile()) continue;
    files.push({ path, size: fileStat.size, mtimeMs: fileStat.mtimeMs });
  }
  return files;
}

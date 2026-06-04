import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

const MAX_IMPORT_FILE_BYTES = 100 * 1024 * 1024;

export async function registerImportRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_IMPORT_FILE_BYTES }, (_request, body, done) => {
    done(null, body);
  });

  fastify.post("/api/imports/file", { bodyLimit: MAX_IMPORT_FILE_BYTES }, async (request) => {
    const query = request.query as { name?: unknown };
    const body = request.body;
    if (!Buffer.isBuffer(body)) {
      throw new Error("Expected application/octet-stream file body");
    }

    const importDir = importDirectory();
    await mkdir(importDir, { recursive: true });
    const name = sanitizeImportFileName(typeof query.name === "string" ? query.name : "dropped-file");
    const path = join(importDir, `${Date.now()}-${randomUUID()}-${name}`);
    await writeFile(path, body);

    return { path, name, size: body.length };
  });
}

function importDirectory(): string {
  return process.env.PI_GUI_IMPORT_DIR || join(tmpdir(), "pi-gui-imports");
}

function sanitizeImportFileName(name: string): string {
  const normalized = name.normalize("NFC").replace(/[\\/\0\r\n\t]/g, "_").trim();
  const withoutControlChars = normalized.replace(/[\u0000-\u001f\u007f]/g, "_");
  return withoutControlChars.slice(0, 160) || "dropped-file";
}

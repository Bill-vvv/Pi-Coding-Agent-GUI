import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredObjectResult {
  hash: string;
  size: number;
  existed: boolean;
}

export class RewindObjectStore {
  private readonly objectRoot: string;
  private readonly tmpRoot: string;

  constructor(private readonly storeRoot: string) {
    this.objectRoot = join(storeRoot, "objects", "sha256");
    this.tmpRoot = join(storeRoot, "tmp");
  }

  async storeBytes(bytes: Buffer): Promise<StoredObjectResult> {
    const hash = sha256(bytes);
    const objectPath = this.objectPath(hash);
    if (await exists(objectPath)) return { hash, size: bytes.byteLength, existed: true };

    await mkdir(dirname(objectPath), { recursive: true });
    await mkdir(this.tmpRoot, { recursive: true });
    const tmpPath = join(this.tmpRoot, `${hash}.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(tmpPath, bytes, { flag: "wx" });
    try {
      await rename(tmpPath, objectPath);
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      if (await exists(objectPath)) return { hash, size: bytes.byteLength, existed: true };
      throw error;
    }
    return { hash, size: bytes.byteLength, existed: false };
  }

  async hasObject(hash: string): Promise<boolean> {
    return exists(this.objectPath(hash));
  }

  async readObject(hash: string): Promise<Buffer> {
    const objectPath = this.objectPath(hash);
    const handle = await open(objectPath, "r");
    try {
      const fileStat = await handle.stat();
      const buffer = Buffer.alloc(fileStat.size);
      await handle.read(buffer, 0, fileStat.size, 0);
      const actual = sha256(buffer);
      if (actual !== hash) throw new Error(`Rewind object hash mismatch for ${hash}`);
      return buffer;
    } finally {
      await handle.close();
    }
  }

  objectPath(hash: string): string {
    validateSha256(hash);
    return join(this.objectRoot, hash.slice(0, 2), hash.slice(2, 4), hash);
  }
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

function validateSha256(hash: string): void {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Invalid SHA-256 object id: ${hash}`);
}

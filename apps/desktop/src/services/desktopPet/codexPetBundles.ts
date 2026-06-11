import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { CodexPetBundle } from "./types.js";

export type DiscoverCodexPetBundlesOptions = {
  repoRoot: string;
  userHome?: string;
};

export function discoverCodexPetBundles(options: DiscoverCodexPetBundlesOptions): CodexPetBundle[] {
  const bundles: CodexPetBundle[] = [];
  const bundledDir = resolve(options.repoRoot, "apps", "desktop", "assets", "pets");
  bundles.push(...discoverBundlesInDirectory(bundledDir, "bundled"));

  const codexPetsDir = resolve(options.userHome ?? homedir(), ".codex", "pets");
  bundles.push(...discoverBundlesInDirectory(codexPetsDir, "codex"));

  const deduped = new Map<string, CodexPetBundle>();
  for (const bundle of bundles) {
    if (!deduped.has(bundle.id)) deduped.set(bundle.id, bundle);
  }
  return [...deduped.values()];
}

export function discoverBundlesInDirectory(parentDir: string, source: CodexPetBundle["source"]): CodexPetBundle[] {
  if (!existsSync(parentDir)) return [];
  return readdirSync(parentDir)
    .map((entry) => resolve(parentDir, entry))
    .filter((entryPath) => safeIsDirectory(entryPath))
    .map((bundleDir) => readCodexPetBundle(bundleDir, source))
    .filter((bundle): bundle is CodexPetBundle => Boolean(bundle));
}

export function readCodexPetBundle(bundleDir: string, source: CodexPetBundle["source"]): CodexPetBundle | undefined {
  const manifestPath = resolve(bundleDir, "pet.json");
  if (!existsSync(manifestPath)) return undefined;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    return validateCodexPetManifest(manifest, bundleDir, source);
  } catch {
    return undefined;
  }
}

export function validateCodexPetManifest(manifest: unknown, bundleDir: string, source: CodexPetBundle["source"]): CodexPetBundle | undefined {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return undefined;
  const record = manifest as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.displayName !== "string" || typeof record.spritesheetPath !== "string") return undefined;
  const spritesheetPath = safeResolveBundleAsset(bundleDir, record.spritesheetPath);
  if (!spritesheetPath || !existsSync(spritesheetPath) || !isStandardCodexPetSpritesheet(spritesheetPath)) return undefined;
  return {
    id: record.id.trim() || basename(bundleDir),
    displayName: record.displayName.trim() || record.id.trim() || basename(bundleDir),
    description: typeof record.description === "string" ? record.description.trim() || undefined : undefined,
    directory: bundleDir,
    spritesheetPath,
    spritesheetUrl: pathToFileURL(spritesheetPath).toString(),
    source,
  };
}

export function safeResolveBundleAsset(bundleDir: string, assetPath: string): string | undefined {
  if (!assetPath.trim() || isAbsolute(assetPath)) return undefined;
  const root = resolve(bundleDir);
  const candidate = resolve(root, assetPath);
  const rel = relative(root, candidate);
  if (rel === "" || rel.startsWith("..") || rel.split(sep).includes("..")) return undefined;
  return candidate;
}

export function isStandardCodexPetSpritesheet(path: string): boolean {
  try {
    const dimensions = readWebpDimensions(readFileSync(path));
    return Boolean(dimensions && dimensions.width > 0 && dimensions.height > 0 && dimensions.width % 8 === 0 && dimensions.height % 9 === 0);
  } catch {
    return false;
  }
}

export function readWebpDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return undefined;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunk = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const payload = offset + 8;
    if (payload + size > buffer.length) return undefined;
    if (chunk === "VP8X" && size >= 10) {
      return {
        width: 1 + buffer.readUIntLE(payload + 4, 3),
        height: 1 + buffer.readUIntLE(payload + 7, 3),
      };
    }
    if (chunk === "VP8L" && size >= 5 && buffer[payload] === 0x2f) {
      const b1 = buffer[payload + 1];
      const b2 = buffer[payload + 2];
      const b3 = buffer[payload + 3];
      const b4 = buffer[payload + 4];
      return {
        width: 1 + (((b2 & 0x3f) << 8) | b1),
        height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
      };
    }
    if (chunk === "VP8 " && size >= 10 && buffer[payload + 3] === 0x9d && buffer[payload + 4] === 0x01 && buffer[payload + 5] === 0x2a) {
      return {
        width: buffer.readUInt16LE(payload + 6) & 0x3fff,
        height: buffer.readUInt16LE(payload + 8) & 0x3fff,
      };
    }
    offset = payload + size + (size % 2);
  }
  return undefined;
}

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

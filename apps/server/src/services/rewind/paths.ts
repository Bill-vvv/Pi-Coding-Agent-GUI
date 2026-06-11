import { relative, resolve, sep } from "node:path";
import type { RewindCapturePolicy, RewindSkipReason } from "./types.js";

const DEFAULT_EXCLUDE_NAMES = [
  ".git",
  "node_modules",
  ".pi-gui",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".turbo",
  ".next",
  ".vite",
];

const DEFAULT_EXCLUDE_PREFIXES = [".pi/rewind"];

const DEFAULT_SECRET_PATTERNS = [
  /^\.env(?:\..*)?$/,
  /(?:^|[-_.])id_rsa$/,
  /(?:^|[-_.])id_ed25519$/,
  /private[-_.]?key/i,
  /\.pem$/i,
  /\.key$/i,
];

export function createDefaultPolicy(overrides: Partial<Pick<RewindCapturePolicy, "maxFileBytes" | "maxNewBytes">> = {}): RewindCapturePolicy {
  return {
    maxFileBytes: overrides.maxFileBytes ?? 20 * 1024 * 1024,
    maxNewBytes: overrides.maxNewBytes ?? 250 * 1024 * 1024,
    excludeNames: new Set(DEFAULT_EXCLUDE_NAMES),
    excludePathPrefixes: DEFAULT_EXCLUDE_PREFIXES,
    secretNamePatterns: DEFAULT_SECRET_PATTERNS,
  };
}

export function normalizeRoot(root: string): string {
  return resolve(root);
}

export function toRelativePath(root: string, absolutePath: string): string | undefined {
  const absoluteRoot = normalizeRoot(root);
  const resolved = resolve(absolutePath);
  const rel = relative(absoluteRoot, resolved);
  if (!rel || rel === "") return "";
  if (rel.startsWith("..") || rel.includes(`${sep}..${sep}`) || rel === ".." || rel.includes("\0")) return undefined;
  return toPortablePath(rel);
}

export function resolveRelativePath(root: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized === undefined) throw new Error(`Invalid rewind path: ${relativePath}`);
  const resolved = resolve(root, normalized);
  const rel = relative(resolve(root), resolved);
  if (rel.startsWith("..") || rel === ".." || rel.includes(`${sep}..${sep}`)) throw new Error(`Path escapes rewind root: ${relativePath}`);
  return resolved;
}

export function normalizeRelativePath(relativePath: string): string | undefined {
  if (!relativePath || relativePath.includes("\0")) return undefined;
  const portable = toPortablePath(relativePath);
  if (portable.startsWith("/") || portable === "." || portable === ".." || portable.startsWith("../") || portable.includes("/../")) return undefined;
  return portable;
}

export function classifyPolicyPath(relativePath: string, policy: RewindCapturePolicy): RewindSkipReason | undefined {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized === undefined) return "invalid_path";
  const parts = normalized.split("/");
  for (const part of parts) {
    if (policy.excludeNames.has(part)) return "excluded";
  }
  if (policy.excludePathPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) return "excluded";
  const base = parts[parts.length - 1] ?? normalized;
  if (policy.secretNamePatterns.some((pattern) => pattern.test(base))) return "secret";
  return undefined;
}

export function isPathExcluded(relativePath: string, policy: RewindCapturePolicy): boolean {
  return classifyPolicyPath(relativePath, policy) !== undefined;
}

export function toPortablePath(path: string): string {
  return path.split(sep).join("/").replace(/\\/g, "/");
}

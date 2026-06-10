import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DiscoveredPiExtensionDescriptor } from "@pi-gui/shared";

const PROJECT_PI_DIR = ".pi";
const PROJECT_EXTENSION_DIR = join(PROJECT_PI_DIR, "extensions");
const PROJECT_SETTINGS_FILE = join(PROJECT_PI_DIR, "settings.json");
const EXTENSION_FILE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);
const MAX_EXTENSION_SCAN_BYTES = 128 * 1024;

export function discoverProjectPiExtensions(cwd: string): DiscoveredPiExtensionDescriptor[] {
  const projectRoot = safeRealpath(cwd) ?? resolve(cwd);
  const byPath = new Map<string, DiscoveredPiExtensionDescriptor>();
  const settingsSelection = extensionSelectionFromProjectSettings(cwd, projectRoot);

  for (const extensionPath of discoverExtensionFiles(resolve(cwd, PROJECT_EXTENSION_DIR))) {
    addDiscoveredExtension(byPath, projectRoot, extensionPath, "project-convention", settingsSelection.excludedPaths);
  }

  for (const extensionPath of settingsSelection.includedPaths) {
    addDiscoveredExtension(byPath, projectRoot, extensionPath, "project-settings", settingsSelection.excludedPaths);
  }

  return [...byPath.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function projectExtensionPathsForCapabilities(cwd: string, capabilityIds: Iterable<string>, confirmedExtensionIds: Iterable<string> = []): string[] {
  const selected = new Set(capabilityIds);
  const confirmed = new Set(confirmedExtensionIds);
  if (selected.size === 0 || confirmed.size === 0) return [];
  return discoverProjectPiExtensions(cwd)
    .filter((extension) => confirmed.has(extension.id) && extension.capabilityIds.some((capabilityId) => selected.has(capabilityId)))
    .map((extension) => extension.path);
}

function addDiscoveredExtension(
  byPath: Map<string, DiscoveredPiExtensionDescriptor>,
  projectRoot: string,
  extensionPath: string,
  source: DiscoveredPiExtensionDescriptor["source"],
  excludedPaths: readonly string[] = [],
): void {
  const realPath = safeRealpath(extensionPath);
  if (!realPath || !isPathInside(projectRoot, realPath) || isExcludedPath(realPath, excludedPaths) || !isExtensionFile(realPath)) return;

  const relativePath = dotRelative(projectRoot, realPath);
  const existing = byPath.get(realPath);
  if (existing) {
    if (source === "project-settings" && existing.source !== "project-settings") {
      byPath.set(realPath, { ...existing, source });
    }
    return;
  }

  const capabilityIds = detectedCapabilityIds(realPath);
  const warnings = capabilityIds.length > 0
    ? ["No Pi GUI manifest found; capability match is based on static tool/UI-name detection."]
    : ["No Pi GUI manifest found; behavior and permissions are undeclared."];

  byPath.set(realPath, {
    id: `project:${realPath}`,
    scope: "project",
    source,
    path: realPath,
    relativePath,
    integrationLevel: 0,
    capabilityIds,
    warnings,
  });
}

function extensionSelectionFromProjectSettings(cwd: string, projectRoot: string): { includedPaths: string[]; excludedPaths: string[] } {
  const settingsPath = resolve(cwd, PROJECT_SETTINGS_FILE);
  if (!existsSync(settingsPath)) return { includedPaths: [], excludedPaths: [] };

  const settings = readJsonObject(settingsPath);
  const extensions = Array.isArray(settings?.extensions) ? settings.extensions.filter((value): value is string => typeof value === "string") : [];
  const settingsDir = resolve(cwd, PROJECT_PI_DIR);
  const excluded: string[] = [];
  const included: string[] = [];

  for (const rawEntry of extensions) {
    const parsed = parseSettingsExtensionEntry(rawEntry);
    if (!parsed || containsGlob(parsed.value)) continue;
    const resolved = resolveSettingsPath(settingsDir, parsed.value);
    if (!resolved) continue;
    const real = safeRealpath(resolved);
    if (!real || !isPathInside(projectRoot, real)) continue;
    if (parsed.mode === "exclude") {
      excluded.push(real);
      continue;
    }
    included.push(...discoverExtensionFiles(real));
  }

  return { includedPaths: included.filter((path) => !isExcludedPath(safeRealpath(path) ?? path, excluded)), excludedPaths: excluded };
}

function discoverExtensionFiles(path: string): string[] {
  const stat = safeStat(path);
  if (!stat) return [];
  if (stat.isFile()) return isExtensionFile(path) ? [path] : [];
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  for (const entry of safeReadDir(path)) {
    const child = join(path, entry.name);
    if (entry.isFile() && isExtensionFile(child)) files.push(child);
    if (entry.isDirectory()) {
      const indexFile = firstExistingExtensionIndex(child);
      if (indexFile) files.push(indexFile);
    }
  }
  return files;
}

function firstExistingExtensionIndex(directory: string): string | undefined {
  for (const extension of [".ts", ".js", ".mjs", ".cjs"]) {
    const candidate = join(directory, `index${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function parseSettingsExtensionEntry(rawEntry: string): { mode: "include" | "exclude"; value: string } | undefined {
  const trimmed = rawEntry.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("!")) return { mode: "exclude", value: trimmed.slice(1).trim() };
  if (trimmed.startsWith("-")) return { mode: "exclude", value: trimmed.slice(1).trim() };
  if (trimmed.startsWith("+")) return { mode: "include", value: trimmed.slice(1).trim() };
  return { mode: "include", value: trimmed };
}

function resolveSettingsPath(settingsDir: string, value: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  if (isAbsolute(value)) return resolve(value);
  return resolve(settingsDir, value);
}

function containsGlob(value: string): boolean {
  return /[*?[]/.test(value);
}

function detectedCapabilityIds(path: string): string[] {
  const text = readFilePrefix(path, MAX_EXTENSION_SCAN_BYTES);
  if (!text) return [];
  const capabilityIds = new Set<string>();
  if (/\btrellis_subagent\b/.test(text)) capabilityIds.add("trellis-subagent");
  if (/\bask_batch\b|\baskBatch\b/.test(text)) capabilityIds.add("interactive-prompts");
  return [...capabilityIds].sort();
}

function readFilePrefix(path: string, maxBytes: number): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function isExtensionFile(path: string): boolean {
  if (path.endsWith(".d.ts")) return false;
  for (const extension of EXTENSION_FILE_EXTENSIONS) {
    if (path.endsWith(extension)) return true;
  }
  return false;
}

function isPathInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !isAbsolute(rel));
}

function isExcludedPath(path: string, excludedPaths: readonly string[]): boolean {
  return excludedPaths.some((excludedPath) => path === excludedPath || isPathInside(excludedPath, path));
}

function dotRelative(root: string, path: string): string {
  const rel = relative(root, path).split(sep).join("/");
  return rel.startsWith("./") || rel === "." ? rel : `./${rel}`;
}

function safeStat(path: string) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function safeRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function safeReadDir(path: string) {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

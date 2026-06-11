import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PI_GUI_CAPABILITIES, type DiscoveredPiExtensionDescriptor } from "@pi-gui/shared";

const PROJECT_PI_DIR = ".pi";
const PROJECT_EXTENSION_DIR = join(PROJECT_PI_DIR, "extensions");
const PROJECT_SETTINGS_FILE = join(PROJECT_PI_DIR, "settings.json");
const EXTENSION_FILE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);
const MAX_EXTENSION_SCAN_BYTES = 128 * 1024;
const PI_GUI_MANIFEST_FILE = "pi-gui.manifest.json";
const KNOWN_CAPABILITY_IDS = new Set(PI_GUI_CAPABILITIES.map((capability) => capability.id));
const DISCOVERY_CACHE_TTL_MS = 2_000;
const DISCOVERY_CACHE_MAX_ENTRIES = 100;

type StatSignature = {
  path: string;
  exists: boolean;
  mtimeMs?: number;
  size?: number;
  isDirectory?: boolean;
};

type DiscoveryCacheEntry = {
  expiresAt: number;
  signatures: StatSignature[];
  extensions: DiscoveredPiExtensionDescriptor[];
};

const discoveryCache = new Map<string, DiscoveryCacheEntry>();

type PiGuiExtensionManifest = {
  integrationLevel: 1 | 2;
  capabilityIds: string[];
};

type PiGuiExtensionManifestReadResult = {
  found: boolean;
  manifest?: PiGuiExtensionManifest;
  warnings: string[];
};

export function discoverProjectPiExtensions(cwd: string): DiscoveredPiExtensionDescriptor[] {
  const projectRoot = safeRealpath(cwd) ?? resolve(cwd);
  const cached = discoveryCache.get(projectRoot);
  if (cached && cached.expiresAt > Date.now() && signaturesStillMatch(cached.signatures)) return cloneDiscoveredExtensions(cached.extensions);

  const dependencyPaths = new Set<string>([projectRoot, resolve(cwd, PROJECT_EXTENSION_DIR), resolve(cwd, PROJECT_SETTINGS_FILE)]);
  const byPath = new Map<string, DiscoveredPiExtensionDescriptor>();
  const settingsSelection = extensionSelectionFromProjectSettings(cwd, projectRoot, dependencyPaths);

  for (const extensionPath of discoverExtensionFiles(resolve(cwd, PROJECT_EXTENSION_DIR), dependencyPaths)) {
    addDiscoveredExtension(byPath, projectRoot, extensionPath, "project-convention", settingsSelection.excludedPaths, dependencyPaths);
  }

  for (const extensionPath of settingsSelection.includedPaths) {
    addDiscoveredExtension(byPath, projectRoot, extensionPath, "project-settings", settingsSelection.excludedPaths, dependencyPaths);
  }

  const extensions = [...byPath.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  rememberDiscovery(projectRoot, dependencyPaths, extensions);
  return cloneDiscoveredExtensions(extensions);
}

export function resetProjectPiExtensionDiscoveryCacheForTest(): void {
  discoveryCache.clear();
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
  dependencyPaths?: Set<string>,
): void {
  dependencyPaths?.add(extensionPath);
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

  dependencyPaths?.add(join(dirname(realPath), PI_GUI_MANIFEST_FILE));
  const manifestResult = readPiGuiExtensionManifest(realPath);
  const capabilityIds = manifestResult.manifest?.capabilityIds ?? detectedCapabilityIds(realPath);
  const warnings = warningsForDiscovery(manifestResult, capabilityIds);

  byPath.set(realPath, {
    id: `project:${realPath}`,
    scope: "project",
    source,
    path: realPath,
    relativePath,
    integrationLevel: manifestResult.manifest?.integrationLevel ?? 0,
    capabilityIds,
    warnings,
  });
}

function extensionSelectionFromProjectSettings(cwd: string, projectRoot: string, dependencyPaths?: Set<string>): { includedPaths: string[]; excludedPaths: string[] } {
  const settingsPath = resolve(cwd, PROJECT_SETTINGS_FILE);
  dependencyPaths?.add(settingsPath);
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
    dependencyPaths?.add(resolved);
    const real = safeRealpath(resolved);
    if (!real || !isPathInside(projectRoot, real)) continue;
    dependencyPaths?.add(real);
    if (parsed.mode === "exclude") {
      excluded.push(real);
      continue;
    }
    included.push(...discoverExtensionFiles(real, dependencyPaths));
  }

  return { includedPaths: included.filter((path) => !isExcludedPath(safeRealpath(path) ?? path, excluded)), excludedPaths: excluded };
}

function discoverExtensionFiles(path: string, dependencyPaths?: Set<string>): string[] {
  dependencyPaths?.add(path);
  const stat = safeStat(path);
  if (!stat) return [];
  if (stat.isFile()) return isExtensionFile(path) ? [path] : [];
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  for (const entry of safeReadDir(path)) {
    const child = join(path, entry.name);
    if (entry.isFile() && isExtensionFile(child)) files.push(child);
    if (entry.isDirectory()) {
      dependencyPaths?.add(child);
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

function readPiGuiExtensionManifest(extensionPath: string): PiGuiExtensionManifestReadResult {
  const manifestPath = join(dirname(extensionPath), PI_GUI_MANIFEST_FILE);
  if (!existsSync(manifestPath)) return { found: false, warnings: [] };

  const manifestObject = readJsonObject(manifestPath);
  if (!manifestObject) {
    return {
      found: true,
      warnings: [`Invalid ${PI_GUI_MANIFEST_FILE}; expected a JSON object.`],
    };
  }

  const { capabilityIds, warnings } = manifestCapabilityIds(manifestObject.capabilityIds);
  const manifestWarnings = Array.isArray(manifestObject.warnings)
    ? manifestObject.warnings
      .filter((item): item is string => typeof item === "string" && item.trim() !== "")
      .map((item) => item.trim())
    : [];

  return {
    found: true,
    manifest: {
      integrationLevel: manifestObject.integrationLevel === 2 ? 2 : 1,
      capabilityIds,
    },
    warnings: [...manifestWarnings, ...warnings],
  };
}

function manifestCapabilityIds(rawCapabilityIds: unknown): { capabilityIds: string[]; warnings: string[] } {
  if (!Array.isArray(rawCapabilityIds)) {
    return { capabilityIds: [], warnings: [`${PI_GUI_MANIFEST_FILE} does not declare capabilityIds.`] };
  }

  const capabilityIds = new Set<string>();
  const unknownCapabilityIds = new Set<string>();
  for (const rawCapabilityId of rawCapabilityIds) {
    if (typeof rawCapabilityId !== "string") continue;
    const capabilityId = rawCapabilityId.trim();
    if (!capabilityId) continue;
    if (KNOWN_CAPABILITY_IDS.has(capabilityId)) {
      capabilityIds.add(capabilityId);
    } else {
      unknownCapabilityIds.add(capabilityId);
    }
  }

  const warnings = unknownCapabilityIds.size > 0
    ? [`${PI_GUI_MANIFEST_FILE} declares unknown capabilityIds: ${[...unknownCapabilityIds].sort().join(", ")}.`]
    : [];
  return { capabilityIds: [...capabilityIds].sort(), warnings };
}

function warningsForDiscovery(manifestResult: PiGuiExtensionManifestReadResult, capabilityIds: readonly string[]): string[] {
  if (manifestResult.found) {
    if (manifestResult.manifest) return manifestResult.warnings;
    const fallbackWarning = capabilityIds.length > 0
      ? `Invalid ${PI_GUI_MANIFEST_FILE}; capability match is based on static tool/UI-name detection.`
      : `Invalid ${PI_GUI_MANIFEST_FILE}; behavior and permissions are undeclared.`;
    return [...manifestResult.warnings, fallbackWarning];
  }

  return capabilityIds.length > 0
    ? ["No Pi GUI manifest found; capability match is based on static tool/UI-name detection."]
    : ["No Pi GUI manifest found; behavior and permissions are undeclared."];
}

function detectedCapabilityIds(path: string): string[] {
  const text = readFilePrefix(path, MAX_EXTENSION_SCAN_BYTES);
  if (!text) return [];
  const capabilityIds = new Set<string>();
  if (/\btrellis_subagent\b/.test(text)) capabilityIds.add("trellis-subagent");
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

function rememberDiscovery(projectRoot: string, dependencyPaths: Set<string>, extensions: DiscoveredPiExtensionDescriptor[]): void {
  discoveryCache.set(projectRoot, {
    expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
    signatures: [...dependencyPaths].sort().map(statSignature),
    extensions: cloneDiscoveredExtensions(extensions),
  });
  while (discoveryCache.size > DISCOVERY_CACHE_MAX_ENTRIES) {
    const oldestKey = discoveryCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    discoveryCache.delete(oldestKey);
  }
}

function signaturesStillMatch(signatures: readonly StatSignature[]): boolean {
  return signatures.every((signature) => signaturesEqual(signature, statSignature(signature.path)));
}

function signaturesEqual(left: StatSignature, right: StatSignature): boolean {
  return left.path === right.path && left.exists === right.exists && left.mtimeMs === right.mtimeMs && left.size === right.size && left.isDirectory === right.isDirectory;
}

function statSignature(path: string): StatSignature {
  const stat = safeStat(path);
  return stat ? { path, exists: true, mtimeMs: stat.mtimeMs, size: stat.size, isDirectory: stat.isDirectory() } : { path, exists: false };
}

function cloneDiscoveredExtensions(extensions: readonly DiscoveredPiExtensionDescriptor[]): DiscoveredPiExtensionDescriptor[] {
  return extensions.map((extension) => ({ ...extension, capabilityIds: [...extension.capabilityIds], warnings: [...extension.warnings] }));
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

import type { ResolvePathErrorCode, ResolvedPath, ResolvedPathSource } from "@pi-gui/shared";
import { stat as defaultStat } from "node:fs/promises";
import { release } from "node:os";
import { posix } from "node:path";
import { parseSshProjectCwd } from "./sshProjectService.js";

type StatLike = { isDirectory(): boolean };

export type PathResolutionEnvironment = {
  isWsl: boolean;
  distroName?: string;
  driveMountRoot: string;
};

export type PathResolutionOptions = Partial<PathResolutionEnvironment> & {
  stat?: (path: string) => Promise<StatLike>;
};

export async function resolveProjectPath(inputPath: string, options: PathResolutionOptions = {}): Promise<ResolvedPath> {
  const input = inputPath.trim();
  const environment = pathResolutionEnvironment(options);
  const converted = convertProjectPath(input, environment);
  if (converted.errorCode) return unresolved(input, converted.source, converted.cwd, converted.errorCode, converted.error);

  const cwd = converted.source === "ssh" ? converted.cwd : posix.normalize(converted.cwd);
  if (converted.source === "ssh") {
    return {
      inputPath: input,
      cwd,
      displayPath: input !== cwd ? input : undefined,
      source: "ssh",
      exists: true,
      isDirectory: true,
    };
  }

  const stat = options.stat ?? defaultStat;
  try {
    const stats = await stat(cwd);
    if (!stats.isDirectory()) return unresolved(input, converted.source, cwd, "path_not_directory", `path is not a directory: ${cwd}`, true);
    return {
      inputPath: input,
      cwd,
      displayPath: input !== cwd ? input : undefined,
      source: converted.source,
      exists: true,
      isDirectory: true,
    };
  } catch (error) {
    return unresolved(input, converted.source, cwd, "path_not_found", (error as Error).message);
  }
}

export function convertProjectPath(inputPath: string, environment: PathResolutionEnvironment = pathResolutionEnvironment()): Pick<ResolvedPath, "cwd" | "source" | "error" | "errorCode"> {
  const input = inputPath.trim();
  if (!input) return { cwd: "", source: "linux", errorCode: "empty_path", error: "path is required" };
  if (input === "~" || input.startsWith("~/")) {
    return { cwd: input, source: "linux", errorCode: "home_expansion_unsupported", error: "~ expansion is not supported; choose or paste an absolute path" };
  }

  const drive = windowsDrivePath(input);
  if (drive) {
    if (!environment.isWsl) {
      return { cwd: input, source: "windows-drive", errorCode: "windows_path_requires_wsl", error: "Windows paths can only be converted when the backend is running in WSL" };
    }
    const segments = normalizeWindowsPathSegments(drive.path.split(/[\\/]+/).filter(Boolean));
    return { cwd: posix.join(environment.driveMountRoot, drive.drive.toLowerCase(), ...segments), source: "windows-drive" };
  }

  const unc = wslUncPath(input);
  if (unc) {
    if (!unc.distro || unc.segments.length === 0) return { cwd: input, source: "wsl-unc", errorCode: "wsl_unc_invalid", error: "WSL UNC path must include a distro and an absolute path" };
    if (!environment.distroName || unc.distro.toLowerCase() !== environment.distroName.toLowerCase()) {
      return {
        cwd: input,
        source: "wsl-unc",
        errorCode: "wsl_unc_distro_mismatch",
        error: `WSL UNC distro ${unc.distro} does not match backend distro ${environment.distroName ?? "unknown"}`,
      };
    }
    return { cwd: posix.resolve(`/${unc.segments.map(encodeWindowsSegmentForWslPath).join("/")}`), source: "wsl-unc" };
  }

  const ssh = parseSshProjectCwd(input);
  if (ssh) return { cwd: ssh.canonicalCwd, source: "ssh" };

  if (input.startsWith("/")) return { cwd: posix.resolve(input), source: "linux" };
  return { cwd: input, source: "linux", errorCode: "relative_path", error: "Project path must be absolute" };
}

export function pathResolutionEnvironment(options: PathResolutionOptions = {}): PathResolutionEnvironment {
  return {
    isWsl: options.isWsl ?? defaultIsWsl(),
    distroName: options.distroName ?? process.env.WSL_DISTRO_NAME,
    driveMountRoot: options.driveMountRoot ?? "/mnt",
  };
}

function windowsDrivePath(input: string): { drive: string; path: string } | undefined {
  const match = /^([A-Za-z]):[\\/]+(.*)$/.exec(input);
  return match ? { drive: match[1]!, path: match[2] ?? "" } : undefined;
}

function wslUncPath(input: string): { distro: string; segments: string[] } | undefined {
  const normalized = input.replace(/\\/g, "/");
  const match = /^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(?:\/(.*))?$/i.exec(normalized);
  if (!match) return undefined;
  const rest = match[2] ?? "";
  return { distro: match[1] ?? "", segments: rest.split("/").filter(Boolean) };
}

function normalizeWindowsPathSegments(segments: string[]): string[] {
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(encodeWindowsSegmentForWslPath(segment));
  }
  return normalized;
}

function encodeWindowsSegmentForWslPath(segment: string): string {
  return segment;
}

function defaultIsWsl(): boolean {
  return Boolean(process.env.WSL_DISTRO_NAME || /microsoft|wsl/i.test(release()));
}

function unresolved(inputPath: string, source: ResolvedPathSource, cwd: string, errorCode: ResolvePathErrorCode, error?: string, exists = false): ResolvedPath {
  return {
    inputPath,
    cwd,
    source,
    exists,
    isDirectory: false,
    errorCode,
    error,
  };
}

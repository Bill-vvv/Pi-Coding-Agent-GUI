import { posix } from "node:path";
import { parseSshProjectCwd } from "./sshProjectService.js";

export function projectIdentityKey(cwd: string): string {
  const input = cwd.trim();
  const ssh = parseSshProjectCwd(input);
  if (ssh) return `ssh:${ssh.canonicalCwd}`;

  const windows = normalizeWindowsDrivePath(input);
  if (windows) return `winfs:${windows}`;

  const mountedWindows = normalizeMountedWindowsPath(input);
  if (mountedWindows) return `winfs:${mountedWindows}`;

  if (input.startsWith("/")) return `posix:${posix.normalize(input)}`;
  return `opaque:${input}`;
}

function normalizeWindowsDrivePath(input: string): string | undefined {
  const normalized = input.replace(/\\/g, "/");
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!match) return undefined;
  return `${match[1]!.toLowerCase()}:/${normalizeWindowsSegments(match[2] ?? "")}`;
}

function normalizeMountedWindowsPath(input: string): string | undefined {
  const normalized = posix.normalize(input);
  const match = /^\/mnt\/([A-Za-z])(?:\/(.*))?$/.exec(normalized);
  if (!match) return undefined;
  return `${match[1]!.toLowerCase()}:/${normalizeWindowsSegments(match[2] ?? "")}`;
}

function normalizeWindowsSegments(input: string): string {
  return input
    .split("/")
    .filter(Boolean)
    .reduce<string[]>((parts, part) => {
      if (part === ".") return parts;
      if (part === "..") {
        parts.pop();
        return parts;
      }
      parts.push(part.toLowerCase());
      return parts;
    }, [])
    .join("/");
}

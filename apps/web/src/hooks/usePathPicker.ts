import type { DirectoryEntry, DirectoryListing, ResolvedPath } from "@pi-gui/shared";
import { useState } from "react";
import { apiUrl } from "../domain/apiUrl";
import { authHeaders } from "../domain/runtimeConfig";

export function usePathPicker() {
  const [open, setOpen] = useState(false);
  const [cwd, setCwd] = useState("");
  const [parent, setParent] = useState<string | undefined>();
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [creatingDirectory, setCreatingDirectory] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [manualPath, setManualPath] = useState("");
  const [resolvedPath, setResolvedPath] = useState<ResolvedPath | undefined>();

  function updateManualPath(path: string) {
    setManualPath(path);
    setResolvedPath(undefined);
  }

  function applyDirectoryListing(listing: DirectoryListing) {
    applyDirectoryListingToState(listing, setCwd, setParent, setEntries, setManualPath);
  }

  async function loadDirectory(path?: string) {
    setLoading(true);
    setError(undefined);
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const response = await fetch(apiUrl(`/api/fs/list${query}`), { headers: authHeaders() });
      if (!response.ok) throw new Error(await responseErrorMessage(response, "读取目录失败"));
      applyDirectoryListing((await response.json()) as DirectoryListing);
      setResolvedPath(undefined);
    } catch (error) {
      setError((error as Error).message || "读取目录失败");
    } finally {
      setLoading(false);
    }
  }

  async function createDirectory(name: string, parentPath = cwd): Promise<boolean> {
    const trimmedName = name.trim();
    if (!parentPath) {
      setError("请先选择当前位置");
      return false;
    }
    if (!trimmedName) {
      setError("请输入文件夹名称");
      return false;
    }

    setCreatingDirectory(true);
    setError(undefined);
    try {
      const response = await fetch(apiUrl("/api/fs/mkdir"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ parent: parentPath, name: trimmedName }),
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, "新建文件夹失败"));
      applyDirectoryListing((await response.json()) as DirectoryListing);
      setResolvedPath(undefined);
      return true;
    } catch (error) {
      setError((error as Error).message || "新建文件夹失败");
      return false;
    } finally {
      setCreatingDirectory(false);
    }
  }

  async function resolveManualPath(path = manualPath): Promise<ResolvedPath | undefined> {
    const trimmed = path.trim();
    if (!trimmed) {
      setError("请输入路径");
      return undefined;
    }
    setResolving(true);
    setError(undefined);
    try {
      const response = await fetch(apiUrl("/api/fs/resolve"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ path: trimmed, purpose: "project" }),
      });
      const data = (await response.json().catch(() => undefined)) as ResolvedPath | undefined;
      if (!response.ok) throw new Error(pathResolveError(data) ?? `路径解析失败 (${response.status})`);
      if (!isResolvedPath(data)) throw new Error("服务器返回的路径解析结果无效");
      setResolvedPath(data);
      if (!data.exists || !data.isDirectory) setError(pathResolveError(data) ?? "路径不可用");
      else if (data.source === "ssh") {
        setCwd(data.cwd);
        setParent(undefined);
        setEntries([]);
        setManualPath(data.cwd);
        setResolvedPath(data);
      } else {
        setCwd(data.cwd);
        await loadDirectory(data.cwd);
        setResolvedPath(data);
      }
      return data;
    } catch (error) {
      setResolvedPath(undefined);
      setError((error as Error).message || "路径解析失败");
      return undefined;
    } finally {
      setResolving(false);
    }
  }

  async function openPicker(path?: string) {
    setOpen(true);
    setManualPath(path ?? "");
    setResolvedPath(undefined);
    if (path && looksLikeSshProjectPath(path)) {
      await resolveManualPath(path);
      return;
    }
    await loadDirectory(path);
  }

  function closePicker() {
    setOpen(false);
  }

  return {
    open,
    cwd,
    parent,
    entries,
    loading,
    resolving,
    creatingDirectory,
    error,
    manualPath,
    resolvedPath,
    setManualPath: updateManualPath,
    openPicker,
    closePicker,
    loadDirectory,
    resolveManualPath,
    createDirectory,
  };
}

function applyDirectoryListingToState(
  listing: DirectoryListing,
  setCwd: (cwd: string) => void,
  setParent: (parent: string | undefined) => void,
  setEntries: (entries: DirectoryEntry[]) => void,
  setManualPath: (path: string) => void,
): void {
  setCwd(listing.cwd);
  setParent(listing.parent);
  setEntries(listing.entries);
  setManualPath(listing.cwd);
}

function isResolvedPath(value: unknown): value is ResolvedPath {
  return Boolean(
    value &&
      typeof value === "object" &&
      "inputPath" in value &&
      typeof value.inputPath === "string" &&
      "cwd" in value &&
      typeof value.cwd === "string" &&
      "source" in value &&
      (value.source === "linux" || value.source === "windows-drive" || value.source === "wsl-unc" || value.source === "ssh") &&
      "exists" in value &&
      typeof value.exists === "boolean" &&
      "isDirectory" in value &&
      typeof value.isDirectory === "boolean",
  );
}

async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  if (!text) return `${fallback} (${response.status})`;
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (typeof body.message === "string" && body.message.trim()) return body.message;
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  } catch {
    // Fall through to raw text for non-JSON responses.
  }
  return text;
}

function looksLikeSshProjectPath(path: string): boolean {
  const value = path.trim();
  if (value.startsWith("ssh://")) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  return /^[^\s:]+:(?:\/.*|~(?:\/.*)?|\.\.?\/.*)$/.test(value);
}

function pathResolveError(path: ResolvedPath | undefined): string | undefined {
  if (!path) return undefined;
  if (path.error) return path.error;
  if (!path.exists) return `路径不存在：${path.cwd}`;
  if (!path.isDirectory) return `路径不是目录：${path.cwd}`;
  return undefined;
}

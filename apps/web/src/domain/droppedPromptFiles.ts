import type { ImportedFileResponse } from "@pi-gui/shared";
import { apiUrl } from "./apiUrl";
import { authHeaders } from "./runtimeConfig";

export type DroppedPromptFragmentResult = {
  fragment: string;
  notice: string;
};

export type UploadDroppedFile = (file: File) => Promise<ImportedFileResponse>;

export function hasPotentialDroppablePromptData(dataTransfer: DataTransfer): boolean {
  return dataTransfer.files.length > 0 || dataTransfer.types.includes("Files") || dataTransfer.types.includes("text/uri-list");
}

export function hasDroppedPromptData(dataTransfer: DataTransfer): boolean {
  return hasPotentialDroppablePromptData(dataTransfer) || parsePlainTextPaths(dataTransfer.getData("text/plain")).length > 0;
}

export async function buildDroppedPromptFragment(files: File[], referencePaths: string[], unsupportedLabels: string[] = [], upload: UploadDroppedFile = uploadDroppedFile): Promise<DroppedPromptFragmentResult> {
  const fragments: string[] = [];
  const skipped: string[] = [];
  const unsupported = [...unsupportedLabels];

  if (files.length > 0) {
    for (const [index, file] of files.entries()) {
      try {
        const existingPath = serverReadableReferencePath(referencePaths[index]);
        const path = existingPath ?? (await upload(file)).path;
        fragments.push(formatFileReference(path));
      } catch (error) {
        skipped.push(`${file.name || "dropped-file"}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } else {
    for (const path of referencePaths) {
      const readablePath = serverReadableReferencePath(path);
      if (readablePath) fragments.push(formatFileReference(readablePath));
      else unsupported.push(path);
    }
  }

  const noticeParts: string[] = [];
  if (fragments.length > 0) noticeParts.push(`已添加 ${fragments.length} 个文件引用`);
  if (skipped.length > 0) noticeParts.push(`跳过 ${skipped.length} 个：${skipped.slice(0, 3).join("；")}${skipped.length > 3 ? "…" : ""}`);
  if (unsupported.length > 0) noticeParts.push(`暂不支持 ${unsupported.length} 个：${unsupported.slice(0, 3).join("；")}${unsupported.length > 3 ? "…" : ""}`);
  if (noticeParts.length === 0) noticeParts.push("未找到可引用的文件；符号链接/文件夹暂不支持拖拽导入。");

  return { fragment: fragments.join("\n"), notice: noticeParts.join("；") };
}

export async function uploadDroppedFile(file: File): Promise<ImportedFileResponse> {
  const response = await fetch(apiUrl(`/api/imports/file?name=${encodeURIComponent(file.name || "dropped-file")}`), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/octet-stream" }),
    body: file,
  });
  const data = (await response.json().catch(() => undefined)) as unknown;
  if (!response.ok) {
    throw new Error(errorMessageFromResponse(data) ?? `上传失败 (${response.status})`);
  }
  if (!isImportedFileResponse(data)) throw new Error("服务器返回的导入结果无效");
  return data;
}

export function droppedReferencePaths(dataTransfer: DataTransfer): string[] {
  const paths = new Set<string>();
  for (const path of parseUriListPaths(dataTransfer.getData("text/uri-list"))) paths.add(path);
  if (paths.size === 0) {
    for (const path of parsePlainTextPaths(dataTransfer.getData("text/plain"))) paths.add(path);
  }
  return Array.from(paths);
}

export function droppedUnsupportedItemLabels(dataTransfer: DataTransfer): string[] {
  const labels: string[] = [];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    const entry = dataTransferItemEntry(item);
    if (!entry?.isDirectory) continue;
    labels.push(entry.name ? `目录 ${entry.name}` : "目录");
  }
  return labels;
}

export function parseUriListPaths(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(fileUriToPath)
    .filter((path): path is string => Boolean(path));
}

export function fileUriToPath(uri: string): string | undefined {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return undefined;
    const path = decodeURIComponent(url.pathname);
    if (url.hostname && isWslFileHost(url.hostname)) return wslUncUriPathToLinuxPath(path);
    return path.match(/^\/[A-Za-z]:\//) ? path.slice(1) : path;
  } catch {
    return undefined;
  }
}

export function parsePlainTextPaths(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(~\/|\/|[A-Za-z]:[\\/]|\\\\wsl(?:\.localhost|\$)\\)/i.test(line));
}

export function formatFileReference(path: string): string {
  return /\s/.test(path) ? `@"${path.replace(/"/g, '\\"')}"` : `@${path}`;
}

export function mergePromptFragment(prompt: string, start: number, end: number, fragment: string): { text: string; cursor: number } {
  const before = prompt.slice(0, start);
  const after = prompt.slice(end);
  const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
  const suffix = after && !after.startsWith("\n") ? "\n\n" : "";
  const inserted = `${prefix}${fragment}${suffix}`;
  return { text: `${before}${inserted}${after}`, cursor: before.length + inserted.length };
}

export function serverReadableReferencePath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const normalized = normalizeWslUncTextPath(path.trim());
  if (!normalized) return undefined;
  if (isWindowsDrivePath(normalized)) return undefined;
  if (normalized.startsWith("~/")) return normalized;
  if (!normalized.startsWith("/") || normalized.startsWith("//")) return undefined;
  if (/^\/[A-Za-z]:\//.test(normalized)) return undefined;
  return normalized;
}

function errorMessageFromResponse(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || !("error" in data)) return undefined;
  return typeof data.error === "string" ? data.error : undefined;
}

function isImportedFileResponse(value: unknown): value is ImportedFileResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "path" in value &&
      typeof value.path === "string" &&
      "name" in value &&
      typeof value.name === "string" &&
      "size" in value &&
      typeof value.size === "number",
  );
}

function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

function isWslFileHost(hostname: string): boolean {
  return hostname.toLowerCase() === "wsl.localhost" || hostname.toLowerCase() === "wsl$";
}

function wslUncUriPathToLinuxPath(pathname: string): string | undefined {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return undefined;
  return `/${segments.slice(1).join("/")}`;
}

function normalizeWslUncTextPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/");
  const match = /^\/\/(?:wsl\.localhost|wsl\$)\/[^/]+\/(.+)$/i.exec(normalized);
  if (match?.[1]) return `/${match[1]}`;
  return path;
}

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => { isDirectory?: boolean; name?: string } | null;
};

function dataTransferItemEntry(item: DataTransferItem): { isDirectory?: boolean; name?: string } | undefined {
  return (item as DataTransferItemWithEntry).webkitGetAsEntry?.() ?? undefined;
}

import type { ImportedFileResponse } from "@pi-gui/shared";
import { apiUrl } from "./apiUrl";
import { authHeaders } from "./runtimeConfig";

export type DroppedPromptFragmentResult = {
  fragment: string;
  notice: string;
};

export type UploadDroppedFile = (file: File) => Promise<ImportedFileResponse>;

const MAX_SAFE_IMAGE_IMPORT_FILES = 8;
const MAX_SAFE_IMAGE_IMPORT_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_SAFE_IMAGE_IMPORT_FILE_BYTES = 6 * 1024 * 1024;

export function hasPotentialDroppablePromptData(dataTransfer: DataTransfer): boolean {
  return dataTransfer.files.length > 0 || dataTransfer.types.includes("Files") || dataTransfer.types.includes("text/uri-list");
}

export function hasDroppedPromptData(dataTransfer: DataTransfer): boolean {
  return hasPotentialDroppablePromptData(dataTransfer) || parsePlainTextPaths(dataTransfer.getData("text/plain")).length > 0;
}

export async function buildDroppedPromptFragment(files: File[], referencePaths: readonly (string | undefined)[], unsupportedLabels: string[] = [], upload: UploadDroppedFile = uploadDroppedFile): Promise<DroppedPromptFragmentResult> {
  const fragments: string[] = [];
  const skipped: string[] = [];
  const unsupported = [...unsupportedLabels];
  let referencedPdfCount = 0;

  if (files.length > 0) {
    const blockedImageImports = blockedImageImportReasons(files, referencePaths);
    for (const [index, file] of files.entries()) {
      const blockedReason = blockedImageImports.get(index);
      if (blockedReason) {
        skipped.push(`${file.name || "dropped-file"}: ${blockedReason}`);
        continue;
      }

      try {
        const existingPath = serverReadableReferencePath(referencePaths[index]);
        const path = existingPath ?? (await upload(file)).path;
        fragments.push(formatFileReference(path));
        if (isPdfFile(file)) referencedPdfCount += 1;
      } catch (error) {
        skipped.push(`${file.name || "dropped-file"}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } else {
    const readablePaths = referencePaths.map((path) => ({ original: path, readable: serverReadableReferencePath(path) }));
    for (const { original, readable } of readablePaths) {
      if (readable) fragments.push(formatFileReference(readable));
      else if (original) unsupported.push(original);
    }
  }

  const noticeParts: string[] = [];
  if (fragments.length > 0) noticeParts.push(`已添加 ${fragments.length} 个文件引用`);
  if (skipped.length > 0) noticeParts.push(`跳过 ${skipped.length} 个：${skipped.slice(0, 3).join("；")}${skipped.length > 3 ? "…" : ""}`);
  if (unsupported.length > 0) noticeParts.push(`暂不支持 ${unsupported.length} 个：${unsupported.slice(0, 3).join("；")}${unsupported.length > 3 ? "…" : ""}`);
  if (referencedPdfCount > 0) noticeParts.push("PDF 已作为路径引用导入。");
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

export function droppedReferencePaths(dataTransfer: DataTransfer): (string | undefined)[] {
  const uriList = dataTransfer.getData("text/uri-list");
  if (uriList) {
    const uriPaths = parseUriListPathSlots(uriList);
    if (dataTransfer.files.length > 0) return uriPaths;
    const paths = new Set<string>();
    for (const path of uriPaths) {
      if (path) paths.add(path);
    }
    if (paths.size > 0) return Array.from(paths);
  }

  const paths = new Set<string>();
  for (const path of parsePlainTextPaths(dataTransfer.getData("text/plain"))) paths.add(path);
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
  return parseUriListPathSlots(uriList).filter((path): path is string => Boolean(path));
}

function parseUriListPathSlots(uriList: string): (string | undefined)[] {
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(fileUriToPath);
}

export function fileUriToPath(uri: string): string | undefined {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return undefined;
    const path = decodeURIComponent(url.pathname);
    if (url.hostname) {
      if (isWslFileHost(url.hostname)) return wslUncUriPathToLinuxPath(path);
      if (!isLocalFileHost(url.hostname)) return undefined;
    }
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

function blockedImageImportReasons(files: File[], referencePaths: readonly (string | undefined)[]): Map<number, string> {
  const images = files
    .map((file, index) => ({ file, index, directReference: serverReadableReferencePath(referencePaths[index]) }))
    .filter(({ file, directReference }) => isRasterImageFile(file) && !directReference);
  const blocked = new Map<number, string>();
  if (images.length === 0) return blocked;

  const totalBytes = images.reduce((total, { file }) => total + file.size, 0);
  const batchReason = imageBatchBlockReason(images.length, totalBytes);
  if (batchReason) {
    for (const { index } of images) blocked.set(index, batchReason);
    return blocked;
  }

  for (const { file, index } of images) {
    if (file.size > MAX_SAFE_IMAGE_IMPORT_FILE_BYTES) {
      blocked.set(index, `图片过大 (${formatBytes(file.size)})，可能被模型作为 base64 持续带入上下文；请先压缩、降低分辨率或改用文件路径引用。`);
    }
  }
  return blocked;
}

function imageBatchBlockReason(imageCount: number, totalBytes: number): string | undefined {
  if (imageCount > MAX_SAFE_IMAGE_IMPORT_FILES) {
    return `一次导入 ${imageCount} 张图片风险过高，可能触发 WebSocket 1009/message too big；请减少图片数量、降低分辨率或分批提交。`;
  }
  if (totalBytes > MAX_SAFE_IMAGE_IMPORT_TOTAL_BYTES) {
    return `图片总量 ${formatBytes(totalBytes)} 过大，可能被模型作为 base64 持续带入上下文；请先压缩、降低分辨率或改用文件路径引用。`;
  }
  return undefined;
}

function isRasterImageFile(file: File): boolean {
  if (/^image\/(?:png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.type)) return true;
  return isRasterImagePath(file.name);
}

function isRasterImagePath(path: string): boolean {
  return /\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/i.test(path);
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.floor(bytes)} B`;
}

function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

function isWslFileHost(hostname: string): boolean {
  return hostname.toLowerCase() === "wsl.localhost" || hostname.toLowerCase() === "wsl$";
}

function isLocalFileHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
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

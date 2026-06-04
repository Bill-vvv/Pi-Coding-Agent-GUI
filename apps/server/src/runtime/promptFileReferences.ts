import { access, open, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

type PromptImageContent = {
  type: "image";
  mimeType: string;
  data: string;
};

type ExpandedPromptFileReferences = {
  message: string;
  images?: PromptImageContent[];
};

type PromptFileReference = {
  token: string;
  path: string;
};

const IMAGE_SNIFF_BYTES = 4100;
const MAX_IMAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export async function expandPromptFileReferences(message: string, cwd: string): Promise<ExpandedPromptFileReferences> {
  if (message.trimStart().startsWith("/")) return { message };

  const references = uniqueResolvedReferences(findPromptFileReferences(message), cwd);
  if (references.length === 0) return { message };

  const images: PromptImageContent[] = [];

  for (const reference of references) {
    const stats = await existingFileStat(reference.path);
    if (!stats || !stats.isFile() || stats.size === 0 || stats.size > MAX_IMAGE_ATTACHMENT_BYTES) continue;

    const mimeType = detectSupportedImageMimeType(await readFilePrefix(reference.path, IMAGE_SNIFF_BYTES));
    if (!mimeType) continue;

    const fileBuffer = await readFile(reference.path);
    images.push({ type: "image", mimeType, data: fileBuffer.toString("base64") });
  }

  return images.length > 0 ? { message, images } : { message };
}

function findPromptFileReferences(message: string): PromptFileReference[] {
  const references: PromptFileReference[] = [];
  let index = 0;

  while (index < message.length) {
    const atIndex = message.indexOf("@", index);
    if (atIndex === -1) break;
    if (!isReferenceBoundary(message, atIndex)) {
      index = atIndex + 1;
      continue;
    }

    const parsed = parseReferenceAt(message, atIndex);
    if (!parsed) {
      index = atIndex + 1;
      continue;
    }

    references.push(parsed.reference);
    index = parsed.nextIndex;
  }

  return references;
}

function parseReferenceAt(message: string, atIndex: number): { reference: PromptFileReference; nextIndex: number } | undefined {
  const start = atIndex + 1;
  const first = message[start];
  if (!first || /\s/.test(first)) return undefined;

  if (first === '"') return parseQuotedReference(message, atIndex, start + 1);
  return parseBareReference(message, atIndex, start);
}

function parseQuotedReference(message: string, atIndex: number, pathStart: number): { reference: PromptFileReference; nextIndex: number } | undefined {
  let value = "";
  for (let index = pathStart; index < message.length; index += 1) {
    const char = message[index];
    if (char === '"') {
      if (!value) return undefined;
      return { reference: { token: message.slice(atIndex, index + 1), path: value }, nextIndex: index + 1 };
    }
    if (char === "\\" && message[index + 1] === '"') {
      value += '"';
      index += 1;
      continue;
    }
    value += char;
  }
  return undefined;
}

function parseBareReference(message: string, atIndex: number, pathStart: number): { reference: PromptFileReference; nextIndex: number } | undefined {
  let end = pathStart;
  while (end < message.length && !/\s/.test(message[end] ?? "")) end += 1;
  const path = trimTrailingPunctuation(message.slice(pathStart, end));
  if (!path) return undefined;
  return { reference: { token: message.slice(atIndex, pathStart + path.length), path }, nextIndex: end };
}

function trimTrailingPunctuation(path: string): string {
  return path.replace(/[),.;:!?]+$/g, "");
}

function isReferenceBoundary(message: string, atIndex: number): boolean {
  if (atIndex === 0) return true;
  return /[\s([{]/.test(message[atIndex - 1] ?? "");
}

function uniqueResolvedReferences(references: PromptFileReference[], cwd: string): PromptFileReference[] {
  const seen = new Set<string>();
  const unique: PromptFileReference[] = [];

  for (const reference of references) {
    const resolvedPath = resolveReferencePath(reference.path, cwd);
    if (seen.has(resolvedPath)) continue;
    seen.add(resolvedPath);
    unique.push({ token: reference.token, path: resolvedPath });
  }

  return unique;
}

function resolveReferencePath(filePath: string, cwd: string): string {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/")) return resolve(homedir(), filePath.slice(2));
  if (isAbsolute(filePath)) return resolve(filePath);
  return resolve(cwd, filePath);
}

async function existingFileStat(path: string) {
  try {
    await access(path);
    return await stat(path);
  } catch {
    return undefined;
  }
}

async function readFilePrefix(path: string, bytes: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function detectSupportedImageMimeType(buffer: Buffer): string | undefined {
  if (startsWith(buffer, [0xff, 0xd8, 0xff]) && buffer[3] !== 0xf7) return "image/jpeg";
  if (startsWith(buffer, PNG_SIGNATURE) && isPng(buffer) && !isAnimatedPng(buffer)) return "image/png";
  if (startsWithAscii(buffer, 0, "GIF")) return "image/gif";
  if (startsWithAscii(buffer, 0, "RIFF") && startsWithAscii(buffer, 8, "WEBP")) return "image/webp";
  return undefined;
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 16 && readUint32BE(buffer, PNG_SIGNATURE.length) === 13 && startsWithAscii(buffer, 12, "IHDR");
}

function isAnimatedPng(buffer: Buffer): boolean {
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= buffer.length) {
    const chunkLength = readUint32BE(buffer, offset);
    const chunkTypeOffset = offset + 4;
    if (startsWithAscii(buffer, chunkTypeOffset, "acTL")) return true;
    if (startsWithAscii(buffer, chunkTypeOffset, "IDAT")) return false;
    const nextOffset = offset + 8 + chunkLength + 4;
    if (nextOffset <= offset || nextOffset > buffer.length) return false;
    offset = nextOffset;
  }
  return false;
}

function readUint32BE(buffer: Buffer, offset: number): number {
  return (buffer[offset] ?? 0) * 0x1000000 + ((buffer[offset + 1] ?? 0) << 16) + ((buffer[offset + 2] ?? 0) << 8) + (buffer[offset + 3] ?? 0);
}

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function startsWithAscii(buffer: Buffer, offset: number, text: string): boolean {
  if (buffer.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (buffer[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

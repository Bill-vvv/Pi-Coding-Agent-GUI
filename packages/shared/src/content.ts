import { isRecord } from "./utils.js";

export function containsSerializedToolCallText(text: string): boolean {
  return removeSerializedToolCalls(text).removed;
}

export function isSerializedToolCallText(text: string): boolean {
  const result = removeSerializedToolCalls(text);
  return result.removed && result.text.trim() === "";
}

export function stripSerializedToolCallsFromText(text: string): string {
  return removeSerializedToolCalls(text).text;
}

function removeSerializedToolCalls(text: string): { text: string; removed: boolean } {
  const fencedToolCallText = wholeJsonCodeFenceContent(text);
  if (fencedToolCallText !== undefined) {
    const fencedResult = removeSerializedToolCalls(fencedToolCallText);
    if (fencedResult.removed && fencedResult.text.trim() === "") return { text: "", removed: true };
  }

  let output = "";
  let index = 0;
  let removed = false;

  while (index < text.length) {
    const start = nextJsonContainerStart(text, index);
    if (start === -1) {
      output += text.slice(index);
      break;
    }

    output += text.slice(index, start);
    const end = findJsonContainerEnd(text, start);
    if (end === -1) {
      output += text[start];
      index = start + 1;
      continue;
    }

    const candidate = text.slice(start, end + 1);
    if (isSerializedToolCallJson(candidate)) {
      removed = true;
      index = end + 1;
      continue;
    }

    output += candidate;
    index = end + 1;
  }

  return { text: cleanupRemovedToolCallText(output), removed };
}

function wholeJsonCodeFenceContent(text: string): string | undefined {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  return match?.[1]?.trim();
}

function nextJsonContainerStart(text: string, startIndex: number): number {
  const objectStart = text.indexOf("{", startIndex);
  const arrayStart = text.indexOf("[", startIndex);
  if (objectStart === -1) return arrayStart;
  if (arrayStart === -1) return objectStart;
  return Math.min(objectStart, arrayStart);
}

function findJsonContainerEnd(text: string, startIndex: number): number {
  const opener = text[startIndex];
  if (opener !== "{" && opener !== "[") return -1;

  const expectedClosers = [opener === "{" ? "}" : "]"];
  let inString = false;
  let escaped = false;

  for (let index = startIndex + 1; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      expectedClosers.push("}");
      continue;
    }

    if (char === "[") {
      expectedClosers.push("]");
      continue;
    }

    if (char === expectedClosers[expectedClosers.length - 1]) {
      expectedClosers.pop();
      if (expectedClosers.length === 0) return index;
    }
  }

  return -1;
}

function isSerializedToolCallJson(text: string): boolean {
  try {
    return isToolCallJson(JSON.parse(text));
  } catch {
    return false;
  }
}

function isToolCallJson(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0 && value.every(isToolCallJson);
  if (!isRecord(value)) return false;
  return value.type === "toolCall" || value.type === "tool_call" || value.type === "tool_use";
}

function cleanupRemovedToolCallText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

import { isRecord, stripSerializedToolCallsFromText } from "@pi-gui/shared";

export type ExtractedMessageContent = {
  text: string;
  thinking?: string;
};

export function extractPiMessageContent(message: Record<string, unknown>): ExtractedMessageContent {
  const content = message.content;
  if (typeof content === "string") return { text: stripSerializedToolCallsFromText(content) };
  if (isRecord(content) && isToolCallContentPart(content)) return { text: "" };
  if (!Array.isArray(content)) return { text: textFromResult(content) };

  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) {
      const text = textFromResult(part);
      if (text) textParts.push(text);
      continue;
    }
    if (part.type === "text" && typeof part.text === "string") {
      const text = stripSerializedToolCallsFromText(part.text);
      if (text) textParts.push(text);
      continue;
    }
    if (part.type === "thinking" && typeof part.thinking === "string") {
      if (part.thinking) thinkingParts.push(part.thinking);
      continue;
    }
    if (part.type === "output_text" && typeof part.text === "string") {
      const text = stripSerializedToolCallsFromText(part.text);
      if (text) textParts.push(text);
      continue;
    }
    if (isToolCallContentPart(part)) {
      continue;
    }
    const fallback = textFromResult(part);
    if (fallback && fallback !== "{}") textParts.push(fallback);
  }

  return {
    text: textParts.filter(Boolean).join("\n"),
    thinking: thinkingParts.filter(Boolean).join("\n") || undefined,
  };
}

export function textFromResult(value: unknown): string {
  if (typeof value === "string") return stripSerializedToolCallsFromText(value);
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(textFromResult).filter(Boolean).join("\n");
  if (!isRecord(value)) return String(value);
  if (isToolCallContentPart(value)) return "";

  if (typeof value.text === "string") return stripSerializedToolCallsFromText(value.text);
  if (typeof value.content === "string") return stripSerializedToolCallsFromText(value.content);
  if (typeof value.output === "string") return stripSerializedToolCallsFromText(value.output);
  if (typeof value.result === "string") return stripSerializedToolCallsFromText(value.result);
  if (typeof value.thinking === "string") return "";

  const nestedContent = textFromResult(value.content);
  if (nestedContent) return nestedContent;
  const nestedResult = textFromResult(value.result);
  if (nestedResult) return nestedResult;

  return JSON.stringify(value, null, 2);
}

export function isToolCallContentPart(part: Record<string, unknown>): boolean {
  return part.type === "toolCall" || part.type === "tool_call" || part.type === "tool_use" || part.type === "toolResult" || part.type === "tool_result";
}

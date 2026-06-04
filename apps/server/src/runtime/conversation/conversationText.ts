const MAX_CONVERSATION_TEXT_CHARS = 200_000;

export function compactText(text: string): string {
  if (text.length <= MAX_CONVERSATION_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_CONVERSATION_TEXT_CHARS)}\n…[truncated ${text.length - MAX_CONVERSATION_TEXT_CHARS} chars]`;
}

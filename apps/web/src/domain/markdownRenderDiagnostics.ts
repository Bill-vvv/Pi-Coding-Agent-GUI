export type MarkdownContentSource = "message" | "thinking" | "subagent";

export type MarkdownEmergencyFallbackEvent = {
  source: MarkdownContentSource;
  streaming: boolean;
  textLength: number;
  reason: string;
  blockCount?: number;
  recordedAt: number;
};

const MAX_DIAGNOSTIC_EVENTS = 50;
const markdownEmergencyFallbackEvents: MarkdownEmergencyFallbackEvent[] = [];

export function reportMarkdownEmergencyFallback(input: Omit<MarkdownEmergencyFallbackEvent, "recordedAt">): void {
  const event: MarkdownEmergencyFallbackEvent = { ...input, recordedAt: Date.now() };
  markdownEmergencyFallbackEvents.push(event);
  if (markdownEmergencyFallbackEvents.length > MAX_DIAGNOSTIC_EVENTS) markdownEmergencyFallbackEvents.splice(0, markdownEmergencyFallbackEvents.length - MAX_DIAGNOSTIC_EVENTS);
  console.warn("[markdown-emergency-fallback]", event);
}

export function readMarkdownEmergencyFallbackEvents(): MarkdownEmergencyFallbackEvent[] {
  return [...markdownEmergencyFallbackEvents];
}

export function clearMarkdownEmergencyFallbackEvents(): void {
  markdownEmergencyFallbackEvents.length = 0;
}

export function debugForcedMarkdownEmergencyFallbackReason(): string | undefined {
  const value = (globalThis as { __PI_GUI_FORCE_MARKDOWN_EMERGENCY_FALLBACK__?: unknown }).__PI_GUI_FORCE_MARKDOWN_EMERGENCY_FALLBACK__;
  if (value === true) return "debug-force";
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

import type { ModelSummary, ThinkingLevel } from "@pi-gui/shared";

export const THINKING_LEVELS: Array<{ value: ThinkingLevel; label: string }> = [
  { value: "off", label: "关闭思考" },
  { value: "minimal", label: "极低" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "超高" },
];

const DEFAULT_REASONING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

// Non-authoritative GUI fallback catalog used only when Pi model discovery is
// unavailable. Pi/provider remains the source of truth for model availability.
// Non-authoritative GUI fallback catalog used when Pi model discovery is
// unavailable. Pi/provider remains final authority when a selected model is sent
// through runtime.start/configure.
export const FALLBACK_MODELS: ModelSummary[] = [
  { provider: "openai-codex", id: "gpt-5.2", label: "openai-codex/GPT-5.2", supportsThinking: true, supportedThinkingLevels: DEFAULT_REASONING_LEVELS, supportsImages: true, supportsFast: true },
  { provider: "openai-codex", id: "gpt-5.3-codex", label: "openai-codex/GPT-5.3 Codex", supportsThinking: true, supportedThinkingLevels: DEFAULT_REASONING_LEVELS, supportsImages: true, supportsFast: true },
  { provider: "openai-codex", id: "gpt-5.3-codex-spark", label: "openai-codex/GPT-5.3 Codex Spark", supportsThinking: true, supportedThinkingLevels: DEFAULT_REASONING_LEVELS, supportsImages: false, supportsFast: true },
  { provider: "openai-codex", id: "gpt-5.4", label: "openai-codex/GPT-5.4", supportsThinking: true, supportedThinkingLevels: DEFAULT_REASONING_LEVELS, supportsImages: true, supportsFast: true },
  { provider: "openai-codex", id: "gpt-5.4-mini", label: "openai-codex/GPT-5.4 mini", supportsThinking: true, supportedThinkingLevels: DEFAULT_REASONING_LEVELS, supportsImages: true, supportsFast: true },
  { provider: "openai-codex", id: "gpt-5.5", label: "openai-codex/GPT-5.5", supportsThinking: true, supportedThinkingLevels: DEFAULT_REASONING_LEVELS, supportsImages: true, supportsFast: true },
];

export function modelKey(model: ModelSummary): string {
  return `${model.provider}/${model.id}`;
}


export function modelSummaryFromKey(key: string): ModelSummary | undefined {
  // UI-only projection for stored/freeform keys. Capability flags are adapter
  // hints for rendering controls, not provider validation.
  const separatorIndex = key.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === key.length - 1) return undefined;
  const provider = key.slice(0, separatorIndex);
  const id = key.slice(separatorIndex + 1);
  // Fallback capability hint for display only; the provider/Pi request layer
  // remains the authority on whether fast mode actually succeeds.
  const supportsFast = provider === "openai" || provider === "openai-codex";
  return {
    provider,
    id,
    label: key,
    supportsThinking: true,
    supportedThinkingLevels: DEFAULT_REASONING_LEVELS,
    supportsImages: false,
    supportsFast,
  };
}

export function compactModelLabel(model: ModelSummary): string {
  return model.id
    .replace(/^gpt-/, "GPT-")
    .replace(/codex/gi, "Codex")
    .replace(/claude/gi, "Claude");
}

export function thinkingLabel(level: ThinkingLevel): string {
  return THINKING_LEVELS.find((item) => item.value === level)?.label ?? level;
}

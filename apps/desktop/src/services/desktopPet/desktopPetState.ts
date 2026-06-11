import { CODEX_PET_ANIMATIONS, type CodexPetAnimationName, type DesktopPetStatus, type NormalizedDesktopPetDisplay } from "./types.js";

const animationSet = new Set<string>(CODEX_PET_ANIMATIONS);
const statusSet = new Set<string>(["idle", "running", "waiting", "review", "done", "failed", "message"] satisfies DesktopPetStatus[]);

export function normalizeDesktopPetDisplay(payload: unknown): NormalizedDesktopPetDisplay | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.title !== "string" || typeof record.detail !== "string") return undefined;
  const mood = compactDesktopPetText(typeof record.mood === "string" ? record.mood : "idle", 32) || "idle";
  const status = normalizeDesktopPetStatus(typeof record.status === "string" ? record.status : statusFromMood(mood));
  return {
    mood,
    tone: compactDesktopPetText(typeof record.tone === "string" ? record.tone : "neutral", 32) || "neutral",
    status,
    animation: normalizeCodexPetAnimation(typeof record.animation === "string" ? record.animation : animationFromMood(mood)),
    title: compactDesktopPetText(record.title, 80),
    detail: compactDesktopPetText(record.detail, 220),
    badges: Array.isArray(record.badges) ? record.badges.filter((item): item is string => typeof item === "string").map((item) => compactDesktopPetText(item, 48)).filter(Boolean).slice(0, 3) : [],
    threadId: compactDesktopPetText(typeof record.threadId === "string" ? record.threadId : "pi-gui-active-runtime", 80) || "pi-gui-active-runtime",
    petId: typeof record.petId === "string" ? compactDesktopPetText(record.petId, 80) : undefined,
  };
}

export function compactDesktopPetText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 1))}…` : compact;
}

export function normalizeCodexPetAnimation(value: string): CodexPetAnimationName {
  return animationSet.has(value) ? value as CodexPetAnimationName : "idle";
}

export function normalizeDesktopPetStatus(value: string): DesktopPetStatus {
  return statusSet.has(value) ? value as DesktopPetStatus : "message";
}

export function codexPetAnimationRow(animation: CodexPetAnimationName): number {
  return CODEX_PET_ANIMATIONS.indexOf(animation);
}

export function statusFromMood(mood: string): DesktopPetStatus {
  switch (mood) {
    case "starting":
    case "thinking":
    case "tool":
    case "subagents":
    case "background":
      return "running";
    case "waiting":
    case "queued":
      return "waiting";
    case "context":
    case "recovering":
      return "review";
    case "ready":
      return "done";
    case "error":
    case "crashed":
      return "failed";
    case "sleeping":
    case "idle":
    default:
      return "idle";
  }
}

export function animationFromMood(mood: string): CodexPetAnimationName {
  switch (mood) {
    case "starting":
    case "thinking":
    case "tool":
    case "subagents":
    case "background":
      return "running";
    case "waiting":
    case "queued":
      return "waiting";
    case "context":
    case "recovering":
      return "review";
    case "ready":
      return "waving";
    case "error":
    case "crashed":
      return "failed";
    case "sleeping":
    case "idle":
    default:
      return "idle";
  }
}

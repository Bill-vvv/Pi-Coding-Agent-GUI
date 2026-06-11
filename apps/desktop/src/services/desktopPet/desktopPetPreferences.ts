import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { DesktopPetPin, DesktopPetPreferences } from "./types.js";

const DEFAULT_SCALE = 1;
const DEFAULT_PIN: DesktopPetPin = "bottom-right";

export function defaultDesktopPetPreferences(): DesktopPetPreferences {
  return { scale: DEFAULT_SCALE, pin: DEFAULT_PIN };
}

export function loadDesktopPetPreferences(path: string): DesktopPetPreferences {
  if (!existsSync(path)) return defaultDesktopPetPreferences();
  try {
    return normalizeDesktopPetPreferences(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    return defaultDesktopPetPreferences();
  }
}

export function saveDesktopPetPreferences(path: string, preferences: DesktopPetPreferences): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(normalizeDesktopPetPreferences(preferences), null, 2));
}

export function normalizeDesktopPetPreferences(value: unknown): DesktopPetPreferences {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    selectedPetId: typeof record.selectedPetId === "string" && record.selectedPetId.trim() ? record.selectedPetId.trim() : undefined,
    scale: normalizeDesktopPetScale(record.scale),
    position: normalizePosition(record.position),
    pin: normalizePin(record.pin),
  };
}

export function normalizeDesktopPetScale(value: unknown): number {
  const scale = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_SCALE;
  return Math.min(2, Math.max(0.5, Math.round(scale * 100) / 100));
}

function normalizePosition(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.x !== "number" || typeof record.y !== "number" || !Number.isFinite(record.x) || !Number.isFinite(record.y)) return undefined;
  return { x: Math.round(record.x), y: Math.round(record.y) };
}

function normalizePin(value: unknown): DesktopPetPin {
  return value === "bottom-left" || value === "top-right" || value === "top-left" || value === "free" || value === "bottom-right" ? value : DEFAULT_PIN;
}

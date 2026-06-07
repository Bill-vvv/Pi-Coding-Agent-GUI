import type { GuiEventKind, ThinkingLevel } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";

export { isRecord };

export function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function thinkingLevelOrUndefined(value: unknown): ThinkingLevel | undefined {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : undefined;
}

export function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function responseModeOrUndefined(value: unknown): "normal" | "fast" | undefined {
  return value === "normal" || value === "fast" ? value : undefined;
}

export function guiEventKindsOrUndefined(value: unknown): GuiEventKind[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("runtime.logs kinds must be an array");
  const kinds = value.map((item) => {
    if (item === "runtime_status" || item === "stderr" || item === "error" || item === "pi_event") return item;
    throw new Error("runtime.logs kinds contains an invalid event kind");
  });
  return [...new Set(kinds)];
}

export function nonNegativeNumberOrUndefined(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number`);
  return value;
}

export function positiveNumberOrUndefined(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${field} must be a positive number`);
  return value;
}

export function nonEmptyStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must be a non-empty string array`);
  return value.map((item) => {
    if (typeof item !== "string" || item.trim() === "") throw new Error(`${field} must be a non-empty string array`);
    return item;
  });
}

import type { GuiEventKind, RuntimeProfileId, ThinkingLevel } from "@pi-gui/shared";
import { isRecord, isRuntimeProfileId } from "@pi-gui/shared";

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

export function runtimeProfileIdOrUndefined(value: unknown): RuntimeProfileId | undefined {
  return isRuntimeProfileId(value) ? value : undefined;
}

export function guiEventKindsOrUndefined(value: unknown): GuiEventKind[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("runtime.logs kinds must be an array");
  const kinds = value.map((item) => {
    if (item === "runtime_status" || item === "stderr" || item === "error" || item === "pi_event" || item === "checkpoint") return item;
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

export function stringArrayOrUndefined(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be a string array`);
  return [...new Set(value.map((item) => {
    if (typeof item !== "string" || item.trim() === "") throw new Error(`${field} must be a string array`);
    return item.trim();
  }))];
}

export function nonEmptyStringArray(value: unknown, field: string): string[] {
  const values = stringArrayOrUndefined(value, field);
  if (!values || values.length === 0) throw new Error(`${field} must be a non-empty string array`);
  return values;
}

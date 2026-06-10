import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ResponseMode } from "@pi-gui/shared";

// Runtime-local temporary provider shim: GUI responseMode maps to provider
// service_tier through an injected Pi extension. This writes only under
// `.pi-gui/runtime-config`, never provider credentials or `~/.pi`.
// Runtime-local temporary provider shim: GUI responseMode "fast" maps to the
// OpenAI priority service_tier consumed by the bundled Pi extension. This file
// writes only `.pi-gui/runtime-config/*`, never Pi/provider credential config.
export function responseModeToServiceTier(responseMode: ResponseMode | undefined): "priority" | undefined {
  return responseMode === "fast" ? "priority" : undefined;
}

export function serviceTierConfigPath(runtimeId: string): string {
  return resolve(process.cwd(), ".pi-gui", "runtime-config", `${runtimeId}.json`);
}

export function writeServiceTierConfig(filePath: string | undefined, responseMode: ResponseMode | undefined): void {
  if (!filePath) return;
  mkdirSync(dirname(filePath), { recursive: true });
  const serviceTier = responseModeToServiceTier(responseMode);
  writeFileSync(filePath, JSON.stringify(serviceTier ? { serviceTier } : {}), "utf8");
}

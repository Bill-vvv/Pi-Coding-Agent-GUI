import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ResponseMode } from "@pi-gui/shared";

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

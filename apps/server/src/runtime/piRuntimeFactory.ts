import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ResponseMode, RuntimeProfileId, ThinkingLevel } from "@pi-gui/shared";
import { projectExtensionPathsForCapabilities } from "./piExtensionDiscovery.js";
import { PiRpcClient } from "./piRpcClient.js";
import { resolveRuntimeCapabilityPlan, type RuntimeCapabilityPlan } from "./runtimeCapabilities.js";
import { serviceTierConfigPath, writeServiceTierConfig } from "./serviceTierConfig.js";

// These files are loaded by absolute path and passed to `pi --mode rpc --extension`.
// They intentionally have no normal TypeScript import edge from production code;
// do not classify them as zombie modules during static reachability cleanup.
//
// Boundary: these are GUI-safe temporary Pi-extension shims. They are passed as
// runtime launch args, are not installed into Pi, and do not mutate `~/.pi`.
// When Pi Agent/provider layers expose first-class capabilities, replace these
// shims with thin adapters that call those capabilities.
const INTERNAL_EXTENSION_PATHS = {
  serviceTier: resolveSiblingExtensionPath("piServiceTierExtension"),
  readyNotification: resolveSiblingExtensionPath("piReadyNotificationExtension"),
  codexTransportMonitor: resolveSiblingExtensionPath("piCodexTransportMonitorExtension"),
};

export type PiRuntimeClientOptions = {
  runtimeId: string;
  cwd: string;
  session?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  responseMode?: ResponseMode;
  runtimeProfileId?: RuntimeProfileId;
  savedRuntimeProfileId?: RuntimeProfileId;
  defaultRuntimeProfileId?: RuntimeProfileId;
  customRuntimeCapabilityIds?: string[];
  confirmedProjectExtensionIds?: string[];
};

export type PiRuntimeClientBundle = {
  client: PiRpcClient;
  serviceTierConfigFile: string;
  capabilityPlan: RuntimeCapabilityPlan;
};

export function createPiRuntimeClient(options: PiRuntimeClientOptions): PiRuntimeClientBundle {
  const capabilityPlan = resolveRuntimeCapabilityPlan({
    cwd: options.cwd,
    requestedProfileId: options.runtimeProfileId,
    savedProfileId: options.savedRuntimeProfileId,
    defaultProfileId: options.defaultRuntimeProfileId,
    customCapabilityIds: options.customRuntimeCapabilityIds,
    responseMode: options.responseMode,
  });
  const serviceTierConfigFile = serviceTierConfigPath(options.runtimeId);
  if (capabilityPlan.serviceTierExtensionEnabled) writeServiceTierConfig(serviceTierConfigFile, options.responseMode);
  return {
    serviceTierConfigFile,
    capabilityPlan,
    client: new PiRpcClient(options.cwd, {
      session: options.session,
      model: options.model,
      thinkingLevel: options.thinkingLevel,
      serviceTierConfigFile: capabilityPlan.serviceTierExtensionEnabled ? serviceTierConfigFile : undefined,
      extensionPaths: extensionPathsForCapabilityPlan(options.cwd, capabilityPlan, options.confirmedProjectExtensionIds),
      disableExtensionDiscovery: capabilityPlan.disableExtensionDiscovery,
      codexTransportMonitorEnabled: capabilityPlan.codexTransportMonitorEnabled,
    }),
  };
}

function extensionPathsForCapabilityPlan(cwd: string, plan: RuntimeCapabilityPlan, confirmedProjectExtensionIds: string[] = []): string[] {
  const paths = internalExtensionPathsForCapabilityPlan(plan);
  if (plan.disableExtensionDiscovery) {
    paths.push(...projectExtensionPathsForCapabilities(cwd, plan.enabledCapabilityIds, confirmedProjectExtensionIds));
  }
  return [...new Set(paths)].sort();
}

function internalExtensionPathsForCapabilityPlan(plan: RuntimeCapabilityPlan): string[] {
  const paths: string[] = [];
  if (plan.serviceTierExtensionEnabled) paths.push(INTERNAL_EXTENSION_PATHS.serviceTier);
  if (plan.readyNotificationsEnabled) paths.push(INTERNAL_EXTENSION_PATHS.readyNotification);
  if (plan.codexTransportMonitorEnabled) paths.push(INTERNAL_EXTENSION_PATHS.codexTransportMonitor);
  return paths;
}

function resolveSiblingExtensionPath(baseName: string): string {
  const jsPath = fileURLToPath(new URL(`./${baseName}.js`, import.meta.url));
  if (existsSync(jsPath)) return jsPath;

  const tsPath = fileURLToPath(new URL(`./${baseName}.ts`, import.meta.url));
  if (existsSync(tsPath)) return tsPath;

  return jsPath;
}

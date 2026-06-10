import { capabilitiesForRuntimeProfile, runtimeProfileById, type CapabilityDescriptor, type RuntimeProfileId } from "@pi-gui/shared";
import { parseSshProjectCwd } from "../services/sshProjectService.js";

export type RuntimeCapabilityPlan = {
  runtimeProfileId: RuntimeProfileId;
  enabledCapabilityIds: string[];
  inheritUserExtensions: boolean;
  disableExtensionDiscovery: boolean;
  interactivePromptsEnabled: boolean;
  readyNotificationsEnabled: boolean;
  codexTransportMonitorEnabled: boolean;
  serviceTierExtensionEnabled: boolean;
};

export function resolveRuntimeCapabilityPlan(options: {
  cwd: string;
  requestedProfileId?: RuntimeProfileId;
  savedProfileId?: RuntimeProfileId;
  defaultProfileId?: RuntimeProfileId;
  responseMode?: unknown;
}): RuntimeCapabilityPlan {
  const runtimeProfileId = options.requestedProfileId ?? options.savedProfileId ?? options.defaultProfileId ?? "vanilla-pi";
  const profile = runtimeProfileById(runtimeProfileId);
  const remoteRuntime = Boolean(parseSshProjectCwd(options.cwd));
  const profileCapabilities = capabilitiesForRuntimeProfile(runtimeProfileId).filter((capability) => capabilitySupportsTarget(capability, remoteRuntime));
  const explicitCapabilityIds = new Set(profileCapabilities.map((capability) => capability.id));

  // Fast response mode is an explicit user/runtime option that depends on the
  // service-tier provider shim. The default "normal" mode must not opt Vanilla
  // Pi into GUI-owned extension injection just because the UI sends its normal
  // default runtime setting.
  if (options.responseMode === "fast" && !remoteRuntime) explicitCapabilityIds.add("provider-models");

  return {
    runtimeProfileId,
    enabledCapabilityIds: [...explicitCapabilityIds].sort(),
    inheritUserExtensions: profile.inheritsUserExtensions,
    disableExtensionDiscovery: !profile.inheritsUserExtensions,
    interactivePromptsEnabled: explicitCapabilityIds.has("interactive-prompts") && !remoteRuntime,
    readyNotificationsEnabled: explicitCapabilityIds.has("pi-ready-notifications") && !remoteRuntime,
    codexTransportMonitorEnabled: explicitCapabilityIds.has("codex-transport-monitor") && !remoteRuntime,
    serviceTierExtensionEnabled: explicitCapabilityIds.has("provider-models") && !remoteRuntime,
  };
}

export function runtimeHasCapability(runtime: { enabledCapabilityIds?: string[] } | undefined, capabilityId: string): boolean {
  return runtime?.enabledCapabilityIds?.includes(capabilityId) === true;
}

function capabilitySupportsTarget(capability: CapabilityDescriptor, remoteRuntime: boolean): boolean {
  return remoteRuntime ? capability.supportsRemoteRuntime : capability.supportsLocalRuntime;
}

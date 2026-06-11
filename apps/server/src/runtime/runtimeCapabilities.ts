import { capabilitiesForRuntimeProfile, DEFAULT_RUNTIME_PROFILE_ID, PI_GUI_CAPABILITIES, runtimeProfileById, type CapabilityDescriptor, type RuntimeProfileId } from "@pi-gui/shared";
import { parseSshProjectCwd } from "../services/sshProjectService.js";

export type RuntimeCapabilityPlan = {
  runtimeProfileId: RuntimeProfileId;
  enabledCapabilityIds: string[];
  inheritUserExtensions: boolean;
  disableExtensionDiscovery: boolean;
  readyNotificationsEnabled: boolean;
  codexTransportMonitorEnabled: boolean;
  serviceTierExtensionEnabled: boolean;
};

export function resolveRuntimeCapabilityPlan(options: {
  cwd: string;
  requestedProfileId?: RuntimeProfileId;
  savedProfileId?: RuntimeProfileId;
  defaultProfileId?: RuntimeProfileId;
  customCapabilityIds?: string[];
  responseMode?: unknown;
}): RuntimeCapabilityPlan {
  const runtimeProfileId = options.requestedProfileId ?? options.savedProfileId ?? options.defaultProfileId ?? DEFAULT_RUNTIME_PROFILE_ID;
  const profile = runtimeProfileById(runtimeProfileId);
  const remoteRuntime = Boolean(parseSshProjectCwd(options.cwd));
  const profileCapabilities = runtimeProfileId === "custom"
    ? customCapabilities(options.customCapabilityIds).filter((capability) => capabilitySupportsTarget(capability, remoteRuntime))
    : capabilitiesForRuntimeProfile(runtimeProfileId).filter((capability) => capabilitySupportsTarget(capability, remoteRuntime));
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
    readyNotificationsEnabled: explicitCapabilityIds.has("pi-ready-notifications") && !remoteRuntime,
    codexTransportMonitorEnabled: explicitCapabilityIds.has("codex-transport-monitor") && !remoteRuntime,
    serviceTierExtensionEnabled: explicitCapabilityIds.has("provider-models") && !remoteRuntime,
  };
}

export function runtimeHasCapability(runtime: { enabledCapabilityIds?: string[] } | undefined, capabilityId: string): boolean {
  return runtime?.enabledCapabilityIds?.includes(capabilityId) === true;
}

function customCapabilities(capabilityIds: string[] | undefined): CapabilityDescriptor[] {
  if (!capabilityIds?.length) return [];
  const requested = new Set(capabilityIds);
  return PI_GUI_CAPABILITIES.filter((capability) => requested.has(capability.id));
}

function capabilitySupportsTarget(capability: CapabilityDescriptor, remoteRuntime: boolean): boolean {
  return remoteRuntime ? capability.supportsRemoteRuntime : capability.supportsLocalRuntime;
}

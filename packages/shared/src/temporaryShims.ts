import {
  PI_GUI_CAPABILITIES,
  type CapabilityDescriptor,
  type CapabilityImplementationHost,
  type CapabilityReleaseStance,
  type CapabilityRisk,
} from "./capabilities.js";

export type TemporaryShimImplementationHost = CapabilityImplementationHost;
export type TemporaryShimRisk = CapabilityRisk;
export type TemporaryShimReleaseStance = Exclude<CapabilityReleaseStance, "core">;

export type TemporaryShimDescriptor = {
  id: string;
  label: string;
  summary: string;
  implementationHost: TemporaryShimImplementationHost;
  risks: TemporaryShimRisk[];
  releaseStance: TemporaryShimReleaseStance;
  mutatesPiEnvironment: boolean;
};

export const TEMPORARY_SHIMS: TemporaryShimDescriptor[] = PI_GUI_CAPABILITIES.filter(isLegacyTemporaryShim).map((capability) => ({
  id: capability.id,
  label: capability.label,
  summary: capability.summary,
  implementationHost: capability.implementationHost,
  risks: capability.risks,
  releaseStance: toTemporaryShimReleaseStance(capability.releaseStance),
  mutatesPiEnvironment: capability.mutatesPiEnvironment,
}));

export function temporaryShimCounts(shims: readonly TemporaryShimDescriptor[] = TEMPORARY_SHIMS): { total: number; explicitSetup: number; mutating: number } {
  return {
    total: shims.length,
    explicitSetup: shims.filter((shim) => shim.releaseStance === "explicit-setup").length,
    mutating: shims.filter((shim) => shim.mutatesPiEnvironment).length,
  };
}

function isLegacyTemporaryShim(capability: CapabilityDescriptor): boolean {
  return capability.legacyTemporaryShim === true;
}

function toTemporaryShimReleaseStance(stance: CapabilityReleaseStance): TemporaryShimReleaseStance {
  if (stance === "core") throw new Error("Core capabilities are not temporary shims");
  return stance;
}

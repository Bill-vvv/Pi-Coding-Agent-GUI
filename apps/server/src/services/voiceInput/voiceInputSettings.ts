import type { VoiceInputSettings } from "@pi-gui/shared";
import { effectiveVoiceInputLimits } from "@pi-gui/shared";
import type { VoiceInputEffectiveConfig } from "./types.js";

export function effectiveVoiceInputConfig(settings: VoiceInputSettings | undefined): VoiceInputEffectiveConfig {
  const limits = effectiveVoiceInputLimits(settings);
  return {
    mode: settings?.mode ?? "disabled",
    captureMode: settings?.captureMode ?? "browser",
    externalUrl: settings?.externalUrl?.trim() || undefined,
    managedCommand: settings?.managedCommand?.trim() || undefined,
    managedArgs: settings?.managedArgs ?? [],
    managedCwd: settings?.managedCwd?.trim() || undefined,
    modelPath: settings?.modelPath?.trim() || undefined,
    autoStart: settings?.autoStart ?? true,
    ...limits,
  };
}

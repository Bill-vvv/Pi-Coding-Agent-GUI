import type { Runtime } from "@pi-gui/shared";
import type { ManagedRuntime } from "./managedRuntime.js";
import { modelKeyFromPiResponseData, thinkingLevelFromPiResponseData } from "./runtimePiPayload.js";
import type { RuntimeEventSink } from "./runtimeEventSink.js";

export function updateRuntimeConfigFromPiResponse(managed: ManagedRuntime, data: Record<string, unknown>, events: RuntimeEventSink): void {
  const model = modelKeyFromPiResponseData(data);
  const thinkingLevel = thinkingLevelFromPiResponseData(data);
  if (!model && !thinkingLevel) return;

  const nextRuntime: Runtime = {
    ...managed.runtime,
    model: model ?? managed.runtime.model,
    thinkingLevel: thinkingLevel ?? managed.runtime.thinkingLevel,
  };
  if (nextRuntime.model === managed.runtime.model && nextRuntime.thinkingLevel === managed.runtime.thinkingLevel) return;

  managed.runtime = nextRuntime;
  events.publishRuntimeStatus(nextRuntime);
}

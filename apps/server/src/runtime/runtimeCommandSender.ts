import { randomUUID } from "node:crypto";
import type { PiRpcCommand, ResponseMode, Runtime, ServerEvent, SlashCommand, ThinkingLevel } from "@pi-gui/shared";
import type { ManagedRuntime } from "./managedRuntime.js";
import { expandPromptFileReferences } from "./promptFileReferences.js";
import type { RuntimeLiveState } from "./runtimeLiveState.js";
import { responseModeToServiceTier, writeServiceTierConfig } from "./serviceTierConfig.js";

export type RuntimeConfigureOptions = {
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  responseMode?: ResponseMode;
};

type Broadcast = (event: ServerEvent) => void;

export function runtimeWithConfiguredOptions(currentRuntime: Runtime, options: RuntimeConfigureOptions): Runtime {
  const model = configuredModelKey(options);
  return {
    ...currentRuntime,
    model: model ?? currentRuntime.model,
    thinkingLevel: options.thinkingLevel ?? currentRuntime.thinkingLevel,
    responseMode: options.responseMode ?? currentRuntime.responseMode,
  };
}

export function applyManagedRuntimeConfiguration(managed: ManagedRuntime, options: RuntimeConfigureOptions, nextRuntime: Runtime): void {
  const model = configuredModelKey(options);
  managed.runtime = nextRuntime;
  if (model || options.thinkingLevel) managed.configRevision += 1;
  if (options.modelProvider && options.modelId) {
    managed.client.send({
      id: `gui-${randomUUID()}`,
      type: "set_model",
      provider: options.modelProvider,
      modelId: options.modelId,
    });
  }
  if (options.thinkingLevel) {
    managed.client.send({ id: `gui-${randomUUID()}`, type: "set_thinking_level", level: options.thinkingLevel });
  }
  if (options.responseMode) {
    writeServiceTierConfig(managed.serviceTierConfigFile, options.responseMode);
    managed.client.send({ id: `gui-${randomUUID()}`, type: "set_service_tier", serviceTier: responseModeToServiceTier(options.responseMode) });
  }
}

export async function sendPrompt(managed: ManagedRuntime, message: string, streamingBehavior: "steer" | "followUp" | undefined, cwd: string): Promise<void> {
  const expanded = await expandPromptFileReferences(message, cwd);
  const command: Record<string, unknown> = {
    id: `gui-${randomUUID()}`,
    type: "prompt",
    message: expanded.message,
  };
  if (expanded.images) command.images = expanded.images;
  if (streamingBehavior) command.streamingBehavior = streamingBehavior;
  managed.client.send(command);
}

export function sendNativeRpcCommand(managed: ManagedRuntime, command: PiRpcCommand, label?: string): void {
  const id = `gui-${randomUUID()}`;
  managed.pendingNativeRpcCommands.set(id, { command: command.type, label });
  managed.client.send({ ...command, id });
}

export function sendAbort(managed: ManagedRuntime): void {
  managed.client.send({ id: `gui-${randomUUID()}`, type: "abort" });
}

export function sendExtensionUiResponse(managed: ManagedRuntime, responseId: string, response: Record<string, unknown>): void {
  managed.client.send({ type: "extension_ui_response", id: responseId, ...response });
}

export function requestRuntimeSlashCommands(managed: ManagedRuntime, liveState: RuntimeLiveState, broadcast: Broadcast): SlashCommand[] | undefined {
  const cached = liveState.getCommands(managed.runtime.id);
  managed.commandsRequestId = `gui-${randomUUID()}`;
  managed.client.send({ id: managed.commandsRequestId, type: "get_commands" });
  if (cached) {
    broadcast({ type: "runtime.commands", runtimeId: managed.runtime.id, projectId: managed.runtime.projectId, commands: cached });
  }
  return cached;
}

function configuredModelKey(options: RuntimeConfigureOptions): string | undefined {
  return options.modelProvider && options.modelId ? `${options.modelProvider}/${options.modelId}` : undefined;
}

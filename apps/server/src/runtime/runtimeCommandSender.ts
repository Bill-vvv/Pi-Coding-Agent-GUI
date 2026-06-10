import { randomUUID } from "node:crypto";
import { isRecord, type PiRpcCommand, type ResponseMode, type Runtime, type RuntimeQueue, type ServerEvent, type SlashCommand, type ThinkingLevel } from "@pi-gui/shared";
import type { ManagedRuntime } from "./managedRuntime.js";
import { expandPromptFileReferences } from "./promptFileReferences.js";
import type { RuntimeLiveState } from "./runtimeLiveState.js";
import { runtimeQueueFromPiPayload } from "./runtimePiPayload.js";
import { responseModeToServiceTier, writeServiceTierConfig } from "./serviceTierConfig.js";

export type RuntimeConfigureOptions = {
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  responseMode?: ResponseMode;
};

type Broadcast = (event: ServerEvent) => void;

const CLEAR_QUEUE_RPC_TIMEOUT_MS = 5000;

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
  // Preserve existing order while keeping GUI runtime metadata updates separate
  // from Pi RPC commands and the runtime-local provider shim side effect.
  sendModelConfiguration(managed, options);
  sendThinkingConfiguration(managed, options);
  applyServiceTierShimConfiguration(managed, options);
}

function sendModelConfiguration(managed: ManagedRuntime, options: RuntimeConfigureOptions): void {
  if (!options.modelProvider || !options.modelId) return;
  managed.client.send({
    id: `gui-${randomUUID()}`,
    type: "set_model",
    provider: options.modelProvider,
    modelId: options.modelId,
  });
}

function sendThinkingConfiguration(managed: ManagedRuntime, options: RuntimeConfigureOptions): void {
  if (!options.thinkingLevel) return;
  managed.client.send({ id: `gui-${randomUUID()}`, type: "set_thinking_level", level: options.thinkingLevel });
}

function applyServiceTierShimConfiguration(managed: ManagedRuntime, options: RuntimeConfigureOptions): void {
  if (!options.responseMode) return;
  writeServiceTierConfig(managed.serviceTierConfigFile, options.responseMode);
  managed.client.send({ id: `gui-${randomUUID()}`, type: "set_service_tier", serviceTier: responseModeToServiceTier(options.responseMode) });
}

export async function sendPrompt(managed: ManagedRuntime, message: string, streamingBehavior: "steer" | "followUp" | undefined, cwd: string): Promise<void> {
  const expanded = await expandPromptFileReferences(message, cwd);
  const command: Record<string, unknown> = {
    id: `gui-${randomUUID()}`,
    type: "prompt",
    message: expanded.message,
  };
  if (streamingBehavior) command.streamingBehavior = streamingBehavior;
  managed.client.send(command);
}

export async function dequeueQueuedPrompts(managed: ManagedRuntime): Promise<RuntimeQueue> {
  const response = await managed.client.request({ id: `gui-${randomUUID()}`, type: "clear_queue" }, CLEAR_QUEUE_RPC_TIMEOUT_MS);
  if (response.success !== true) {
    const error = typeof response.error === "string" ? response.error : "Failed to restore queued messages";
    throw new Error(/Unknown command/i.test(error) ? "当前 Pi RPC 不支持队列撤回，请升级 Pi 到支持 clear_queue 的版本" : error);
  }
  return runtimeQueueFromPiPayload(isRecord(response.data) ? response.data : {});
}

export async function replaceQueuedPrompts(managed: ManagedRuntime, requestedQueue: RuntimeQueue, cwd: string): Promise<void> {
  const currentQueue = await dequeueQueuedPrompts(managed);
  if (!runtimeQueueHasSameItems(currentQueue, requestedQueue)) {
    await enqueueRuntimeQueue(managed, currentQueue, cwd);
    throw new Error("队列已更新，请重试排序");
  }
  await enqueueRuntimeQueue(managed, requestedQueue, cwd);
}

async function enqueueRuntimeQueue(managed: ManagedRuntime, queue: RuntimeQueue, cwd: string): Promise<void> {
  for (const message of queue.steering) {
    await sendPrompt(managed, message, "steer", cwd);
  }
  for (const message of queue.followUp) {
    await sendPrompt(managed, message, "followUp", cwd);
  }
}

function runtimeQueueHasSameItems(left: RuntimeQueue, right: RuntimeQueue): boolean {
  return stringMultisetKey(left.steering) === stringMultisetKey(right.steering) && stringMultisetKey(left.followUp) === stringMultisetKey(right.followUp);
}

function stringMultisetKey(values: string[]): string {
  return values.map((value) => JSON.stringify(value)).sort().join("\n");
}

export function sendNativeRpcCommand(managed: ManagedRuntime, command: PiRpcCommand, label?: string): void {
  const id = `gui-${randomUUID()}`;
  managed.pendingNativeRpcCommands.set(id, { command: command.type, label });
  managed.client.send({ ...command, id });
}

export function sendAbort(managed: ManagedRuntime): void {
  // Fan out to the known cancellable Pi RPC activities before the generic
  // agent abort. The generic abort covers the active agent run/retry, while
  // abort_bash handles standalone RPC bash operations if one is active.
  managed.client.send({ id: `gui-${randomUUID()}`, type: "abort_retry" });
  managed.client.send({ id: `gui-${randomUUID()}`, type: "abort_bash" });
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

import type { ClientCommand, GuiEventKind } from "@pi-gui/shared";
import type { WsClient } from "../wsHub.js";
import { sendCommandResult, type CommandHandlerContext } from "./types.js";

type CommandOf<TType extends ClientCommand["type"]> = Extract<ClientCommand, { type: TType }>;

const DEFAULT_RUNTIME_LOG_KINDS: GuiEventKind[] = ["runtime_status", "stderr", "error"];

export async function handleRuntimeStart(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"runtime.start">): Promise<void> {
  const runtime = context.supervisor.startRuntime(command.projectId, { model: command.model, thinkingLevel: command.thinkingLevel, responseMode: command.responseMode });
  sendCommandResult(context, socket, command, true, { runtime });
}

export async function handleRuntimeResume(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"runtime.resume">): Promise<void> {
  const runtime = context.supervisor.resumeRuntime(command.runtimeId, { model: command.model, thinkingLevel: command.thinkingLevel, responseMode: command.responseMode });
  sendCommandResult(context, socket, command, true, { runtime });
}

export async function handleRuntimeRestart(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"runtime.restart">): Promise<void> {
  const runtime = context.supervisor.restartRuntime(command.runtimeId, { model: command.model, thinkingLevel: command.thinkingLevel, responseMode: command.responseMode });
  sendCommandResult(context, socket, command, true, { runtime });
}

export async function handleRuntimeConfigure(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"runtime.configure">): Promise<void> {
  context.supervisor.configureRuntime(command.runtimeId, {
    modelProvider: command.modelProvider,
    modelId: command.modelId,
    thinkingLevel: command.thinkingLevel,
    responseMode: command.responseMode,
  });
  sendCommandResult(context, socket, command, true);
}

export async function handleRuntimeStop(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"runtime.stop">): Promise<void> {
  const runtime = context.supervisor.stopRuntime(command.runtimeId);
  sendCommandResult(context, socket, command, true, { runtime });
}

export async function handleRuntimeArchive(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"runtime.archive">): Promise<void> {
  const runtime = context.supervisor.archiveRuntime(command.runtimeId);
  sendCommandResult(context, socket, command, true, { runtime });
}

export async function handleRuntimeArchiveBlank(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"runtime.archiveBlank">): Promise<void> {
  // Guarded cleanup for unused new conversations. archiveBlankRuntime returns
  // the unchanged runtime when content, a session link, busy state, or status
  // makes cleanup unsafe.
  const runtime = context.supervisor.archiveBlankRuntime(command.runtimeId);
  sendCommandResult(context, socket, command, true, { runtime });
}

export async function handleRuntimePrompt(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"runtime.prompt">): Promise<void> {
  await context.supervisor.prompt(command.runtimeId, command.message, command.streamingBehavior, command.displayMessage);
  sendCommandResult(context, socket, command, true);
}

export async function handleRuntimeQueueDequeue(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"runtime.queue.dequeue">): Promise<void> {
  const queue = await context.supervisor.dequeueQueue(command.runtimeId);
  sendCommandResult(context, socket, command, true, { queue });
}

export async function handleRuntimeQueueReorder(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"runtime.queue.reorder">): Promise<void> {
  await context.supervisor.reorderQueue(command.runtimeId, command.queue);
  sendCommandResult(context, socket, command, true, { queue: command.queue });
}

export async function handleRuntimeRpc(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"runtime.rpc">): Promise<void> {
  context.supervisor.executeRpcCommand(command.runtimeId, command.command, command.label, command.displayMessage);
  sendCommandResult(context, socket, command, true);
}

export async function handleRuntimeCommandsList(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"runtime.commands.list">): Promise<void> {
  const commands = context.supervisor.requestSlashCommands(command.runtimeId);
  sendCommandResult(context, socket, command, true, { commands: commands ?? [] });
}

export async function handleRuntimeLogs(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"runtime.logs">): Promise<void> {
  const runtime = context.supervisor.getRuntime(command.runtimeId);
  if (!runtime) throw new Error(`Runtime not found: ${command.runtimeId}`);
  const limit = boundedRuntimeLogLimit(command.limit);
  const filters = {
    runtimeId: runtime.id,
    kinds: command.kinds && command.kinds.length > 0 ? command.kinds : DEFAULT_RUNTIME_LOG_KINDS,
  };
  const queriedEvents = command.afterEventId === undefined
    ? context.db.listRecentEvents(limit + 1, filters)
    : context.db.listEvents(command.afterEventId, limit + 1, filters);
  const hasMore = queriedEvents.length > limit;
  const events = hasMore && command.afterEventId === undefined ? queriedEvents.slice(queriedEvents.length - limit) : queriedEvents.slice(0, limit);
  context.send(socket, {
    type: "runtime.logs",
    runtimeId: runtime.id,
    projectId: runtime.projectId,
    events,
    hasMore,
  });
  sendCommandResult(context, socket, command, true, { count: events.length, hasMore });
}

export async function handleExtensionUiRespond(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"extension.ui.respond">): Promise<void> {
  context.supervisor.respondExtensionUi(command.runtimeId, command.responseId, command.response);
  sendCommandResult(context, socket, command, true);
}

export async function handleRuntimeAbort(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"runtime.abort">): Promise<void> {
  context.supervisor.abort(command.runtimeId);
  sendCommandResult(context, socket, command, true);
}

function boundedRuntimeLogLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? 200, 500));
}

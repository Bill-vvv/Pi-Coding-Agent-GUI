import type { ClientCommand } from "@pi-gui/shared";
import type { WsClient } from "../wsHub.js";
import { sendCommandResult, type CommandHandlerContext } from "./types.js";

type CommandOf<TType extends ClientCommand["type"]> = Extract<ClientCommand, { type: TType }>;

export async function handleConversationOpen(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"conversation.open">): Promise<void> {
  const snapshot = context.supervisor.conversationSnapshot(command.runtimeId, command.limit);
  if (!snapshot) throw new Error(`Runtime not found: ${command.runtimeId}`);
  context.send(socket, snapshot);
  context.send(socket, { type: "subagent.snapshot", runs: context.supervisor.listSubagentRuns(command.runtimeId, 500) });
  sendCommandResult(context, socket, command, true, { count: snapshot.type === "conversation.snapshot" ? snapshot.messages.length : 0 });
}

export async function handleConversationPage(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"conversation.page">): Promise<void> {
  const page = context.supervisor.conversationPageBefore(command.runtimeId, command.beforeMessageId, command.limit);
  if (!page) throw new Error(`Runtime not found: ${command.runtimeId}`);
  context.send(socket, page);
  sendCommandResult(context, socket, command, true, { count: page.type === "conversation.page" ? page.messages.length : 0 });
}

export async function handleSubagentDetailOpen(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"subagent.detail.open">): Promise<void> {
  const detail = context.supervisor.subagentDetail(command.runId, command.childRunId, command.limit);
  context.send(socket, detail);
  sendCommandResult(context, socket, command, true, { count: detail.messages.length });
}

export async function handleEventReplay(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"event.replay">): Promise<void> {
  const events = context.db.listEvents(command.afterEventId ?? 0, command.limit ?? 500, { projectId: command.projectId, runtimeId: command.runtimeId });
  for (const event of events) context.send(socket, { type: "gui.event", event });
  sendCommandResult(context, socket, command, true, { count: events.length });
}

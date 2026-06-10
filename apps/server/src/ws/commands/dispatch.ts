import type { ClientCommand } from "@pi-gui/shared";
import type { WsClient } from "../wsHub.js";
import { handleConversationOpen, handleConversationPage, handleEventReplay, handleSubagentDetailOpen } from "./conversationCommands.js";
import { handleProjectConfigure, handleProjectCreate, handleProjectList, handleSessionList, handleSessionResume, handleSettingsGet, handleSettingsUpdate } from "./projectSessionSettingsCommands.js";
import {
  handleExtensionUiRespond,
  handleRuntimeAbort,
  handleRuntimeArchive,
  handleRuntimeArchiveBlank,
  handleRuntimeCommandsList,
  handleRuntimeConfigure,
  handleRuntimeLogs,
  handleRuntimePrompt,
  handleRuntimeQueueDequeue,
  handleRuntimeQueueReorder,
  handleRuntimeRestart,
  handleRuntimeResume,
  handleRuntimeRpc,
  handleRuntimeStart,
  handleRuntimeStop,
} from "./runtimeCommands.js";
import type { CommandHandlerContext } from "./types.js";

export async function dispatchClientCommand(context: CommandHandlerContext, socket: WsClient, command: ClientCommand): Promise<void> {
  switch (command.type) {
    case "project.list":
      await handleProjectList(context, socket, command);
      break;
    case "project.create":
      await handleProjectCreate(context, socket, command);
      break;
    case "project.configure":
      await handleProjectConfigure(context, socket, command);
      break;
    case "session.list":
      await handleSessionList(context, socket, command);
      break;
    case "session.resume":
      await handleSessionResume(context, socket, command);
      break;
    case "settings.get":
      await handleSettingsGet(context, socket, command);
      break;
    case "settings.update":
      await handleSettingsUpdate(context, socket, command);
      break;
    case "runtime.start":
      await handleRuntimeStart(context, socket, command);
      break;
    case "runtime.resume":
      await handleRuntimeResume(context, socket, command);
      break;
    case "runtime.restart":
      await handleRuntimeRestart(context, socket, command);
      break;
    case "runtime.configure":
      await handleRuntimeConfigure(context, socket, command);
      break;
    case "runtime.stop":
      await handleRuntimeStop(context, socket, command);
      break;
    case "runtime.archive":
      await handleRuntimeArchive(context, socket, command);
      break;
    case "runtime.archiveBlank":
      await handleRuntimeArchiveBlank(context, socket, command);
      break;
    case "runtime.prompt":
      await handleRuntimePrompt(context, socket, command);
      break;
    case "runtime.queue.dequeue":
      await handleRuntimeQueueDequeue(context, socket, command);
      break;
    case "runtime.queue.reorder":
      await handleRuntimeQueueReorder(context, socket, command);
      break;
    case "runtime.rpc":
      await handleRuntimeRpc(context, socket, command);
      break;
    case "runtime.commands.list":
      await handleRuntimeCommandsList(context, socket, command);
      break;
    case "runtime.logs":
      await handleRuntimeLogs(context, socket, command);
      break;
    case "extension.ui.respond":
      await handleExtensionUiRespond(context, socket, command);
      break;
    case "runtime.abort":
      await handleRuntimeAbort(context, socket, command);
      break;
    case "conversation.open":
      await handleConversationOpen(context, socket, command);
      break;
    case "conversation.page":
      await handleConversationPage(context, socket, command);
      break;
    case "subagent.detail.open":
      await handleSubagentDetailOpen(context, socket, command);
      break;
    case "event.replay":
      await handleEventReplay(context, socket, command);
      break;
    default:
      assertNever(command);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled client command: ${JSON.stringify(value)}`);
}

import type { ClientCommand } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import {
  parseCheckpointCapture,
  parseCheckpointGc,
  parseCheckpointHealth,
  parseCheckpointJumps,
  parseCheckpointList,
  parseCheckpointPreview,
  parseCheckpointRestore,
  parseConversationOpen,
  parseConversationPage,
  parseEventReplay,
  parseExtensionUiRespond,
  parseProjectConfigure,
  parseProjectCreate,
  parseProjectList,
  parseRuntimeAbort,
  parseRuntimeArchive,
  parseRuntimeArchiveBlank,
  parseRuntimeCommandsList,
  parseRuntimeConfigure,
  parseRuntimeLogs,
  parseRuntimePrompt,
  parseRuntimeQueueDequeue,
  parseRuntimeQueueReorder,
  parseRuntimeRestart,
  parseRuntimeResume,
  parseRuntimeRpc,
  parseRuntimeStart,
  parseRuntimeStop,
  parseSessionList,
  parseSessionResume,
  parseSettingsGet,
  parseSettingsUpdate,
  parseSubagentDetailOpen,
} from "./clientCommands/index.js";

export function parseClientCommand(value: unknown): ClientCommand {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Invalid command: missing type");
  }

  switch (value.type) {
    case "project.list":
      return parseProjectList(value);
    case "project.create":
      return parseProjectCreate(value);
    case "project.configure":
      return parseProjectConfigure(value);
    case "session.list":
      return parseSessionList(value);
    case "session.resume":
      return parseSessionResume(value);
    case "settings.get":
      return parseSettingsGet(value);
    case "settings.update":
      return parseSettingsUpdate(value);
    case "runtime.start":
      return parseRuntimeStart(value);
    case "runtime.resume":
      return parseRuntimeResume(value);
    case "runtime.restart":
      return parseRuntimeRestart(value);
    case "runtime.configure":
      return parseRuntimeConfigure(value);
    case "runtime.stop":
      return parseRuntimeStop(value);
    case "runtime.archive":
      return parseRuntimeArchive(value);
    case "runtime.archiveBlank":
      return parseRuntimeArchiveBlank(value);
    case "runtime.prompt":
      return parseRuntimePrompt(value);
    case "runtime.queue.dequeue":
      return parseRuntimeQueueDequeue(value);
    case "runtime.queue.reorder":
      return parseRuntimeQueueReorder(value);
    case "runtime.rpc":
      return parseRuntimeRpc(value);
    case "runtime.abort":
      return parseRuntimeAbort(value);
    case "runtime.commands.list":
      return parseRuntimeCommandsList(value);
    case "runtime.logs":
      return parseRuntimeLogs(value);
    case "extension.ui.respond":
      return parseExtensionUiRespond(value);
    case "conversation.open":
      return parseConversationOpen(value);
    case "conversation.page":
      return parseConversationPage(value);
    case "checkpoint.list":
      return parseCheckpointList(value);
    case "checkpoint.capture":
      return parseCheckpointCapture(value);
    case "checkpoint.preview":
      return parseCheckpointPreview(value);
    case "checkpoint.restore":
      return parseCheckpointRestore(value);
    case "checkpoint.jumps":
      return parseCheckpointJumps(value);
    case "checkpoint.health":
      return parseCheckpointHealth(value);
    case "checkpoint.gc":
      return parseCheckpointGc(value);
    case "subagent.detail.open":
      return parseSubagentDetailOpen(value);
    case "event.replay":
      return parseEventReplay(value);
    default:
      throw new Error(`Unknown command type: ${value.type}`);
  }
}

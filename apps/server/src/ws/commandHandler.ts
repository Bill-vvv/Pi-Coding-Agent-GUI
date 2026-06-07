import type { ClientCommand } from "@pi-gui/shared";
import { parseClientCommand } from "../protocol/parseClientCommand.js";
import { resolveProjectPath } from "../services/pathResolutionService.js";
import { dispatchClientCommand, sendCommandResult, type CommandHandlerDependencies } from "./commands/index.js";
import type { WsClient } from "./wsHub.js";

export type { CommandHandlerDependencies } from "./commands/index.js";

export function createSocketMessageHandler({ db, supervisor, send, broadcast, resolvePath = resolveProjectPath }: CommandHandlerDependencies) {
  const context = { db, supervisor, send, broadcast, resolvePath };

  return async function handleSocketMessage(socket: WsClient, data: Buffer | string): Promise<void> {
    const raw = typeof data === "string" ? data : data.toString("utf8");
    let command: ClientCommand;
    try {
      command = parseClientCommand(JSON.parse(raw));
    } catch (error) {
      send(socket, {
        type: "command.result",
        command: "unknown",
        success: false,
        error: (error as Error).message,
      });
      return;
    }

    try {
      await dispatchClientCommand(context, socket, command);
    } catch (error) {
      sendCommandResult(context, socket, command, false, undefined, (error as Error).message);
    }
  };
}

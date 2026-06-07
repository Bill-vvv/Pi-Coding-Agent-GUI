import type { ClientCommand, ServerEvent } from "@pi-gui/shared";
import type { AppDatabase } from "../../db.js";
import type { RuntimeSupervisor } from "../../runtime/runtimeSupervisor.js";
import { resolveProjectPath } from "../../services/pathResolutionService.js";
import type { WsClient } from "../wsHub.js";

export type CommandHandlerDependencies = {
  db: AppDatabase;
  supervisor: RuntimeSupervisor;
  send: (socket: WsClient, event: ServerEvent) => void;
  broadcast: (event: ServerEvent) => void;
  resolvePath?: typeof resolveProjectPath;
};

export type CommandHandlerContext = Omit<CommandHandlerDependencies, "resolvePath"> & {
  resolvePath: typeof resolveProjectPath;
};

export function sendCommandResult(
  { send }: Pick<CommandHandlerContext, "send">,
  socket: WsClient,
  command: ClientCommand,
  success: boolean,
  data?: unknown,
  error?: string,
): void {
  send(socket, {
    type: "command.result",
    requestId: command.requestId,
    command: command.type,
    success,
    data,
    error,
  });
}

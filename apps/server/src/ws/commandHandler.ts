import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { ClientCommand, ServerEvent } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { AppDatabase } from "../db.js";
import { parseClientCommand } from "../protocol/parseClientCommand.js";
import type { RuntimeSupervisor } from "../runtime/runtimeSupervisor.js";
import { indexKnownPiSessions } from "../services/sessionIndexService.js";
import type { WsClient } from "./wsHub.js";

type CommandHandlerDependencies = {
  db: AppDatabase;
  supervisor: RuntimeSupervisor;
  send: (socket: WsClient, event: ServerEvent) => void;
  broadcast: (event: ServerEvent) => void;
};

export function createSocketMessageHandler({ db, supervisor, send, broadcast }: CommandHandlerDependencies) {
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
      switch (command.type) {
        case "project.list": {
          const projects = db.listProjects();
          send(socket, { type: "project.list", projects });
          sendResult(send, socket, command, true, { projects });
          break;
        }
        case "project.create": {
          const cwd = resolve(command.cwd);
          const stat = statSync(cwd);
          if (!stat.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
          const project = db.createProject({
            id: randomUUID(),
            name: command.name?.trim() || basename(cwd) || cwd,
            cwd,
            defaultModel: command.defaultModel?.trim() || undefined,
            lastOpenedAt: Date.now(),
          });
          broadcast({ type: "project.created", project });
          broadcast({ type: "project.list", projects: db.listProjects() });
          sendResult(send, socket, command, true, { project });
          break;
        }
        case "session.list": {
          indexKnownPiSessions(db);
          const sessions = db.listSessions(command.projectId);
          send(socket, { type: "session.list", sessions, projectId: command.projectId });
          sendResult(send, socket, command, true, { sessions });
          break;
        }
        case "session.resume": {
          const runtime = supervisor.resumeSession(command.sessionId, { model: command.model, thinkingLevel: command.thinkingLevel, responseMode: command.responseMode });
          sendResult(send, socket, command, true, { runtime });
          break;
        }
        case "settings.get": {
          const settings = db.getSettings();
          send(socket, { type: "settings.updated", settings });
          sendResult(send, socket, command, true, { settings });
          break;
        }
        case "settings.update": {
          const settings = db.updateSettings(command.settings);
          broadcast({ type: "settings.updated", settings });
          sendResult(send, socket, command, true, { settings });
          break;
        }
        case "runtime.start": {
          const runtime = supervisor.startRuntime(command.projectId, { model: command.model, thinkingLevel: command.thinkingLevel, responseMode: command.responseMode });
          sendResult(send, socket, command, true, { runtime });
          break;
        }
        case "runtime.resume": {
          const runtime = supervisor.resumeRuntime(command.runtimeId, { model: command.model, thinkingLevel: command.thinkingLevel, responseMode: command.responseMode });
          sendResult(send, socket, command, true, { runtime });
          break;
        }
        case "runtime.restart": {
          const runtime = supervisor.restartRuntime(command.runtimeId, { model: command.model, thinkingLevel: command.thinkingLevel, responseMode: command.responseMode });
          sendResult(send, socket, command, true, { runtime });
          break;
        }
        case "runtime.configure": {
          supervisor.configureRuntime(command.runtimeId, {
            modelProvider: command.modelProvider,
            modelId: command.modelId,
            thinkingLevel: command.thinkingLevel,
            responseMode: command.responseMode,
          });
          sendResult(send, socket, command, true);
          break;
        }
        case "runtime.stop": {
          const runtime = supervisor.stopRuntime(command.runtimeId);
          sendResult(send, socket, command, true, { runtime });
          break;
        }
        case "runtime.archive": {
          const runtime = supervisor.archiveRuntime(command.runtimeId);
          sendResult(send, socket, command, true, { runtime });
          break;
        }
        case "runtime.prompt": {
          supervisor.prompt(command.runtimeId, command.message, command.streamingBehavior);
          sendResult(send, socket, command, true);
          break;
        }
        case "runtime.rpc": {
          supervisor.executeRpcCommand(command.runtimeId, command.command, command.label);
          sendResult(send, socket, command, true);
          break;
        }
        case "runtime.commands.list": {
          const commands = supervisor.requestSlashCommands(command.runtimeId);
          sendResult(send, socket, command, true, { commands: commands ?? [] });
          break;
        }
        case "extension.ui.respond": {
          supervisor.respondExtensionUi(command.runtimeId, command.responseId, command.response);
          sendResult(send, socket, command, true);
          break;
        }
        case "runtime.abort": {
          supervisor.abort(command.runtimeId);
          sendResult(send, socket, command, true);
          break;
        }
        case "conversation.open": {
          const snapshot = supervisor.conversationSnapshot(command.runtimeId, command.limit);
          if (!snapshot) throw new Error(`Runtime not found: ${command.runtimeId}`);
          send(socket, snapshot);
          send(socket, { type: "subagent.snapshot", runs: supervisor.listSubagentRuns(command.runtimeId, 500) });
          sendResult(send, socket, command, true, { count: snapshot.type === "conversation.snapshot" ? snapshot.messages.length : 0 });
          break;
        }
        case "subagent.detail.open": {
          const detail = supervisor.subagentDetail(command.runId, command.childRunId, command.limit);
          send(socket, detail);
          sendResult(send, socket, command, true, { count: detail.messages.length });
          break;
        }
        case "event.replay": {
          const events = db.listEvents(command.afterEventId ?? 0, command.limit ?? 500, { projectId: command.projectId, runtimeId: command.runtimeId });
          for (const event of events) send(socket, { type: "gui.event", event });
          sendResult(send, socket, command, true, { count: events.length });
          break;
        }
      }
    } catch (error) {
      sendResult(send, socket, command, false, undefined, (error as Error).message);
    }
  };
}

function sendResult(
  send: (socket: WsClient, event: ServerEvent) => void,
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

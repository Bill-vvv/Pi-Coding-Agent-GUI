import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { ClientCommand } from "@pi-gui/shared";
import { indexKnownPiSessions } from "../../services/sessionIndexService.js";
import type { WsClient } from "../wsHub.js";
import { sendCommandResult, type CommandHandlerContext } from "./types.js";

type CommandOf<TType extends ClientCommand["type"]> = Extract<ClientCommand, { type: TType }>;

export async function handleProjectList(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"project.list">): Promise<void> {
  const projects = context.db.listProjects();
  context.send(socket, { type: "project.list", projects });
  sendCommandResult(context, socket, command, true, { projects });
}

export async function handleProjectCreate(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"project.create">): Promise<void> {
  const resolved = await context.resolvePath(command.cwd);
  if (!resolved.exists || !resolved.isDirectory) throw new Error(resolved.error ?? `cwd is not a directory: ${resolved.cwd || command.cwd}`);
  const cwd = resolved.cwd;
  const project = context.db.createProject({
    id: randomUUID(),
    name: command.name?.trim() || basename(cwd) || cwd,
    cwd,
    defaultModel: command.defaultModel?.trim() || undefined,
    lastOpenedAt: Date.now(),
  });
  context.broadcast({ type: "project.created", project });
  context.broadcast({ type: "project.list", projects: context.db.listProjects() });
  sendCommandResult(context, socket, command, true, { project });
}

export async function handleSessionList(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"session.list">): Promise<void> {
  indexKnownPiSessions(context.db);
  const sessions = context.db.listSessions(command.projectId);
  context.send(socket, { type: "session.list", sessions, projectId: command.projectId });
  sendCommandResult(context, socket, command, true, { sessions });
}

export async function handleSessionResume(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"session.resume">): Promise<void> {
  const runtime = context.supervisor.resumeSession(command.sessionId, { model: command.model, thinkingLevel: command.thinkingLevel, responseMode: command.responseMode });
  sendCommandResult(context, socket, command, true, { runtime });
}

export async function handleSettingsGet(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"settings.get">): Promise<void> {
  const settings = context.db.getSettings();
  context.send(socket, { type: "settings.updated", settings });
  sendCommandResult(context, socket, command, true, { settings });
}

export async function handleSettingsUpdate(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"settings.update">): Promise<void> {
  const settings = context.db.updateSettings(command.settings);
  context.broadcast({ type: "settings.updated", settings });
  sendCommandResult(context, socket, command, true, { settings });
}

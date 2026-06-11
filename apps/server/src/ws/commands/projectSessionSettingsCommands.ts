import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { ClientCommand, ExecutionHostRef, GuiSession } from "@pi-gui/shared";
import { decorateProjectWithGitSummary, decorateProjectsWithGitSummary } from "../../services/projectGitSummary.js";
import { indexKnownPiSessions } from "../../services/sessionIndexService.js";
import type { WsClient } from "../wsHub.js";
import { sendCommandResult, type CommandHandlerContext } from "./types.js";

type CommandOf<TType extends ClientCommand["type"]> = Extract<ClientCommand, { type: TType }>;

export async function handleProjectList(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"project.list">): Promise<void> {
  const projects = decorateProjectsWithGitSummary(context.db.listProjects());
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
    defaultRuntimeProfileId: command.defaultRuntimeProfileId,
    lastOpenedAt: Date.now(),
  });
  const decoratedProject = decorateProjectWithGitSummary(project);
  context.broadcast({ type: "project.created", project: decoratedProject });
  context.broadcast({ type: "project.list", projects: decorateProjectsWithGitSummary(context.db.listProjects()) });
  sendCommandResult(context, socket, command, true, { project: decoratedProject });
}

export async function handleProjectConfigure(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"project.configure">): Promise<void> {
  const project = context.db.updateProjectRuntimeProfile(command.projectId, command.defaultRuntimeProfileId ?? null);
  if (!project) throw new Error(`Project not found: ${command.projectId}`);
  const decoratedProject = decorateProjectWithGitSummary(project);
  context.broadcast({ type: "project.list", projects: decorateProjectsWithGitSummary(context.db.listProjects()) });
  sendCommandResult(context, socket, command, true, { project: decoratedProject });
}

export async function handleSessionList(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"session.list">): Promise<void> {
  indexKnownPiSessions(context.db);
  const page = context.db.listSessionsPage(command.projectId, command.limit, command.cursor);
  context.send(socket, {
    type: "session.list",
    sessions: page.sessions,
    projectId: command.projectId,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    cursor: command.cursor,
  });
  sendCommandResult(context, socket, command, true, { sessions: page.sessions, hasMore: page.hasMore, nextCursor: page.nextCursor });
}

export async function handleSessionResume(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"session.resume">): Promise<void> {
  const session = context.db.getSession(command.sessionId);
  assertSessionBelongsToCurrentHost(session, context.db.getExecutionHost());
  const runtime = context.supervisor.resumeSession(command.sessionId, { model: command.model, thinkingLevel: command.thinkingLevel, responseMode: command.responseMode, runtimeProfileId: command.runtimeProfileId });
  sendCommandResult(context, socket, command, true, { runtime });
}

function assertSessionBelongsToCurrentHost(session: GuiSession | undefined, currentHost: ExecutionHostRef | undefined): void {
  if (!session?.host || !currentHost || sameExecutionHost(session.host, currentHost)) return;
  const sessionHost = session.host.label ?? session.host.id;
  const currentHostLabel = currentHost.label ?? currentHost.id;
  throw new Error(`This session belongs to ${sessionHost}. Switch to that host before resuming it from ${currentHostLabel}.`);
}

function sameExecutionHost(left: ExecutionHostRef, right: ExecutionHostRef): boolean {
  return left.kind === right.kind && left.id === right.id;
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

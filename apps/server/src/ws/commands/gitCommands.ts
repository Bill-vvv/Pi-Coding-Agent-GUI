import type { ClientCommand, Project } from "@pi-gui/shared";
import { createGitBranch, deleteMergedGitBranch, readGitStatus, switchGitBranch } from "../../services/gitService.js";
import { decorateProjectsWithGitSummary } from "../../services/projectGitSummary.js";
import type { WsClient } from "../wsHub.js";
import { sendCommandResult, type CommandHandlerContext } from "./types.js";

type CommandOf<TType extends ClientCommand["type"]> = Extract<ClientCommand, { type: TType }>;

export async function handleGitStatus(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"git.status">): Promise<void> {
  const project = requireProject(context, command.projectId);
  const status = readGitStatus(project);
  context.send(socket, { type: "git.status", status });
  sendCommandResult(context, socket, command, true, { status });
}

export async function handleGitBranchCreate(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"git.branch.create">): Promise<void> {
  const project = requireProject(context, command.projectId);
  const status = createGitBranch(project, command.name);
  context.send(socket, { type: "git.status", status });
  context.broadcast({ type: "project.list", projects: decorateProjectsWithGitSummary(context.db.listProjects()) });
  sendCommandResult(context, socket, command, true, { status });
}

export async function handleGitBranchSwitch(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"git.branch.switch">): Promise<void> {
  const project = requireProject(context, command.projectId);
  const status = switchGitBranch(project, command.branch);
  context.send(socket, { type: "git.status", status });
  context.broadcast({ type: "project.list", projects: decorateProjectsWithGitSummary(context.db.listProjects()) });
  sendCommandResult(context, socket, command, true, { status });
}

export async function handleGitBranchDelete(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"git.branch.delete">): Promise<void> {
  const project = requireProject(context, command.projectId);
  const status = deleteMergedGitBranch(project, command.branch);
  context.send(socket, { type: "git.status", status });
  context.broadcast({ type: "project.list", projects: decorateProjectsWithGitSummary(context.db.listProjects()) });
  sendCommandResult(context, socket, command, true, { status });
}

function requireProject(context: CommandHandlerContext, projectId: string): Project {
  const project = context.db.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  return project;
}

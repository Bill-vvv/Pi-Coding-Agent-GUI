import type { ClientCommand } from "@pi-gui/shared";
import type { CommandRecord } from "./types.js";
import { stringOrUndefined } from "./validators.js";

type CommandOf<TType extends ClientCommand["type"]> = Extract<ClientCommand, { type: TType }>;

export function parseGitStatus(value: CommandRecord): CommandOf<"git.status"> {
  if (typeof value.projectId !== "string") throw new Error("git.status requires projectId");
  return { type: "git.status", requestId: stringOrUndefined(value.requestId), projectId: value.projectId };
}

export function parseGitBranchCreate(value: CommandRecord): CommandOf<"git.branch.create"> {
  if (typeof value.projectId !== "string") throw new Error("git.branch.create requires projectId");
  if (typeof value.name !== "string") throw new Error("git.branch.create requires name");
  return { type: "git.branch.create", requestId: stringOrUndefined(value.requestId), projectId: value.projectId, name: value.name };
}

export function parseGitBranchSwitch(value: CommandRecord): CommandOf<"git.branch.switch"> {
  if (typeof value.projectId !== "string") throw new Error("git.branch.switch requires projectId");
  if (typeof value.branch !== "string") throw new Error("git.branch.switch requires branch");
  return { type: "git.branch.switch", requestId: stringOrUndefined(value.requestId), projectId: value.projectId, branch: value.branch };
}

export function parseGitBranchDelete(value: CommandRecord): CommandOf<"git.branch.delete"> {
  if (typeof value.projectId !== "string") throw new Error("git.branch.delete requires projectId");
  if (typeof value.branch !== "string") throw new Error("git.branch.delete requires branch");
  return { type: "git.branch.delete", requestId: stringOrUndefined(value.requestId), projectId: value.projectId, branch: value.branch };
}

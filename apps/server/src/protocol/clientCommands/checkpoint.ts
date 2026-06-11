import type { ClientCommand } from "@pi-gui/shared";
import type { CommandRecord } from "./types.js";
import { stringOrUndefined } from "./validators.js";

type CommandOf<TType extends ClientCommand["type"]> = Extract<ClientCommand, { type: TType }>;

export function parseCheckpointList(value: CommandRecord): CommandOf<"checkpoint.list"> {
  return { type: "checkpoint.list", requestId: stringOrUndefined(value.requestId), projectId: requiredString(value.projectId, "checkpoint.list requires projectId") };
}

export function parseCheckpointCapture(value: CommandRecord): CommandOf<"checkpoint.capture"> {
  return { type: "checkpoint.capture", requestId: stringOrUndefined(value.requestId), projectId: requiredString(value.projectId, "checkpoint.capture requires projectId") };
}

export function parseCheckpointPreview(value: CommandRecord): CommandOf<"checkpoint.preview"> {
  return {
    type: "checkpoint.preview",
    requestId: stringOrUndefined(value.requestId),
    projectId: requiredString(value.projectId, "checkpoint.preview requires projectId"),
    snapshotId: requiredString(value.snapshotId, "checkpoint.preview requires snapshotId"),
  };
}

export function parseCheckpointRestore(value: CommandRecord): CommandOf<"checkpoint.restore"> {
  const runtimeId = optionalNonEmptyString(value.runtimeId, "checkpoint.restore runtimeId must be a non-empty string");
  const entryId = optionalNonEmptyString(value.entryId, "checkpoint.restore entryId must be a non-empty string");
  if (!runtimeId && entryId) throw new Error("checkpoint.restore requires runtimeId when entryId is provided");
  return {
    type: "checkpoint.restore",
    requestId: stringOrUndefined(value.requestId),
    projectId: requiredString(value.projectId, "checkpoint.restore requires projectId"),
    snapshotId: requiredString(value.snapshotId, "checkpoint.restore requires snapshotId"),
    runtimeId,
    entryId,
  };
}

export function parseCheckpointJumps(value: CommandRecord): CommandOf<"checkpoint.jumps"> {
  return { type: "checkpoint.jumps", requestId: stringOrUndefined(value.requestId), projectId: requiredString(value.projectId, "checkpoint.jumps requires projectId"), limit: optionalPositiveInteger(value.limit, "checkpoint.jumps limit must be a positive integer") };
}

export function parseCheckpointHealth(value: CommandRecord): CommandOf<"checkpoint.health"> {
  return { type: "checkpoint.health", requestId: stringOrUndefined(value.requestId), projectId: requiredString(value.projectId, "checkpoint.health requires projectId") };
}

export function parseCheckpointGc(value: CommandRecord): CommandOf<"checkpoint.gc"> {
  return {
    type: "checkpoint.gc",
    requestId: stringOrUndefined(value.requestId),
    projectId: requiredString(value.projectId, "checkpoint.gc requires projectId"),
    dryRun: typeof value.dryRun === "boolean" ? value.dryRun : undefined,
    keepRecent: optionalPositiveInteger(value.keepRecent, "checkpoint.gc keepRecent must be a positive integer"),
  };
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(message);
  return value;
}

function optionalNonEmptyString(value: unknown, message: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new Error(message);
  return value;
}

function optionalPositiveInteger(value: unknown, message: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(message);
  return value;
}

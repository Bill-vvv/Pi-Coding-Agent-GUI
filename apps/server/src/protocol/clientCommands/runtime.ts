import type { ClientCommand } from "@pi-gui/shared";
import type { CommandRecord } from "./types.js";
import {
  guiEventKindsOrUndefined,
  isRecord,
  nonNegativeNumberOrUndefined,
  positiveNumberOrUndefined,
  responseModeOrUndefined,
  stringOrUndefined,
  thinkingLevelOrUndefined,
} from "./validators.js";

type CommandOf<TType extends ClientCommand["type"]> = Extract<ClientCommand, { type: TType }>;

export function parseRuntimeStart(value: CommandRecord): CommandOf<"runtime.start"> {
  if (typeof value.projectId !== "string") throw new Error("runtime.start requires projectId");
  return {
    type: "runtime.start",
    requestId: stringOrUndefined(value.requestId),
    projectId: value.projectId,
    model: stringOrUndefined(value.model),
    thinkingLevel: thinkingLevelOrUndefined(value.thinkingLevel),
    responseMode: responseModeOrUndefined(value.responseMode),
  };
}

export function parseRuntimeResume(value: CommandRecord): CommandOf<"runtime.resume"> {
  if (typeof value.runtimeId !== "string") throw new Error("runtime.resume requires runtimeId");
  return {
    type: "runtime.resume",
    requestId: stringOrUndefined(value.requestId),
    runtimeId: value.runtimeId,
    model: stringOrUndefined(value.model),
    thinkingLevel: thinkingLevelOrUndefined(value.thinkingLevel),
    responseMode: responseModeOrUndefined(value.responseMode),
  };
}

export function parseRuntimeRestart(value: CommandRecord): CommandOf<"runtime.restart"> {
  if (typeof value.runtimeId !== "string") throw new Error("runtime.restart requires runtimeId");
  return {
    type: "runtime.restart",
    requestId: stringOrUndefined(value.requestId),
    runtimeId: value.runtimeId,
    model: stringOrUndefined(value.model),
    thinkingLevel: thinkingLevelOrUndefined(value.thinkingLevel),
    responseMode: responseModeOrUndefined(value.responseMode),
  };
}

export function parseRuntimeConfigure(value: CommandRecord): CommandOf<"runtime.configure"> {
  if (typeof value.runtimeId !== "string") throw new Error("runtime.configure requires runtimeId");
  return {
    type: "runtime.configure",
    requestId: stringOrUndefined(value.requestId),
    runtimeId: value.runtimeId,
    modelProvider: stringOrUndefined(value.modelProvider),
    modelId: stringOrUndefined(value.modelId),
    thinkingLevel: thinkingLevelOrUndefined(value.thinkingLevel),
    responseMode: responseModeOrUndefined(value.responseMode),
  };
}

export function parseRuntimeStop(value: CommandRecord): CommandOf<"runtime.stop"> {
  if (typeof value.runtimeId !== "string") throw new Error("runtime.stop requires runtimeId");
  return { type: "runtime.stop", requestId: stringOrUndefined(value.requestId), runtimeId: value.runtimeId };
}

export function parseRuntimeArchive(value: CommandRecord): CommandOf<"runtime.archive"> {
  if (typeof value.runtimeId !== "string") throw new Error("runtime.archive requires runtimeId");
  return { type: "runtime.archive", requestId: stringOrUndefined(value.requestId), runtimeId: value.runtimeId };
}

export function parseRuntimeArchiveBlank(value: CommandRecord): CommandOf<"runtime.archiveBlank"> {
  // Safe cleanup command: the supervisor decides whether the runtime is still
  // an unused new conversation and returns the unchanged runtime when denied.
  if (typeof value.runtimeId !== "string") throw new Error("runtime.archiveBlank requires runtimeId");
  return { type: "runtime.archiveBlank", requestId: stringOrUndefined(value.requestId), runtimeId: value.runtimeId };
}

export function parseRuntimePrompt(value: CommandRecord): CommandOf<"runtime.prompt"> {
  if (typeof value.runtimeId !== "string") throw new Error("runtime.prompt requires runtimeId");
  if (typeof value.message !== "string") throw new Error("runtime.prompt requires message");
  if (value.streamingBehavior !== undefined && value.streamingBehavior !== "steer" && value.streamingBehavior !== "followUp") {
    throw new Error("runtime.prompt streamingBehavior must be steer or followUp");
  }
  return {
    type: "runtime.prompt",
    requestId: stringOrUndefined(value.requestId),
    runtimeId: value.runtimeId,
    message: value.message,
    streamingBehavior: value.streamingBehavior,
    displayMessage: stringOrUndefined(value.displayMessage),
  };
}

export function parseRuntimeQueueDequeue(value: CommandRecord): CommandOf<"runtime.queue.dequeue"> {
  if (typeof value.runtimeId !== "string") throw new Error("runtime.queue.dequeue requires runtimeId");
  return { type: "runtime.queue.dequeue", requestId: stringOrUndefined(value.requestId), runtimeId: value.runtimeId };
}

export function parseRuntimeQueueReorder(value: CommandRecord): CommandOf<"runtime.queue.reorder"> {
  if (typeof value.runtimeId !== "string") throw new Error("runtime.queue.reorder requires runtimeId");
  if (!isRecord(value.queue)) throw new Error("runtime.queue.reorder requires queue");
  return {
    type: "runtime.queue.reorder",
    requestId: stringOrUndefined(value.requestId),
    runtimeId: value.runtimeId,
    queue: {
      steering: stringArray(value.queue.steering, "runtime.queue.reorder queue.steering"),
      followUp: stringArray(value.queue.followUp, "runtime.queue.reorder queue.followUp"),
    },
  };
}

export function parseRuntimeRpc(value: CommandRecord): CommandOf<"runtime.rpc"> {
  if (typeof value.runtimeId !== "string") throw new Error("runtime.rpc requires runtimeId");
  if (!isRecord(value.command) || typeof value.command.type !== "string") throw new Error("runtime.rpc requires command.type");
  return {
    type: "runtime.rpc",
    requestId: stringOrUndefined(value.requestId),
    runtimeId: value.runtimeId,
    command: { ...value.command, type: value.command.type },
    label: stringOrUndefined(value.label),
    displayMessage: stringOrUndefined(value.displayMessage),
  };
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((item) => {
    if (typeof item !== "string") throw new Error(`${field} must contain only strings`);
    return item;
  });
}

export function parseRuntimeAbort(value: CommandRecord): CommandOf<"runtime.abort"> {
  if (typeof value.runtimeId !== "string") throw new Error("runtime.abort requires runtimeId");
  return { type: "runtime.abort", requestId: stringOrUndefined(value.requestId), runtimeId: value.runtimeId };
}

export function parseRuntimeCommandsList(value: CommandRecord): CommandOf<"runtime.commands.list"> {
  if (typeof value.runtimeId !== "string") throw new Error("runtime.commands.list requires runtimeId");
  return { type: "runtime.commands.list", requestId: stringOrUndefined(value.requestId), runtimeId: value.runtimeId };
}

export function parseRuntimeLogs(value: CommandRecord): CommandOf<"runtime.logs"> {
  if (typeof value.runtimeId !== "string") throw new Error("runtime.logs requires runtimeId");
  return {
    type: "runtime.logs",
    requestId: stringOrUndefined(value.requestId),
    runtimeId: value.runtimeId,
    afterEventId: nonNegativeNumberOrUndefined(value.afterEventId, "runtime.logs afterEventId"),
    limit: positiveNumberOrUndefined(value.limit, "runtime.logs limit"),
    kinds: guiEventKindsOrUndefined(value.kinds),
  };
}

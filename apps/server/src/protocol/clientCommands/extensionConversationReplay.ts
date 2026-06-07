import type { ClientCommand } from "@pi-gui/shared";
import type { CommandRecord } from "./types.js";
import { isRecord, numberOrUndefined, stringOrUndefined } from "./validators.js";

type CommandOf<TType extends ClientCommand["type"]> = Extract<ClientCommand, { type: TType }>;

export function parseExtensionUiRespond(value: CommandRecord): CommandOf<"extension.ui.respond"> {
  if (typeof value.runtimeId !== "string") throw new Error("extension.ui.respond requires runtimeId");
  if (typeof value.responseId !== "string") throw new Error("extension.ui.respond requires responseId");
  if (!isRecord(value.response)) throw new Error("extension.ui.respond requires response");
  if (!("cancelled" in value.response) && !("value" in value.response) && !("confirmed" in value.response)) {
    throw new Error("extension.ui.respond response must contain cancelled, value, or confirmed");
  }
  return {
    type: "extension.ui.respond",
    requestId: stringOrUndefined(value.requestId),
    runtimeId: value.runtimeId,
    responseId: value.responseId,
    response: parseExtensionUiResponse(value.response),
  };
}

export function parseConversationOpen(value: CommandRecord): CommandOf<"conversation.open"> {
  if (typeof value.runtimeId !== "string") throw new Error("conversation.open requires runtimeId");
  return {
    type: "conversation.open",
    requestId: stringOrUndefined(value.requestId),
    runtimeId: value.runtimeId,
    limit: numberOrUndefined(value.limit),
  };
}

export function parseConversationPage(value: CommandRecord): CommandOf<"conversation.page"> {
  if (typeof value.runtimeId !== "string") throw new Error("conversation.page requires runtimeId");
  if (typeof value.beforeMessageId !== "string") throw new Error("conversation.page requires beforeMessageId");
  return {
    type: "conversation.page",
    requestId: stringOrUndefined(value.requestId),
    runtimeId: value.runtimeId,
    beforeMessageId: value.beforeMessageId,
    limit: numberOrUndefined(value.limit),
  };
}

export function parseSubagentDetailOpen(value: CommandRecord): CommandOf<"subagent.detail.open"> {
  if (typeof value.runId !== "string") throw new Error("subagent.detail.open requires runId");
  if (value.childRunId !== undefined && typeof value.childRunId !== "string") throw new Error("subagent.detail.open childRunId must be a string");
  return {
    type: "subagent.detail.open",
    requestId: stringOrUndefined(value.requestId),
    runId: value.runId,
    childRunId: stringOrUndefined(value.childRunId),
    limit: numberOrUndefined(value.limit),
  };
}

export function parseEventReplay(value: CommandRecord): CommandOf<"event.replay"> {
  if (value.projectId !== undefined && typeof value.projectId !== "string") throw new Error("event.replay projectId must be a string");
  if (value.runtimeId !== undefined && typeof value.runtimeId !== "string") throw new Error("event.replay runtimeId must be a string");
  return {
    type: "event.replay",
    requestId: stringOrUndefined(value.requestId),
    afterEventId: numberOrUndefined(value.afterEventId),
    limit: numberOrUndefined(value.limit),
    projectId: stringOrUndefined(value.projectId),
    runtimeId: stringOrUndefined(value.runtimeId),
  };
}

function parseExtensionUiResponse(value: Record<string, unknown>) {
  if (value.cancelled === true) return { cancelled: true as const };
  if (typeof value.value === "string") return { value: value.value };
  if (typeof value.confirmed === "boolean") return { confirmed: value.confirmed };
  throw new Error("extension.ui.respond response payload is invalid");
}

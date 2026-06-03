import type { ClientCommand, ThinkingLevel } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";

export function parseClientCommand(value: unknown): ClientCommand {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Invalid command: missing type");
  }

  switch (value.type) {
    case "project.list":
      return { type: "project.list", requestId: stringOrUndefined(value.requestId) };
    case "project.create":
      if (value.name !== undefined && typeof value.name !== "string") throw new Error("project.create name must be a string");
      if (typeof value.cwd !== "string") throw new Error("project.create requires cwd");
      return {
        type: "project.create",
        requestId: stringOrUndefined(value.requestId),
        name: stringOrUndefined(value.name),
        cwd: value.cwd,
        defaultModel: stringOrUndefined(value.defaultModel),
      };
    case "session.list":
      if (value.projectId !== undefined && typeof value.projectId !== "string") throw new Error("session.list projectId must be a string");
      return { type: "session.list", requestId: stringOrUndefined(value.requestId), projectId: stringOrUndefined(value.projectId) };
    case "settings.get":
      return { type: "settings.get", requestId: stringOrUndefined(value.requestId) };
    case "settings.update":
      if (!isRecord(value.settings)) throw new Error("settings.update requires settings");
      return {
        type: "settings.update",
        requestId: stringOrUndefined(value.requestId),
        settings: {
          defaultModel: stringOrUndefined(value.settings.defaultModel) ?? "",
          defaultThinkingLevel: thinkingLevelOrUndefined(value.settings.defaultThinkingLevel),
          responseMode: value.settings.responseMode === "fast" ? "fast" : value.settings.responseMode === "normal" ? "normal" : undefined,
        },
      };
    case "runtime.start":
      if (typeof value.projectId !== "string") throw new Error("runtime.start requires projectId");
      return {
        type: "runtime.start",
        requestId: stringOrUndefined(value.requestId),
        projectId: value.projectId,
        model: stringOrUndefined(value.model),
        thinkingLevel: thinkingLevelOrUndefined(value.thinkingLevel),
        responseMode: responseModeOrUndefined(value.responseMode),
      };
    case "runtime.resume":
      if (typeof value.runtimeId !== "string") throw new Error("runtime.resume requires runtimeId");
      return {
        type: "runtime.resume",
        requestId: stringOrUndefined(value.requestId),
        runtimeId: value.runtimeId,
        model: stringOrUndefined(value.model),
        thinkingLevel: thinkingLevelOrUndefined(value.thinkingLevel),
        responseMode: responseModeOrUndefined(value.responseMode),
      };
    case "runtime.configure":
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
    case "runtime.stop":
      if (typeof value.runtimeId !== "string") throw new Error("runtime.stop requires runtimeId");
      return { type: "runtime.stop", requestId: stringOrUndefined(value.requestId), runtimeId: value.runtimeId };
    case "runtime.archive":
      if (typeof value.runtimeId !== "string") throw new Error("runtime.archive requires runtimeId");
      return { type: "runtime.archive", requestId: stringOrUndefined(value.requestId), runtimeId: value.runtimeId };
    case "runtime.prompt":
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
      };
    case "runtime.abort":
      if (typeof value.runtimeId !== "string") throw new Error("runtime.abort requires runtimeId");
      return { type: "runtime.abort", requestId: stringOrUndefined(value.requestId), runtimeId: value.runtimeId };
    case "conversation.open":
      if (typeof value.runtimeId !== "string") throw new Error("conversation.open requires runtimeId");
      return {
        type: "conversation.open",
        requestId: stringOrUndefined(value.requestId),
        runtimeId: value.runtimeId,
        limit: numberOrUndefined(value.limit),
      };
    case "event.replay":
      return {
        type: "event.replay",
        requestId: stringOrUndefined(value.requestId),
        afterEventId: numberOrUndefined(value.afterEventId),
        limit: numberOrUndefined(value.limit),
      };
    default:
      throw new Error(`Unknown command type: ${value.type}`);
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function thinkingLevelOrUndefined(value: unknown): ThinkingLevel | undefined {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function responseModeOrUndefined(value: unknown): "normal" | "fast" | undefined {
  return value === "normal" || value === "fast" ? value : undefined;
}

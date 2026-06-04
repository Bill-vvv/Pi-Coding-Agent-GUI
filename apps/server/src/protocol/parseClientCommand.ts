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
    case "session.resume":
      if (typeof value.sessionId !== "string") throw new Error("session.resume requires sessionId");
      return {
        type: "session.resume",
        requestId: stringOrUndefined(value.requestId),
        sessionId: value.sessionId,
        model: stringOrUndefined(value.model),
        thinkingLevel: thinkingLevelOrUndefined(value.thinkingLevel),
        responseMode: responseModeOrUndefined(value.responseMode),
      };
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
    case "runtime.restart":
      if (typeof value.runtimeId !== "string") throw new Error("runtime.restart requires runtimeId");
      return {
        type: "runtime.restart",
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
    case "runtime.rpc":
      if (typeof value.runtimeId !== "string") throw new Error("runtime.rpc requires runtimeId");
      if (!isRecord(value.command) || typeof value.command.type !== "string") throw new Error("runtime.rpc requires command.type");
      return {
        type: "runtime.rpc",
        requestId: stringOrUndefined(value.requestId),
        runtimeId: value.runtimeId,
        command: { ...value.command, type: value.command.type },
        label: stringOrUndefined(value.label),
      };
    case "runtime.abort":
      if (typeof value.runtimeId !== "string") throw new Error("runtime.abort requires runtimeId");
      return { type: "runtime.abort", requestId: stringOrUndefined(value.requestId), runtimeId: value.runtimeId };
    case "runtime.commands.list":
      if (typeof value.runtimeId !== "string") throw new Error("runtime.commands.list requires runtimeId");
      return { type: "runtime.commands.list", requestId: stringOrUndefined(value.requestId), runtimeId: value.runtimeId };
    case "extension.ui.respond":
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
    case "conversation.open":
      if (typeof value.runtimeId !== "string") throw new Error("conversation.open requires runtimeId");
      return {
        type: "conversation.open",
        requestId: stringOrUndefined(value.requestId),
        runtimeId: value.runtimeId,
        limit: numberOrUndefined(value.limit),
      };
    case "subagent.detail.open":
      if (typeof value.runId !== "string") throw new Error("subagent.detail.open requires runId");
      if (value.childRunId !== undefined && typeof value.childRunId !== "string") throw new Error("subagent.detail.open childRunId must be a string");
      return {
        type: "subagent.detail.open",
        requestId: stringOrUndefined(value.requestId),
        runId: value.runId,
        childRunId: stringOrUndefined(value.childRunId),
        limit: numberOrUndefined(value.limit),
      };
    case "event.replay":
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
    default:
      throw new Error(`Unknown command type: ${value.type}`);
  }
}

function parseExtensionUiResponse(value: Record<string, unknown>) {
  if (value.cancelled === true) return { cancelled: true as const };
  if (typeof value.value === "string") return { value: value.value };
  if (typeof value.confirmed === "boolean") return { confirmed: value.confirmed };
  throw new Error("extension.ui.respond response payload is invalid");
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

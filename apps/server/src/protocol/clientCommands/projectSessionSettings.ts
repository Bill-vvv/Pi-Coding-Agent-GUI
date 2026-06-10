import type { ClientCommand } from "@pi-gui/shared";
import type { CommandRecord } from "./types.js";
import { isRecord, responseModeOrUndefined, runtimeProfileIdOrUndefined, stringArrayOrUndefined, stringOrUndefined, thinkingLevelOrUndefined } from "./validators.js";

type CommandOf<TType extends ClientCommand["type"]> = Extract<ClientCommand, { type: TType }>;

export function parseProjectList(value: CommandRecord): CommandOf<"project.list"> {
  return { type: "project.list", requestId: stringOrUndefined(value.requestId) };
}

export function parseProjectCreate(value: CommandRecord): CommandOf<"project.create"> {
  if (value.name !== undefined && typeof value.name !== "string") throw new Error("project.create name must be a string");
  if (typeof value.cwd !== "string") throw new Error("project.create requires cwd");
  return {
    type: "project.create",
    requestId: stringOrUndefined(value.requestId),
    name: stringOrUndefined(value.name),
    cwd: value.cwd,
    defaultModel: stringOrUndefined(value.defaultModel),
    defaultRuntimeProfileId: runtimeProfileIdOrUndefined(value.defaultRuntimeProfileId),
  };
}

export function parseProjectConfigure(value: CommandRecord): CommandOf<"project.configure"> {
  if (typeof value.projectId !== "string") throw new Error("project.configure requires projectId");
  return {
    type: "project.configure",
    requestId: stringOrUndefined(value.requestId),
    projectId: value.projectId,
    defaultRuntimeProfileId: value.defaultRuntimeProfileId === null ? null : runtimeProfileIdOrUndefined(value.defaultRuntimeProfileId),
  };
}

export function parseSessionList(value: CommandRecord): CommandOf<"session.list"> {
  if (value.projectId !== undefined && typeof value.projectId !== "string") throw new Error("session.list projectId must be a string");
  return { type: "session.list", requestId: stringOrUndefined(value.requestId), projectId: stringOrUndefined(value.projectId) };
}

export function parseSessionResume(value: CommandRecord): CommandOf<"session.resume"> {
  if (typeof value.sessionId !== "string") throw new Error("session.resume requires sessionId");
  return {
    type: "session.resume",
    requestId: stringOrUndefined(value.requestId),
    sessionId: value.sessionId,
    model: stringOrUndefined(value.model),
    thinkingLevel: thinkingLevelOrUndefined(value.thinkingLevel),
    responseMode: responseModeOrUndefined(value.responseMode),
    runtimeProfileId: runtimeProfileIdOrUndefined(value.runtimeProfileId),
  };
}

export function parseSettingsGet(value: CommandRecord): CommandOf<"settings.get"> {
  return { type: "settings.get", requestId: stringOrUndefined(value.requestId) };
}

export function parseSettingsUpdate(value: CommandRecord): CommandOf<"settings.update"> {
  if (!isRecord(value.settings)) throw new Error("settings.update requires settings");
  return {
    type: "settings.update",
    requestId: stringOrUndefined(value.requestId),
    settings: {
      defaultModel: stringOrUndefined(value.settings.defaultModel) ?? "",
      defaultThinkingLevel: thinkingLevelOrUndefined(value.settings.defaultThinkingLevel),
      responseMode: value.settings.responseMode === "fast" ? "fast" : value.settings.responseMode === "normal" ? "normal" : undefined,
      defaultRuntimeProfileId: runtimeProfileIdOrUndefined(value.settings.defaultRuntimeProfileId),
      confirmedProjectExtensionIds: stringArrayOrUndefined(value.settings.confirmedProjectExtensionIds, "settings.confirmedProjectExtensionIds"),
    },
  };
}

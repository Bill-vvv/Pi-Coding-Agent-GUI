import { isRecord, type RuntimeQueue, type SlashCommand, type ThinkingLevel } from "@pi-gui/shared";

export function runtimeQueueFromPiPayload(payload: Record<string, unknown>): RuntimeQueue {
  return {
    steering: stringArray(payload.steering),
    followUp: stringArray(payload.followUp),
  };
}

export function modelKeyFromPiResponseData(data: Record<string, unknown>): string | undefined {
  const model = isRecord(data.model) ? data.model : data;
  return typeof model.provider === "string" && typeof model.id === "string" ? `${model.provider}/${model.id}` : undefined;
}

export function thinkingLevelFromPiResponseData(data: Record<string, unknown>): ThinkingLevel | undefined {
  return parseThinkingLevel(data.thinkingLevel ?? data.level);
}

export function slashCommandsFromPiResponseData(data: Record<string, unknown>): SlashCommand[] {
  const commands = Array.isArray(data.commands) ? data.commands : [];
  return commands.flatMap((command): SlashCommand[] => {
    if (!isRecord(command) || typeof command.name !== "string") return [];
    const source = slashCommandSource(command.source);
    if (!source) return [];
    return [
      {
        name: command.name,
        description: typeof command.description === "string" ? command.description : undefined,
        source,
        location: typeof command.location === "string" ? command.location : undefined,
        path: typeof command.path === "string" ? command.path : undefined,
        sourceInfo: command.sourceInfo,
      },
    ];
  });
}

function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" ? value : undefined;
}

function slashCommandSource(value: unknown): SlashCommand["source"] | undefined {
  return value === "builtin" || value === "extension" || value === "prompt" || value === "skill" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

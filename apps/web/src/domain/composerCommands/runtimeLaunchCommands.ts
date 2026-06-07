import type { ClientCommand, ServerEvent } from "@pi-gui/shared";

export type RuntimePromptCommand = Extract<ClientCommand, { type: "runtime.prompt" }>;

export function buildChatRuntimePromptCommand({
  requestId,
  runtimeId,
  message,
  streamingBehavior,
}: {
  requestId?: string;
  runtimeId: string;
  message: string;
  streamingBehavior?: "steer" | "followUp";
}): RuntimePromptCommand {
  const command: RuntimePromptCommand = { type: "runtime.prompt", runtimeId, message };
  if (requestId) command.requestId = requestId;
  if (streamingBehavior) command.streamingBehavior = streamingBehavior;
  return command;
}

export function runningBusyStreamingBehavior(isRunning: boolean, isBusy: boolean): "steer" | undefined {
  return isRunning && isBusy ? "steer" : undefined;
}

export function isRuntimeLaunchCommand(command: Extract<ServerEvent, { type: "command.result" }>["command"]): boolean {
  return command === "runtime.start" || command === "runtime.resume" || command === "runtime.restart" || command === "session.resume";
}

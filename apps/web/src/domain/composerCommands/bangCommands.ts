import type { PiRpcCommand } from "@pi-gui/shared";

export type ParsedBangInput = {
  command: string;
  excludeFromContext: boolean;
};

export function parseBangInput(input: string): ParsedBangInput | undefined {
  const trimmedStart = input.trimStart();
  if (!trimmedStart.startsWith("!")) return undefined;
  const excludeFromContext = trimmedStart.startsWith("!!");
  const command = trimmedStart.slice(excludeFromContext ? 2 : 1).trim();
  return { command, excludeFromContext };
}

export function bangInputDisplayMessage(input: string): string {
  return input.trimStart().replace(/\s+$/g, "");
}

export function bangInputRpcCommand(parsed: ParsedBangInput): PiRpcCommand | undefined {
  if (!parsed.command) return undefined;
  return { type: "bash", command: parsed.command, excludeFromContext: parsed.excludeFromContext };
}

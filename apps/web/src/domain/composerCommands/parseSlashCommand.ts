export type ParsedSlashInput = {
  name: string;
  args: string;
};

export function parseSlashInput(input: string): ParsedSlashInput | undefined {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return undefined;
  const withoutSlash = trimmed.slice(1);
  const separatorIndex = withoutSlash.search(/\s/);
  return {
    name: separatorIndex === -1 ? withoutSlash : withoutSlash.slice(0, separatorIndex),
    args: separatorIndex === -1 ? "" : withoutSlash.slice(separatorIndex).trim(),
  };
}

export function slashDisplayMessage(input: string): string {
  return input.trim();
}

export function slashDisplayMessageForCommand(input: string, commandName: string): string | undefined {
  return isDisplayOnlySlashCommand(commandName) ? undefined : slashDisplayMessage(input);
}

function isDisplayOnlySlashCommand(commandName: string): boolean {
  return commandName === "goal" || commandName.startsWith("goal:");
}

export function slashCommandMessage(name: string, args: string): string {
  return `/${name}${args ? ` ${args}` : ""}`;
}

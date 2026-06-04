import type { SlashCommand } from "@pi-gui/shared";

export const GUI_BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  { name: "compact", description: "手动压缩当前会话上下文，可追加压缩说明", source: "builtin" },
  { name: "name", description: "设置当前会话名称：/name <名称>", source: "builtin" },
  { name: "session", description: "显示当前会话统计信息", source: "builtin" },
  { name: "export", description: "导出当前会话为 HTML，可追加输出路径", source: "builtin" },
];

export type ParsedGuiSlashCommand =
  | { kind: "builtin"; command: Record<string, unknown> }
  | { kind: "prompt" };

export function parseGuiSlashCommand(text: string, id: string): ParsedGuiSlashCommand {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return { kind: "prompt" };

  const withoutSlash = trimmed.slice(1);
  const separatorIndex = withoutSlash.search(/\s/);
  const name = separatorIndex === -1 ? withoutSlash : withoutSlash.slice(0, separatorIndex);
  const args = separatorIndex === -1 ? "" : withoutSlash.slice(separatorIndex).trim();

  switch (name) {
    case "compact":
      return {
        kind: "builtin",
        command: { id, type: "compact", ...(args ? { customInstructions: args } : {}) },
      };
    case "name":
      if (!args) throw new Error("/name requires a session name");
      return { kind: "builtin", command: { id, type: "set_session_name", name: args } };
    case "session":
      if (args) throw new Error("/session does not accept arguments");
      return { kind: "builtin", command: { id, type: "get_session_stats" } };
    case "export":
      return {
        kind: "builtin",
        command: { id, type: "export_html", ...(args ? { outputPath: args } : {}) },
      };
    default:
      return { kind: "prompt" };
  }
}

export function withGuiBuiltinSlashCommands(commands: SlashCommand[]): SlashCommand[] {
  const seen = new Set<string>();
  const merged: SlashCommand[] = [];
  for (const command of [...GUI_BUILTIN_SLASH_COMMANDS, ...commands]) {
    if (seen.has(command.name)) continue;
    seen.add(command.name);
    merged.push(command);
  }
  return merged;
}

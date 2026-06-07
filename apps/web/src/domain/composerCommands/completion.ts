import type { ModelSummary, SlashCommand } from "@pi-gui/shared";
import { compactModelLabel, modelKey } from "../models";

export type ComposerCommandOption = {
  name: string;
  title: string;
  description: string;
  source: SlashCommand["source"] | "gui";
  dynamicCommand?: SlashCommand;
  argRequired?: boolean;
};

export type ParsedLeadingSlashCommand = {
  name: string;
  args: string;
  lineStart: number;
  lineEnd: number;
};

export type ComposerCompletionItem =
  | {
      kind: "command";
      key: string;
      title: string;
      description: string;
      sourceLabel: string;
      command: ComposerCommandOption;
    }
  | {
      kind: "model";
      key: string;
      title: string;
      description: string;
      sourceLabel: string;
      model: ModelSummary;
    };

export type ComposerCommandCompletion = {
  visible: boolean;
  items: ComposerCompletionItem[];
  activeIndex: number;
};

const NATIVE_COMMANDS: ComposerCommandOption[] = [
  { name: "login", title: "/login", description: "管理 OAuth 或 API key 凭据", source: "gui" },
  { name: "logout", title: "/logout", description: "退出 provider 登录状态", source: "gui" },
  { name: "model", title: "/model", description: "打开原生模型选择器", source: "gui" },
  { name: "scoped-models", title: "/scoped-models", description: "管理模型循环范围", source: "gui" },
  { name: "settings", title: "/settings", description: "打开 GUI 设置", source: "gui" },
  { name: "goal", title: "/goal [text|clear]", description: "设置、查看或清除当前 Pi session goal", source: "gui" },
  { name: "resume", title: "/resume", description: "打开 session history", source: "gui" },
  { name: "new", title: "/new", description: "创建新的 Pi session", source: "gui" },
  { name: "name", title: "/name <name>", description: "设置当前会话名称", source: "gui", argRequired: true },
  { name: "session", title: "/session", description: "显示当前会话统计", source: "gui" },
  { name: "tree", title: "/tree", description: "会话树 / 历史节点跳转", source: "gui" },
  { name: "fork", title: "/fork <entryId>", description: "从历史 user message 创建 fork", source: "gui", argRequired: true },
  { name: "clone", title: "/clone", description: "克隆当前活动分支", source: "gui" },
  { name: "compact", title: "/compact [prompt]", description: "手动压缩上下文", source: "gui" },
  { name: "copy", title: "/copy", description: "复制最后一条 assistant 回复", source: "gui" },
  { name: "export", title: "/export [file]", description: "导出当前 session 为 HTML", source: "gui" },
  { name: "share", title: "/share", description: "上传分享当前 session", source: "gui" },
  { name: "reload", title: "/reload", description: "刷新 commands / state / messages", source: "gui" },
  { name: "hotkeys", title: "/hotkeys", description: "显示快捷键", source: "gui" },
  { name: "changelog", title: "/changelog", description: "显示版本历史", source: "gui" },
  { name: "quit", title: "/quit", description: "停止当前 runtime", source: "gui" },
];

export function buildCommandOptions(commands: SlashCommand[]): ComposerCommandOption[] {
  const dynamicOptions = commands.map((command): ComposerCommandOption => ({
    name: command.name,
    title: `/${command.name}`,
    description: command.description ?? sourceLabel(command.source),
    source: command.source,
    dynamicCommand: command,
  }));
  const nativeOptions = NATIVE_COMMANDS.map((command) => bindNativeCommandToDynamic(command, commands));
  const seen = new Set<string>();
  return [...nativeOptions, ...dynamicOptions].filter((command) => {
    if (seen.has(command.name)) return false;
    seen.add(command.name);
    return true;
  });
}

function bindNativeCommandToDynamic(command: ComposerCommandOption, commands: SlashCommand[]): ComposerCommandOption {
  if (command.name !== "goal") return command;
  const goalCommand = preferredSlashCommand(commands, "goal");
  if (!goalCommand) return command;
  return {
    ...command,
    description: goalCommand.description ?? command.description,
    dynamicCommand: goalCommand,
  };
}

function preferredSlashCommand(commands: SlashCommand[], baseName: string): SlashCommand | undefined {
  return commands.find((command) => command.name === baseName) ?? commands.find((command) => command.name.startsWith(`${baseName}:`));
}

export function buildComposerCompletions({
  prompt,
  commands,
  models,
  selectedIndex,
  suppressed,
}: {
  prompt: string;
  commands: ComposerCommandOption[];
  models: ModelSummary[];
  selectedIndex: number;
  suppressed: boolean;
}): ComposerCommandCompletion {
  const parsed = parseLeadingSlashCommand(prompt);
  if (suppressed || !parsed) return { visible: false, items: [], activeIndex: 0 };

  const items = parsed.name === "model" && parsed.args
    ? modelCompletionItems(parsed.args, models)
    : commandCompletionItems(parsed.name, commands);

  return {
    visible: items.length > 0,
    items,
    activeIndex: Math.max(0, Math.min(selectedIndex, Math.max(0, items.length - 1))),
  };
}

export function parseLeadingSlashCommand(prompt: string): ParsedLeadingSlashCommand | undefined {
  const lineStart = prompt.search(/\S/);
  if (lineStart === -1 || prompt[lineStart] !== "/") return undefined;
  const newlineIndex = prompt.indexOf("\n", lineStart);
  const lineEnd = newlineIndex === -1 ? prompt.length : newlineIndex;
  const commandLine = prompt.slice(lineStart + 1, lineEnd);
  const separatorIndex = commandLine.search(/\s/);
  return {
    name: separatorIndex === -1 ? commandLine : commandLine.slice(0, separatorIndex),
    args: separatorIndex === -1 ? "" : commandLine.slice(separatorIndex).trim(),
    lineStart,
    lineEnd,
  };
}

export function replaceLeadingCommandLine(prompt: string, replacementLine: string): string {
  const parsed = parseLeadingSlashCommand(prompt);
  if (!parsed) return prompt;
  return `${prompt.slice(0, parsed.lineStart)}${replacementLine}${prompt.slice(parsed.lineEnd)}`;
}

export function completeCommandPrompt(prompt: string, command: ComposerCommandOption): string {
  const args = parseLeadingSlashCommand(prompt)?.args ?? "";
  return replaceLeadingCommandLine(prompt, `/${command.name}${args ? ` ${args}` : " "}`);
}

export function completeModelPrompt(prompt: string, model: ModelSummary): string {
  return replaceLeadingCommandLine(prompt, `/model ${modelKey(model)}`);
}

export function isExecutableCommandInput(prompt: string, command: ComposerCommandOption | undefined): boolean {
  const parsed = parseLeadingSlashCommand(prompt);
  if (!parsed || !command) return false;
  return parsed.name === command.name;
}

function commandCompletionItems(queryInput: string, commands: ComposerCommandOption[]): ComposerCompletionItem[] {
  const query = queryInput.toLowerCase();
  return commands
    .filter((command) => command.name.toLowerCase().includes(query))
    .sort((left, right) => commandRank(left.name, query) - commandRank(right.name, query) || left.name.localeCompare(right.name))
    .slice(0, 10)
    .map((command) => ({
      kind: "command",
      key: `${command.source}:${command.name}:${command.dynamicCommand?.path ?? ""}`,
      title: command.title,
      description: command.description,
      sourceLabel: sourceLabel(command.source),
      command,
    }));
}

function modelCompletionItems(queryInput: string, models: ModelSummary[]): ComposerCompletionItem[] {
  const query = queryInput.trim().toLowerCase();
  if (!query) return [];
  return models
    .filter((model) => modelMatchesQuery(model, query))
    .sort((left, right) => modelRank(left, query) - modelRank(right, query) || modelKey(left).localeCompare(modelKey(right)))
    .slice(0, 10)
    .map((model) => ({
      kind: "model",
      key: `model:${modelKey(model)}`,
      title: compactModelLabel(model),
      description: modelKey(model),
      sourceLabel: "模型",
      model,
    }));
}

function modelMatchesQuery(model: ModelSummary, query: string): boolean {
  return modelSearchFields(model).some((field) => field.includes(query));
}

function modelRank(model: ModelSummary, query: string): number {
  const key = modelKey(model).toLowerCase();
  const id = model.id.toLowerCase();
  const fields = modelSearchFields(model);
  if (key === query || id === query) return 0;
  if (fields.some((field) => field.startsWith(query))) return 1;
  return 2;
}

function modelSearchFields(model: ModelSummary): string[] {
  return [modelKey(model), model.id, model.label ?? "", model.provider].map((value) => value.toLowerCase());
}

function commandRank(name: string, query: string): number {
  const lowerName = name.toLowerCase();
  if (lowerName === query) return 0;
  if (lowerName.startsWith(query)) return 1;
  return 2;
}

function sourceLabel(source: ComposerCommandOption["source"]): string {
  switch (source) {
    case "gui":
      return "Pi / GUI";
    case "builtin":
      return "内置";
    case "extension":
      return "扩展";
    case "prompt":
      return "Prompt";
    case "skill":
      return "Skill";
  }
}

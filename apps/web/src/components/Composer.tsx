import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelSummary, Project, ResponseMode, Runtime, SlashCommand, ThinkingLevel } from "@pi-gui/shared";
import type { ConnectionState, ConversationContextUsage } from "../types";
import { ContextIndicator } from "./ContextIndicator";
import { Icon } from "./Icon";
import { ModelPicker } from "./ModelPicker";

type ComposerProps = {
  prompt: string;
  projectCwd: string;
  selectedProject?: Project;
  models: ModelSummary[];
  selectedModel?: ModelSummary;
  selectedThinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
  responseMode: ResponseMode;
  modelPickerOpen: boolean;
  contextUsage?: ConversationContextUsage;
  slashCommands: SlashCommand[];
  commandMenuOpenSignal: number;
  connection: ConnectionState;
  activeRuntime?: Runtime;
  activeRuntimeIsBusy: boolean;
  onSubmit: (streamingBehavior?: "steer" | "followUp") => void;
  onPromptChange: (prompt: string) => void;
  onExecuteCommandInput: (input: string, command?: ComposerCommandOption) => boolean;
  onOpenPathPicker: () => void | Promise<void>;
  onAbortRuntime: (runtimeId: string) => void;
  onToggleModelPicker: () => void;
  onCloseModelPicker: () => void;
  onChooseModel: (model: ModelSummary) => void;
  onChooseThinkingLevel: (level: ThinkingLevel) => void;
  onChooseResponseMode: (mode: ResponseMode) => void;
};

export type ComposerCommandOption = {
  name: string;
  title: string;
  description: string;
  source: SlashCommand["source"] | "gui";
  dynamicCommand?: SlashCommand;
  argRequired?: boolean;
};

const NATIVE_COMMANDS: ComposerCommandOption[] = [
  { name: "login", title: "/login", description: "管理 OAuth 或 API key 凭据", source: "gui" },
  { name: "logout", title: "/logout", description: "退出 provider 登录状态", source: "gui" },
  { name: "model", title: "/model", description: "打开原生模型选择器", source: "gui" },
  { name: "scoped-models", title: "/scoped-models", description: "管理模型循环范围", source: "gui" },
  { name: "settings", title: "/settings", description: "打开 GUI 设置", source: "gui" },
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

export function Composer({
  prompt,
  projectCwd,
  selectedProject,
  models,
  selectedModel,
  selectedThinkingLevel,
  availableThinkingLevels,
  responseMode,
  modelPickerOpen,
  contextUsage,
  slashCommands,
  commandMenuOpenSignal,
  connection,
  activeRuntime,
  activeRuntimeIsBusy,
  onSubmit,
  onPromptChange,
  onExecuteCommandInput,
  onOpenPathPicker,
  onAbortRuntime,
  onToggleModelPicker,
  onCloseModelPicker,
  onChooseModel,
  onChooseThinkingLevel,
  onChooseResponseMode,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [commandMenuSuppressed, setCommandMenuSuppressed] = useState(false);
  const hasPrompt = prompt.trim().length > 0;
  const showAbortAction = activeRuntime?.status === "running" && activeRuntimeIsBusy && !hasPrompt;
  const sendTitle = activeRuntimeIsBusy ? "Steer up（回车）" : "发送（回车）";
  const commandOptions = useMemo(() => buildCommandOptions(slashCommands), [slashCommands]);
  const commandCompletion = useMemo(
    () => commandCompletionForPrompt(prompt, commandOptions, selectedCommandIndex, commandMenuSuppressed),
    [commandMenuSuppressed, commandOptions, prompt, selectedCommandIndex],
  );

  useEffect(() => {
    if (commandMenuOpenSignal <= 0) return;
    setCommandMenuSuppressed(false);
    setSelectedCommandIndex(0);
    if (!prompt.trimStart().startsWith("/")) onPromptChange("/");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [commandMenuOpenSignal]);

  function submit(streamingBehavior?: "steer" | "followUp") {
    if (prompt.trimStart().startsWith("/")) {
      const selectedCommand = commandCompletion.matches[commandCompletion.activeIndex];
      if (onExecuteCommandInput(prompt, selectedCommand)) {
        setCommandMenuSuppressed(false);
        setSelectedCommandIndex(0);
      }
      return;
    }
    onSubmit(streamingBehavior);
  }

  function completeCommand(command: ComposerCommandOption | undefined) {
    if (!command) return;
    const leadingWhitespace = prompt.match(/^\s*/)?.[0] ?? "";
    const args = commandArgs(prompt);
    onPromptChange(`${leadingWhitespace}/${command.name}${args ? ` ${args}` : " "}`);
    setSelectedCommandIndex(0);
    setCommandMenuSuppressed(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const streamingBehavior = streamingBehaviorFromSubmitter(submitter);
        submit(streamingBehavior);
      }}
    >
      {commandCompletion.visible ? (
        <div className="composer-command-menu" role="listbox" aria-label="Pi slash commands">
          {commandCompletion.matches.map((command, index) => (
            <button
              key={`${command.source}:${command.name}:${command.dynamicCommand?.path ?? ""}`}
              className={`composer-command-item ${index === commandCompletion.activeIndex ? "is-active" : ""}`}
              type="button"
              role="option"
              aria-selected={index === commandCompletion.activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSelectedCommandIndex(index)}
              onClick={() => completeCommand(command)}
            >
              <span className="composer-command-name">{command.title}</span>
              <span className="composer-command-description">{command.description}</span>
              <span className={`composer-command-source source-${command.source}`}>{sourceLabel(command.source)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="composer-input-row">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(event) => {
            setSelectedCommandIndex(0);
            setCommandMenuSuppressed(false);
            onPromptChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;

            if (event.key === "/" && !event.shiftKey && !prompt.trim()) {
              setCommandMenuSuppressed(false);
              return;
            }

            if (commandCompletion.visible) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedCommandIndex((index) => (index + 1) % commandCompletion.matches.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedCommandIndex((index) => (index - 1 + commandCompletion.matches.length) % commandCompletion.matches.length);
                return;
              }
              if (event.key === "Tab") {
                event.preventDefault();
                completeCommand(commandCompletion.matches[commandCompletion.activeIndex]);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setCommandMenuSuppressed(true);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                const selectedCommand = commandCompletion.matches[commandCompletion.activeIndex];
                if (!isExecutableCommandInput(prompt, selectedCommand)) completeCommand(selectedCommand);
                else submit(activeRuntimeIsBusy ? (event.altKey ? "followUp" : "steer") : undefined);
                return;
              }
            }

            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (activeRuntimeIsBusy) submit(event.altKey ? "followUp" : "steer");
              else event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {showAbortAction ? (
          <button
            className="send-action abort-action"
            type="button"
            title="中止本轮输出"
            aria-label="中止本轮输出"
            onClick={() => onAbortRuntime(activeRuntime.id)}
          >
            <Icon name="stop" />
          </button>
        ) : (
          <button
            className="send-action"
            type="submit"
            data-streaming-behavior={activeRuntimeIsBusy ? "steer" : undefined}
            title={sendTitle}
            aria-label={sendTitle}
            disabled={!hasPrompt || connection !== "open"}
          >
            <span aria-hidden="true">↵</span>
          </button>
        )}
      </div>

      <div className="composer-meta-row">
        <button className={`path-picker-trigger composer-project-trigger ${projectCwd || selectedProject ? "has-value" : ""}`} type="button" onClick={() => void onOpenPathPicker()}>
          <Icon name="folder" />
          <span>{projectCwd || selectedProject?.cwd || "选择项目文件夹"}</span>
        </button>

        <div className="composer-runtime-controls">
          <ModelPicker
            models={models}
            selectedModel={selectedModel}
            selectedThinkingLevel={selectedThinkingLevel}
            availableThinkingLevels={availableThinkingLevels}
            responseMode={responseMode}
            open={modelPickerOpen}
            onToggleOpen={onToggleModelPicker}
            onClose={onCloseModelPicker}
            onChooseModel={onChooseModel}
            onChooseThinkingLevel={onChooseThinkingLevel}
            onChooseResponseMode={onChooseResponseMode}
          />
          <ContextIndicator usage={contextUsage} activeRuntime={activeRuntime} />
        </div>
      </div>
    </form>
  );
}

function buildCommandOptions(commands: SlashCommand[]): ComposerCommandOption[] {
  const dynamicOptions = commands.map((command): ComposerCommandOption => ({
    name: command.name,
    title: `/${command.name}`,
    description: command.description ?? sourceLabel(command.source),
    source: command.source,
    dynamicCommand: command,
  }));
  const seen = new Set<string>();
  return [...NATIVE_COMMANDS, ...dynamicOptions].filter((command) => {
    if (seen.has(command.name)) return false;
    seen.add(command.name);
    return true;
  });
}

function commandCompletionForPrompt(prompt: string, commands: ComposerCommandOption[], selectedIndex: number, suppressed: boolean) {
  const parsed = parseCommandInput(prompt);
  if (suppressed || !parsed || commands.length === 0) return { visible: false, matches: [], activeIndex: 0 };
  const query = parsed.name.toLowerCase();
  const matches = commands
    .filter((command) => command.name.toLowerCase().includes(query))
    .sort((left, right) => commandRank(left.name, query) - commandRank(right.name, query) || left.name.localeCompare(right.name))
    .slice(0, 10);
  return { visible: matches.length > 0, matches, activeIndex: Math.max(0, Math.min(selectedIndex, Math.max(0, matches.length - 1))) };
}

function parseCommandInput(prompt: string): { name: string; args: string } | undefined {
  const trimmed = prompt.trimStart();
  if (!trimmed.startsWith("/")) return undefined;
  if (trimmed.includes("\n")) return undefined;
  const withoutSlash = trimmed.slice(1);
  const separatorIndex = withoutSlash.search(/\s/);
  return {
    name: separatorIndex === -1 ? withoutSlash : withoutSlash.slice(0, separatorIndex),
    args: separatorIndex === -1 ? "" : withoutSlash.slice(separatorIndex).trim(),
  };
}

function commandArgs(prompt: string): string {
  return parseCommandInput(prompt)?.args ?? "";
}

function isExecutableCommandInput(prompt: string, command: ComposerCommandOption | undefined): boolean {
  const parsed = parseCommandInput(prompt);
  if (!parsed || !command) return false;
  return parsed.name === command.name || Boolean(parsed.args);
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

function streamingBehaviorFromSubmitter(submitter: HTMLButtonElement | null): "steer" | "followUp" | undefined {
  const behavior = submitter?.dataset.streamingBehavior;
  if (behavior === "steer" || behavior === "followUp") return behavior;
  return undefined;
}

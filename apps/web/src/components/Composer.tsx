import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { ModelSummary, Project, ResponseMode, Runtime, RuntimeQueue, SlashCommand, ThinkingLevel, VoiceInputSettings } from "@pi-gui/shared";
import type { RuntimeExtensionUiChrome } from "../domain/extensionUiChrome";
import { useVoiceInput } from "../hooks/useVoiceInput";
import type { ConnectionState, ConversationContextUsage } from "../types";
import { ContextIndicator } from "./ContextIndicator";
import { ExtensionUiWidgetStack } from "./ExtensionUiChrome";
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
  activeRuntimeQueue?: RuntimeQueue;
  slashCommands: SlashCommand[];
  extensionUi?: RuntimeExtensionUiChrome;
  commandMenuOpenSignal: number;
  connection: ConnectionState;
  activeRuntime?: Runtime;
  activeRuntimeIsBusy: boolean;
  voiceInputSettings?: VoiceInputSettings;
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
  activeRuntimeQueue,
  slashCommands,
  extensionUi,
  commandMenuOpenSignal,
  connection,
  activeRuntime,
  activeRuntimeIsBusy,
  voiceInputSettings,
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
  const latestPromptRef = useRef(prompt);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [commandMenuSuppressed, setCommandMenuSuppressed] = useState(false);
  const [dropState, setDropState] = useState<"idle" | "active" | "reading">("idle");
  const [dropNotice, setDropNotice] = useState<string | undefined>();
  const hasPrompt = prompt.trim().length > 0;
  const showAbortAction = activeRuntime?.status === "running" && activeRuntimeIsBusy && !hasPrompt;
  const sendTitle = activeRuntimeIsBusy ? "Steer up（回车）" : "发送（回车）";
  const queuedPromptItems = queuedPromptNoticeItems(activeRuntimeQueue);
  const commandOptions = useMemo(() => buildCommandOptions(slashCommands), [slashCommands]);
  const commandCompletion = useMemo(
    () => commandCompletionForPrompt(prompt, commandOptions, selectedCommandIndex, commandMenuSuppressed),
    [commandMenuSuppressed, commandOptions, prompt, selectedCommandIndex],
  );
  const { voiceInput, toggleRecording, dismissError: dismissVoiceInputError } = useVoiceInput({
    connection,
    settings: voiceInputSettings,
    onTranscript: insertPromptFragment,
  });
  const voiceLabel =
    voiceInput.state === "recording" ? "停止语音输入" : voiceInput.state === "processing" ? "正在识别语音" : voiceInput.state === "unavailable" ? voiceInput.status?.message ?? "语音输入不可用" : "语音输入";
  const voiceTitle = `${voiceLabel}（Ctrl/Cmd+Shift+M）`;

  useEffect(() => {
    latestPromptRef.current = prompt;
  }, [prompt]);

  useEffect(() => {
    if (commandMenuOpenSignal <= 0) return;
    setCommandMenuSuppressed(false);
    setSelectedCommandIndex(0);
    if (!latestPromptRef.current.trimStart().startsWith("/")) updatePrompt("/");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [commandMenuOpenSignal]);

  useEffect(() => {
    if (!dropNotice) return;
    const timer = window.setTimeout(() => setDropNotice(undefined), DROP_NOTICE_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [dropNotice]);

  useEffect(() => {
    function handleVoiceInputShortcut(event: KeyboardEvent) {
      if (!isVoiceInputShortcut(event) || event.repeat || event.defaultPrevented) return;
      event.preventDefault();
      if (connection !== "open" || voiceInput.state === "processing" || voiceInput.state === "unavailable") return;
      void toggleRecording();
      requestAnimationFrame(() => textareaRef.current?.focus());
    }

    window.addEventListener("keydown", handleVoiceInputShortcut);
    return () => window.removeEventListener("keydown", handleVoiceInputShortcut);
  }, [connection, toggleRecording, voiceInput.state]);

  useEffect(() => {
    function handleWindowDragOver(event: globalThis.DragEvent) {
      if (!event.dataTransfer || !hasPotentialDroppablePromptData(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }

    function handleWindowDrop(event: globalThis.DragEvent) {
      if (!event.dataTransfer || !hasDroppedPromptData(event.dataTransfer)) return;
      event.preventDefault();
    }

    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("drop", handleWindowDrop);
    return () => {
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, []);

  function submit(streamingBehavior?: "steer" | "followUp") {
    const currentPrompt = latestPromptRef.current;
    if (currentPrompt.trimStart().startsWith("/")) {
      const selectedCommand = commandCompletion.matches[commandCompletion.activeIndex];
      if (onExecuteCommandInput(currentPrompt, selectedCommand)) {
        setCommandMenuSuppressed(false);
        setSelectedCommandIndex(0);
      }
      return;
    }
    onSubmit(streamingBehavior);
  }

  function updatePrompt(nextPrompt: string) {
    latestPromptRef.current = nextPrompt;
    onPromptChange(nextPrompt);
  }

  function completeCommand(command: ComposerCommandOption | undefined) {
    if (!command) return;
    const currentPrompt = latestPromptRef.current;
    const leadingWhitespace = currentPrompt.match(/^\s*/)?.[0] ?? "";
    const args = commandArgs(currentPrompt);
    updatePrompt(`${leadingWhitespace}/${command.name}${args ? ` ${args}` : " "}`);
    setSelectedCommandIndex(0);
    setCommandMenuSuppressed(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function insertPromptFragment(fragment: string) {
    const textarea = textareaRef.current;
    const currentPrompt = latestPromptRef.current;
    const start = textarea?.selectionStart ?? currentPrompt.length;
    const end = textarea?.selectionEnd ?? currentPrompt.length;
    const insertion = mergePromptFragment(currentPrompt, start, end, fragment);
    updatePrompt(insertion.text);
    setSelectedCommandIndex(0);
    setCommandMenuSuppressed(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(insertion.cursor, insertion.cursor);
    });
  }

  function handleComposerDragOver(event: DragEvent<HTMLFormElement>) {
    if (!hasPotentialDroppablePromptData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (dropState !== "active") setDropState("active");
  }

  function handleComposerDragLeave(event: DragEvent<HTMLFormElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (dropState !== "reading") setDropState("idle");
  }

  async function handleComposerDrop(event: DragEvent<HTMLFormElement>) {
    if (!hasDroppedPromptData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    await importDroppedPromptData(event.dataTransfer);
  }

  async function importDroppedPromptData(dataTransfer: DataTransfer) {
    const files = Array.from(dataTransfer.files);
    const referencePaths = droppedReferencePaths(dataTransfer);
    setDropNotice(undefined);
    setDropState("reading");
    try {
      const result = await buildDroppedPromptFragment(files, referencePaths);
      if (result.fragment) insertPromptFragment(result.fragment);
      setDropNotice(result.notice);
    } catch (error) {
      setDropNotice(`文件拖拽导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDropState("idle");
    }
  }

  return (
    <form
      className={`composer ${dropState === "active" ? "drag-active" : ""} ${dropState === "reading" ? "drag-reading" : ""}`}
      onDragOver={handleComposerDragOver}
      onDragLeave={handleComposerDragLeave}
      onDrop={(event) => void handleComposerDrop(event)}
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const streamingBehavior = streamingBehaviorFromSubmitter(submitter);
        submit(streamingBehavior);
      }}
    >
      <ExtensionUiWidgetStack chrome={extensionUi} placement="aboveEditor" />

      {queuedPromptItems.length > 0 ? (
        <div className="composer-queued-prompt-notice" aria-live="polite" aria-label="等待处理的 follow up 和 steer up">
          {queuedPromptItems.map((item) => (
            <div className="composer-queued-prompt-item" key={item.key}>
              <span className="composer-queued-prompt-label">{item.label}</span>
              <span className="composer-queued-prompt-text">{item.text}</span>
            </div>
          ))}
        </div>
      ) : null}

      {dropState !== "idle" || dropNotice ? (
        <div className={`composer-drop-status ${dropState !== "idle" ? `is-${dropState}` : ""}`} aria-live="polite">
          <span>{dropState === "active" ? "松开即可导入文件到对话" : dropState === "reading" ? "正在导入拖拽文件…" : dropNotice}</span>
          {dropState === "idle" && dropNotice ? (
            <button className="composer-drop-status-dismiss" type="button" aria-label="关闭拖拽导入提示" onClick={() => setDropNotice(undefined)}>
              ×
            </button>
          ) : null}
        </div>
      ) : null}

      {voiceInput.state === "recording" || voiceInput.state === "processing" || voiceInput.error ? (
        <div className={`composer-drop-status composer-voice-status is-${voiceInput.state}`} aria-live="polite">
          <span>{voiceInput.state === "recording" ? "正在录音…再次点击麦克风结束" : voiceInput.state === "processing" ? "正在离线识别语音…" : voiceInput.error}</span>
          {voiceInput.error ? (
            <button className="composer-drop-status-dismiss" type="button" aria-label="关闭语音输入错误" onClick={dismissVoiceInputError}>
              ×
            </button>
          ) : null}
        </div>
      ) : null}

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
            updatePrompt(event.target.value);
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
        <button
          className={`send-action composer-voice-action ${voiceInput.state === "recording" ? "is-recording" : ""}`}
          type="button"
          title={voiceTitle}
          aria-label={voiceTitle}
          onClick={() => void toggleRecording()}
          disabled={connection !== "open" || voiceInput.state === "processing" || voiceInput.state === "unavailable"}
        >
          <Icon name="mic" />
        </button>
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

      <ExtensionUiWidgetStack chrome={extensionUi} placement="belowEditor" />
    </form>
  );
}

function queuedPromptNoticeItems(queue: RuntimeQueue | undefined): Array<{ key: string; label: string; text: string }> {
  if (!queue) return [];
  return [
    ...queue.steering.map((text, index) => ({ key: `steer:${index}:${text}`, label: "Steer up", text: queuedPromptPreview(text) })),
    ...queue.followUp.map((text, index) => ({ key: `followUp:${index}:${text}`, label: "Follow up", text: queuedPromptPreview(text) })),
  ];
}

function queuedPromptPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized || "（空内容）";
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

function isVoiceInputShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "m";
}

function streamingBehaviorFromSubmitter(submitter: HTMLButtonElement | null): "steer" | "followUp" | undefined {
  const behavior = submitter?.dataset.streamingBehavior;
  if (behavior === "steer" || behavior === "followUp") return behavior;
  return undefined;
}

type DroppedPromptFragmentResult = {
  fragment: string;
  notice: string;
};

type ImportedFileResponse = {
  path: string;
  name: string;
  size: number;
};

const DROP_NOTICE_AUTO_DISMISS_MS = 6000;

function hasPotentialDroppablePromptData(dataTransfer: DataTransfer): boolean {
  return dataTransfer.files.length > 0 || dataTransfer.types.includes("Files") || dataTransfer.types.includes("text/uri-list");
}

function hasDroppedPromptData(dataTransfer: DataTransfer): boolean {
  return hasPotentialDroppablePromptData(dataTransfer) || parsePlainTextPaths(dataTransfer.getData("text/plain")).length > 0;
}

async function buildDroppedPromptFragment(files: File[], referencePaths: string[]): Promise<DroppedPromptFragmentResult> {
  const fragments: string[] = [];
  const skipped: string[] = [];

  if (files.length > 0) {
    for (const [index, file] of files.entries()) {
      try {
        const existingPath = referencePaths[index];
        const path = existingPath ?? (await uploadDroppedFile(file)).path;
        fragments.push(formatFileReference(path));
      } catch (error) {
        skipped.push(`${file.name || "dropped-file"}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } else {
    fragments.push(...referencePaths.map(formatFileReference));
  }

  const noticeParts: string[] = [];
  if (fragments.length > 0) noticeParts.push(`已添加 ${fragments.length} 个文件引用`);
  if (skipped.length > 0) noticeParts.push(`跳过 ${skipped.length} 个：${skipped.slice(0, 3).join("；")}${skipped.length > 3 ? "…" : ""}`);
  if (noticeParts.length === 0) noticeParts.push("未找到可引用的文件；符号链接/文件夹暂不支持拖拽导入。");

  return { fragment: fragments.join("\n"), notice: noticeParts.join("；") };
}

async function uploadDroppedFile(file: File): Promise<ImportedFileResponse> {
  const response = await fetch(`/api/imports/file?name=${encodeURIComponent(file.name || "dropped-file")}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  const data = (await response.json().catch(() => undefined)) as unknown;
  if (!response.ok) {
    throw new Error(errorMessageFromResponse(data) ?? `上传失败 (${response.status})`);
  }
  if (!isImportedFileResponse(data)) throw new Error("服务器返回的导入结果无效");
  return data;
}

function errorMessageFromResponse(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || !("error" in data)) return undefined;
  return typeof data.error === "string" ? data.error : undefined;
}

function isImportedFileResponse(value: unknown): value is ImportedFileResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "path" in value &&
      typeof value.path === "string" &&
      "name" in value &&
      typeof value.name === "string" &&
      "size" in value &&
      typeof value.size === "number",
  );
}

function droppedReferencePaths(dataTransfer: DataTransfer): string[] {
  const paths = new Set<string>();
  for (const path of parseUriListPaths(dataTransfer.getData("text/uri-list"))) paths.add(path);
  if (paths.size === 0) {
    for (const path of parsePlainTextPaths(dataTransfer.getData("text/plain"))) paths.add(path);
  }
  return Array.from(paths);
}

function parseUriListPaths(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(fileUriToPath)
    .filter((path): path is string => Boolean(path));
}

function fileUriToPath(uri: string): string | undefined {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return undefined;
    const path = decodeURIComponent(url.pathname);
    return path.match(/^\/[A-Za-z]:\//) ? path.slice(1) : path;
  } catch {
    return undefined;
  }
}

function parsePlainTextPaths(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(~\/|\/|[A-Za-z]:[\\/])/.test(line));
}

function formatFileReference(path: string): string {
  return /\s/.test(path) ? `@"${path.replace(/"/g, '\\"')}"` : `@${path}`;
}

function mergePromptFragment(prompt: string, start: number, end: number, fragment: string): { text: string; cursor: number } {
  const before = prompt.slice(0, start);
  const after = prompt.slice(end);
  const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
  const suffix = after && !after.startsWith("\n") ? "\n\n" : "";
  const inserted = `${prefix}${fragment}${suffix}`;
  return { text: `${before}${inserted}${after}`, cursor: before.length + inserted.length };
}

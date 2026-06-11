import { forwardRef, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";
import type { ModelSummary, Project, ResponseMode, Runtime, RuntimeQueue, SlashCommand, ThinkingLevel } from "@pi-gui/shared";
import {
  buildCommandOptions,
  buildComposerCompletions,
  completeCommandPrompt,
  completeModelPrompt,
  isExecutableCommandInput,
  parseLeadingSlashCommand,
  type ComposerCommandOption,
  type ComposerCompletionItem,
} from "../domain/composerCommands";
import {
  buildDroppedPromptFragment,
  droppedReferencePaths,
  droppedUnsupportedItemLabels,
  hasDroppedPromptData,
  hasPotentialDroppablePromptData,
  mergePromptFragment,
} from "../domain/droppedPromptFiles";
import { apiUrl } from "../domain/apiUrl";
import { activeComposerReferenceToken, completeComposerReference, type ComposerFileSearchEntry, type ComposerFileSearchResponse } from "../domain/composerReferences";
import { authHeaders } from "../domain/runtimeConfig";
import type { PendingCommandEntry } from "../domain/pendingCommands";
import { runtimeQueueOrderItems } from "../domain/runtimeQueueOrdering";
import type { RuntimeExtensionUiChrome } from "../domain/extensionUiChrome";
import { mediaQueryMatches } from "../domain/mediaQuery";
import { isConnectionReady } from "../domain/connection";
import type { ConnectionState, ConversationContextUsage } from "../types";
import { ContextIndicator } from "./ContextIndicator";
import { ExtensionUiWidgetStack } from "./ExtensionUiChrome";
import { Icon } from "./Icon";
import { ModelPicker } from "./ModelPicker";
import { ComposerCommandMenu } from "./composer/ComposerCommandMenu";
import { ComposerReferenceMenu } from "./composer/ComposerReferenceMenu";
import { QueuedPromptNotice } from "./composer/QueuedPromptNotice";

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
  focusRequestSignal?: number;
  connection: ConnectionState;
  activeRuntime?: Runtime;
  activeRuntimeIsBusy: boolean;
  pendingCommand?: PendingCommandEntry;
  onSubmit: (streamingBehavior?: "steer" | "followUp") => void;
  onPromptChange: (prompt: string) => void;
  onExecuteCommandInput: (input: string, command?: ComposerCommandOption) => boolean;
  onOpenPathPicker: () => void | Promise<void>;
  onAbortRuntime: (runtimeId: string) => void;
  onDequeueRuntimeQueue: (runtimeId: string) => void;
  onReorderRuntimeQueue: (runtimeId: string, queue: RuntimeQueue) => void;
  onToggleModelPicker: () => void;
  onCloseModelPicker: () => void;
  onChooseModel: (model: ModelSummary) => void;
  onChooseThinkingLevel: (level: ThinkingLevel) => void;
  onChooseResponseMode: (mode: ResponseMode) => void;
};

export const Composer = forwardRef<HTMLFormElement, ComposerProps>(function Composer({
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
  focusRequestSignal,
  connection,
  activeRuntime,
  activeRuntimeIsBusy,
  pendingCommand,
  onSubmit,
  onPromptChange,
  onExecuteCommandInput,
  onOpenPathPicker,
  onAbortRuntime,
  onDequeueRuntimeQueue,
  onReorderRuntimeQueue,
  onToggleModelPicker,
  onCloseModelPicker,
  onChooseModel,
  onChooseThinkingLevel,
  onChooseResponseMode,
}, ref) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const latestPromptRef = useRef(prompt);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [commandMenuSuppressed, setCommandMenuSuppressed] = useState(false);
  const [caretIndex, setCaretIndex] = useState(0);
  const [referenceItems, setReferenceItems] = useState<ComposerFileSearchEntry[]>([]);
  const [selectedReferenceIndex, setSelectedReferenceIndex] = useState(0);
  const [referenceMenuSuppressed, setReferenceMenuSuppressed] = useState(false);
  const [dropState, setDropState] = useState<"idle" | "active" | "reading">("idle");
  const [dropNotice, setDropNotice] = useState<string | undefined>();
  const hasPrompt = prompt.trim().length > 0;
  const connectionReady = isConnectionReady(connection);
  const runtimeCanReceiveAbort = Boolean(activeRuntime && (activeRuntime.status === "running" || activeRuntime.status === "starting") && !activeRuntime.archivedAt);
  const showAbortAction = runtimeCanReceiveAbort && (activeRuntimeIsBusy || activeRuntime?.status === "starting");
  const sendTitle = activeRuntimeIsBusy ? "Steer up（回车）" : "发送（回车）";
  const queuedPromptItems = runtimeQueueOrderItems(activeRuntimeQueue);
  const inlinePromptPendingNotice = pendingCommand?.command === "runtime.prompt" && pendingCommand.status === "sent" ? "Pi正在接收你的信息。" : undefined;
  const pendingCommandNotice = inlinePromptPendingNotice ? undefined : composerPendingCommandNotice(pendingCommand);
  const commandOptions = useMemo(() => buildCommandOptions(slashCommands), [slashCommands]);
  const commandCompletion = useMemo(
    () => buildComposerCompletions({ prompt, commands: commandOptions, models, selectedIndex: selectedCommandIndex, suppressed: commandMenuSuppressed }),
    [commandMenuSuppressed, commandOptions, models, prompt, selectedCommandIndex],
  );
  const referenceToken = useMemo(() => activeComposerReferenceToken(prompt, caretIndex), [caretIndex, prompt]);
  const referenceCompletionVisible = Boolean(referenceToken && referenceItems.length > 0 && !referenceMenuSuppressed && !commandCompletion.visible);

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
    if (!focusRequestSignal) return;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [focusRequestSignal]);

  useEffect(() => {
    if (!dropNotice) return;
    const timer = window.setTimeout(() => setDropNotice(undefined), DROP_NOTICE_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [dropNotice]);

  useEffect(() => {
    const root = projectCwd || selectedProject?.cwd;
    if (!referenceToken || referenceMenuSuppressed || !root) {
      setReferenceItems([]);
      return undefined;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({ root, q: referenceToken.query, limit: "40" });
    void fetch(apiUrl(`/api/fs/search?${query.toString()}`), { headers: authHeaders(), signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<ComposerFileSearchResponse>;
      })
      .then((result) => {
        setReferenceItems(result.entries);
        setSelectedReferenceIndex(0);
      })
      .catch((error) => {
        if ((error as { name?: string }).name === "AbortError") return;
        setReferenceItems([]);
      });
    return () => controller.abort();
  }, [projectCwd, referenceMenuSuppressed, referenceToken, selectedProject?.cwd]);

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
    if (currentPrompt.trimStart().startsWith("!") && onExecuteCommandInput(currentPrompt)) {
      setCommandMenuSuppressed(false);
      setSelectedCommandIndex(0);
      return;
    }
    if (parseLeadingSlashCommand(currentPrompt)) {
      const selectedItem = commandCompletion.items[commandCompletion.activeIndex];
      if (selectedItem?.kind === "model") {
        chooseModelCompletion(selectedItem);
        return;
      }
      const selectedCommand = selectedItem?.kind === "command" ? selectedItem.command : undefined;
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

  function completeCompletion(item: ComposerCompletionItem | undefined) {
    if (!item) return;
    const currentPrompt = latestPromptRef.current;
    updatePrompt(item.kind === "model" ? completeModelPrompt(currentPrompt, item.model) : completeCommandPrompt(currentPrompt, item.command));
    setSelectedCommandIndex(0);
    setCommandMenuSuppressed(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function chooseModelCompletion(item: Extract<ComposerCompletionItem, { kind: "model" }>) {
    onChooseModel(item.model);
    updatePrompt("");
    setSelectedCommandIndex(0);
    setCommandMenuSuppressed(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function completeReference(item: ComposerFileSearchEntry | undefined) {
    if (!item || !referenceToken) return;
    const completion = completeComposerReference(latestPromptRef.current, referenceToken, item);
    updatePrompt(completion.text);
    setReferenceItems([]);
    setSelectedReferenceIndex(0);
    setReferenceMenuSuppressed(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(completion.cursor, completion.cursor);
      setCaretIndex(completion.cursor);
    });
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
      setCaretIndex(insertion.cursor);
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
    const unsupportedLabels = droppedUnsupportedItemLabels(dataTransfer);
    await importPromptFiles(files, referencePaths, unsupportedLabels, "文件拖拽导入失败");
  }

  async function importSelectedPromptFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    await importPromptFiles(files, [], [], "文件选择导入失败");
  }

  async function importPastedPromptFiles(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    await importPromptFiles(files, [], [], "剪贴板文件导入失败");
  }

  async function importPromptFiles(files: File[], referencePaths: readonly (string | undefined)[], unsupportedLabels: string[], errorPrefix: string) {
    setDropNotice(undefined);
    setDropState("reading");
    try {
      const result = await buildDroppedPromptFragment(files, referencePaths, unsupportedLabels);
      if (result.fragment) insertPromptFragment(result.fragment);
      setDropNotice(result.notice);
    } catch (error) {
      setDropNotice(`${errorPrefix}：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDropState("idle");
    }
  }

  return (
    <form
      ref={ref}
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

      <QueuedPromptNotice
        items={queuedPromptItems}
        runtimeId={activeRuntime?.id}
        connection={connection}
        onDequeueRuntimeQueue={onDequeueRuntimeQueue}
        onReorderRuntimeQueue={onReorderRuntimeQueue}
      />

      {pendingCommandNotice ? (
        <div className={`composer-command-status ${pendingCommand?.status ?? ""}`} aria-live="polite">
          <span>{pendingCommandNotice}</span>
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

      {commandCompletion.visible ? (
        <ComposerCommandMenu
          items={commandCompletion.items}
          activeIndex={commandCompletion.activeIndex}
          onActivate={setSelectedCommandIndex}
          onSelect={(item) => (item.kind === "model" ? chooseModelCompletion(item) : completeCompletion(item))}
        />
      ) : referenceCompletionVisible ? (
        <ComposerReferenceMenu
          items={referenceItems}
          activeIndex={selectedReferenceIndex}
          onActivate={setSelectedReferenceIndex}
          onSelect={completeReference}
        />
      ) : null}

      <div className="composer-input-row">
        <input ref={fileInputRef} className="composer-file-input" type="file" multiple onChange={(event) => void importSelectedPromptFiles(event)} />
        <div className="composer-editor-column">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => {
              setSelectedCommandIndex(0);
              setCommandMenuSuppressed(false);
              setReferenceMenuSuppressed(false);
              setCaretIndex(event.target.selectionStart ?? event.target.value.length);
              updatePrompt(event.target.value);
            }}
            onPaste={(event) => void importPastedPromptFiles(event)}
            onSelect={(event) => setCaretIndex(event.currentTarget.selectionStart ?? latestPromptRef.current.length)}
            onClick={(event) => setCaretIndex(event.currentTarget.selectionStart ?? latestPromptRef.current.length)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;

              if (event.key === "/" && !event.shiftKey && !prompt.trim()) {
                setCommandMenuSuppressed(false);
                return;
              }

              if (event.key === "ArrowUp" && event.altKey && activeRuntime && queuedPromptItems.length > 0) {
                event.preventDefault();
                onDequeueRuntimeQueue(activeRuntime.id);
                return;
              }

              if (commandCompletion.visible) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelectedCommandIndex((index) => (index + 1) % commandCompletion.items.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedCommandIndex((index) => (index - 1 + commandCompletion.items.length) % commandCompletion.items.length);
                  return;
                }
                if (event.key === "Tab") {
                  event.preventDefault();
                  completeCompletion(commandCompletion.items[commandCompletion.activeIndex]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setCommandMenuSuppressed(true);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  const selectedItem = commandCompletion.items[commandCompletion.activeIndex];
                  if (selectedItem?.kind === "model") chooseModelCompletion(selectedItem);
                  else if (!isExecutableCommandInput(prompt, selectedItem?.command)) completeCompletion(selectedItem);
                  else submit(activeRuntimeIsBusy ? (event.altKey ? "followUp" : "steer") : undefined);
                  return;
                }
              }

              if (referenceCompletionVisible) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelectedReferenceIndex((index) => (index + 1) % referenceItems.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedReferenceIndex((index) => (index - 1 + referenceItems.length) % referenceItems.length);
                  return;
                }
                if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
                  event.preventDefault();
                  completeReference(referenceItems[selectedReferenceIndex]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setReferenceMenuSuppressed(true);
                  return;
                }
              }

              if (event.key === "Enter" && !event.shiftKey) {
                if (shouldTreatEnterAsNewlineOnMobile()) return;
                event.preventDefault();
                if (activeRuntimeIsBusy) submit(event.altKey ? "followUp" : "steer");
                else event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          {inlinePromptPendingNotice ? (
            <div className="composer-inline-prompt-status" role="status" aria-live="polite">
              <span>{inlinePromptPendingNotice}</span>
              <span className="composer-inline-prompt-loader" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          ) : null}
        </div>
        <div className="composer-input-actions">
          <div className="composer-input-tools" role="group" aria-label="输入辅助操作">
            <button
              className="composer-attach-action"
              type="button"
              title="选择文件并插入引用"
              aria-label="选择文件并插入引用"
              onClick={() => fileInputRef.current?.click()}
              disabled={dropState === "reading" || !connectionReady}
            >
              <Icon name="attach" />
            </button>
          </div>
          <div className="composer-submit-actions">
            {showAbortAction && activeRuntime ? (
              <button
                className="send-action abort-action"
                type="button"
                title="中止本轮输出"
                aria-label="中止本轮输出"
                onClick={() => onAbortRuntime(activeRuntime.id)}
              >
                <Icon name="stop" />
              </button>
            ) : null}
            {hasPrompt || !showAbortAction ? (
              <button
                className="send-action"
                type="submit"
                data-streaming-behavior={activeRuntimeIsBusy ? "steer" : undefined}
                title={sendTitle}
                aria-label={sendTitle}
                disabled={!hasPrompt || !connectionReady}
              >
                <Icon name="enter" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="composer-meta-row">
        <div className="composer-project-meta">
          <button
            className={`path-picker-trigger composer-project-trigger ${projectCwd || selectedProject ? "has-value" : ""}`}
            type="button"
            onPointerDown={(event) => {
              if (event.pointerType === "mouse") return;
              event.preventDefault();
              void onOpenPathPicker();
            }}
            onClick={() => void onOpenPathPicker()}
          >
            <Icon name="folder" />
            <span>{projectCwd || selectedProject?.cwd || "选择项目文件夹"}</span>
          </button>
        </div>

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
});

function composerPendingCommandNotice(command?: PendingCommandEntry): string | undefined {
  if (!command) return undefined;
  if (command.status === "sent") return `${commandLabel(command.command)} 已发送，等待确认…`;
  if (command.status === "timeout") return `${commandLabel(command.command)} 暂无确认，可能仍在后端执行。`;
  if (command.status === "unknown_after_disconnect") return `${commandLabel(command.command)} 断线前已发送，状态未知；等待重连同步。`;
  if (command.status === "failed") return `${commandLabel(command.command)} 失败${command.error ? `：${command.error}` : ""}`;
  return undefined;
}

function commandLabel(command: PendingCommandEntry["command"]): string {
  if (command === "runtime.prompt") return "Prompt";
  if (command === "runtime.start") return "启动 runtime";
  if (command === "runtime.resume") return "恢复 runtime";
  if (command === "runtime.restart") return "重启 runtime";
  if (command === "runtime.abort") return "中止 runtime";
  if (command === "runtime.stop") return "停止 runtime";
  if (command === "runtime.archive" || command === "runtime.archiveBlank") return "归档 runtime";
  if (command === "runtime.queue.dequeue") return "取回队列 prompt";
  if (command === "runtime.queue.reorder") return "调整队列";
  if (command === "project.create") return "创建项目";
  if (command === "session.resume") return "恢复会话";
  return command;
}

function streamingBehaviorFromSubmitter(submitter: HTMLButtonElement | null): "steer" | "followUp" | undefined {
  const behavior = submitter?.dataset.streamingBehavior;
  if (behavior === "steer" || behavior === "followUp") return behavior;
  return undefined;
}

function shouldTreatEnterAsNewlineOnMobile(): boolean {
  return mediaQueryMatches("(pointer: coarse), (max-width: 700px)");
}

const DROP_NOTICE_AUTO_DISMISS_MS = 6000;

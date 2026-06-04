import { useRef, type Dispatch, type SetStateAction } from "react";
import type { PiRpcCommand, Project, ResponseMode, Runtime, ServerEvent, ThinkingLevel } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import type { ComposerCommandOption } from "../components/Composer";
import type { AppAction } from "../state/appReducer";
import type { GuiSocketSend } from "../types";

type PendingNativeRpc = {
  requestId?: string;
  runtimeId?: string;
  projectId?: string;
  command: PiRpcCommand;
  label: string;
  clearPrompt: boolean;
  input?: string;
};

type PendingRuntimePrompt = {
  requestId?: string;
  runtimeId?: string;
  projectId?: string;
  message: string;
  streamingBehavior?: "steer" | "followUp";
  input?: string;
};

type UseComposerCommandsOptions = {
  activeRuntime?: Runtime;
  activeRuntimeIsBusy: boolean;
  selectedProject?: Project;
  lastAssistantText?: string;
  defaultRuntimeModelKey: () => string | undefined;
  defaultThinkingLevel: ThinkingLevel;
  defaultResponseMode: ResponseMode;
  dispatch: Dispatch<AppAction>;
  send: GuiSocketSend;
  setPrompt: Dispatch<SetStateAction<string>>;
  setModelPickerOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  openSessionHistory: (projectId: string) => void;
  openCheckpoints: (projectId?: string, runtimeId?: string) => void;
  startRuntimeForSidebarProject: (projectId: string) => void;
};

export function useComposerCommands({
  activeRuntime,
  activeRuntimeIsBusy,
  selectedProject,
  lastAssistantText,
  defaultRuntimeModelKey,
  defaultThinkingLevel,
  defaultResponseMode,
  dispatch,
  send,
  setPrompt,
  setModelPickerOpen,
  setSettingsOpen,
  openSessionHistory,
  openCheckpoints,
  startRuntimeForSidebarProject,
}: UseComposerCommandsOptions) {
  const pendingNativeRpcRef = useRef<PendingNativeRpc | undefined>(undefined);
  const pendingRuntimePromptRef = useRef<PendingRuntimePrompt | undefined>(undefined);

  function handleComposerCommandServerEvent(event: ServerEvent) {
    handlePendingNativeRpcServerEvent(event);
    handlePendingRuntimePromptServerEvent(event);
  }

  function handlePendingNativeRpcServerEvent(event: ServerEvent) {
    const pending = pendingNativeRpcRef.current;
    if (!pending) return;

    if (event.type === "runtime.status" && pending.runtimeId === event.runtime.id && event.runtime.status === "running") {
      flushPendingNativeRpc(pending, event.runtime.id);
      return;
    }

    if (event.type !== "command.result" || event.requestId !== pending.requestId) return;

    if (!event.success) {
      pendingNativeRpcRef.current = undefined;
      restorePrompt(pending.input);
      return;
    }

    if (!isRuntimeLaunchCommand(event.command)) return;
    if (!isRecord(event.data) || !isRecord(event.data.runtime) || typeof event.data.runtime.id !== "string") {
      pendingNativeRpcRef.current = undefined;
      restorePrompt(pending.input);
      dispatch({ type: "set.operationError", error: `${pending.label} 启动 runtime 后未返回 runtime id` });
      return;
    }

    flushPendingNativeRpc(pending, event.data.runtime.id);
  }

  function handlePendingRuntimePromptServerEvent(event: ServerEvent) {
    const pending = pendingRuntimePromptRef.current;
    if (!pending) return;

    if (event.type === "runtime.status" && pending.runtimeId === event.runtime.id && event.runtime.status === "running") {
      flushPendingRuntimePrompt(pending, event.runtime.id);
      return;
    }

    if (event.type !== "command.result" || event.requestId !== pending.requestId) return;

    if (!event.success) {
      pendingRuntimePromptRef.current = undefined;
      restorePrompt(pending.input);
      return;
    }

    if (!isRuntimeLaunchCommand(event.command)) return;
    if (!isRecord(event.data) || !isRecord(event.data.runtime) || typeof event.data.runtime.id !== "string") {
      pendingRuntimePromptRef.current = undefined;
      restorePrompt(pending.input);
      dispatch({ type: "set.operationError", error: "启动 runtime 后未返回 runtime id" });
      return;
    }

    flushPendingRuntimePrompt(pending, event.data.runtime.id);
  }

  function executeCommandInput(input: string, command?: ComposerCommandOption): boolean {
    const parsed = parseSlashInput(input);
    if (!parsed) return false;

    if (command?.dynamicCommand) {
      const streamingBehavior = activeRuntime?.status === "running" && activeRuntimeIsBusy ? "steer" : undefined;
      return sendRuntimePrompt(`/${command.dynamicCommand.name}${parsed.args ? ` ${parsed.args}` : ""}`, streamingBehavior, input);
    }

    return executeNativeCommand(parsed.name, parsed.args);
  }

  function executeNativeCommand(name: string, args: string): boolean {
    switch (name) {
      case "login":
      case "logout":
        return notifyCommandError("GUI 原生登录/退出还未接入 Pi provider auth；请暂时在终端使用 pi 交互模式完成。");
      case "model":
        setModelPickerOpen(true);
        setPrompt("");
        return true;
      case "scoped-models":
        return notifyCommandError("Scoped models 的 GUI 管理界面尚未实现；当前可通过模型选择器直接选择模型。");
      case "settings":
        setSettingsOpen(true);
        setPrompt("");
        return true;
      case "resume":
        if (!selectedProject) return notifyCommandError("请先选择项目");
        openSessionHistory(selectedProject.id);
        setPrompt("");
        return true;
      case "checkpoints":
        openCheckpoints(selectedProject?.id, activeRuntime?.id);
        setPrompt("");
        return true;
      case "new":
        if (activeRuntime?.status === "running") return sendNativeRpc({ type: "new_session" }, "/new");
        if (selectedProject) {
          startRuntimeForSidebarProject(selectedProject.id);
          setPrompt("");
          return true;
        }
        return notifyCommandError("请先选择项目");
      case "name":
        if (!args) return notifyCommandError("/name 需要会话名称");
        return sendNativeRpc({ type: "set_session_name", name: args }, "/name");
      case "session":
        return sendNativeRpc({ type: "get_session_stats" }, "/session");
      case "tree":
        return notifyCommandError("Session tree 原生视图尚未实现；可先通过会话历史恢复已有 session。");
      case "fork":
        if (!args) return notifyCommandError("/fork 需要 entryId；后续会补充原生历史消息选择 UI。");
        return sendNativeRpc({ type: "fork", entryId: args }, "/fork");
      case "clone":
        if (!window.confirm("复制当前活动分支到新 session？")) return false;
        return sendNativeRpc({ type: "clone" }, "/clone");
      case "compact":
        return sendNativeRpc(args ? { type: "compact", customInstructions: args } : { type: "compact" }, "/compact");
      case "copy":
        if (!lastAssistantText?.trim()) return notifyCommandError("没有可复制的 assistant 回复");
        void navigator.clipboard.writeText(lastAssistantText).then(
          () => dispatch({ type: "set.notice", notice: "已复制最后一条 assistant 回复" }),
          () => dispatch({ type: "set.operationError", error: "复制失败" }),
        );
        setPrompt("");
        return true;
      case "export":
        return sendNativeRpc(args ? { type: "export_html", outputPath: args } : { type: "export_html" }, "/export");
      case "share":
        return notifyCommandError("/share 尚未在 RPC 中暴露；GUI 暂不能直接上传 gist。");
      case "reload":
        if (activeRuntime?.status === "running") {
          send({ type: "runtime.commands.list", runtimeId: activeRuntime.id });
          sendNativeRpc({ type: "get_state" }, "/reload state", false);
          sendNativeRpc({ type: "get_messages" }, "/reload messages", false);
          setPrompt("");
          return true;
        }
        return sendNativeRpc({ type: "get_state" }, "/reload state");
      case "hotkeys":
        return notifyCommandError("快捷键：Ctrl/Cmd+K 或空输入 / 打开命令栏；↑/↓ 选择；Tab 补全；Enter 执行；Shift+Enter 换行。");
      case "changelog":
        return notifyCommandError("Changelog 原生视图尚未实现。");
      case "quit":
        if (!activeRuntime) return notifyCommandError("没有可停止的 runtime");
        if (window.confirm("停止当前 Pi runtime？")) {
          const ok = send({ type: "runtime.stop", runtimeId: activeRuntime.id });
          if (ok) setPrompt("");
          return ok;
        }
        return false;
      default:
        return sendRuntimePrompt(`/${name}${args ? ` ${args}` : ""}`, activeRuntime?.status === "running" && activeRuntimeIsBusy ? "steer" : undefined, `/${name}${args ? ` ${args}` : ""}`);
    }
  }

  function sendNativeRpc(command: PiRpcCommand, label: string, clearPrompt = true): boolean {
    if (activeRuntime?.status === "running" && !activeRuntime.archivedAt) return sendNativeRpcToRuntime(activeRuntime.id, command, label, clearPrompt);
    return launchRuntimeThenSendNativeRpc(command, label, clearPrompt);
  }

  function sendNativeRpcToRuntime(runtimeId: string, command: PiRpcCommand, label: string, clearPrompt: boolean): boolean {
    const ok = send({ type: "runtime.rpc", runtimeId, command, label });
    if (ok && clearPrompt) setPrompt("");
    return ok;
  }

  function sendRuntimePrompt(message: string, streamingBehavior: "steer" | "followUp" | undefined, input: string): boolean {
    if (activeRuntime?.status === "running" && !activeRuntime.archivedAt) {
      const ok = send({ type: "runtime.prompt", runtimeId: activeRuntime.id, message, streamingBehavior });
      if (ok) setPrompt("");
      return ok;
    }
    return launchRuntimeThenSendPrompt(message, streamingBehavior, input);
  }

  function launchRuntimeThenSendNativeRpc(command: PiRpcCommand, label: string, clearPrompt: boolean): boolean {
    const input = clearPrompt ? `/${label.replace(/^\//, "")}` : undefined;

    if (activeRuntime?.status === "starting") {
      pendingNativeRpcRef.current = { runtimeId: activeRuntime.id, command, label, clearPrompt, input };
      if (clearPrompt) setPrompt("");
      return true;
    }

    if (activeRuntime && !activeRuntime.archivedAt && (activeRuntime.status === "stopped" || activeRuntime.status === "crashed")) {
      const requestId = crypto.randomUUID();
      const sent = activeRuntime.sessionId
        ? send({ type: "runtime.resume", requestId, runtimeId: activeRuntime.id })
        : send({
            type: "runtime.restart",
            requestId,
            runtimeId: activeRuntime.id,
            model: activeRuntime.model ?? defaultRuntimeModelKey(),
            thinkingLevel: activeRuntime.thinkingLevel ?? defaultThinkingLevel,
            responseMode: activeRuntime.responseMode ?? defaultResponseMode,
          });
      if (!sent) return false;
      pendingNativeRpcRef.current = { requestId, projectId: activeRuntime.projectId, command, label, clearPrompt, input };
      if (clearPrompt) setPrompt("");
      return true;
    }

    if (selectedProject) {
      const requestId = crypto.randomUUID();
      const sent = send({
        type: "runtime.start",
        requestId,
        projectId: selectedProject.id,
        model: defaultRuntimeModelKey(),
        thinkingLevel: defaultThinkingLevel,
        responseMode: defaultResponseMode,
      });
      if (!sent) return false;
      pendingNativeRpcRef.current = { requestId, projectId: selectedProject.id, command, label, clearPrompt, input };
      if (clearPrompt) setPrompt("");
      return true;
    }

    return notifyCommandError("需要运行中的 runtime");
  }

  function launchRuntimeThenSendPrompt(message: string, streamingBehavior: "steer" | "followUp" | undefined, input: string): boolean {
    if (activeRuntime?.status === "starting") {
      pendingRuntimePromptRef.current = { runtimeId: activeRuntime.id, message, streamingBehavior, input };
      setPrompt("");
      return true;
    }

    if (activeRuntime && !activeRuntime.archivedAt && (activeRuntime.status === "stopped" || activeRuntime.status === "crashed")) {
      const requestId = crypto.randomUUID();
      const sent = activeRuntime.sessionId
        ? send({ type: "runtime.resume", requestId, runtimeId: activeRuntime.id })
        : send({
            type: "runtime.restart",
            requestId,
            runtimeId: activeRuntime.id,
            model: activeRuntime.model ?? defaultRuntimeModelKey(),
            thinkingLevel: activeRuntime.thinkingLevel ?? defaultThinkingLevel,
            responseMode: activeRuntime.responseMode ?? defaultResponseMode,
          });
      if (!sent) return false;
      pendingRuntimePromptRef.current = { requestId, projectId: activeRuntime.projectId, message, streamingBehavior, input };
      setPrompt("");
      return true;
    }

    if (selectedProject) {
      const requestId = crypto.randomUUID();
      const sent = send({
        type: "runtime.start",
        requestId,
        projectId: selectedProject.id,
        model: defaultRuntimeModelKey(),
        thinkingLevel: defaultThinkingLevel,
        responseMode: defaultResponseMode,
      });
      if (!sent) return false;
      pendingRuntimePromptRef.current = { requestId, projectId: selectedProject.id, message, streamingBehavior, input };
      setPrompt("");
      return true;
    }

    return notifyCommandError("需要运行中的 runtime");
  }

  function flushPendingNativeRpc(pending: PendingNativeRpc, runtimeId: string) {
    pendingNativeRpcRef.current = undefined;
    if (!send({ type: "runtime.rpc", runtimeId, command: pending.command, label: pending.label })) {
      restorePrompt(pending.input);
    }
  }

  function flushPendingRuntimePrompt(pending: PendingRuntimePrompt, runtimeId: string) {
    pendingRuntimePromptRef.current = undefined;
    if (!send({ type: "runtime.prompt", runtimeId, message: pending.message, streamingBehavior: pending.streamingBehavior })) {
      restorePrompt(pending.input);
    }
  }

  function restorePrompt(input?: string) {
    if (!input?.trim()) return;
    setPrompt((current) => (current.trim() ? current : input));
  }

  function notifyCommandError(message: string): false {
    dispatch({ type: "set.operationError", error: message });
    return false;
  }

  return { executeCommandInput, handleComposerCommandServerEvent };
}

function isRuntimeLaunchCommand(command: Extract<ServerEvent, { type: "command.result" }>["command"]): boolean {
  return command === "runtime.start" || command === "runtime.resume" || command === "runtime.restart" || command === "session.resume";
}

function parseSlashInput(input: string): { name: string; args: string } | undefined {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return undefined;
  const withoutSlash = trimmed.slice(1);
  const separatorIndex = withoutSlash.search(/\s/);
  return {
    name: separatorIndex === -1 ? withoutSlash : withoutSlash.slice(0, separatorIndex),
    args: separatorIndex === -1 ? "" : withoutSlash.slice(separatorIndex).trim(),
  };
}

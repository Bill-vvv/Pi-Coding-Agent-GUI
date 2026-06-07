import { useRef, type Dispatch, type SetStateAction } from "react";
import type { PiRpcCommand, Project, ResponseMode, Runtime, ServerEvent, ThinkingLevel } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import {
  bangInputDisplayMessage,
  bangInputRpcCommand,
  isRuntimeLaunchCommand,
  parseBangInput,
  parseSlashInput,
  routeNativeComposerCommand,
  runningBusyStreamingBehavior,
  slashCommandMessage,
  slashDisplayMessageForCommand,
  type ComposerCommandOption,
} from "../domain/composerCommands";
import { createRequestId } from "../domain/requestId";
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
  displayMessage?: string;
};

type PendingRuntimePrompt = {
  requestId?: string;
  runtimeId?: string;
  projectId?: string;
  message: string;
  streamingBehavior?: "steer" | "followUp";
  input?: string;
  displayMessage?: string;
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
  openSessionTreeForkControls: (mode: "fork" | "tree") => void;
  openProviderAuthPanel: (action: "login" | "logout") => void;
  openScopedModelsPanel: () => void;
  markRuntimeLocalUserActivity: (runtimeId: string) => void;
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
  openSessionTreeForkControls,
  openProviderAuthPanel,
  openScopedModelsPanel,
  markRuntimeLocalUserActivity,
  startRuntimeForSidebarProject,
}: UseComposerCommandsOptions) {
  const pendingNativeRpcRef = useRef<PendingNativeRpc | undefined>(undefined);
  const pendingRuntimePromptRef = useRef<PendingRuntimePrompt | undefined>(undefined);

  function handleComposerCommandServerEvent(event: ServerEvent) {
    handlePendingNativeRpcServerEvent(event);
    handlePendingRuntimePromptServerEvent(event);
    handleExportRpcResponse(event);
  }

  function handleExportRpcResponse(event: ServerEvent) {
    if (event.type !== "runtime.rpc.response" || event.command !== "export_html") return;
    if (!event.success) {
      dispatch({ type: "set.operationError", error: event.error ?? "导出 session 失败" });
      return;
    }
    const path = isRecord(event.data) && typeof event.data.path === "string" ? event.data.path : undefined;
    dispatch({ type: "set.notice", notice: path ? `会话已导出到 ${path}` : "会话已导出" });
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
    const parsedBang = parseBangInput(input);
    if (parsedBang) {
      const rpcCommand = bangInputRpcCommand(parsedBang);
      if (!rpcCommand) return notifyCommandError("! 命令需要提供要执行的 shell command");
      return sendNativeRpc(rpcCommand, parsedBang.excludeFromContext ? "!!" : "!", true, bangInputDisplayMessage(input));
    }

    const parsed = parseSlashInput(input);
    if (!parsed) return false;

    const displayMessage = slashDisplayMessageForCommand(input, command?.dynamicCommand?.name ?? parsed.name);
    if (command?.dynamicCommand) {
      const streamingBehavior = runningBusyStreamingBehavior(activeRuntime?.status === "running", activeRuntimeIsBusy);
      return sendRuntimePrompt(slashCommandMessage(command.dynamicCommand.name, parsed.args), streamingBehavior, input, displayMessage);
    }

    return executeNativeCommand(parsed.name, parsed.args, displayMessage);
  }

  function executeNativeCommand(name: string, args: string, displayMessage: string | undefined): boolean {
    const route = routeNativeComposerCommand(name, args, lastAssistantText);
    switch (route.kind) {
      case "error":
        return notifyCommandError(route.message);
      case "openModelPicker":
        setModelPickerOpen(true);
        setPrompt("");
        return true;
      case "openSettings":
        setSettingsOpen(true);
        setPrompt("");
        return true;
      case "openSessionHistory":
        if (!selectedProject) return notifyCommandError("请先选择项目");
        openSessionHistory(selectedProject.id);
        setPrompt("");
        return true;
      case "openSessionTree":
        openSessionTreeForkControls(route.mode);
        setPrompt("");
        return true;
      case "openProviderAuth":
        openProviderAuthPanel(route.action);
        setPrompt("");
        return true;
      case "openScopedModels":
        openScopedModelsPanel();
        setPrompt("");
        return true;
      case "newSession":
        if (activeRuntime?.status === "running") return sendNativeRpc({ type: "new_session" }, "/new", true, displayMessage);
        if (selectedProject) {
          startRuntimeForSidebarProject(selectedProject.id);
          setPrompt("");
          return true;
        }
        return notifyCommandError("请先选择项目");
      case "copyLastAssistant":
        if (!lastAssistantText?.trim()) return notifyCommandError("没有可复制的 assistant 回复");
        void navigator.clipboard.writeText(lastAssistantText).then(
          () => dispatch({ type: "set.notice", notice: "已复制最后一条 assistant 回复" }),
          () => dispatch({ type: "set.operationError", error: "复制失败" }),
        );
        setPrompt("");
        return true;
      case "reload":
        if (activeRuntime?.status === "running") {
          send({ type: "runtime.commands.list", runtimeId: activeRuntime.id });
          sendNativeRpc({ type: "get_state" }, "/reload state", false, displayMessage);
          sendNativeRpc({ type: "get_messages" }, "/reload messages", false);
          setPrompt("");
          return true;
        }
        return sendNativeRpc({ type: "get_state" }, "/reload state", true, displayMessage);
      case "stopRuntime":
        if (!activeRuntime) return notifyCommandError("没有可停止的 runtime");
        if (window.confirm("停止当前 Pi runtime？")) {
          const ok = send({ type: "runtime.stop", runtimeId: activeRuntime.id });
          if (ok) setPrompt("");
          return ok;
        }
        return false;
      case "nativeRpc":
        if (route.confirmMessage && !window.confirm(route.confirmMessage)) return false;
        return sendNativeRpc(route.command, route.label, route.clearPrompt, displayMessage);
      case "runtimePrompt":
        return sendRuntimePrompt(route.message, runningBusyStreamingBehavior(activeRuntime?.status === "running", activeRuntimeIsBusy), route.message, displayMessage);
    }
  }

  function sendNativeRpc(command: PiRpcCommand, label: string, clearPrompt = true, displayMessage?: string): boolean {
    if (activeRuntime?.status === "running" && !activeRuntime.archivedAt) return sendNativeRpcToRuntime(activeRuntime.id, command, label, clearPrompt, displayMessage);
    return launchRuntimeThenSendNativeRpc(command, label, clearPrompt, displayMessage);
  }

  function sendNativeRpcToRuntime(runtimeId: string, command: PiRpcCommand, label: string, clearPrompt: boolean, displayMessage?: string): boolean {
    const ok = send({ type: "runtime.rpc", runtimeId, command, label, displayMessage });
    if (ok) {
      markRuntimeLocalUserActivity(runtimeId);
      if (clearPrompt) setPrompt("");
    }
    return ok;
  }

  function sendRuntimePrompt(message: string, streamingBehavior: "steer" | "followUp" | undefined, input: string, displayMessage?: string): boolean {
    if (activeRuntime?.status === "running" && !activeRuntime.archivedAt) {
      const ok = send({ type: "runtime.prompt", runtimeId: activeRuntime.id, message, streamingBehavior, displayMessage });
      if (ok) {
        markRuntimeLocalUserActivity(activeRuntime.id);
        setPrompt("");
      }
      return ok;
    }
    return launchRuntimeThenSendPrompt(message, streamingBehavior, input, displayMessage);
  }

  function launchRuntimeThenSendNativeRpc(command: PiRpcCommand, label: string, clearPrompt: boolean, displayMessage?: string): boolean {
    const input = clearPrompt ? displayMessage ?? `/${label.replace(/^\//, "")}` : undefined;

    if (activeRuntime?.status === "starting") {
      pendingNativeRpcRef.current = { runtimeId: activeRuntime.id, command, label, clearPrompt, input, displayMessage };
      markRuntimeLocalUserActivity(activeRuntime.id);
      if (clearPrompt) setPrompt("");
      return true;
    }

    if (activeRuntime && !activeRuntime.archivedAt && (activeRuntime.status === "stopped" || activeRuntime.status === "crashed")) {
      const requestId = createRequestId();
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
      pendingNativeRpcRef.current = { requestId, projectId: activeRuntime.projectId, command, label, clearPrompt, input, displayMessage };
      if (clearPrompt) setPrompt("");
      return true;
    }

    if (selectedProject) {
      const requestId = createRequestId();
      const sent = send({
        type: "runtime.start",
        requestId,
        projectId: selectedProject.id,
        model: defaultRuntimeModelKey(),
        thinkingLevel: defaultThinkingLevel,
        responseMode: defaultResponseMode,
      });
      if (!sent) return false;
      pendingNativeRpcRef.current = { requestId, projectId: selectedProject.id, command, label, clearPrompt, input, displayMessage };
      if (clearPrompt) setPrompt("");
      return true;
    }

    return notifyCommandError("需要运行中的 runtime");
  }

  function launchRuntimeThenSendPrompt(message: string, streamingBehavior: "steer" | "followUp" | undefined, input: string, displayMessage?: string): boolean {
    if (activeRuntime?.status === "starting") {
      pendingRuntimePromptRef.current = { runtimeId: activeRuntime.id, message, streamingBehavior, input, displayMessage };
      markRuntimeLocalUserActivity(activeRuntime.id);
      setPrompt("");
      return true;
    }

    if (activeRuntime && !activeRuntime.archivedAt && (activeRuntime.status === "stopped" || activeRuntime.status === "crashed")) {
      const requestId = createRequestId();
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
      pendingRuntimePromptRef.current = { requestId, projectId: activeRuntime.projectId, message, streamingBehavior, input, displayMessage };
      setPrompt("");
      return true;
    }

    if (selectedProject) {
      const requestId = createRequestId();
      const sent = send({
        type: "runtime.start",
        requestId,
        projectId: selectedProject.id,
        model: defaultRuntimeModelKey(),
        thinkingLevel: defaultThinkingLevel,
        responseMode: defaultResponseMode,
      });
      if (!sent) return false;
      pendingRuntimePromptRef.current = { requestId, projectId: selectedProject.id, message, streamingBehavior, input, displayMessage };
      setPrompt("");
      return true;
    }

    return notifyCommandError("需要运行中的 runtime");
  }

  function flushPendingNativeRpc(pending: PendingNativeRpc, runtimeId: string) {
    pendingNativeRpcRef.current = undefined;
    if (send({ type: "runtime.rpc", runtimeId, command: pending.command, label: pending.label, displayMessage: pending.displayMessage })) {
      markRuntimeLocalUserActivity(runtimeId);
    } else {
      restorePrompt(pending.input);
    }
  }

  function flushPendingRuntimePrompt(pending: PendingRuntimePrompt, runtimeId: string) {
    pendingRuntimePromptRef.current = undefined;
    if (send({ type: "runtime.prompt", runtimeId, message: pending.message, streamingBehavior: pending.streamingBehavior, displayMessage: pending.displayMessage })) {
      markRuntimeLocalUserActivity(runtimeId);
    } else {
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


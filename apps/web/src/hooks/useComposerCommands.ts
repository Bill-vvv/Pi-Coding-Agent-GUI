import type { Dispatch } from "react";
import type { PiRpcCommand, Project, Runtime } from "@pi-gui/shared";
import type { ComposerCommandOption } from "../components/Composer";
import type { AppAction } from "../state/appReducer";
import type { GuiSocketSend } from "../types";

type UseComposerCommandsOptions = {
  activeRuntime?: Runtime;
  activeRuntimeIsBusy: boolean;
  selectedProject?: Project;
  lastAssistantText?: string;
  dispatch: Dispatch<AppAction>;
  send: GuiSocketSend;
  setPrompt: (prompt: string) => void;
  setModelPickerOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  openSessionHistory: (projectId: string) => void;
  startRuntimeForSidebarProject: (projectId: string) => void;
};

export function useComposerCommands({
  activeRuntime,
  activeRuntimeIsBusy,
  selectedProject,
  lastAssistantText,
  dispatch,
  send,
  setPrompt,
  setModelPickerOpen,
  setSettingsOpen,
  openSessionHistory,
  startRuntimeForSidebarProject,
}: UseComposerCommandsOptions) {
  function executeCommandInput(input: string, command?: ComposerCommandOption): boolean {
    const parsed = parseSlashInput(input);
    if (!parsed) return false;

    if (command?.dynamicCommand) {
      if (!activeRuntime?.id) return notifyCommandError("需要运行中的 runtime");
      const streamingBehavior = activeRuntimeIsBusy ? "steer" : undefined;
      const ok = send({ type: "runtime.prompt", runtimeId: activeRuntime.id, message: `/${command.dynamicCommand.name}${parsed.args ? ` ${parsed.args}` : ""}`, streamingBehavior });
      if (ok) setPrompt("");
      return ok;
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
        }
        setPrompt("");
        return true;
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
        if (!activeRuntime?.id) return notifyCommandError("需要运行中的 runtime");
        return send({ type: "runtime.prompt", runtimeId: activeRuntime.id, message: `/${name}${args ? ` ${args}` : ""}`, streamingBehavior: activeRuntimeIsBusy ? "steer" : undefined });
    }
  }

  function sendNativeRpc(command: PiRpcCommand, label: string, clearPrompt = true): boolean {
    if (!activeRuntime?.id || activeRuntime.status !== "running") return notifyCommandError("需要运行中的 runtime");
    const ok = send({ type: "runtime.rpc", runtimeId: activeRuntime.id, command, label });
    if (ok && clearPrompt) setPrompt("");
    return ok;
  }

  function notifyCommandError(message: string): false {
    dispatch({ type: "set.operationError", error: message });
    return false;
  }

  return { executeCommandInput };
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

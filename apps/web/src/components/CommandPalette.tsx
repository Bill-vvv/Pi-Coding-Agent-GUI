import { useEffect, useMemo, useState } from "react";
import type { PiRpcCommand, Runtime, SlashCommand } from "@pi-gui/shared";
import type { ConnectionState } from "../types";

type NativeCommandId =
  | "login"
  | "logout"
  | "model"
  | "scoped-models"
  | "settings"
  | "resume"
  | "new"
  | "name"
  | "session"
  | "tree"
  | "fork"
  | "clone"
  | "compact"
  | "copy"
  | "export"
  | "share"
  | "reload"
  | "hotkeys"
  | "changelog"
  | "quit"
  | "bash";

type CommandAction = {
  id: string;
  title: string;
  description: string;
  group: string;
  keywords?: string;
  source?: SlashCommand["source"] | "gui";
  argLabel?: string;
  argPlaceholder?: string;
  argRequired?: boolean;
  disabledReason?: string;
  run: (arg: string) => void;
};

type CommandPaletteProps = {
  open: boolean;
  connection: ConnectionState;
  activeRuntime?: Runtime;
  activeRuntimeIsBusy: boolean;
  slashCommands: SlashCommand[];
  lastAssistantText?: string;
  onClose: () => void;
  onSetPrompt: (prompt: string) => void;
  onOpenModelPicker: () => void;
  onOpenSettings: () => void;
  onOpenSessionHistory: () => void;
  onStartNewRuntime: () => void;
  onRefreshCommands: () => void;
  onSendPrompt: (message: string, streamingBehavior?: "steer" | "followUp") => boolean;
  onSendRpc: (command: PiRpcCommand, label?: string) => boolean;
  onStopRuntime: () => void;
  onNotify: (message: string) => void;
};

const NATIVE_COMMANDS: Array<{ id: NativeCommandId; title: string; description: string; argLabel?: string; argPlaceholder?: string; argRequired?: boolean }> = [
  { id: "login", title: "/login", description: "管理 OAuth 或 API key 凭据" },
  { id: "logout", title: "/logout", description: "退出 provider 登录状态" },
  { id: "model", title: "/model", description: "打开原生模型选择器" },
  { id: "scoped-models", title: "/scoped-models", description: "管理 Ctrl+P 模型循环范围" },
  { id: "settings", title: "/settings", description: "打开 GUI 设置" },
  { id: "resume", title: "/resume", description: "打开会话历史并恢复 Pi session" },
  { id: "new", title: "/new", description: "在当前 runtime 中创建新的 Pi session" },
  { id: "name", title: "/name", description: "设置当前会话显示名称", argLabel: "会话名称", argPlaceholder: "my-feature-work", argRequired: true },
  { id: "session", title: "/session", description: "显示当前会话统计信息" },
  { id: "tree", title: "/tree", description: "会话树 / 跳转到历史节点" },
  { id: "fork", title: "/fork", description: "从指定 user message entry 创建 fork", argLabel: "Entry ID", argPlaceholder: "从后续 session tree UI 选择；也可粘贴 entryId", argRequired: true },
  { id: "clone", title: "/clone", description: "复制当前活动分支到新 session" },
  { id: "compact", title: "/compact", description: "手动压缩当前会话上下文", argLabel: "压缩说明（可选）", argPlaceholder: "Focus on code changes" },
  { id: "copy", title: "/copy", description: "复制最后一条 assistant 回复" },
  { id: "export", title: "/export", description: "导出当前会话为 HTML", argLabel: "输出路径（可选）", argPlaceholder: "/tmp/session.html" },
  { id: "share", title: "/share", description: "上传为私有 GitHub gist 并生成分享链接" },
  { id: "reload", title: "/reload", description: "刷新命令列表、会话状态和消息" },
  { id: "hotkeys", title: "/hotkeys", description: "显示 GUI 快捷键" },
  { id: "changelog", title: "/changelog", description: "显示版本历史" },
  { id: "quit", title: "/quit", description: "停止当前 Pi runtime" },
  { id: "bash", title: "! bash", description: "执行 shell 命令并把输出加入下一轮上下文", argLabel: "Shell 命令", argPlaceholder: "npm test", argRequired: true },
];

export function CommandPalette({
  open,
  connection,
  activeRuntime,
  activeRuntimeIsBusy,
  slashCommands,
  lastAssistantText,
  onClose,
  onSetPrompt,
  onOpenModelPicker,
  onOpenSettings,
  onOpenSessionHistory,
  onStartNewRuntime,
  onRefreshCommands,
  onSendPrompt,
  onSendRpc,
  onStopRuntime,
  onNotify,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [arg, setArg] = useState("");

  const actions = useMemo(() => {
    const nativeActions = NATIVE_COMMANDS.map((command): CommandAction => ({
      ...command,
      id: `native:${command.id}`,
      group: "Pi built-in / GUI native",
      source: "gui",
      disabledReason: disabledReasonForNative(command.id, activeRuntime, connection),
      run: (value) => runNativeCommand(command.id, value),
    }));

    const dynamicActions = slashCommands.map((command): CommandAction => ({
      id: `${command.source}:${command.name}:${command.path ?? ""}`,
      title: `/${command.name}`,
      description: command.description ?? sourceLabel(command.source),
      group: sourceGroup(command.source),
      source: command.source,
      keywords: `${command.name} ${command.description ?? ""} ${command.location ?? ""} ${command.path ?? ""}`,
      argLabel: "参数（可选）",
      argPlaceholder: `传给 /${command.name} 的参数`,
      disabledReason: !activeRuntime || activeRuntime.status !== "running" ? "需要运行中的 runtime" : connection !== "open" ? "WebSocket 未连接" : undefined,
      run: (value) => {
        const message = `/${command.name}${value.trim() ? ` ${value.trim()}` : ""}`;
        const streamingBehavior = activeRuntimeIsBusy ? "steer" : undefined;
        if (onSendPrompt(message, streamingBehavior)) onClose();
      },
    }));

    return [...nativeActions, ...dynamicActions];
  }, [activeRuntime, activeRuntimeIsBusy, connection, onClose, onSendPrompt, slashCommands]);

  const filteredActions = useMemo(() => {
    const normalized = query.trim().replace(/^\//, "").toLowerCase();
    if (!normalized) return actions;
    return actions.filter((action) => `${action.title} ${action.description} ${action.keywords ?? ""}`.toLowerCase().includes(normalized));
  }, [actions, query]);
  const selectedAction = filteredActions[Math.min(selectedIndex, Math.max(0, filteredActions.length - 1))];

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    setArg("");
  }, [open]);

  if (!open) return null;

  function runSelected() {
    if (!selectedAction || selectedAction.disabledReason) return;
    if (selectedAction.argRequired && !arg.trim()) {
      onNotify(`请输入${selectedAction.argLabel ?? "参数"}`);
      return;
    }
    selectedAction.run(arg);
    setArg("");
  }

  function runNativeCommand(id: NativeCommandId, value: string) {
    switch (id) {
      case "login":
      case "logout":
        onNotify("GUI 原生登录/退出还未接入 Pi provider auth；请暂时在终端使用 pi 交互模式完成。此命令已保留在原生命令面板中。" );
        return;
      case "model":
        onOpenModelPicker();
        onClose();
        return;
      case "scoped-models":
        onNotify("Scoped models 的 GUI 管理界面尚未实现；当前可通过模型选择器直接选择模型。" );
        return;
      case "settings":
        onOpenSettings();
        onClose();
        return;
      case "resume":
        onOpenSessionHistory();
        onClose();
        return;
      case "new":
        if (activeRuntime?.status === "running") onSendRpc({ type: "new_session" }, "/new");
        else onStartNewRuntime();
        onClose();
        return;
      case "name":
        if (onSendRpc({ type: "set_session_name", name: value.trim() }, "/name")) onClose();
        return;
      case "session":
        if (onSendRpc({ type: "get_session_stats" }, "/session")) onClose();
        return;
      case "tree":
        onNotify("Session tree 原生视图尚未实现；可先通过会话历史恢复已有 session。" );
        return;
      case "fork":
        if (onSendRpc({ type: "fork", entryId: value.trim() }, "/fork")) onClose();
        return;
      case "clone":
        if (window.confirm("复制当前活动分支到新 session？") && onSendRpc({ type: "clone" }, "/clone")) onClose();
        return;
      case "compact": {
        const customInstructions = value.trim();
        if (onSendRpc(customInstructions ? { type: "compact", customInstructions } : { type: "compact" }, "/compact")) onClose();
        return;
      }
      case "copy":
        if (!lastAssistantText?.trim()) {
          onNotify("没有可复制的 assistant 回复");
          return;
        }
        void navigator.clipboard.writeText(lastAssistantText).then(() => onNotify("已复制最后一条 assistant 回复"), () => onNotify("复制失败"));
        onClose();
        return;
      case "export": {
        const outputPath = value.trim();
        if (onSendRpc(outputPath ? { type: "export_html", outputPath } : { type: "export_html" }, "/export")) onClose();
        return;
      }
      case "share":
        onNotify("/share 尚未在 RPC 中暴露；GUI 暂不能直接上传 gist。" );
        return;
      case "reload":
        onRefreshCommands();
        if (activeRuntime?.status === "running") {
          onSendRpc({ type: "get_state" }, "/reload state");
          onSendRpc({ type: "get_messages" }, "/reload messages");
        }
        onClose();
        return;
      case "hotkeys":
        onNotify("快捷键：Ctrl/Cmd+K 打开命令面板；Enter 发送；Shift+Enter 换行；运行中 Enter=steer，Alt+Enter=follow-up。" );
        return;
      case "changelog":
        onNotify("Changelog 原生视图尚未实现。" );
        return;
      case "quit":
        if (window.confirm("停止当前 Pi runtime？")) onStopRuntime();
        onClose();
        return;
      case "bash":
        if (onSendRpc({ type: "bash", command: value }, "! bash")) onClose();
        return;
    }
  }

  return (
    <div className="command-palette-backdrop" onMouseDown={onClose}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Pi command palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-palette-header">
          <input
            autoFocus
            value={query}
            placeholder="搜索 Pi 命令、prompt、skill、extension…"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((index) => Math.min(index + 1, Math.max(0, filteredActions.length - 1)));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((index) => Math.max(index - 1, 0));
              }
              if (event.key === "Enter" && !selectedAction?.argLabel) {
                event.preventDefault();
                runSelected();
              }
            }}
          />
          <span>⌘K</span>
        </div>

        <div className="command-palette-body">
          <div className="command-palette-list" role="listbox">
            {filteredActions.map((action, index) => (
              <button
                key={action.id}
                type="button"
                className={`command-palette-item ${index === selectedIndex ? "is-active" : ""}`}
                aria-selected={index === selectedIndex}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  setSelectedIndex(index);
                  if (!action.argLabel) action.run("");
                }}
              >
                <span className="command-palette-title">{action.title}</span>
                <span className="command-palette-description">{action.disabledReason ?? action.description}</span>
                <span className={`command-palette-source source-${action.source ?? "gui"}`}>{action.group}</span>
              </button>
            ))}
          </div>

          <aside className="command-palette-detail">
            {selectedAction ? (
              <>
                <div className="command-palette-detail-title">{selectedAction.title}</div>
                <p>{selectedAction.description}</p>
                {selectedAction.disabledReason ? <p className="command-palette-warning">{selectedAction.disabledReason}</p> : null}
                {selectedAction.argLabel ? (
                  <label className="command-palette-arg">
                    <span>{selectedAction.argLabel}</span>
                    <textarea
                      value={arg}
                      placeholder={selectedAction.argPlaceholder}
                      onChange={(event) => setArg(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault();
                          runSelected();
                        }
                      }}
                    />
                  </label>
                ) : null}
                <button type="button" className="command-palette-run" disabled={Boolean(selectedAction.disabledReason)} onClick={runSelected}>
                  {selectedAction.argLabel ? "执行（Ctrl/⌘+Enter）" : "执行"}
                </button>
              </>
            ) : (
              <p>没有匹配的命令</p>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}

function disabledReasonForNative(id: NativeCommandId, runtime: Runtime | undefined, connection: ConnectionState): string | undefined {
  if (["model", "settings", "resume", "hotkeys", "changelog", "login", "logout", "scoped-models", "share", "tree"].includes(id)) return undefined;
  if (id === "copy") return undefined;
  if (connection !== "open") return "WebSocket 未连接";
  if (id === "new") return undefined;
  if (!runtime || runtime.status !== "running") return "需要运行中的 runtime";
  return undefined;
}

function sourceLabel(source: SlashCommand["source"]): string {
  switch (source) {
    case "extension":
      return "Extension command";
    case "prompt":
      return "Prompt template";
    case "skill":
      return "Skill command";
    case "builtin":
      return "Built-in command";
  }
}

function sourceGroup(source: SlashCommand["source"]): string {
  switch (source) {
    case "extension":
      return "Extensions";
    case "prompt":
      return "Prompt templates";
    case "skill":
      return "Skills";
    case "builtin":
      return "Built-in";
  }
}

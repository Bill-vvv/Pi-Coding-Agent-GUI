import type { PiRpcCommand } from "@pi-gui/shared";
import { slashCommandMessage } from "./parseSlashCommand";

export type ComposerCommandRoute =
  | { kind: "error"; message: string }
  | { kind: "openModelPicker" }
  | { kind: "openSettings" }
  | { kind: "openSessionHistory" }
  | { kind: "openSessionTree"; mode: "fork" | "tree" }
  | { kind: "openProviderAuth"; action: "login" | "logout" }
  | { kind: "openScopedModels" }
  | { kind: "newSession" }
  | { kind: "copyLastAssistant" }
  | { kind: "reload" }
  | { kind: "stopRuntime" }
  | { kind: "nativeRpc"; command: PiRpcCommand; label: string; clearPrompt: boolean; confirmMessage?: string }
  | { kind: "runtimePrompt"; message: string };

export type GuiHotkeyItem = {
  keys: string[];
  description: string;
};

export type GuiHotkeySection = {
  title: string;
  items: GuiHotkeyItem[];
};

export const GUI_HOTKEY_SECTIONS: GuiHotkeySection[] = [
  {
    title: "全局",
    items: [
      { keys: ["Esc"], description: "关闭弹层/正在输出时中止本轮输出" },
      { keys: ["Ctrl/Cmd+K"], description: "打开命令栏" },
      { keys: ["Ctrl/Cmd+,"], description: "打开设置" },
    ],
  },
  {
    title: "输入框",
    items: [
      { keys: ["/（空输入）"], description: "打开命令栏" },
      { keys: ["Enter"], description: "发送/执行" },
      { keys: ["Shift+Enter"], description: "换行" },
      { keys: ["Alt+Enter"], description: "Follow up" },
      { keys: ["Alt+↑"], description: "取回排队消息" },
    ],
  },
  {
    title: "命令补全",
    items: [
      { keys: ["↑", "↓"], description: "选择" },
      { keys: ["Tab"], description: "补全" },
      { keys: ["Esc"], description: "关闭补全" },
    ],
  },
];

export function guiHotkeysHelpMessage(): string {
  const entries = GUI_HOTKEY_SECTIONS.flatMap((section) => section.items.map((item) => `${item.keys.join("/")} ${item.description}`));
  return `快捷键：${entries.join("；")}。`;
}

export function routeNativeComposerCommand(name: string, args: string, lastAssistantText?: string): ComposerCommandRoute {
  switch (name) {
    case "login":
      return { kind: "openProviderAuth", action: "login" };
    case "logout":
      return { kind: "openProviderAuth", action: "logout" };
    case "model":
      return { kind: "openModelPicker" };
    case "scoped-models":
      return { kind: "openScopedModels" };
    case "settings":
      return { kind: "openSettings" };
    case "goal":
      return { kind: "runtimePrompt", message: slashCommandMessage(name, args) };
    case "resume":
      return { kind: "openSessionHistory" };
    case "new":
      return { kind: "newSession" };
    case "name":
      if (!args) return { kind: "error", message: "/name 需要会话名称" };
      return { kind: "nativeRpc", command: { type: "set_session_name", name: args }, label: "/name", clearPrompt: true };
    case "session":
      return { kind: "nativeRpc", command: { type: "get_session_stats" }, label: "/session", clearPrompt: true };
    case "tree":
      return { kind: "openSessionTree", mode: "tree" };
    case "fork":
      if (!args) return { kind: "openSessionTree", mode: "fork" };
      return { kind: "nativeRpc", command: { type: "fork", entryId: args }, label: "/fork", clearPrompt: true };
    case "clone":
      return { kind: "nativeRpc", command: { type: "clone" }, label: "/clone", clearPrompt: true, confirmMessage: "复制当前活动分支到新 session？" };
    case "compact":
      return { kind: "nativeRpc", command: args ? { type: "compact", customInstructions: args } : { type: "compact" }, label: "/compact", clearPrompt: true };
    case "copy":
      if (!lastAssistantText?.trim()) return { kind: "error", message: "没有可复制的 assistant 回复" };
      return { kind: "copyLastAssistant" };
    case "export":
      return { kind: "nativeRpc", command: args ? { type: "export_html", outputPath: args } : { type: "export_html" }, label: "/export", clearPrompt: true };
    case "share":
      return { kind: "error", message: "/share 尚未在 RPC 中暴露；GUI 暂不能直接上传 gist。" };
    case "reload":
      return { kind: "reload" };
    case "hotkeys":
      return { kind: "error", message: guiHotkeysHelpMessage() };
    case "changelog":
      return { kind: "error", message: "Changelog 原生视图尚未实现。" };
    case "quit":
      return { kind: "stopRuntime" };
    default:
      return { kind: "runtimePrompt", message: slashCommandMessage(name, args) };
  }
}

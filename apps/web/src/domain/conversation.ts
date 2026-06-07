import type { ConversationMessage } from "../types";

export function messageRoleLabel(role: ConversationMessage["role"]): string {
  if (role === "user") return "你";
  if (role === "assistant") return "Pi";
  if (role === "tool") return "工具";
  if (role === "log") return "日志";
  return "错误";
}


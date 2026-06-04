import type { GuiSession, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";

export function sidebarSessionTitle(runtime: Runtime, summary: RuntimeConversationSummary | undefined, session: GuiSession | undefined): string {
  if (summary?.title) return summary.title;
  if (session?.title) return session.title;
  if (session) return `历史对话 ${session.id.slice(0, 8)}`;
  if (runtime.sessionId) return `对话 ${runtime.sessionId.slice(0, 8)}`;
  if (runtime.status === "running" || runtime.status === "starting") return "新对话";
  return `对话 ${runtime.id.slice(0, 8)}`;
}

export function sidebarSessionDetail(runtime: Runtime, summary: RuntimeConversationSummary | undefined, session: GuiSession | undefined): string | undefined {
  if (summary?.detail) return summary.detail;
  if (summary?.messageCount) return `${summary.messageCount} 条消息`;
  if (session) return formatSidebarSessionDate(session.updatedAt);
  if (runtime.sessionId) return `Session ${runtime.sessionId.slice(0, 8)}`;
  return undefined;
}

function formatSidebarSessionDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  } catch {
    return "未知时间";
  }
}

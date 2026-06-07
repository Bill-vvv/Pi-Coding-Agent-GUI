import type { ExtensionUiRequest, Project, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";

export const PI_READY_FOR_INPUT_NOTIFICATION = "Pi is ready for input";
const PI_READY_FOR_INPUT_LABEL = "Pi 已可继续输入";

type NotifyRequest = Extract<ExtensionUiRequest, { method: "notify" }>;

export type DesktopNotificationPresentation = {
  title: string;
  body: string;
  tag: string;
  target: {
    projectId: string;
    runtimeId: string;
  };
};

export type DesktopNotificationContext = {
  runtimeId: string;
  projectId: string;
  request: NotifyRequest;
  projects: Project[];
  runtimes: Runtime[];
  conversationSummaries: Record<string, RuntimeConversationSummary>;
};

export type DesktopNotificationInterruptionContext = {
  visibilityState?: DocumentVisibilityState;
  hidden?: boolean;
  hasFocus?: boolean;
  activeProjectId?: string;
  activeRuntimeId?: string;
  targetProjectId: string;
  targetRuntimeId: string;
};

export function isPiReadyForInputNotification(request: NotifyRequest): boolean {
  return request.message.trim() === PI_READY_FOR_INPUT_NOTIFICATION;
}

export function shouldInterruptWithDesktopNotification({
  visibilityState,
  hidden,
  hasFocus,
  activeProjectId,
  activeRuntimeId,
  targetProjectId,
  targetRuntimeId,
}: DesktopNotificationInterruptionContext): boolean {
  if (hidden === true) return true;
  if (visibilityState && visibilityState !== "visible") return true;
  if (hasFocus === false) return true;
  if (activeProjectId !== targetProjectId) return true;
  if (activeRuntimeId !== targetRuntimeId) return true;
  return false;
}

export function desktopNotificationPresentation({
  runtimeId,
  projectId,
  request,
  projects,
  runtimes,
  conversationSummaries,
}: DesktopNotificationContext): DesktopNotificationPresentation | undefined {
  if (!isPiReadyForInputNotification(request)) return undefined;

  const project = projects.find((item) => item.id === projectId);
  const runtime = runtimes.find((item) => item.id === runtimeId);
  const summary = conversationSummaries[runtimeId];
  const title = project ? `${PI_READY_FOR_INPUT_LABEL} · ${project.name}` : PI_READY_FOR_INPUT_LABEL;
  const body = [summary?.title ?? (runtime ? `对话 ${runtime.id.slice(0, 8)}` : undefined), PI_READY_FOR_INPUT_LABEL].filter(Boolean).join("\n");

  return {
    title,
    body,
    tag: `pi-gui-ready-${runtimeId}`,
    target: { projectId, runtimeId },
  };
}

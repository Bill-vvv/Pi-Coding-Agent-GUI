import { useCallback } from "react";
import type { ExtensionUiRequest, Project, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";
import { showBrowserNotification } from "../domain/browserNotifications";
import { desktopNotificationPresentation, shouldInterruptWithDesktopNotification } from "../domain/extensionNotifications";
import type { UiPreferences } from "../types";

type ReadyDesktopNotificationContext = {
  uiPreferences: UiPreferences;
  projects: Project[];
  runtimes: Runtime[];
  conversationSummaries: Record<string, RuntimeConversationSummary>;
  activeProjectId?: string;
  activeRuntimeId?: string;
  onOpenNotificationTarget: (projectId: string, runtimeId: string) => void;
};

type ReadyDesktopNotificationRequest = {
  runtimeId: string;
  projectId: string;
  request: Extract<ExtensionUiRequest, { method: "notify" }>;
};

export function useReadyDesktopNotifications({
  uiPreferences,
  projects,
  runtimes,
  conversationSummaries,
  activeProjectId,
  activeRuntimeId,
  onOpenNotificationTarget,
}: ReadyDesktopNotificationContext) {
  const maybeShowReadyDesktopNotification = useCallback(({
    runtimeId,
    projectId,
    request,
  }: ReadyDesktopNotificationRequest): void => {
    if (!uiPreferences.desktopNotificationsEnabled) return;

    const presentation = desktopNotificationPresentation({ runtimeId, projectId, request, projects, runtimes, conversationSummaries });
    if (!presentation) return;

    if (!shouldInterruptWithDesktopNotification({
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : undefined,
      activeProjectId,
      activeRuntimeId,
      targetProjectId: projectId,
      targetRuntimeId: runtimeId,
    })) return;

    showBrowserNotification(presentation.title, {
      body: presentation.body,
      tag: presentation.tag,
      onClick: () => onOpenNotificationTarget(presentation.target.projectId, presentation.target.runtimeId),
    });
  }, [activeProjectId, activeRuntimeId, conversationSummaries, onOpenNotificationTarget, projects, runtimes, uiPreferences.desktopNotificationsEnabled]);

  return { maybeShowReadyDesktopNotification };
}

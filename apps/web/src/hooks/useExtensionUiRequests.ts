import { useState } from "react";
import type { ExtensionUiRequest, ExtensionUiResponse, Project, Runtime, RuntimeConversationSummary, ServerEvent } from "@pi-gui/shared";
import { showBrowserNotification } from "../domain/browserNotifications";
import { desktopNotificationPresentation, shouldInterruptWithDesktopNotification } from "../domain/extensionNotifications";
import type { GuiSocketSend, UiPreferences } from "../types";

type UseExtensionUiRequestsOptions = {
  send: GuiSocketSend;
  setPrompt: (prompt: string) => void;
  uiPreferences: UiPreferences;
  projects: Project[];
  runtimes: Runtime[];
  conversationSummaries: Record<string, RuntimeConversationSummary>;
  activeProjectId?: string;
  activeRuntimeId?: string;
  onOpenNotificationTarget: (projectId: string, runtimeId: string) => void;
};

export function useExtensionUiRequests({ send, setPrompt, uiPreferences, projects, runtimes, conversationSummaries, activeProjectId, activeRuntimeId, onOpenNotificationTarget }: UseExtensionUiRequestsOptions) {
  const [extensionUiDialog, setExtensionUiDialog] = useState<{ runtimeId: string; request: ExtensionUiRequest } | undefined>();

  function handleExtensionUiServerEvent(event: ServerEvent) {
    if (event.type !== "extension.ui.request") return;
    handleExtensionUiRequest(event.runtimeId, event.projectId, event.request);
  }

  function handleExtensionUiRequest(runtimeId: string, projectId: string, request: ExtensionUiRequest) {
    switch (request.method) {
      case "notify":
        maybeShowDesktopNotification({ runtimeId, projectId, request, uiPreferences, projects, runtimes, conversationSummaries, activeProjectId, activeRuntimeId, onOpenNotificationTarget });
        return;
      case "set_editor_text":
        setPrompt(request.text);
        return;
      case "setTitle":
        document.title = request.title || "Pi GUI";
        return;
      case "setStatus":
      case "setWidget":
        return;
      default:
        setExtensionUiDialog({ runtimeId, request });
        return;
    }
  }

  function sendExtensionUiResponse(response: ExtensionUiResponse) {
    if (!extensionUiDialog) return;
    send({ type: "extension.ui.respond", runtimeId: extensionUiDialog.runtimeId, responseId: extensionUiDialog.request.id, response });
    setExtensionUiDialog(undefined);
  }

  return {
    extensionUiDialog,
    handleExtensionUiServerEvent,
    sendExtensionUiResponse,
  };
}

type DesktopNotificationOptions = {
  runtimeId: string;
  projectId: string;
  request: Extract<ExtensionUiRequest, { method: "notify" }>;
  uiPreferences: UiPreferences;
  projects: Project[];
  runtimes: Runtime[];
  conversationSummaries: Record<string, RuntimeConversationSummary>;
  activeProjectId?: string;
  activeRuntimeId?: string;
  onOpenNotificationTarget: (projectId: string, runtimeId: string) => void;
};

function maybeShowDesktopNotification({ runtimeId, projectId, request, uiPreferences, projects, runtimes, conversationSummaries, activeProjectId, activeRuntimeId, onOpenNotificationTarget }: DesktopNotificationOptions) {
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
}



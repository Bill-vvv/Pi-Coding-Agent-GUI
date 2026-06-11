import { useState } from "react";
import type { ExtensionUiRequest, ExtensionUiResponse, Project, Runtime, RuntimeConversationSummary, ServerEvent } from "@pi-gui/shared";
import type { GuiSocketSend, UiPreferences } from "../types";
import { useReadyDesktopNotifications } from "./useReadyDesktopNotifications";

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
  const { maybeShowReadyDesktopNotification } = useReadyDesktopNotifications({
    uiPreferences,
    projects,
    runtimes,
    conversationSummaries,
    activeProjectId,
    activeRuntimeId,
    onOpenNotificationTarget,
  });

  function handleExtensionUiServerEvent(event: ServerEvent) {
    if (event.type === "runtime.status") {
      if (extensionUiDialog?.runtimeId === event.runtime.id && event.runtime.status !== "running" && event.runtime.status !== "starting") {
        setExtensionUiDialog(undefined);
      }
      return;
    }
    if (event.type !== "extension.ui.request") return;
    handleExtensionUiRequest(event.runtimeId, event.projectId, event.request);
  }

  function handleExtensionUiRequest(runtimeId: string, projectId: string, request: ExtensionUiRequest) {
    switch (request.method) {
      case "notify":
        maybeShowReadyDesktopNotification({ runtimeId, projectId, request });
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
    const sent = send({ type: "extension.ui.respond", runtimeId: extensionUiDialog.runtimeId, responseId: extensionUiDialog.request.id, response });
    if (sent) setExtensionUiDialog(undefined);
  }

  return {
    extensionUiDialog,
    handleExtensionUiServerEvent,
    sendExtensionUiResponse,
  };
}



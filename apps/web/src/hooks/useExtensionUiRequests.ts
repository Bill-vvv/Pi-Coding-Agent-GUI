import { useState, type Dispatch } from "react";
import type { ExtensionUiRequest, ExtensionUiResponse, Project, Runtime, RuntimeConversationSummary, ServerEvent } from "@pi-gui/shared";
import { showBrowserNotification } from "../domain/browserNotifications";
import type { AppAction } from "../state/appReducer";
import type { GuiSocketSend, UiPreferences } from "../types";

type UseExtensionUiRequestsOptions = {
  dispatch: Dispatch<AppAction>;
  send: GuiSocketSend;
  setPrompt: (prompt: string) => void;
  uiPreferences: UiPreferences;
  projects: Project[];
  runtimes: Runtime[];
  activeRuntime?: Runtime;
  conversationSummaries: Record<string, RuntimeConversationSummary>;
};

export function useExtensionUiRequests({ dispatch, send, setPrompt, uiPreferences, projects, runtimes, activeRuntime, conversationSummaries }: UseExtensionUiRequestsOptions) {
  const [extensionUiDialog, setExtensionUiDialog] = useState<{ runtimeId: string; request: ExtensionUiRequest } | undefined>();

  function handleExtensionUiServerEvent(event: ServerEvent) {
    if (event.type !== "extension.ui.request") return;
    handleExtensionUiRequest(event.runtimeId, event.projectId, event.request);
  }

  function handleExtensionUiRequest(runtimeId: string, projectId: string, request: ExtensionUiRequest) {
    switch (request.method) {
      case "notify": {
        const noticeMessage = formatNotificationMessage(request.message, runtimeId, projectId, activeRuntime?.id, projects, runtimes, conversationSummaries);
        if (request.notifyType === "error") dispatch({ type: "set.operationError", error: noticeMessage });
        else dispatch({ type: "set.notice", notice: noticeMessage });
        maybeShowDesktopNotification({ runtimeId, projectId, request, uiPreferences, activeRuntime, projects, runtimes, conversationSummaries });
        return;
      }
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
  activeRuntime?: Runtime;
  projects: Project[];
  runtimes: Runtime[];
  conversationSummaries: Record<string, RuntimeConversationSummary>;
};

function maybeShowDesktopNotification({ runtimeId, projectId, request, uiPreferences, activeRuntime, projects, runtimes, conversationSummaries }: DesktopNotificationOptions) {
  if (!uiPreferences.desktopNotificationsEnabled) return;
  if (!shouldInterruptWithDesktopNotification(runtimeId, activeRuntime?.id)) return;

  const project = projects.find((item) => item.id === projectId);
  const runtime = runtimes.find((item) => item.id === runtimeId);
  const summary = conversationSummaries[runtimeId];
  const title = project ? `Pi 已完成 · ${project.name}` : "Pi 已完成";
  const body = [summary?.title ?? (runtime ? `对话 ${runtime.id.slice(0, 8)}` : undefined), request.message].filter(Boolean).join("\n");

  showBrowserNotification(title, {
    body,
    tag: `pi-gui-ready-${runtimeId}`,
  });
}

function shouldInterruptWithDesktopNotification(runtimeId: string, activeRuntimeId?: string): boolean {
  return document.hidden || !document.hasFocus() || runtimeId !== activeRuntimeId;
}

function formatNotificationMessage(
  message: string,
  runtimeId: string,
  projectId: string,
  activeRuntimeId: string | undefined,
  projects: Project[],
  runtimes: Runtime[],
  conversationSummaries: Record<string, RuntimeConversationSummary>,
): string {
  if (runtimeId === activeRuntimeId) return message;

  const project = projects.find((item) => item.id === projectId);
  const runtime = runtimes.find((item) => item.id === runtimeId);
  const summary = conversationSummaries[runtimeId];
  const label = summary?.title ?? project?.name ?? (runtime ? `对话 ${runtime.id.slice(0, 8)}` : undefined);
  return label ? `${label}: ${message}` : message;
}

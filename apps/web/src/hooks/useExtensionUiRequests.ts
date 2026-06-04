import { useState, type Dispatch } from "react";
import type { ClientCommand, ExtensionUiRequest, ExtensionUiResponse, ServerEvent } from "@pi-gui/shared";
import type { AppAction } from "../state/appReducer";

type UseExtensionUiRequestsOptions = {
  dispatch: Dispatch<AppAction>;
  send: (command: ClientCommand) => boolean;
  setPrompt: (prompt: string) => void;
};

export function useExtensionUiRequests({ dispatch, send, setPrompt }: UseExtensionUiRequestsOptions) {
  const [extensionUiDialog, setExtensionUiDialog] = useState<{ runtimeId: string; request: ExtensionUiRequest } | undefined>();

  function handleExtensionUiServerEvent(event: ServerEvent) {
    if (event.type !== "extension.ui.request") return;
    handleExtensionUiRequest(event.runtimeId, event.request);
  }

  function handleExtensionUiRequest(runtimeId: string, request: ExtensionUiRequest) {
    switch (request.method) {
      case "notify":
        dispatch({ type: "set.lastError", error: request.message });
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

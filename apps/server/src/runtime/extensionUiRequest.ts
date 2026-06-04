import type { ExtensionUiRequest } from "@pi-gui/shared";

export function isExtensionUiRequest(value: Record<string, unknown> | undefined): value is ExtensionUiRequest {
  if (!value || value.type !== "extension_ui_request" || typeof value.id !== "string" || typeof value.method !== "string") return false;
  switch (value.method) {
    case "select":
      return typeof value.title === "string" && Array.isArray(value.options) && value.options.every((option) => typeof option === "string");
    case "confirm":
      return typeof value.title === "string" && typeof value.message === "string";
    case "input":
      return typeof value.title === "string";
    case "editor":
      return typeof value.title === "string";
    case "notify":
      return typeof value.message === "string";
    case "setStatus":
      return typeof value.statusKey === "string";
    case "setWidget":
      return typeof value.widgetKey === "string";
    case "setTitle":
      return typeof value.title === "string";
    case "set_editor_text":
      return typeof value.text === "string";
    default:
      return false;
  }
}

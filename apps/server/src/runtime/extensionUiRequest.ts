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
    case "askBatch":
      return isAskBatchRequest(value);
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

export function isExtensionUiDialogRequest(request: ExtensionUiRequest): boolean {
  return request.method === "select" || request.method === "confirm" || request.method === "input" || request.method === "editor" || request.method === "askBatch";
}

function isAskBatchRequest(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.questions) || value.questions.length === 0) return false;
  if (value.title !== undefined && typeof value.title !== "string") return false;
  if (value.context !== undefined && typeof value.context !== "string") return false;
  if (value.submitPolicy !== undefined && value.submitPolicy !== "require_all" && value.submitPolicy !== "allow_partial") return false;
  return value.questions.every(isAskBatchQuestion);
}

function isAskBatchQuestion(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.prompt !== "string") return false;
  if (value.label !== undefined && typeof value.label !== "string") return false;
  if (value.situation !== undefined && typeof value.situation !== "string") return false;
  if (value.suggestion !== undefined && typeof value.suggestion !== "string") return false;
  if (value.kind !== undefined && !["single", "multi", "confirm", "text"].includes(String(value.kind))) return false;
  if (value.allowOther !== undefined && typeof value.allowOther !== "boolean") return false;
  if (value.required !== undefined && typeof value.required !== "boolean") return false;
  if (value.defaultValue !== undefined && typeof value.defaultValue !== "string" && typeof value.defaultValue !== "boolean" && !Array.isArray(value.defaultValue)) return false;
  if (Array.isArray(value.defaultValue) && !value.defaultValue.every((item) => typeof item === "string")) return false;
  if (value.options === undefined) return true;
  return Array.isArray(value.options) && value.options.every(isAskBatchOption);
}

function isAskBatchOption(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.value === "string" && typeof value.label === "string" && (value.description === undefined || typeof value.description === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

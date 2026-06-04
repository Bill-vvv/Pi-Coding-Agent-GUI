import type { ExtensionUiRequest } from "@pi-gui/shared";

export type ExtensionUiWidgetPlacement = "aboveEditor" | "belowEditor";

export type ExtensionUiWidget = {
  lines: string[];
  placement: ExtensionUiWidgetPlacement;
};

export type RuntimeExtensionUiChrome = {
  statuses: Record<string, string>;
  widgets: Record<string, ExtensionUiWidget>;
};

export type ExtensionUiChromeByRuntime = Record<string, RuntimeExtensionUiChrome>;

export function applyExtensionUiChromeRequest(
  chromeByRuntime: ExtensionUiChromeByRuntime,
  runtimeId: string,
  request: ExtensionUiRequest,
): ExtensionUiChromeByRuntime {
  switch (request.method) {
    case "setStatus":
      return updateRuntimeChrome(chromeByRuntime, runtimeId, (chrome) => updateStatus(chrome, request.statusKey, request.statusText));
    case "setWidget":
      return updateRuntimeChrome(chromeByRuntime, runtimeId, (chrome) => updateWidget(chrome, request.widgetKey, request.widgetLines, request.widgetPlacement));
    default:
      return chromeByRuntime;
  }
}

export function extensionUiChromeRequestFromPayload(payload: unknown): ExtensionUiRequest | undefined {
  if (!isRecord(payload) || payload.type !== "extension_ui_request" || typeof payload.id !== "string") return undefined;

  if (payload.method === "setStatus" && typeof payload.statusKey === "string") {
    return {
      type: "extension_ui_request",
      id: payload.id,
      method: "setStatus",
      statusKey: payload.statusKey,
      statusText: typeof payload.statusText === "string" ? payload.statusText : undefined,
    };
  }

  if (payload.method === "setWidget" && typeof payload.widgetKey === "string") {
    if (payload.widgetLines !== undefined && !isStringArray(payload.widgetLines)) return undefined;
    const widgetPlacement = payload.widgetPlacement === "belowEditor" || payload.widgetPlacement === "aboveEditor" ? payload.widgetPlacement : undefined;
    return {
      type: "extension_ui_request",
      id: payload.id,
      method: "setWidget",
      widgetKey: payload.widgetKey,
      widgetLines: payload.widgetLines,
      widgetPlacement,
    };
  }

  return undefined;
}

function updateRuntimeChrome(
  chromeByRuntime: ExtensionUiChromeByRuntime,
  runtimeId: string,
  update: (chrome: RuntimeExtensionUiChrome) => RuntimeExtensionUiChrome,
): ExtensionUiChromeByRuntime {
  const current = chromeByRuntime[runtimeId] ?? emptyRuntimeChrome();
  const next = update(current);
  if (runtimeChromeIsEmpty(next)) {
    if (!chromeByRuntime[runtimeId]) return chromeByRuntime;
    const { [runtimeId]: _removed, ...rest } = chromeByRuntime;
    return rest;
  }
  return { ...chromeByRuntime, [runtimeId]: next };
}

function updateStatus(chrome: RuntimeExtensionUiChrome, key: string, text: string | undefined): RuntimeExtensionUiChrome {
  const statuses = { ...chrome.statuses };
  const normalized = text?.trim();
  if (normalized) statuses[key] = normalized;
  else delete statuses[key];
  return { ...chrome, statuses };
}

function updateWidget(
  chrome: RuntimeExtensionUiChrome,
  key: string,
  lines: string[] | undefined,
  placement: ExtensionUiWidgetPlacement | undefined,
): RuntimeExtensionUiChrome {
  const widgets = { ...chrome.widgets };
  const normalizedLines = (lines ?? []).map((line) => line.trim()).filter(Boolean);
  if (normalizedLines.length > 0) {
    widgets[key] = { lines: normalizedLines, placement: placement ?? "aboveEditor" };
  } else {
    delete widgets[key];
  }
  return { ...chrome, widgets };
}

function emptyRuntimeChrome(): RuntimeExtensionUiChrome {
  return { statuses: {}, widgets: {} };
}

function runtimeChromeIsEmpty(chrome: RuntimeExtensionUiChrome): boolean {
  return Object.keys(chrome.statuses).length === 0 && Object.keys(chrome.widgets).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

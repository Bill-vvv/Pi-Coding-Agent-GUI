import type { VoiceInputCaptureMode, VoiceInputMode, VoiceInputSettings } from "@pi-gui/shared";

export type VoiceInputUserMode = "off" | "browserMicrophone" | "capswriterNativeBridge" | "customAdvanced";

export type CapsWriterBridgeFields = {
  serviceUrl: string;
  capswriterWsUrl: string;
  serverExe: string;
  serverCwd: string;
  language: string;
};

export const DEFAULT_VOICE_SERVICE_URL = "http://127.0.0.1:8765";
export const DEFAULT_CAPSWRITER_SERVICE_URL = "http://127.0.0.1:18765";
export const DEFAULT_CAPSWRITER_WS_URL = "ws://auto:6016";
export const DEFAULT_CAPSWRITER_LANGUAGE = "chinese";
export const DEFAULT_MANAGED_VOICE_COMMAND = "python";
export const DEFAULT_MANAGED_VOICE_ARGS = ["server.py", "--port", "8765"];

const CAPSWRITER_BRIDGE_MARKER_FLAGS = ["--capswriter-ws", "--capswriter-server-exe"] as const;

export function deriveVoiceInputUserMode(settings: VoiceInputSettings | undefined): VoiceInputUserMode {
  const mode = settings?.mode ?? "disabled";
  if (mode === "disabled") return "off";
  const captureMode = settings?.captureMode ?? "browser";
  if (captureMode === "native" && isCapsWriterBridgeSettings(settings)) return "capswriterNativeBridge";
  if (captureMode === "browser") return "browserMicrophone";
  return "customAdvanced";
}

export function voiceInputSettingsForUserMode(userMode: VoiceInputUserMode, current: VoiceInputSettings | undefined): Partial<VoiceInputSettings> {
  if (userMode === "off") return { mode: "disabled" };
  if (userMode === "browserMicrophone") {
    const mode = current?.mode && current.mode !== "disabled" ? current.mode : "managedProcess";
    const next: Partial<VoiceInputSettings> = {
      ...current,
      mode,
      captureMode: "browser",
      externalUrl: current?.externalUrl ?? DEFAULT_VOICE_SERVICE_URL,
    };
    if (mode === "managedProcess") {
      next.managedCommand = current?.managedCommand ?? DEFAULT_MANAGED_VOICE_COMMAND;
      next.managedArgs = current?.managedArgs?.length ? current.managedArgs : DEFAULT_MANAGED_VOICE_ARGS;
      next.autoStart = current?.autoStart ?? true;
    }
    return next;
  }
  if (userMode === "capswriterNativeBridge") {
    return capswriterBridgeSettings(current, capsWriterBridgeFieldsFromSettings(current));
  }
  return { ...current, mode: current?.mode && current.mode !== "disabled" ? current.mode : "externalService" };
}

export function isCapsWriterBridgeSettings(settings: VoiceInputSettings | undefined): boolean {
  const args = settings?.managedArgs ?? [];
  return CAPSWRITER_BRIDGE_MARKER_FLAGS.some((flag) => args.includes(flag));
}

export function capsWriterBridgeFieldsFromSettings(settings: VoiceInputSettings | undefined): CapsWriterBridgeFields {
  const args = settings?.managedArgs ?? [];
  const serviceUrl = isCapsWriterBridgeSettings(settings) ? settings?.externalUrl ?? DEFAULT_CAPSWRITER_SERVICE_URL : DEFAULT_CAPSWRITER_SERVICE_URL;
  return {
    serviceUrl,
    capswriterWsUrl: argValue(args, "--capswriter-ws") ?? DEFAULT_CAPSWRITER_WS_URL,
    serverExe: argValue(args, "--capswriter-server-exe") ?? "",
    serverCwd: argValue(args, "--capswriter-server-cwd") ?? "",
    language: argValue(args, "--language") ?? DEFAULT_CAPSWRITER_LANGUAGE,
  };
}

export function capswriterBridgeSettings(current: VoiceInputSettings | undefined, fields: Partial<CapsWriterBridgeFields>): Partial<VoiceInputSettings> {
  const merged = { ...capsWriterBridgeFieldsFromSettings(current), ...trimBridgeFields(fields) };
  return {
    ...current,
    mode: "managedProcess",
    captureMode: "native",
    externalUrl: merged.serviceUrl || DEFAULT_CAPSWRITER_SERVICE_URL,
    managedCommand: current?.managedCommand ?? DEFAULT_MANAGED_VOICE_COMMAND,
    managedArgs: buildCapsWriterManagedArgs(merged),
    autoStart: current?.autoStart ?? true,
  };
}

export function buildCapsWriterManagedArgs(fields: CapsWriterBridgeFields): string[] {
  const args = [
    "server.py",
    "--port",
    String(wrapperServicePort(fields.serviceUrl)),
    "--capswriter-ws",
    fields.capswriterWsUrl.trim() || DEFAULT_CAPSWRITER_WS_URL,
  ];
  const serverExe = fields.serverExe.trim();
  const serverCwd = fields.serverCwd.trim();
  const language = fields.language.trim() || DEFAULT_CAPSWRITER_LANGUAGE;
  if (serverExe) args.push("--capswriter-server-exe", serverExe);
  if (serverCwd) args.push("--capswriter-server-cwd", serverCwd);
  args.push("--language", language);
  return args;
}

export function wrapperServicePort(serviceUrl: string | undefined): number {
  if (!serviceUrl?.trim()) return 18765;
  try {
    const parsed = new URL(serviceUrl);
    if (!parsed.port) return 18765;
    const port = Number(parsed.port);
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 18765;
  } catch {
    return 18765;
  }
}

export function splitManagedArgs(value: string): string[] {
  return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

export function voiceInputSettingsEqual(left: VoiceInputSettings | undefined, right: VoiceInputSettings | undefined): boolean {
  return (
    (left?.mode ?? "disabled") === (right?.mode ?? "disabled") &&
    (left?.captureMode ?? "browser") === (right?.captureMode ?? "browser") &&
    (left?.externalUrl ?? "") === (right?.externalUrl ?? "") &&
    (left?.managedCommand ?? "") === (right?.managedCommand ?? "") &&
    (left?.managedCwd ?? "") === (right?.managedCwd ?? "") &&
    (left?.modelPath ?? "") === (right?.modelPath ?? "") &&
    (left?.autoStart ?? true) === (right?.autoStart ?? true) &&
    (left?.startupTimeoutMs ?? 0) === (right?.startupTimeoutMs ?? 0) &&
    (left?.transcriptionTimeoutMs ?? 0) === (right?.transcriptionTimeoutMs ?? 0) &&
    (left?.maxRecordingMs ?? 0) === (right?.maxRecordingMs ?? 0) &&
    (left?.maxUploadBytes ?? 0) === (right?.maxUploadBytes ?? 0) &&
    voiceInputArgsEqual(left?.managedArgs, right?.managedArgs)
  );
}

function trimBridgeFields(fields: Partial<CapsWriterBridgeFields>): Partial<CapsWriterBridgeFields> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])) as Partial<CapsWriterBridgeFields>;
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value?.trim() || undefined;
}

function voiceInputArgsEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  const leftArgs = left ?? [];
  const rightArgs = right ?? [];
  return leftArgs.length === rightArgs.length && leftArgs.every((item, index) => item === rightArgs[index]);
}

export function rawVoiceInputModeOrEnabledDefault(settings: VoiceInputSettings | undefined): VoiceInputMode {
  return settings?.mode ?? "disabled";
}

export function rawVoiceInputCaptureModeOrDefault(settings: VoiceInputSettings | undefined): VoiceInputCaptureMode {
  return settings?.captureMode ?? "browser";
}

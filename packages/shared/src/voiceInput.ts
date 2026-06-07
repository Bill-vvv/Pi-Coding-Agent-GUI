import type { VoiceInputCaptureMode, VoiceInputMode, VoiceInputSettings } from "./domain.js";
import { isRecord } from "./utils.js";

export const DEFAULT_VOICE_INPUT_MAX_RECORDING_MS = 60_000;
export const DEFAULT_VOICE_INPUT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const DEFAULT_VOICE_INPUT_TRANSCRIPTION_TIMEOUT_MS = 45_000;
export const DEFAULT_VOICE_INPUT_STARTUP_TIMEOUT_MS = 20_000;

export function normalizeVoiceInputSettings(value: unknown): VoiceInputSettings | undefined {
  if (!isRecord(value)) return undefined;
  const mode = voiceInputModeOrUndefined(value.mode);
  const captureMode = voiceInputCaptureModeOrUndefined(value.captureMode);
  const normalized: VoiceInputSettings = {};
  if (mode) normalized.mode = mode;
  if (captureMode) normalized.captureMode = captureMode;
  assignTrimmedString(normalized, "externalUrl", value.externalUrl);
  assignTrimmedString(normalized, "managedCommand", value.managedCommand);
  assignTrimmedString(normalized, "managedCwd", value.managedCwd);
  assignTrimmedString(normalized, "modelPath", value.modelPath);
  if (Array.isArray(value.managedArgs)) {
    const args = value.managedArgs.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
    if (args.length > 0) normalized.managedArgs = args;
  }
  if (typeof value.autoStart === "boolean") normalized.autoStart = value.autoStart;
  assignPositiveInteger(normalized, "startupTimeoutMs", value.startupTimeoutMs);
  assignPositiveInteger(normalized, "transcriptionTimeoutMs", value.transcriptionTimeoutMs);
  assignPositiveInteger(normalized, "maxRecordingMs", value.maxRecordingMs);
  assignPositiveInteger(normalized, "maxUploadBytes", value.maxUploadBytes);
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function effectiveVoiceInputLimits(settings: VoiceInputSettings | undefined): { maxRecordingMs: number; maxUploadBytes: number; transcriptionTimeoutMs: number; startupTimeoutMs: number } {
  return {
    maxRecordingMs: boundedPositiveInteger(settings?.maxRecordingMs, DEFAULT_VOICE_INPUT_MAX_RECORDING_MS, 1_000, 10 * 60_000),
    maxUploadBytes: boundedPositiveInteger(settings?.maxUploadBytes, DEFAULT_VOICE_INPUT_MAX_UPLOAD_BYTES, 1024, 100 * 1024 * 1024),
    transcriptionTimeoutMs: boundedPositiveInteger(settings?.transcriptionTimeoutMs, DEFAULT_VOICE_INPUT_TRANSCRIPTION_TIMEOUT_MS, 1_000, 5 * 60_000),
    startupTimeoutMs: boundedPositiveInteger(settings?.startupTimeoutMs, DEFAULT_VOICE_INPUT_STARTUP_TIMEOUT_MS, 1_000, 2 * 60_000),
  };
}

export function voiceInputModeOrUndefined(value: unknown): VoiceInputMode | undefined {
  return value === "disabled" || value === "externalService" || value === "managedProcess" ? value : undefined;
}

export function voiceInputCaptureModeOrUndefined(value: unknown): VoiceInputCaptureMode | undefined {
  return value === "browser" || value === "native" ? value : undefined;
}

function assignTrimmedString(settings: VoiceInputSettings, key: keyof Pick<VoiceInputSettings, "externalUrl" | "managedCommand" | "managedCwd" | "modelPath">, value: unknown): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed) settings[key] = trimmed;
}

function assignPositiveInteger(settings: VoiceInputSettings, key: keyof Pick<VoiceInputSettings, "startupTimeoutMs" | "transcriptionTimeoutMs" | "maxRecordingMs" | "maxUploadBytes">, value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
  settings[key] = Math.floor(value);
}

function boundedPositiveInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return fallback;
  return Math.max(min, Math.min(Math.floor(value), max));
}

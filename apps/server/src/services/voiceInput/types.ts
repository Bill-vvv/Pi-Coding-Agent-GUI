import type { VoiceInputCaptureMode, VoiceInputMode, VoiceInputSettings, VoiceRecordingStartResponse, VoiceTranscriptionResponse } from "@pi-gui/shared";

export type VoiceInputEffectiveConfig = {
  mode: VoiceInputMode;
  captureMode: VoiceInputCaptureMode;
  externalUrl?: string;
  managedCommand?: string;
  managedArgs: string[];
  managedCwd?: string;
  modelPath?: string;
  autoStart: boolean;
  startupTimeoutMs: number;
  transcriptionTimeoutMs: number;
  maxRecordingMs: number;
  maxUploadBytes: number;
};

export type VoiceInputStatusDetails = {
  available: boolean;
  mode: VoiceInputMode;
  state: "disabled" | "not_configured" | "starting" | "ready" | "error";
  message?: string;
  maxRecordingMs: number;
  maxUploadBytes: number;
  transcriptionTimeoutMs: number;
};

export type VoiceTranscriptionRequest = {
  audio: Buffer;
  mimeType: string;
  timeoutMs: number;
};

export type VoiceTranscriptionResult = VoiceTranscriptionResponse;

export type VoiceAdapter = {
  health(config: VoiceInputEffectiveConfig): Promise<{ ready: boolean; message?: string }>;
  transcribe(config: VoiceInputEffectiveConfig, request: VoiceTranscriptionRequest): Promise<VoiceTranscriptionResult>;
  startRecording(config: VoiceInputEffectiveConfig): Promise<VoiceRecordingStartResponse>;
  stopRecording(config: VoiceInputEffectiveConfig): Promise<VoiceTranscriptionResult>;
};

export type VoiceSettingsProvider = {
  getSettings(): { voiceInput?: VoiceInputSettings };
};

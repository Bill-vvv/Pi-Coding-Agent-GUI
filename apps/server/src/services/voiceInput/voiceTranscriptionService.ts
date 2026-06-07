import type { VoiceInputStatus, VoiceRecordingStartResponse } from "@pi-gui/shared";
import { VoiceInputError } from "./errors.js";
import { ExternalVoiceAdapter } from "./externalVoiceAdapter.js";
import { ManagedVoiceProcess } from "./managedVoiceProcess.js";
import type { VoiceAdapter, VoiceInputEffectiveConfig, VoiceSettingsProvider, VoiceTranscriptionResult } from "./types.js";
import { effectiveVoiceInputConfig } from "./voiceInputSettings.js";

export class VoiceTranscriptionService {
  private readonly adapter: VoiceAdapter;
  private readonly managedProcess = new ManagedVoiceProcess();
  private nativeRecordingConfig: VoiceInputEffectiveConfig | undefined;

  constructor(private readonly settingsProvider: VoiceSettingsProvider, adapter: VoiceAdapter = new ExternalVoiceAdapter()) {
    this.adapter = adapter;
  }

  async getStatus(): Promise<VoiceInputStatus> {
    const config = effectiveVoiceInputConfig(this.settingsProvider.getSettings().voiceInput);
    const base = {
      mode: config.mode,
      maxRecordingMs: config.maxRecordingMs,
      maxUploadBytes: config.maxUploadBytes,
      transcriptionTimeoutMs: config.transcriptionTimeoutMs,
    };
    if (config.mode === "disabled") return { ...base, available: false, state: "disabled", message: "Voice input is disabled" };
    if (!config.externalUrl) return { ...base, available: false, state: "not_configured", message: "Voice input service URL is not configured" };
    if (config.mode === "managedProcess" && !config.managedCommand) {
      return { ...base, available: false, state: "not_configured", message: "Voice input managed command is not configured" };
    }
    const startingState = this.managedProcess.statusState();
    if (startingState) return { ...base, available: false, state: startingState, message: "Voice input service is starting" };

    try {
      if (config.mode === "managedProcess" && config.autoStart) await this.managedProcess.ensureStarted(config);
      const health = await this.adapter.health(config);
      return { ...base, available: health.ready, state: health.ready ? "ready" : "error", message: health.message };
    } catch (error) {
      return { ...base, available: false, state: "error", message: (error as Error).message };
    }
  }

  async transcribe(audio: Buffer, mimeType: string): Promise<VoiceTranscriptionResult> {
    const config = await this.readyConfig();
    if (audio.length === 0) throw new VoiceInputError("Voice input audio is empty", 400, "invalid_audio");
    if (audio.length > config.maxUploadBytes) throw new VoiceInputError(`Voice input audio exceeds ${config.maxUploadBytes} bytes`, 413, "audio_too_large");
    const result = await this.adapter.transcribe(config, { audio, mimeType, timeoutMs: config.transcriptionTimeoutMs });
    return normalizedTranscript(result);
  }

  async startRecording(): Promise<VoiceRecordingStartResponse> {
    const config = await this.readyConfig();
    if (config.captureMode !== "native") throw new VoiceInputError("Native voice capture is not enabled", 400, "native_recording_unsupported");
    if (this.nativeRecordingConfig) throw new VoiceInputError("Native voice recording is already active", 409, "native_recording_already_active");
    this.nativeRecordingConfig = config;
    try {
      return await this.adapter.startRecording(config);
    } catch (error) {
      if (this.nativeRecordingConfig === config) this.nativeRecordingConfig = undefined;
      throw error;
    }
  }

  async stopRecording(): Promise<VoiceTranscriptionResult> {
    const activeConfig = this.nativeRecordingConfig;
    if (activeConfig) {
      try {
        return normalizedTranscript(await this.adapter.stopRecording(activeConfig));
      } finally {
        if (this.nativeRecordingConfig === activeConfig) this.nativeRecordingConfig = undefined;
      }
    }

    const config = await this.readyConfig();
    if (config.captureMode !== "native") throw new VoiceInputError("Native voice capture is not enabled", 400, "native_recording_unsupported");
    return normalizedTranscript(await this.adapter.stopRecording(config));
  }

  stop(): void {
    this.managedProcess.stop();
  }

  private async readyConfig() {
    const config = effectiveVoiceInputConfig(this.settingsProvider.getSettings().voiceInput);
    if (config.mode === "disabled") throw new VoiceInputError("Voice input is disabled", 400, "voice_input_disabled");
    if (!config.externalUrl) throw new VoiceInputError("Voice input service URL is not configured", 400, "voice_input_not_configured");
    if (config.mode === "managedProcess") await this.managedProcess.ensureStarted(config);
    return config;
  }
}

function normalizedTranscript(result: VoiceTranscriptionResult): VoiceTranscriptionResult {
  if (!result.text.trim()) throw new VoiceInputError("Voice input returned an empty transcript", 422, "empty_transcript");
  return { ...result, text: result.text.trim() };
}

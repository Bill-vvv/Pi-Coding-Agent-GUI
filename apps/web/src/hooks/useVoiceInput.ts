import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceInputSettings, VoiceInputStatus, VoiceTranscriptionResponse } from "@pi-gui/shared";
import { DEFAULT_VOICE_INPUT_MAX_RECORDING_MS, DEFAULT_VOICE_INPUT_MAX_UPLOAD_BYTES, isRecord } from "@pi-gui/shared";
import type { ConnectionState } from "../types";

export type VoiceInputUiState = "unavailable" | "idle" | "recording" | "processing" | "error";

export type VoiceInputState = {
  state: VoiceInputUiState;
  status?: VoiceInputStatus;
  error?: string;
  supported: boolean;
  recordingStartedAt?: number;
};

type UseVoiceInputOptions = {
  connection: ConnectionState;
  settings?: VoiceInputSettings;
  onTranscript: (text: string) => void;
};

const MIME_CANDIDATES = ["audio/webm;codecs=pcm", "audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/wav"];
const HIGH_QUALITY_AUDIO_BITS_PER_SECOND = 256_000;
const VOICE_CAPTURE_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48_000 },
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
};

export function useVoiceInput({ connection, settings, onTranscript }: UseVoiceInputOptions) {
  const captureMode = settings?.captureMode ?? "browser";
  const browserCaptureSupported = typeof window !== "undefined" && typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
  const supported = captureMode === "native" || browserCaptureSupported;
  const [voiceState, setVoiceState] = useState<VoiceInputState>({ state: "unavailable", supported });
  const recorderRef = useRef<MediaRecorder | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const chunksRef = useRef<BlobPart[]>([]);
  const stopTimerRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(false);
  const nativeRecordingActiveRef = useRef(false);
  const nativeStartGenerationRef = useRef(0);

  const refreshStatus = useCallback(async () => {
    if (connection !== "open") return;
    try {
      const response = await fetch("/api/voice/status");
      if (!response.ok) throw new Error(await voiceResponseErrorMessage(response, `语音输入状态读取失败：HTTP ${response.status}`));
      const status = (await response.json()) as VoiceInputStatus;
      setVoiceState((current) => ({
        ...current,
        status,
        supported,
        state: supported && status.available ? (current.state === "unavailable" ? "idle" : current.state) : current.state === "recording" || current.state === "processing" ? current.state : "unavailable",
        error: status.available || current.state !== "recording" ? undefined : current.error,
      }));
    } catch {
      setVoiceState((current) => ({
        ...current,
        state: current.state === "recording" || current.state === "processing" ? current.state : "unavailable",
        error: current.state === "recording" || current.state === "processing" ? current.error : undefined,
      }));
    }
  }, [connection, supported]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, settings]);

  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        nativeStartGenerationRef.current += 1;
        cleanupRecording();
        stopNativeRecordingIfActive();
      };
    },
    [],
  );

  const toggleRecording = useCallback(async () => {
    if (voiceState.state === "recording") {
      if (nativeRecordingActiveRef.current) {
        void stopNativeRecording();
      } else {
        recorderRef.current?.stop();
      }
      return;
    }
    if (!supported) {
      setVoiceState((current) => ({ ...current, state: "unavailable", error: "当前浏览器不支持录音" }));
      return;
    }
    if (connection !== "open") {
      setVoiceState((current) => ({ ...current, state: "error", error: "后端连接未打开" }));
      return;
    }
    const status = voiceState.status;
    if (!status?.available) {
      setVoiceState((current) => ({ ...current, state: "unavailable", error: status?.message || "语音输入不可用" }));
      return;
    }

    if (captureMode === "native") {
      void startNativeRecording();
      return;
    }

    try {
      chunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: VOICE_CAPTURE_CONSTRAINTS });
      streamRef.current = stream;
      const mimeType = preferredMimeType();
      const recorder = createVoiceMediaRecorder(stream, mimeType);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setVoiceState((current) => ({ ...current, state: "error", error: "录音失败" }));
        cleanupRecording();
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "application/octet-stream" });
        cleanupRecording();
        void transcribeBlob(blob);
      };
      recorder.start();
      const maxRecordingMs = voiceState.status?.maxRecordingMs ?? DEFAULT_VOICE_INPUT_MAX_RECORDING_MS;
      stopTimerRef.current = window.setTimeout(() => recorder.state === "recording" && recorder.stop(), maxRecordingMs);
      setVoiceState((current) => ({ ...current, state: "recording", error: undefined, recordingStartedAt: Date.now() }));
    } catch (error) {
      cleanupRecording();
      setVoiceState((current) => ({ ...current, state: "error", error: error instanceof Error ? error.message : String(error) }));
    }
  }, [captureMode, connection, onTranscript, supported, voiceState]);

  const cancelRecording = useCallback(() => {
    cleanupRecording();
    if (captureMode === "native") {
      nativeStartGenerationRef.current += 1;
      stopNativeRecordingIfActive();
    }
    setVoiceState((current) => ({ ...current, state: current.status?.available ? "idle" : "unavailable" }));
  }, [captureMode, voiceState.state]);

  const dismissError = useCallback(() => {
    setVoiceState((current) => {
      if (!current.error) return current;
      const nextState = current.state === "error" ? dismissedVoiceErrorState(current) : current.state;
      return { ...current, state: nextState, error: undefined, recordingStartedAt: nextState === "recording" ? current.recordingStartedAt : undefined };
    });
  }, []);

  async function startNativeRecording() {
    const startGeneration = nativeStartGenerationRef.current + 1;
    nativeStartGenerationRef.current = startGeneration;
    setVoiceState((current) => ({ ...current, state: "processing", error: undefined }));
    try {
      const response = await fetch("/api/voice/recording/start", {
        method: "POST",
              });
      if (!response.ok) throw new Error(await voiceResponseErrorMessage(response, `原生语音录音启动失败：HTTP ${response.status}`));
      const result = (await response.json().catch(() => undefined)) as { startedAt?: number } | undefined;
      nativeRecordingActiveRef.current = true;
      if (startGeneration !== nativeStartGenerationRef.current || !mountedRef.current) {
        stopNativeRecordingIfActive();
        return;
      }
      setVoiceState((current) => ({ ...current, state: "recording", error: undefined, recordingStartedAt: result?.startedAt ?? Date.now() }));
    } catch (error) {
      nativeRecordingActiveRef.current = false;
      if (startGeneration !== nativeStartGenerationRef.current || !mountedRef.current) return;
      setVoiceState((current) => ({ ...current, state: "error", error: error instanceof Error ? error.message : String(error), recordingStartedAt: undefined }));
    }
  }

  async function stopNativeRecording() {
    setVoiceState((current) => ({ ...current, state: "processing", error: undefined }));
    try {
      const response = await fetch("/api/voice/recording/stop", {
        method: "POST",
              });
      nativeRecordingActiveRef.current = false;
      if (!response.ok) throw new Error(await voiceResponseErrorMessage(response, `原生语音录音停止失败：HTTP ${response.status}`));
      const result = (await response.json()) as VoiceTranscriptionResponse;
      if (!result.text.trim()) throw new Error("语音识别结果为空");
      onTranscript(result.text);
      setVoiceState((current) => ({ ...current, state: current.status?.available ? "idle" : "unavailable", error: undefined, recordingStartedAt: undefined }));
    } catch (error) {
      setVoiceState((current) => ({ ...current, state: "error", error: error instanceof Error ? error.message : String(error), recordingStartedAt: undefined }));
    }
  }

  function stopNativeRecordingIfActive() {
    if (!nativeRecordingActiveRef.current) return;
    nativeRecordingActiveRef.current = false;
    void fetch("/api/voice/recording/stop", { method: "POST" }).catch(() => undefined);
  }

  async function transcribeBlob(blob: Blob) {
    const maxUploadBytes = voiceState.status?.maxUploadBytes ?? DEFAULT_VOICE_INPUT_MAX_UPLOAD_BYTES;
    if (blob.size === 0) {
      setVoiceState((current) => ({ ...current, state: "error", error: "没有录到音频" }));
      return;
    }
    if (blob.size > maxUploadBytes) {
      setVoiceState((current) => ({ ...current, state: "error", error: `录音过大（${blob.size} bytes）` }));
      return;
    }
    setVoiceState((current) => ({ ...current, state: "processing", error: undefined }));
    try {
      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        headers: { "Content-Type": blob.type || "application/octet-stream", "X-Voice-Mime-Type": blob.type || "application/octet-stream" },
        body: blob,
      });
      if (!response.ok) throw new Error(await voiceResponseErrorMessage(response, `语音识别失败：HTTP ${response.status}`));
      const result = (await response.json()) as VoiceTranscriptionResponse;
      if (!result.text.trim()) throw new Error("语音识别结果为空");
      onTranscript(result.text);
      setVoiceState((current) => ({ ...current, state: current.status?.available ? "idle" : "unavailable", error: undefined }));
    } catch (error) {
      setVoiceState((current) => ({ ...current, state: "error", error: error instanceof Error ? error.message : String(error) }));
    }
  }

  function cleanupRecording() {
    if (stopTimerRef.current !== undefined) window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = undefined;
    recorderRef.current = undefined;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
    chunksRef.current = [];
  }

  return { voiceInput: voiceState, toggleRecording, cancelRecording, dismissError, refreshStatus };
}

function dismissedVoiceErrorState(state: VoiceInputState): VoiceInputUiState {
  return state.supported && (state.status?.available ?? true) ? "idle" : "unavailable";
}

function preferredMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function createVoiceMediaRecorder(stream: MediaStream, mimeType: string | undefined): MediaRecorder {
  const highQualityOptions: MediaRecorderOptions = mimeType
    ? { mimeType, audioBitsPerSecond: HIGH_QUALITY_AUDIO_BITS_PER_SECOND }
    : { audioBitsPerSecond: HIGH_QUALITY_AUDIO_BITS_PER_SECOND };
  try {
    return new MediaRecorder(stream, highQualityOptions);
  } catch {
    return new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  }
}

async function voiceResponseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => undefined);
  if (isRecord(body)) {
    const message = stringField(body.error) ?? stringField(body.message);
    const code = stringField(body.code);
    return localizedVoiceErrorMessage(code, message, fallback);
  }
  return fallback;
}

function localizedVoiceErrorMessage(code: string | undefined, message: string | undefined, fallback: string): string {
  if (code === "empty_transcript") return "语音识别结果为空：请确认麦克风有声音，或稍微靠近麦克风后重试。";
  if (code === "voice_input_disabled") return "语音输入已关闭，请先在设置里启用。";
  if (code === "voice_input_not_configured") return message ? `语音输入未配置：${message}` : "语音输入未配置。";
  if (code === "invalid_audio") return message ? `录音数据无效：${message}` : "录音数据无效。";
  if (code === "audio_too_large") return message ? `录音过大：${message}` : "录音过大。";
  if (code === "managed_process_error") return message ? `本地语音识别进程启动失败：${message}` : "本地语音识别进程启动失败。";
  if (code === "native_recording_unsupported") return message ? `原生录音不可用：${message}` : "原生录音不可用：请确认 wrapper 支持 /record/start 和 /record/stop，并能访问本机麦克风。";
  if (code === "native_recording_already_active") return "原生录音已经在进行中。";
  if (code === "native_recording_not_active") return "原生录音尚未开始。";
  if (code === "native_recording_error") return message ? `原生录音失败：${message}` : "原生录音失败。";
  if (code === "invalid_upstream_response") return message ? `本地语音识别服务响应格式错误：${message}` : "本地语音识别服务响应格式错误。";
  if (code === "upstream_error") return message ? `本地语音识别服务报错：${message}` : "本地语音识别服务报错。";
  if (code === "upstream_timeout") return "本地语音识别服务超时，请稍后重试或检查 ASR 服务状态。";
  if (code === "upstream_unavailable") return message ? `本地语音识别服务不可用：${message}` : "本地语音识别服务不可用。";
  if (message) return `${fallback}：${message}`;
  return fallback;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

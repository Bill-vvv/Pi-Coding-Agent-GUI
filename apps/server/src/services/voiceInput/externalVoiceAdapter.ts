import { isRecord, type VoiceRecordingStartResponse } from "@pi-gui/shared";
import { VoiceInputError } from "./errors.js";
import type { VoiceAdapter, VoiceInputEffectiveConfig, VoiceTranscriptionRequest, VoiceTranscriptionResult } from "./types.js";
import { assertLocalVoiceServiceUrl } from "./voiceServiceUrl.js";

export class ExternalVoiceAdapter implements VoiceAdapter {
  async health(config: VoiceInputEffectiveConfig): Promise<{ ready: boolean; message?: string }> {
    const baseUrl = requireServiceUrl(config);
    const response = await fetchWithTimeout(joinServicePath(baseUrl, "/health"), { method: "GET" }, Math.min(config.startupTimeoutMs, 10_000));
    if (!response.ok) {
      const message = await responseErrorMessage(response);
      return { ready: false, message: `ASR health check failed: HTTP ${response.status}${message ? `: ${message}` : ""}` };
    }
    const body = await response.json().catch(() => undefined);
    if (!isRecord(body)) return { ready: true };
    if (body.ok === false || body.ready === false) return { ready: false, message: stringOrUndefined(body.message) ?? "ASR service is not ready" };
    return { ready: true, message: stringOrUndefined(body.message) };
  }

  async transcribe(config: VoiceInputEffectiveConfig, request: VoiceTranscriptionRequest): Promise<VoiceTranscriptionResult> {
    const baseUrl = requireServiceUrl(config);
    const headers = new Headers({ "Content-Type": request.mimeType || "application/octet-stream" });
    if (config.modelPath) headers.set("X-Voice-Model-Path", config.modelPath);
    const response = await fetchWithTimeout(
      joinServicePath(baseUrl, "/transcribe"),
      { method: "POST", headers, body: request.audio as unknown as BodyInit },
      request.timeoutMs,
    );
    if (!response.ok) await throwUpstreamResponseError(response, "ASR transcription failed", "upstream_error");
    return transcriptionResponseFromBody(await response.json().catch(() => undefined));
  }

  async startRecording(config: VoiceInputEffectiveConfig): Promise<VoiceRecordingStartResponse> {
    const response = await this.postRecordingCommand(config, "/record/start");
    if (!response.ok) await throwUpstreamResponseError(response, "Native voice recording start failed", response.status === 404 ? "native_recording_unsupported" : "native_recording_error");
    const body = await response.json().catch(() => undefined);
    if (!isRecord(body) || body.recording !== true) throw new VoiceInputError("Native voice recording response did not include recording state", 502, "invalid_upstream_response");
    return { recording: true, startedAt: numberOrNow(body.startedAt) };
  }

  async stopRecording(config: VoiceInputEffectiveConfig): Promise<VoiceTranscriptionResult> {
    const response = await this.postRecordingCommand(config, "/record/stop");
    if (!response.ok) await throwUpstreamResponseError(response, "Native voice recording stop failed", response.status === 404 ? "native_recording_unsupported" : "native_recording_error");
    return transcriptionResponseFromBody(await response.json().catch(() => undefined));
  }

  private async postRecordingCommand(config: VoiceInputEffectiveConfig, path: string): Promise<Response> {
    const baseUrl = requireServiceUrl(config);
    return fetchWithTimeout(joinServicePath(baseUrl, path), { method: "POST" }, config.transcriptionTimeoutMs);
  }
}

function requireServiceUrl(config: VoiceInputEffectiveConfig): string {
  if (!config.externalUrl) throw new VoiceInputError("Voice input service URL is not configured", 400, "voice_input_not_configured");
  try {
    return assertLocalVoiceServiceUrl(config.externalUrl);
  } catch (error) {
    throw new VoiceInputError(errorMessage(error), 400, "voice_input_not_configured");
  }
}

function joinServicePath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new VoiceInputError("ASR service request timed out", 504, "upstream_timeout");
    throw new VoiceInputError(`ASR service request failed: ${errorMessage(error)}`, 503, "upstream_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

async function throwUpstreamResponseError(response: Response, prefix: string, fallbackCode: VoiceInputError["code"]): Promise<never> {
  const details = await responseErrorDetails(response);
  const code = details.code ?? fallbackCode;
  throw new VoiceInputError(`${prefix}: HTTP ${response.status}${details.message ? `: ${details.message}` : ""}`, statusCodeForVoiceError(response.status, code), code);
}

function statusCodeForVoiceError(upstreamStatus: number, code: VoiceInputError["code"]): number {
  if (code === "native_recording_already_active" || code === "native_recording_not_active") return 409;
  if (code === "native_recording_unsupported") return 400;
  if (code === "empty_transcript") return 422;
  if (code === "upstream_timeout" || upstreamStatus === 504) return 504;
  if (code === "upstream_unavailable") return 503;
  return 502;
}

function transcriptionResponseFromBody(body: unknown): VoiceTranscriptionResult {
  if (!isRecord(body) || typeof body.text !== "string") throw new VoiceInputError("ASR transcription response did not include text", 502, "invalid_upstream_response");
  const text = body.text.trim();
  return {
    text,
    durationMs: typeof body.durationMs === "number" && Number.isFinite(body.durationMs) ? body.durationMs : undefined,
  };
}

async function responseErrorMessage(response: Response): Promise<string | undefined> {
  return (await responseErrorDetails(response)).message;
}

async function responseErrorDetails(response: Response): Promise<{ message?: string; code?: VoiceInputError["code"] }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await response.json().catch(() => undefined);
    if (isRecord(body)) return { message: firstString(body.message, body.error, body.detail), code: voiceInputErrorCodeOrUndefined(body.code) };
  }
  return {};
}

function voiceInputErrorCodeOrUndefined(value: unknown): VoiceInputError["code"] | undefined {
  return typeof value === "string" && isVoiceInputErrorCode(value) ? value : undefined;
}

function isVoiceInputErrorCode(value: string): value is VoiceInputError["code"] {
  return [
    "voice_input_disabled",
    "voice_input_not_configured",
    "invalid_audio",
    "audio_too_large",
    "empty_transcript",
    "managed_process_error",
    "upstream_unavailable",
    "upstream_timeout",
    "upstream_error",
    "invalid_upstream_response",
    "native_recording_unsupported",
    "native_recording_already_active",
    "native_recording_not_active",
    "native_recording_error",
  ].includes(value);
}

function numberOrNow(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const message = stringOrUndefined(value);
    if (message) return message.slice(0, 500);
  }
  return undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

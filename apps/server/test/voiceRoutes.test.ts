import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { VoiceInputStatus, VoiceRecordingStartResponse, VoiceTranscriptionResponse } from "@pi-gui/shared";
import { registerVoiceRoutes } from "../src/routes/voiceRoutes.js";
import { VoiceInputError } from "../src/services/voiceInput/index.js";

test("voice status route returns service status without requiring a real ASR engine", async (t) => {
  const fastify = Fastify({ logger: false });
  await registerVoiceRoutes(fastify, {
    async getStatus(): Promise<VoiceInputStatus> {
      return {
        available: false,
        mode: "disabled",
        state: "disabled",
        message: "Voice input is disabled",
        maxRecordingMs: 60_000,
        maxUploadBytes: 25 * 1024 * 1024,
        transcriptionTimeoutMs: 45_000,
      };
    },
    async transcribe(): Promise<VoiceTranscriptionResponse> {
      throw new Error("not used");
    },
    async startRecording(): Promise<VoiceRecordingStartResponse> {
      throw new Error("not used");
    },
    async stopRecording(): Promise<VoiceTranscriptionResponse> {
      throw new Error("not used");
    },
  });
  t.after(() => fastify.close());

  const response = await fastify.inject({ method: "GET", url: "/api/voice/status" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    available: false,
    mode: "disabled",
    state: "disabled",
    message: "Voice input is disabled",
    maxRecordingMs: 60_000,
    maxUploadBytes: 25 * 1024 * 1024,
    transcriptionTimeoutMs: 45_000,
  });
});

test("voice transcription route passes bounded browser audio bytes to the service", async (t) => {
  const calls: Array<{ audio: Buffer; mimeType: string }> = [];
  const fastify = Fastify({ logger: false });
  await registerVoiceRoutes(fastify, {
    async getStatus(): Promise<VoiceInputStatus> {
      throw new Error("not used");
    },
    async transcribe(audio: Buffer, mimeType: string): Promise<VoiceTranscriptionResponse> {
      calls.push({ audio, mimeType });
      return { text: "你好 Pi" };
    },
    async startRecording(): Promise<VoiceRecordingStartResponse> {
      throw new Error("not used");
    },
    async stopRecording(): Promise<VoiceTranscriptionResponse> {
      throw new Error("not used");
    },
  });
  t.after(() => fastify.close());

  const payload = Buffer.from("fake-webm-audio");
  const response = await fastify.inject({
    method: "POST",
    url: "/api/voice/transcribe",
    headers: { "content-type": "audio/webm; codecs=opus" },
    payload,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { text: "你好 Pi" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.audio.toString(), payload.toString());
  assert.equal(calls[0]?.mimeType, "audio/webm");

  const octetPayload = Buffer.from("fake-octet-audio");
  const octetResponse = await fastify.inject({
    method: "POST",
    url: "/api/voice/transcribe",
    headers: { "content-type": "application/octet-stream" },
    payload: octetPayload,
  });

  assert.equal(octetResponse.statusCode, 200);
  assert.deepEqual(octetResponse.json(), { text: "你好 Pi" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.audio.toString(), octetPayload.toString());
  assert.equal(calls[1]?.mimeType, "application/octet-stream");
});

test("voice transcription route returns operational voice errors without generic HTTP 500", async (t) => {
  const fastify = Fastify({ logger: false });
  await registerVoiceRoutes(fastify, {
    async getStatus(): Promise<VoiceInputStatus> {
      throw new Error("not used");
    },
    async transcribe(): Promise<VoiceTranscriptionResponse> {
      throw new VoiceInputError("Voice input returned an empty transcript", 422, "empty_transcript");
    },
    async startRecording(): Promise<VoiceRecordingStartResponse> {
      throw new Error("not used");
    },
    async stopRecording(): Promise<VoiceTranscriptionResponse> {
      throw new Error("not used");
    },
  });
  t.after(() => fastify.close());

  const response = await fastify.inject({
    method: "POST",
    url: "/api/voice/transcribe",
    headers: { "content-type": "audio/webm" },
    payload: Buffer.from("fake-webm-audio"),
  });

  assert.equal(response.statusCode, 422);
  assert.deepEqual(response.json(), { error: "Voice input returned an empty transcript", code: "empty_transcript" });
});

test("voice native recording routes delegate start and stop to the service", async (t) => {
  const calls: string[] = [];
  const fastify = Fastify({ logger: false });
  await registerVoiceRoutes(fastify, {
    async getStatus(): Promise<VoiceInputStatus> {
      throw new Error("not used");
    },
    async transcribe(): Promise<VoiceTranscriptionResponse> {
      throw new Error("not used");
    },
    async startRecording(): Promise<VoiceRecordingStartResponse> {
      calls.push("start");
      return { recording: true, startedAt: 123 };
    },
    async stopRecording(): Promise<VoiceTranscriptionResponse> {
      calls.push("stop");
      return { text: "原生录音结果", durationMs: 456 };
    },
  });
  t.after(() => fastify.close());

  const start = await fastify.inject({ method: "POST", url: "/api/voice/recording/start" });
  const stop = await fastify.inject({ method: "POST", url: "/api/voice/recording/stop" });

  assert.equal(start.statusCode, 200);
  assert.deepEqual(start.json(), { recording: true, startedAt: 123 });
  assert.equal(stop.statusCode, 200);
  assert.deepEqual(stop.json(), { text: "原生录音结果", durationMs: 456 });
  assert.deepEqual(calls, ["start", "stop"]);
});

test("voice native recording routes return operational errors without generic HTTP 500", async (t) => {
  const fastify = Fastify({ logger: false });
  await registerVoiceRoutes(fastify, {
    async getStatus(): Promise<VoiceInputStatus> {
      throw new Error("not used");
    },
    async transcribe(): Promise<VoiceTranscriptionResponse> {
      throw new Error("not used");
    },
    async startRecording(): Promise<VoiceRecordingStartResponse> {
      throw new VoiceInputError("Native recording is unsupported", 400, "native_recording_unsupported");
    },
    async stopRecording(): Promise<VoiceTranscriptionResponse> {
      throw new Error("not used");
    },
  });
  t.after(() => fastify.close());

  const response = await fastify.inject({ method: "POST", url: "/api/voice/recording/start" });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "Native recording is unsupported", code: "native_recording_unsupported" });
});

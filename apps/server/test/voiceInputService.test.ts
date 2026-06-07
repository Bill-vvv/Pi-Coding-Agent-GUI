import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { VoiceInputSettings } from "@pi-gui/shared";
import { ExternalVoiceAdapter, VoiceInputError, VoiceTranscriptionService, assertLocalVoiceServiceUrl } from "../src/services/voiceInput/index.js";
import type { VoiceAdapter, VoiceInputEffectiveConfig } from "../src/services/voiceInput/types.js";

test("voice service URLs are constrained to local/private offline targets", () => {
  assert.equal(assertLocalVoiceServiceUrl("http://127.0.0.1:8765?token=secret"), "http://127.0.0.1:8765/");
  assert.equal(assertLocalVoiceServiceUrl("http://192.168.1.20:8765/base"), "http://192.168.1.20:8765/base");
  assert.equal(assertLocalVoiceServiceUrl("http://172.20.0.1:8765"), "http://172.20.0.1:8765/");
  assert.throws(() => assertLocalVoiceServiceUrl("https://example.com/asr"), /localhost|private LAN/);
  assert.throws(() => assertLocalVoiceServiceUrl("ftp://127.0.0.1/asr"), /http or https/);
});

test("voice service stops native recording with the config that started it", async () => {
  let settings: { voiceInput: VoiceInputSettings } = {
    voiceInput: {
      mode: "externalService" as const,
      captureMode: "native" as const,
      externalUrl: "http://127.0.0.1:1111",
    },
  };
  const stoppedUrls: Array<string | undefined> = [];
  const adapter: VoiceAdapter = {
    async health() {
      return { ready: true };
    },
    async transcribe() {
      return { text: "not used" };
    },
    async startRecording() {
      return { recording: true, startedAt: 123 };
    },
    async stopRecording(config) {
      stoppedUrls.push(config.externalUrl);
      return { text: " native result " };
    },
  };
  const service = new VoiceTranscriptionService({ getSettings: () => settings }, adapter);

  await service.startRecording();
  settings = {
    voiceInput: {
      mode: "externalService" as const,
      captureMode: "browser" as const,
      externalUrl: "http://127.0.0.1:2222",
    },
  };

  const result = await service.stopRecording();

  assert.deepEqual(stoppedUrls, ["http://127.0.0.1:1111"]);
  assert.deepEqual(result, { text: "native result" });
});

test("external voice adapter preserves native recording error codes from wrapper responses", async (t) => {
  const server = createServer((_request, response) => {
    const body = JSON.stringify({ ok: false, message: "native recording is not active", code: "native_recording_not_active" });
    response.writeHead(409, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const adapter = new ExternalVoiceAdapter();
  const config: VoiceInputEffectiveConfig = {
    mode: "externalService",
    captureMode: "native",
    externalUrl: `http://127.0.0.1:${address.port}`,
    managedArgs: [],
    autoStart: true,
    startupTimeoutMs: 1_000,
    transcriptionTimeoutMs: 1_000,
    maxRecordingMs: 60_000,
    maxUploadBytes: 25 * 1024 * 1024,
  };

  await assert.rejects(
    () => adapter.stopRecording(config),
    (error: unknown) => {
      assert.ok(error instanceof VoiceInputError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "native_recording_not_active");
      assert.match(error.message, /native recording is not active/);
      return true;
    },
  );
});

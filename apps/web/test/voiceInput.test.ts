import assert from "node:assert/strict";
import test from "node:test";
import { effectiveVoiceInputLimits, normalizeVoiceInputSettings } from "@pi-gui/shared";

test("voice input settings normalize user-provided CapsWriter wrapper config", () => {
  const settings = normalizeVoiceInputSettings({
    mode: "managedProcess",
    captureMode: "native",
    externalUrl: " http://127.0.0.1:8765 ",
    managedCommand: " python ",
    managedArgs: [" server.py ", "", 7],
    modelPath: " /models/capswriter ",
    autoStart: true,
    transcriptionTimeoutMs: 45_000,
  });

  assert.deepEqual(settings, {
    mode: "managedProcess",
    captureMode: "native",
    externalUrl: "http://127.0.0.1:8765",
    managedCommand: "python",
    managedArgs: ["server.py"],
    modelPath: "/models/capswriter",
    autoStart: true,
    transcriptionTimeoutMs: 45_000,
  });
});

test("voice input defaults match MVP recording and transcription limits", () => {
  assert.deepEqual(effectiveVoiceInputLimits(undefined), {
    maxRecordingMs: 60_000,
    maxUploadBytes: 25 * 1024 * 1024,
    transcriptionTimeoutMs: 45_000,
    startupTimeoutMs: 20_000,
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import type { VoiceInputSettings } from "@pi-gui/shared";
import {
  buildCapsWriterManagedArgs,
  capsWriterBridgeFieldsFromSettings,
  deriveVoiceInputUserMode,
  voiceInputSettingsForUserMode,
  wrapperServicePort,
} from "../src/domain/voiceInputSettings";

test("voice input user mode maps existing settings without rewriting custom values", () => {
  assert.equal(deriveVoiceInputUserMode(undefined), "off");
  assert.equal(deriveVoiceInputUserMode({ mode: "disabled" }), "off");
  assert.equal(deriveVoiceInputUserMode({ mode: "managedProcess", captureMode: "browser" }), "browserMicrophone");
  assert.equal(
    deriveVoiceInputUserMode({ mode: "managedProcess", captureMode: "native", managedArgs: ["server.py", "--capswriter-ws", "ws://auto:6016"] }),
    "capswriterNativeBridge",
  );
  assert.equal(deriveVoiceInputUserMode({ mode: "externalService", captureMode: "native", externalUrl: "http://127.0.0.1:9000" }), "customAdvanced");
  assert.equal(deriveVoiceInputUserMode({ mode: "managedProcess", captureMode: "native", managedArgs: ["server.py", "--language", "chinese"] }), "customAdvanced");
});

test("CapsWriter bridge fields parse concise values from managed args", () => {
  const settings: VoiceInputSettings = {
    mode: "managedProcess",
    captureMode: "native",
    externalUrl: "http://127.0.0.1:18765",
    managedArgs: [
      "server.py",
      "--port",
      "18765",
      "--capswriter-ws",
      "ws://auto:6016",
      "--capswriter-server-exe",
      "/mnt/d/CapsWriter-Offline/start_server.exe",
      "--capswriter-server-cwd",
      "/mnt/d/CapsWriter-Offline",
      "--language",
      "chinese",
    ],
  };

  assert.deepEqual(capsWriterBridgeFieldsFromSettings(settings), {
    serviceUrl: "http://127.0.0.1:18765",
    capswriterWsUrl: "ws://auto:6016",
    serverExe: "/mnt/d/CapsWriter-Offline/start_server.exe",
    serverCwd: "/mnt/d/CapsWriter-Offline",
    language: "chinese",
  });
});

test("CapsWriter bridge preset builds stable wrapper args and defaults port", () => {
  assert.deepEqual(
    buildCapsWriterManagedArgs({
      serviceUrl: "http://127.0.0.1:18765",
      capswriterWsUrl: "ws://auto:6016",
      serverExe: "/mnt/d/CapsWriter-Offline/start_server.exe",
      serverCwd: "/mnt/d/CapsWriter-Offline",
      language: "chinese",
    }),
    [
      "server.py",
      "--port",
      "18765",
      "--capswriter-ws",
      "ws://auto:6016",
      "--capswriter-server-exe",
      "/mnt/d/CapsWriter-Offline/start_server.exe",
      "--capswriter-server-cwd",
      "/mnt/d/CapsWriter-Offline",
      "--language",
      "chinese",
    ],
  );

  assert.equal(wrapperServicePort("http://127.0.0.1/voice"), 18765);
  assert.equal(wrapperServicePort("not a url"), 18765);
});

test("selecting user-facing modes preserves compatible settings and configures CapsWriter native bridge", () => {
  const browser = voiceInputSettingsForUserMode("browserMicrophone", {
    mode: "externalService",
    captureMode: "native",
    externalUrl: "http://127.0.0.1:9999",
  });
  assert.deepEqual(browser, {
    mode: "externalService",
    captureMode: "browser",
    externalUrl: "http://127.0.0.1:9999",
  });

  const capswriter = voiceInputSettingsForUserMode("capswriterNativeBridge", {
    mode: "managedProcess",
    externalUrl: "http://127.0.0.1:8765",
    managedCommand: "python",
    managedArgs: ["server.py", "--port", "8765", "--model", "iic/SenseVoiceSmall"],
  });

  assert.equal(capswriter.mode, "managedProcess");
  assert.equal(capswriter.captureMode, "native");
  assert.equal(capswriter.externalUrl, "http://127.0.0.1:18765");
  assert.deepEqual(capswriter.managedArgs, ["server.py", "--port", "18765", "--capswriter-ws", "ws://auto:6016", "--language", "chinese"]);
});

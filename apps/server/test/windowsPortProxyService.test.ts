import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { launchWindowsPortProxySetup, windowsPortProxyScript } from "../src/services/windowsPortProxyService.js";
import { resolveWindowsPowerShellExecutable } from "../src/services/windowsPowerShellService.js";

test("windows portproxy script configures fixed Pi GUI forwarding and firewall rule", () => {
  const script = windowsPortProxyScript({ listenPort: 8787, connectAddress: "172.20.253.149" });

  assert.match(script, /netsh interface portproxy add v4tov4/);
  assert.match(script, /listenport=\$listenPort/);
  assert.match(script, /connectaddress=\$connectAddress/);
  assert.match(script, /New-NetFirewallRule/);
  assert.match(script, /portproxy show v4tov4/);
  assert.match(script, /Portproxy verification failed/);
  assert.match(script, /Pi GUI Remote LAN 8787/);
  assert.match(script, /172\.20\.253\.149/);
});

test("windows portproxy launcher starts an elevated PowerShell encoded command", async () => {
  let captured: { file: string; args: string[]; timeoutMs: number } | undefined;
  await launchWindowsPortProxySetup({ listenPort: 8787, connectAddress: "172.20.253.149" }, async (file, args, options) => {
    captured = { file, args, timeoutMs: options.timeoutMs };
  });

  assert.match(captured?.file ?? "", /powershell\.exe$/);
  assert.deepEqual(captured?.args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
  assert.equal(captured?.timeoutMs, 120000);
  const command = captured?.args[3] ?? "";
  assert.match(command, /\$innerPowerShell = Join-Path \$PSHOME 'powershell\.exe'/);
  assert.match(command, /Start-Process -FilePath \$innerPowerShell -Verb RunAs .* -Wait -PassThru/);
  assert.match(command, /Elevated PowerShell exited with code/);
  const encoded = command.match(/-EncodedCommand','([^']+)'/)?.[1];
  assert.ok(encoded);
  const decoded = Buffer.from(encoded, "base64").toString("utf16le");
  assert.match(decoded, /connectAddress = '172\.20\.253\.149'/);
});

test("windows PowerShell resolver supports configured and WSL fallback paths", () => {
  assert.equal(resolveWindowsPowerShellExecutable({ PI_GUI_WINDOWS_POWERSHELL_PATH: "/custom/powershell.exe" }, () => false), "/custom/powershell.exe");
  assert.equal(
    resolveWindowsPowerShellExecutable({}, (path) => path === "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"),
    "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  assert.equal(resolveWindowsPowerShellExecutable({}, () => false), "powershell.exe");
});

test("windows portproxy launcher gives setup guidance when PowerShell is missing", async () => {
  await assert.rejects(
    () => launchWindowsPortProxySetup({ listenPort: 8787, connectAddress: "172.20.253.149" }, async () => {
      const error = new Error("spawn powershell.exe ENOENT") as Error & { code: string };
      error.code = "ENOENT";
      throw error;
    }),
    /PI_GUI_WINDOWS_POWERSHELL_PATH/,
  );
});

test("windows portproxy launcher rejects invalid target values", async () => {
  await assert.rejects(() => launchWindowsPortProxySetup({ listenPort: 0, connectAddress: "172.20.253.149" }, async () => undefined), /valid TCP port/);
  await assert.rejects(() => launchWindowsPortProxySetup({ listenPort: 8787, connectAddress: "not-an-ip" }, async () => undefined), /valid WSL IPv4/);
});

import { execFile } from "node:child_process";
import { Buffer } from "node:buffer";
import { isIP } from "node:net";
import { resolveWindowsPowerShellExecutable, windowsPowerShellUnavailableError } from "./windowsPowerShellService.js";

export type WindowsPortProxyRequest = {
  listenPort: number;
  connectAddress: string;
};

export type WindowsPortProxyRunner = (file: string, args: string[], options: { timeoutMs: number }) => Promise<void>;

export async function launchWindowsPortProxySetup(request: WindowsPortProxyRequest, runner: WindowsPortProxyRunner = execFileRunner): Promise<void> {
  validateWindowsPortProxyRequest(request);
  const encodedScript = encodePowerShellCommand(windowsPortProxyScript(request));
  const startElevatedCommand = [
    `$arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedScript}')`,
    "$innerPowerShell = Join-Path $PSHOME 'powershell.exe'",
    "$process = Start-Process -FilePath $innerPowerShell -Verb RunAs -ArgumentList $arguments -Wait -PassThru",
    "if ($process.ExitCode -ne 0) { throw \"Elevated PowerShell exited with code $($process.ExitCode)\" }",
  ].join("; ");
  try {
    await runner(resolveWindowsPowerShellExecutable(), ["-NoProfile", "-NonInteractive", "-Command", startElevatedCommand], { timeoutMs: 120_000 });
  } catch (error) {
    throw windowsPowerShellUnavailableError(error) ?? error;
  }
}

export function windowsPortProxyScript({ listenPort, connectAddress }: WindowsPortProxyRequest): string {
  validateWindowsPortProxyRequest({ listenPort, connectAddress });
  const ruleName = `Pi GUI Remote LAN ${listenPort}`;
  return `
$ErrorActionPreference = 'Stop'
$listenPort = ${listenPort}
$connectAddress = '${connectAddress}'
$ruleName = '${ruleName}'
netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$listenPort | Out-Null
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$listenPort connectaddress=$connectAddress connectport=$listenPort | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to configure portproxy for ${connectAddress}:${listenPort}" }
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existingRule) { Remove-NetFirewallRule -DisplayName $ruleName }
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $listenPort | Out-Null
$configured = netsh interface portproxy show v4tov4 | Select-String -SimpleMatch $connectAddress
if (-not $configured) { throw "Portproxy verification failed for ${connectAddress}:${listenPort}" }
Write-Host "Pi GUI Remote Access forwarding configured: 0.0.0.0:${listenPort} -> ${connectAddress}:${listenPort}"
`.trim();
}

function validateWindowsPortProxyRequest({ listenPort, connectAddress }: WindowsPortProxyRequest): void {
  if (!Number.isInteger(listenPort) || listenPort <= 0 || listenPort > 65535) throw new Error("Remote Access portproxy requires a valid TCP port");
  if (isIP(connectAddress) !== 4) throw new Error("Remote Access portproxy requires a valid WSL IPv4 address");
}

function encodePowerShellCommand(command: string): string {
  return Buffer.from(command, "utf16le").toString("base64");
}

function execFileRunner(file: string, args: string[], options: { timeoutMs: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: options.timeoutMs, windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

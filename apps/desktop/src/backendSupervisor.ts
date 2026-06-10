import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { WriteStream } from "node:fs";
import type { DesktopBackendHost, DesktopLaunchConfig } from "./desktopConfig.js";
import { appendProcessChunk } from "./logs.js";
import { backendEnv } from "./desktopConfig.js";

export type BackendSupervisor = {
  process: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  stop: () => Promise<void>;
};

export function startBackend(config: DesktopLaunchConfig, log: WriteStream): BackendSupervisor {
  return config.backendHost.kind === "wsl" ? startWslBackend(config, log) : startWindowsBackend(config, log);
}

export function startWslBackend(config: DesktopLaunchConfig, log: WriteStream): BackendSupervisor {
  return startManagedBackend("WSL", spawn("wsl.exe", wslArgs(config), {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }), config, log, backendShellScript(config));
}

export function startWindowsBackend(config: DesktopLaunchConfig, log: WriteStream): BackendSupervisor {
  const launch = windowsBackendLaunch(config);
  return startManagedBackend("Windows", spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }), config, log);
}

function startManagedBackend(label: string, child: ChildProcessWithoutNullStreams, config: DesktopLaunchConfig, log: WriteStream, stdinInput?: string): BackendSupervisor {
  child.stdin.end(stdinInput);
  child.stdout.on("data", (chunk: Buffer) => {
    appendProcessChunk(log, "stdout", chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    appendProcessChunk(log, "stderr", chunk);
    process.stderr.write(chunk);
  });

  let exited = false;
  const exitPromise = new Promise<never>((_resolve, reject) => {
    child.once("exit", (code, signal) => {
      exited = true;
      reject(new Error(`${label} backend exited before readiness${signal ? ` with signal ${signal}` : code === null ? "" : ` with code ${code}`}`));
    });
    child.once("error", (error) => {
      exited = true;
      reject(error);
    });
  });

  return {
    process: child,
    ready: Promise.race([waitForBackendHealth(config), exitPromise]),
    stop: () => stopChild(child, () => exited),
  };
}

export function wslArgs(config: DesktopLaunchConfig): string[] {
  const host = requireHost(config.backendHost, "wsl");
  return [
    ...(host.distro ? ["-d", host.distro] : []),
    "--cd",
    host.cwd,
    "--",
    "bash",
    "-se",
  ];
}

export function windowsBackendLaunch(config: DesktopLaunchConfig): {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
} {
  const host = requireHost(config.backendHost, "windows");
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", config.backendCommand],
    cwd: host.cwd,
    env: { ...process.env, ...backendEnv(config) },
  };
}

export function backendShellScript(config: DesktopLaunchConfig): string {
  const env = backendEnv(config);
  return [
    "set -e",
    ...Object.entries(env).map(([key, value]) => `export ${key}=${shellQuote(value)}`),
    config.backendCommand,
  ].join("\n");
}

export async function waitForBackendHealth(config: Pick<DesktopLaunchConfig, "backendPort" | "backendReadyTimeoutMs" | "authToken" | "desktopLaunchId">): Promise<void> {
  const deadline = Date.now() + config.backendReadyTimeoutMs;
  const url = `http://127.0.0.1:${config.backendPort}/api/desktop/ready`;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { authorization: `Bearer ${config.authToken}` },
      });
      if (!response.ok) {
        lastError = new Error(`Readiness check returned ${response.status}`);
      } else if (await isExpectedDesktopBackend(response, config.desktopLaunchId)) {
        return;
      } else {
        lastError = new Error("Readiness check reached a different Pi GUI backend instance");
      }
    } catch (error) {
      lastError = error;
    }
    await delay(350);
  }

  const suffix = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for Pi GUI backend at ${url}${suffix}`);
}

async function isExpectedDesktopBackend(response: Response, desktopLaunchId: string): Promise<boolean> {
  try {
    const payload = await response.json() as { ok?: unknown; mode?: unknown; launchId?: unknown };
    return payload.ok === true && payload.mode === "desktop" && payload.launchId === desktopLaunchId;
  } catch {
    return false;
  }
}

async function stopChild(child: ChildProcessWithoutNullStreams, isExited: () => boolean): Promise<void> {
  if (isExited()) return;
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(2500).then(() => {
      if (!isExited()) child.kill("SIGKILL");
    }),
  ]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireHost<K extends DesktopBackendHost["kind"]>(host: DesktopBackendHost, kind: K): Extract<DesktopBackendHost, { kind: K }> {
  if (host.kind !== kind) throw new Error(`Desktop backend host is ${host.kind}, not ${kind}`);
  return host as Extract<DesktopBackendHost, { kind: K }>;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

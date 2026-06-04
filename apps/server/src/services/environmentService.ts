import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, release } from "node:os";
import type { EnvironmentDiagnostics } from "@pi-gui/shared";

type ExecResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: Error;
};

type EnvironmentOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

export async function diagnoseEnvironment(options: EnvironmentOptions = {}): Promise<EnvironmentDiagnostics> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const [wsl, pi] = await Promise.all([detectWsl(env), detectPi(env)]);

  return {
    checkedAt: Date.now(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cwd,
    home: homedir(),
    wsl,
    pi,
  };
}

async function detectWsl(env: NodeJS.ProcessEnv): Promise<EnvironmentDiagnostics["wsl"]> {
  const kernelRelease = release();
  const procVersion = await readTextFile("/proc/version");
  const distroName = env.WSL_DISTRO_NAME || undefined;
  const isWsl = Boolean(distroName || /microsoft|wsl/i.test(`${kernelRelease}\n${procVersion ?? ""}`));
  return {
    isWsl,
    distroName,
    kernelRelease,
    interop: Boolean(env.WSL_INTEROP),
  };
}

async function detectPi(env: NodeJS.ProcessEnv): Promise<EnvironmentDiagnostics["pi"]> {
  const [pathResult, versionResult] = await Promise.all([
    execFileResult("which", ["pi"], { env, timeoutMs: 3_000 }),
    execFileResult("pi", ["--version"], { env, timeoutMs: 5_000 }),
  ]);
  const path = firstLine(pathResult.stdout);
  const version = firstLine(versionResult.stdout) ?? firstLine(versionResult.stderr);
  const installed = pathResult.ok || versionResult.ok;

  if (!installed) {
    return {
      installed: false,
      error: compactError(versionResult.error ?? pathResult.error, versionResult.stderr || pathResult.stderr),
    };
  }

  return {
    installed: true,
    path,
    version,
    error: versionResult.ok ? undefined : compactError(versionResult.error, versionResult.stderr),
  };
}

async function readTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function execFileResult(file: string, args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(file, args, { env: options.env, timeout: options.timeoutMs, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ?? undefined,
      });
    });
  });
}

function firstLine(value: string): string | undefined {
  return value
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
}

function compactError(error: Error | undefined, stderr: string): string | undefined {
  const text = firstLine(stderr) ?? error?.message;
  if (!text) return undefined;
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

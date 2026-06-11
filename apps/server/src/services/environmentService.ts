import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, release } from "node:os";
import { StringDecoder } from "node:string_decoder";
import type { EnvironmentDiagnostics, EnvironmentReadinessIssue } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import { LfJsonlParser, type JsonlParseBatch } from "../runtime/jsonlFraming.js";
import { readServerRuntimeConfig, type ServerRuntimeConfig } from "./serverConfig.js";

type ExecResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: Error;
};

type RpcSmokeResult = NonNullable<EnvironmentDiagnostics["pi"]["rpcSmoke"]>;

type EnvironmentDependencies = {
  now: () => number;
  platform: string;
  arch: string;
  nodeVersion: string;
  home: () => string;
  kernelRelease: () => string;
  readTextFile: (path: string) => Promise<string | undefined>;
  execFile: (file: string, args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<ExecResult>;
  rpcSmoke: (env: NodeJS.ProcessEnv) => Promise<RpcSmokeResult>;
  serverConfig: (env: NodeJS.ProcessEnv) => ServerRuntimeConfig;
};

type EnvironmentOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  dependencies?: Partial<EnvironmentDependencies>;
};

const PI_RPC_SMOKE_COMMAND = "get_available_models";
const ENVIRONMENT_SUCCESS_TTL_MS = 45_000;
const ENVIRONMENT_FAILURE_TTL_MS = 8_000;

let environmentCache: { diagnostics: EnvironmentDiagnostics; expiresAt: number } | undefined;
let environmentRefreshInFlight: Promise<EnvironmentDiagnostics> | undefined;

export async function getCachedEnvironmentDiagnostics(options: EnvironmentOptions = {}): Promise<EnvironmentDiagnostics> {
  const now = Date.now();
  if (environmentCache && environmentCache.expiresAt > now) return cloneDiagnostics(environmentCache.diagnostics);
  if (environmentRefreshInFlight) return cloneDiagnostics(await environmentRefreshInFlight);

  environmentRefreshInFlight = diagnoseEnvironment(options)
    .then((diagnostics) => {
      const ttl = diagnostics.readiness?.status === "ready" ? ENVIRONMENT_SUCCESS_TTL_MS : ENVIRONMENT_FAILURE_TTL_MS;
      environmentCache = { diagnostics: cloneDiagnostics(diagnostics), expiresAt: Date.now() + ttl };
      return diagnostics;
    })
    .catch((error) => {
      if (environmentCache) {
        environmentCache = { diagnostics: environmentCache.diagnostics, expiresAt: Date.now() + ENVIRONMENT_FAILURE_TTL_MS };
        return cloneDiagnostics(environmentCache.diagnostics);
      }
      throw error;
    })
    .finally(() => {
      environmentRefreshInFlight = undefined;
    });
  return cloneDiagnostics(await environmentRefreshInFlight);
}

export function resetEnvironmentDiagnosticsCacheForTest(): void {
  environmentCache = undefined;
  environmentRefreshInFlight = undefined;
}

export async function diagnoseEnvironment(options: EnvironmentOptions = {}): Promise<EnvironmentDiagnostics> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const dependencies = environmentDependencies(options.dependencies);
  const [wsl, npmResult, pi] = await Promise.all([detectWsl(env, dependencies), detectNpm(env, dependencies), detectPi(env, dependencies)]);
  const diagnostics: EnvironmentDiagnostics = {
    checkedAt: dependencies.now(),
    platform: dependencies.platform,
    arch: dependencies.arch,
    nodeVersion: dependencies.nodeVersion,
    npmVersion: npmResult.version,
    cwd,
    home: dependencies.home(),
    backend: backendDiagnostics(dependencies.serverConfig(env)),
    wsl,
    pi,
  };

  return {
    ...diagnostics,
    readiness: readinessFromDiagnostics(diagnostics, npmResult.error),
  };
}

function cloneDiagnostics(diagnostics: EnvironmentDiagnostics): EnvironmentDiagnostics {
  return JSON.parse(JSON.stringify(diagnostics)) as EnvironmentDiagnostics;
}

function backendDiagnostics(config: ServerRuntimeConfig): NonNullable<EnvironmentDiagnostics["backend"]> {
  return { host: config.host, port: config.port, mode: config.mode };
}

function environmentDependencies(overrides: Partial<EnvironmentDependencies> = {}): EnvironmentDependencies {
  return {
    now: Date.now,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    home: homedir,
    kernelRelease: release,
    readTextFile,
    execFile: execFileResult,
    rpcSmoke: piRpcSmoke,
    serverConfig: readServerRuntimeConfig,
    ...overrides,
  };
}

async function detectWsl(env: NodeJS.ProcessEnv, dependencies: EnvironmentDependencies): Promise<EnvironmentDiagnostics["wsl"]> {
  const kernelRelease = dependencies.kernelRelease();
  const procVersion = await dependencies.readTextFile("/proc/version");
  const distroName = env.WSL_DISTRO_NAME || undefined;
  const isWsl = Boolean(distroName || /microsoft|wsl/i.test(`${kernelRelease}\n${procVersion ?? ""}`));
  return {
    isWsl,
    distroName,
    kernelRelease,
    interop: Boolean(env.WSL_INTEROP),
  };
}

async function detectNpm(env: NodeJS.ProcessEnv, dependencies: EnvironmentDependencies): Promise<{ version?: string; error?: string }> {
  const result = await dependencies.execFile("npm", ["--version"], { env, timeoutMs: 3_000 });
  return {
    version: firstLine(result.stdout),
    error: result.ok ? undefined : compactError(result.error, result.stderr),
  };
}

async function detectPi(env: NodeJS.ProcessEnv, dependencies: EnvironmentDependencies): Promise<EnvironmentDiagnostics["pi"]> {
  const [pathResult, versionResult] = await Promise.all([
    dependencies.execFile("which", ["pi"], { env, timeoutMs: 3_000 }),
    dependencies.execFile("pi", ["--version"], { env, timeoutMs: 5_000 }),
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
    rpcSmoke: await dependencies.rpcSmoke(env),
  };
}

function readinessFromDiagnostics(diagnostics: EnvironmentDiagnostics, npmError?: string): EnvironmentDiagnostics["readiness"] {
  const issues: EnvironmentReadinessIssue[] = [];

  if (!diagnostics.wsl.isWsl) {
    issues.push({
      code: "wsl_not_detected",
      severity: diagnostics.platform === "win32" ? "error" : "warning",
      message: "未检测到 WSL 环境",
      detail: `backend platform: ${diagnostics.platform}`,
      remediation: "桌面版需要在 WSL 内运行 Pi GUI backend；请确认 Electron 启动的是 WSL backend。",
    });
  } else if (!diagnostics.wsl.interop) {
    issues.push({
      code: "wsl_interop_unavailable",
      severity: "warning",
      message: "WSL interop 不可用",
      remediation: "如果桌面壳需要从 Windows 管理 WSL，请确认 WSL interop 未被禁用。",
    });
  }

  if (!diagnostics.npmVersion) {
    issues.push({
      code: "npm_unavailable",
      severity: "warning",
      message: "未检测到 npm",
      detail: npmError,
      remediation: "请确认 WSL 内 Node/npm 安装完整，并且 npm 在 PATH 中。",
    });
  }

  if (!diagnostics.pi.installed) {
    issues.push({
      code: "pi_not_installed",
      severity: "error",
      message: "未检测到 Pi CLI",
      detail: diagnostics.pi.error,
      remediation: "请在 WSL 内安装 Pi，并确认 `pi` 在 PATH 中可执行。",
    });
  } else if (diagnostics.pi.rpcSmoke && !diagnostics.pi.rpcSmoke.ok) {
    issues.push({
      code: "pi_rpc_smoke_failed",
      severity: "error",
      message: "Pi RPC smoke 检测失败",
      detail: diagnostics.pi.rpcSmoke.error,
      remediation: "请在 WSL 终端运行 `pi --mode rpc --no-session` 检查登录、模型配置和 provider 凭据。",
    });
  }

  return {
    status: issues.some((issue) => issue.severity === "error") ? "error" : issues.length > 0 ? "warning" : "ready",
    issues,
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

function piRpcSmoke(env: NodeJS.ProcessEnv, timeoutMs = 5_000): Promise<RpcSmokeResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const proc = spawn("pi", ["--mode", "rpc", "--no-session"], {
      cwd: env.HOME || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    const parser = new LfJsonlParser();
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let stderrBuffer = "";
    let settled = false;

    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.kill("SIGTERM");
      resolve({ ok, command: PI_RPC_SMOKE_COMMAND, durationMs: Date.now() - startedAt, error });
    };

    const handleBatch = (batch: JsonlParseBatch) => {
      const [parseError] = batch.errors;
      if (parseError) {
        finish(false, parseError.message);
        return;
      }

      for (const message of batch.records) {
        if (!isRecord(message) || message.type !== "response" || message.id !== "environment-smoke") continue;
        if (message.success === true) finish(true);
        else finish(false, typeof message.error === "string" ? message.error : `${PI_RPC_SMOKE_COMMAND} failed`);
        return;
      }
    };

    const timer = setTimeout(() => finish(false, `Timed out after ${timeoutMs}ms`), timeoutMs);
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += stderrDecoder.write(chunk);
    });
    proc.on("error", (error) => finish(false, error.message));
    proc.on("exit", () => {
      stderrBuffer += stderrDecoder.end();
      if (!settled) {
        handleBatch(parser.end(stdoutDecoder.end()));
        if (!settled) finish(false, firstLine(stderrBuffer) ?? "Pi RPC exited before smoke response");
      }
    });
    proc.stdout.on("data", (chunk: Buffer) => {
      handleBatch(parser.push(stdoutDecoder.write(chunk)));
    });
    proc.stdin.write(`${JSON.stringify({ id: "environment-smoke", type: PI_RPC_SMOKE_COMMAND })}\n`);
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

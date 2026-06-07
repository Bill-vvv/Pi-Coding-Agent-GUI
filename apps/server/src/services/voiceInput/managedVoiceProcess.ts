import { spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { VoiceInputError } from "./errors.js";
import type { VoiceInputEffectiveConfig } from "./types.js";

export class ManagedVoiceProcess {
  private child?: ChildProcess;
  private starting?: Promise<void>;

  async ensureStarted(config: VoiceInputEffectiveConfig): Promise<void> {
    if (config.mode !== "managedProcess") return;
    if (!config.managedCommand) throw new VoiceInputError("Voice input managed command is not configured", 400, "voice_input_not_configured");
    await validateConfiguredPaths(config);
    if (this.child && this.child.exitCode === null && !this.child.killed) return;
    if (this.starting) return this.starting;
    this.starting = this.start(config).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  statusState(): "starting" | undefined {
    return this.starting ? "starting" : undefined;
  }

  stop(): void {
    const child = this.child;
    this.child = undefined;
    if (!child || child.killed || child.exitCode !== null) return;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
    }, 3_000).unref();
  }

  private async start(config: VoiceInputEffectiveConfig): Promise<void> {
    const env = { ...process.env };
    if (config.modelPath) env.PI_GUI_VOICE_MODEL_PATH = config.modelPath;
    const child = spawn(config.managedCommand as string, config.managedArgs, {
      cwd: config.managedCwd || process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const startupOutput = createStartupOutputCapture();
    this.child = child;
    child.stdout?.on("data", startupOutput.stdout);
    child.stderr?.on("data", startupOutput.stderr);
    child.on("exit", () => {
      if (this.child === child) this.child = undefined;
    });
    await waitForProcessWarmup(child, Math.min(config.startupTimeoutMs, 2_000), startupOutput.format);
  }
}

type StartupOutputCapture = {
  stdout: (chunk: unknown) => void;
  stderr: (chunk: unknown) => void;
  format: () => string;
};

const MAX_STARTUP_OUTPUT_BYTES = 4_000;

function createStartupOutputCapture(): StartupOutputCapture {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;

  return {
    stdout: (chunk) => {
      stdoutBytes = appendBoundedChunk(stdout, stdoutBytes, chunk);
    },
    stderr: (chunk) => {
      stderrBytes = appendBoundedChunk(stderr, stderrBytes, chunk);
    },
    format: () => formatStartupOutput(stdout, stderr),
  };
}

function appendBoundedChunk(chunks: Buffer[], currentBytes: number, chunk: unknown): number {
  if (currentBytes >= MAX_STARTUP_OUTPUT_BYTES) return currentBytes;
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  const remaining = MAX_STARTUP_OUTPUT_BYTES - currentBytes;
  chunks.push(buffer.subarray(0, remaining));
  return currentBytes + Math.min(buffer.length, remaining);
}

function formatStartupOutput(stdout: Buffer[], stderr: Buffer[]): string {
  const parts: string[] = [];
  const stderrText = decodeOutput(stderr);
  const stdoutText = decodeOutput(stdout);
  if (stderrText) parts.push(`stderr: ${stderrText}`);
  if (stdoutText) parts.push(`stdout: ${stdoutText}`);
  return parts.join("; ");
}

function decodeOutput(chunks: Buffer[]): string {
  return Buffer.concat(chunks).toString("utf8").replace(/\s+/g, " ").trim().slice(0, 1_000);
}

async function validateConfiguredPaths(config: VoiceInputEffectiveConfig): Promise<void> {
  if (config.managedCwd) {
    const cwdStat = await stat(config.managedCwd).catch(() => undefined);
    if (!cwdStat?.isDirectory()) throw new VoiceInputError("Voice input managed cwd does not exist or is not a directory", 400, "voice_input_not_configured");
  }
  if (config.modelPath) {
    const modelStat = await stat(config.modelPath).catch(() => undefined);
    if (!modelStat) throw new VoiceInputError("Voice input model path does not exist", 400, "voice_input_not_configured");
  }
}

async function waitForProcessWarmup(child: ChildProcess, delayMs: number, startupOutput: () => string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new VoiceInputError(`Voice input managed process failed to start: ${error.message}${startupOutputSuffix(startupOutput)}`, 503, "managed_process_error"));
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new VoiceInputError(`Voice input managed process exited during startup (${code ?? signal ?? "unknown"})${startupOutputSuffix(startupOutput)}`, 503, "managed_process_error"));
    });
  });
}

function startupOutputSuffix(startupOutput: () => string): string {
  const output = startupOutput();
  return output ? `: ${output}` : "";
}

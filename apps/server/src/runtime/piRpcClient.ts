import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";

type PiRpcClientEvents = {
  event: [payload: unknown];
  stderr: [chunk: string];
  error: [error: Error];
  exit: [code: number | null, signal: NodeJS.Signals | null];
};

const DEFAULT_STOP_GRACE_MS = 2500;
const MAX_UNTERMINATED_JSONL_PREVIEW_CHARS = 120;
const SERVICE_TIER_EXTENSION_PATH = resolveSiblingExtensionPath();

export class PiRpcClient extends EventEmitter<PiRpcClientEvents> {
  private proc?: ChildProcessWithoutNullStreams;
  private stdoutBuffer = "";
  private stdoutDecoder = new StringDecoder("utf8");
  private stderrDecoder = new StringDecoder("utf8");
  private stopping = false;
  private exited = false;

  constructor(
    private readonly cwd: string,
    private readonly options: { model?: string; thinkingLevel?: string; serviceTierConfigFile?: string } = {},
  ) {
    super();
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  get isStopping(): boolean {
    return this.stopping;
  }

  start(): void {
    if (this.proc) {
      throw new Error("Pi RPC process already started");
    }

    const args = ["--mode", "rpc"];
    if (this.options.model) {
      args.push("--model", this.options.model);
    }
    if (this.options.thinkingLevel) {
      args.push("--thinking", this.options.thinkingLevel);
    }
    if (this.options.serviceTierConfigFile) {
      args.push("--extension", SERVICE_TIER_EXTENSION_PATH);
    }

    this.proc = spawn("pi", args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(this.options.serviceTierConfigFile ? { PI_GUI_SERVICE_TIER_FILE: this.options.serviceTierConfigFile } : {}),
      },
    });

    this.proc.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    this.proc.stderr.on("data", (chunk: Buffer) => this.emit("stderr", this.stderrDecoder.write(chunk)));
    this.proc.on("error", (error) => this.emit("error", error));
    this.proc.on("exit", (code, signal) => {
      this.exited = true;
      const tail = this.stdoutDecoder.end();
      if (tail) this.stdoutBuffer += tail;
      if (this.stdoutBuffer.length > 0) {
        this.emit("error", new Error(formatUnterminatedJsonlError(this.stdoutBuffer)));
        this.stdoutBuffer = "";
      }
      const stderrTail = this.stderrDecoder.end();
      if (stderrTail) this.emit("stderr", stderrTail);
      this.emit("exit", code, signal);
    });
  }

  send(command: Record<string, unknown>): void {
    if (command.type === "set_service_tier") {
      this.setServiceTier(command.serviceTier);
      this.emit("event", {
        id: command.id,
        type: "response",
        command: "set_service_tier",
        success: true,
        data: { serviceTier: command.serviceTier },
      });
      return;
    }

    if (!this.proc || !this.proc.stdin.writable) {
      throw new Error("Pi RPC process is not writable");
    }
    this.proc.stdin.write(`${JSON.stringify(command)}\n`);
  }

  stop(graceMs = DEFAULT_STOP_GRACE_MS): void {
    if (!this.proc || this.stopping) return;
    this.stopping = true;
    const proc = this.proc;
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!this.exited && proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGKILL");
      }
    }, graceMs).unref();
  }

  private setServiceTier(serviceTier: unknown): void {
    if (!this.options.serviceTierConfigFile) return;
    const normalized = normalizeServiceTier(serviceTier);
    mkdirSync(dirname(this.options.serviceTierConfigFile), { recursive: true });
    writeFileSync(this.options.serviceTierConfigFile, JSON.stringify(normalized ? { serviceTier: normalized } : {}), "utf8");
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer += this.stdoutDecoder.write(chunk);

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) break;

      let line = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.parseLine(line);
    }
  }

  private parseLine(line: string): void {
    if (line.length === 0) return;
    try {
      this.emit("event", JSON.parse(line));
    } catch (error) {
      this.emit("error", new Error(`Failed to parse Pi RPC JSONL record: ${(error as Error).message}`));
    }
  }
}

function resolveSiblingExtensionPath(): string {
  const jsPath = fileURLToPath(new URL("./piServiceTierExtension.js", import.meta.url));
  if (existsSync(jsPath)) return jsPath;

  const tsPath = fileURLToPath(new URL("./piServiceTierExtension.ts", import.meta.url));
  if (existsSync(tsPath)) return tsPath;

  return jsPath;
}

function normalizeServiceTier(serviceTier: unknown): "default" | "flex" | "scale" | "priority" | undefined {
  return serviceTier === "default" || serviceTier === "flex" || serviceTier === "scale" || serviceTier === "priority" ? serviceTier : undefined;
}

function formatUnterminatedJsonlError(buffer: string): string {
  const preview =
    buffer.length > MAX_UNTERMINATED_JSONL_PREVIEW_CHARS
      ? `${buffer.slice(0, MAX_UNTERMINATED_JSONL_PREVIEW_CHARS)}…`
      : buffer;
  return `Pi RPC stdout ended with an unterminated JSONL record (${buffer.length} chars): ${JSON.stringify(preview)}`;
}

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { LfJsonlParser } from "./jsonlFraming.js";

type PiRpcClientEvents = {
  event: [payload: unknown];
  stderr: [chunk: string];
  error: [error: Error];
  exit: [code: number | null, signal: NodeJS.Signals | null];
};

const DEFAULT_STOP_GRACE_MS = 2500;

export class PiRpcClient extends EventEmitter<PiRpcClientEvents> {
  private proc?: ChildProcessWithoutNullStreams;
  private stdoutParser = new LfJsonlParser();
  private stdoutDecoder = new StringDecoder("utf8");
  private stderrDecoder = new StringDecoder("utf8");
  private stopping = false;
  private exited = false;

  constructor(
    private readonly cwd: string,
    private readonly options: { model?: string; thinkingLevel?: string; serviceTierConfigFile?: string; session?: string; extensionPaths?: string[] } = {},
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
    if (this.options.session) {
      args.push("--session", this.options.session);
    }
    if (this.options.model) {
      args.push("--model", this.options.model);
    }
    if (this.options.thinkingLevel) {
      args.push("--thinking", this.options.thinkingLevel);
    }
    for (const extensionPath of this.options.extensionPaths ?? []) {
      args.push("--extension", extensionPath);
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
      this.emitBatch(this.stdoutParser.end(this.stdoutDecoder.end()));
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
    this.emitBatch(this.stdoutParser.push(this.stdoutDecoder.write(chunk)));
  }

  private emitBatch(batch: { records: unknown[]; errors: Error[] }): void {
    for (const record of batch.records) this.emit("event", record);
    for (const error of batch.errors) this.emit("error", error);
  }
}

function normalizeServiceTier(serviceTier: unknown): "default" | "flex" | "scale" | "priority" | undefined {
  return serviceTier === "default" || serviceTier === "flex" || serviceTier === "scale" || serviceTier === "priority" ? serviceTier : undefined;
}


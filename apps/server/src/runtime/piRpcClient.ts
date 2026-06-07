import { isServiceTier, type ServiceTier } from "@pi-gui/shared";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { parseSshProjectCwd, remoteCdCommand, shellQuote } from "../services/sshProjectService.js";
import { LfJsonlParser } from "./jsonlFraming.js";

type PiRpcClientEvents = {
  event: [payload: unknown];
  stderr: [chunk: string];
  error: [error: Error];
  exit: [code: number | null, signal: NodeJS.Signals | null];
};

type PendingRequest = {
  resolve: (response: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_STOP_GRACE_MS = 2500;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const SESSION_CONTEXT_ENV_KEYS = ["TRELLIS_CONTEXT_ID", "PI_SESSION_ID", "PI_SESSIONID"] as const;

export class PiRpcClient extends EventEmitter<PiRpcClientEvents> {
  private proc?: ChildProcessWithoutNullStreams;
  private stdoutParser = new LfJsonlParser();
  private stdoutDecoder = new StringDecoder("utf8");
  private stderrDecoder = new StringDecoder("utf8");
  private pendingRequests = new Map<string, PendingRequest>();
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

    const remoteTarget = parseSshProjectCwd(this.cwd);
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
    // Internal GUI extensions are local files. They cannot be passed to a remote
    // Pi runtime unless they are installed on that remote machine too.
    if (!remoteTarget) {
      for (const extensionPath of this.options.extensionPaths ?? []) {
        args.push("--extension", extensionPath);
      }
    }

    const launch = remoteTarget ? remotePiRpcLaunch(remoteTarget, args) : { command: "pi", args, cwd: this.cwd };
    this.proc = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: createPiRuntimeEnv(remoteTarget ? undefined : this.options.serviceTierConfigFile),
    });

    this.proc.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    this.proc.stderr.on("data", (chunk: Buffer) => this.emit("stderr", this.stderrDecoder.write(chunk)));
    this.proc.on("error", (error) => {
      this.rejectPendingRequests(error);
      this.emit("error", error);
    });
    this.proc.on("exit", (code, signal) => {
      this.exited = true;
      this.emitBatch(this.stdoutParser.end(this.stdoutDecoder.end()));
      this.rejectPendingRequests(new Error(`Pi RPC process exited before responding${code === null ? "" : ` with code ${code}`}`));
      const stderrTail = this.stderrDecoder.end();
      if (stderrTail) this.emit("stderr", stderrTail);
      this.emit("exit", code, signal);
    });
  }

  request(command: Record<string, unknown>, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<Record<string, unknown>> {
    if (typeof command.id !== "string") throw new Error("Pi RPC request requires string id");
    const id = command.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timed out waiting for Pi RPC response: ${String(command.type)}`));
      }, timeoutMs);
      timer.unref?.();
      this.pendingRequests.set(id, { resolve, reject, timer });
      try {
        this.send(command);
      } catch (error) {
        this.pendingRequests.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  send(command: Record<string, unknown>): void {
    if (command.type === "set_service_tier") {
      this.setServiceTier(command.serviceTier);
      const response = {
        id: command.id,
        type: "response",
        command: "set_service_tier",
        success: true,
        data: { serviceTier: command.serviceTier },
      };
      this.resolvePendingResponse(response);
      this.emit("event", response);
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
    for (const record of batch.records) {
      this.resolvePendingResponse(record);
      this.emit("event", record);
    }
    for (const error of batch.errors) this.emit("error", error);
  }

  private resolvePendingResponse(payload: unknown): void {
    if (!isRecord(payload) || payload.type !== "response" || typeof payload.id !== "string") return;
    const pending = this.pendingRequests.get(payload.id);
    if (!pending) return;
    this.pendingRequests.delete(payload.id);
    clearTimeout(pending.timer);
    pending.resolve(payload);
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createPiRuntimeEnv(serviceTierConfigFile?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of SESSION_CONTEXT_ENV_KEYS) delete env[key];
  env.PI_GUI_CODEX_TRANSPORT_MONITOR ??= "1";
  env.PI_GUI_ASK_BATCH_DIALOG = "1";
  if (serviceTierConfigFile) env.PI_GUI_SERVICE_TIER_FILE = serviceTierConfigFile;
  return env;
}

function normalizeServiceTier(serviceTier: unknown): ServiceTier | undefined {
  // Explicit "auto" is a real provider service_tier value and is persisted.
  // Omitted/invalid values clear the GUI override by writing an empty config.
  return isServiceTier(serviceTier) ? serviceTier : undefined;
}

type RemoteLaunchTarget = NonNullable<ReturnType<typeof parseSshProjectCwd>>;

function remotePiRpcLaunch(target: RemoteLaunchTarget, piArgs: string[]): { command: string; args: string[]; cwd?: string } {
  const script = [
    "set -e",
    remoteCdCommand(target.remoteCwd),
    "export PI_GUI_ASK_BATCH_DIALOG=1",
    "command -v pi >/dev/null 2>&1 || { echo 'pi-gui: remote command not found: pi' >&2; exit 127; }",
    `exec pi ${piArgs.map(shellQuote).join(" ")}`,
  ].join("\n");
  const sshArgs = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
  ];
  if (target.port) sshArgs.push("-p", target.port);
  sshArgs.push(target.sshHost, `sh -c ${shellQuote(script)}`);
  return { command: "ssh", args: sshArgs };
}


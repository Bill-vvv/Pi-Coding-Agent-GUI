import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { LfJsonlParser } from "../src/runtime/jsonlFraming.js";

const cwd = process.env.PI_GUI_SMOKE_CWD ?? process.cwd();
const timeoutMs = boundedIntegerEnv("PI_GUI_SMOKE_TIMEOUT_MS", 10_000, 1_000, 120_000);
const requestId = `pi-gui-smoke-${randomUUID()}`;
const args = ["--mode", "rpc"];

if (process.env.PI_GUI_SMOKE_SESSION) args.push("--session", process.env.PI_GUI_SMOKE_SESSION);
if (process.env.PI_GUI_SMOKE_MODEL) args.push("--model", process.env.PI_GUI_SMOKE_MODEL);
if (process.env.PI_GUI_SMOKE_THINKING) args.push("--thinking", process.env.PI_GUI_SMOKE_THINKING);

const stdoutParser = new LfJsonlParser();
const stdoutDecoder = new StringDecoder("utf8");
const stderrDecoder = new StringDecoder("utf8");
let stderrText = "";
let settled = false;

const proc = spawn("pi", args, {
  cwd,
  stdio: ["pipe", "pipe", "pipe"],
});

const timeout = setTimeout(() => {
  finish(1, `Timed out after ${timeoutMs}ms waiting for get_state response.`);
}, timeoutMs);
timeout.unref();

proc.stdout.on("data", (chunk: Buffer) => handleStdout(stdoutDecoder.write(chunk)));
proc.stderr.on("data", (chunk: Buffer) => {
  stderrText += stderrDecoder.write(chunk);
});
proc.on("error", (error) => finish(1, `Failed to start pi --mode rpc: ${error.message}`));
proc.on("exit", (code, signal) => {
  handleStdout(stdoutDecoder.end(), true);
  const stderrTail = stderrDecoder.end();
  if (stderrTail) stderrText += stderrTail;
  if (!settled) finish(1, `pi --mode rpc exited before get_state response (code=${code}, signal=${signal}).`);
});

proc.stdin.write(`${JSON.stringify({ id: requestId, type: "get_state" })}\n`);

function handleStdout(text: string, final = false): void {
  const batch = final ? stdoutParser.end(text) : stdoutParser.push(text);
  for (const error of batch.errors) {
    finish(1, error.message);
    return;
  }

  for (const record of batch.records) {
    if (!isRecord(record) || record.type !== "response" || record.id !== requestId) continue;
    if (record.success !== true) {
      finish(1, `get_state failed: ${JSON.stringify(record.error ?? record)}`);
      return;
    }

    const data = isRecord(record.data) ? record.data : {};
    finish(0, `pi --mode rpc smoke test passed. sessionId=${typeof data.sessionId === "string" ? data.sessionId : "unknown"}`);
    return;
  }
}

function finish(code: number, message: string): void {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  if (code === 0) {
    console.log(message);
  } else {
    console.error(message);
    if (stderrText.trim()) console.error(`\n--- stderr ---\n${stderrText.trimEnd()}`);
  }
  if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGTERM");
  process.exitCode = code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function boundedIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const rawValue = process.env[name];
  if (!rawValue) return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

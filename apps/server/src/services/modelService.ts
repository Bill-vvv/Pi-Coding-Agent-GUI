import { execFile, spawn } from "node:child_process";
import type { ModelSummary, ThinkingLevel } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";

export async function listPiModels(): Promise<ModelSummary[]> {
  const fromRpc = await listPiModelsViaRpc().catch(() => []);
  if (fromRpc.length > 0) return fromRpc;

  try {
    const { stdout } = await execFileAsync("pi", ["--list-models"]);
    return parsePiModelList(stdout);
  } catch {
    return [];
  }
}

function listPiModelsViaRpc(timeoutMs = 12_000): Promise<ModelSummary[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pi", ["--mode", "rpc", "--no-session"], {
      cwd: process.env.HOME || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

    const settle = (models: ModelSummary[], error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.kill("SIGTERM");
      if (error) reject(error);
      else resolve(models);
    };

    const timer = setTimeout(() => settle([], new Error("Timed out while reading Pi models")), timeoutMs);
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf8");
    });
    proc.on("error", (error) => settle([], error));
    proc.on("exit", () => {
      if (!settled) settle([], new Error(stderrBuffer || "Pi RPC exited before model list response"));
    });
    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      while (true) {
        const newlineIndex = stdoutBuffer.indexOf("\n");
        if (newlineIndex === -1) break;
        let line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line) continue;
        let message: unknown;
        try {
          message = JSON.parse(line) as unknown;
        } catch (error) {
          settle([], new Error(`Failed to parse Pi model RPC JSONL record: ${(error as Error).message}`));
          return;
        }
        if (!isRecord(message) || message.type !== "response" || message.id !== "gui-models") continue;
        if (message.success !== true) {
          settle([], new Error(typeof message.error === "string" ? message.error : "get_available_models failed"));
          return;
        }
        const data = isRecord(message.data) ? message.data : undefined;
        const models = Array.isArray(data?.models) ? data.models : [];
        settle(models.map(modelSummaryFromRpcModel).filter((model): model is ModelSummary => Boolean(model)));
      }
    });
    proc.stdin.write(`${JSON.stringify({ id: "gui-models", type: "get_available_models" })}\n`);
  });
}

function modelSummaryFromRpcModel(value: unknown): ModelSummary | undefined {
  if (!isRecord(value) || typeof value.provider !== "string" || typeof value.id !== "string") return undefined;
  const name = typeof value.name === "string" ? value.name : value.id;
  const input = Array.isArray(value.input) ? value.input : [];
  const supportedThinkingLevels = supportedThinkingLevelsFromRpcModel(value);
  return {
    provider: value.provider,
    id: value.id,
    label: `${value.provider}/${name}`,
    supportsThinking: value.reasoning === true,
    supportedThinkingLevels,
    supportsImages: input.includes("image"),
    supportsFast: supportsPriorityServiceTier(value),
    contextWindow: numberOrUndefined(value.contextWindow),
  };
}

function parsePiModelList(output: string): ModelSummary[] {
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const [, ...rows] = lines;
  return rows.flatMap((line) => {
    const columns = line.split(/\s+/);
    const [provider, id, , , thinking, images] = columns;
    if (!provider || !id) return [];
    return [
      {
        provider,
        id,
        label: `${provider}/${id}`,
        supportsThinking: thinking === "yes",
        supportsImages: images === "yes",
        supportsFast: supportsPriorityServiceTier({ provider, id }),
      },
    ];
  });
}

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function supportedThinkingLevelsFromRpcModel(model: Record<string, unknown>): ThinkingLevel[] | undefined {
  if (model.reasoning !== true) return undefined;
  const thinkingLevelMap = isRecord(model.thinkingLevelMap) ? model.thinkingLevelMap : undefined;
  return THINKING_LEVELS.filter((level) => {
    const mapped = thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh") return mapped !== undefined;
    return true;
  });
}

function supportsPriorityServiceTier(model: Record<string, unknown>): boolean {
  const provider = typeof model.provider === "string" ? model.provider : "";
  const api = typeof model.api === "string" ? model.api : undefined;
  if (api) return (provider === "openai" && api === "openai-responses") || (provider === "openai-codex" && api === "openai-codex-responses");
  return provider === "openai" || provider === "openai-codex";
}

function execFileAsync(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

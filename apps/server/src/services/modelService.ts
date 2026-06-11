import { execFile, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { ModelSummary, ThinkingLevel } from "@pi-gui/shared";
import { isRecord } from "@pi-gui/shared";
import { LfJsonlParser, type JsonlParseBatch } from "../runtime/jsonlFraming.js";

const MODEL_CACHE_SUCCESS_TTL_MS = 5 * 60_000;
const MODEL_CACHE_FAILURE_TTL_MS = 15_000;

let modelCache: { models: ModelSummary[]; expiresAt: number } | undefined;
let modelRefreshInFlight: Promise<ModelSummary[]> | undefined;

export async function listPiModels(): Promise<ModelSummary[]> {
  const now = Date.now();
  if (modelCache && modelCache.expiresAt > now) return cloneModels(modelCache.models);
  if (modelRefreshInFlight) return cloneModels(await modelRefreshInFlight);

  modelRefreshInFlight = refreshPiModels()
    .then((models) => {
      modelCache = { models: cloneModels(models), expiresAt: Date.now() + (models.length > 0 ? MODEL_CACHE_SUCCESS_TTL_MS : MODEL_CACHE_FAILURE_TTL_MS) };
      return models;
    })
    .catch(() => {
      if (modelCache?.models.length) {
        modelCache = { models: modelCache.models, expiresAt: Date.now() + MODEL_CACHE_FAILURE_TTL_MS };
        return cloneModels(modelCache.models);
      }
      modelCache = { models: [], expiresAt: Date.now() + MODEL_CACHE_FAILURE_TTL_MS };
      return [];
    })
    .finally(() => {
      modelRefreshInFlight = undefined;
    });
  return cloneModels(await modelRefreshInFlight);
}

async function refreshPiModels(): Promise<ModelSummary[]> {
  // Pi/provider model discovery is the authoritative source. The CLI fallback
  // below is a GUI projection fallback only; do not treat it as provider truth
  // or use it to reject user-selected model IDs before Pi sees them.
  const fromRpc = await listPiModelsViaRpc().catch(() => []);
  if (fromRpc.length > 0) return fromRpc;

  const { stdout } = await execFileAsync("pi", ["--list-models"]);
  return parsePiModelList(stdout);
}

function cloneModels(models: ModelSummary[]): ModelSummary[] {
  return models.map((model) => ({ ...model, supportedThinkingLevels: model.supportedThinkingLevels ? [...model.supportedThinkingLevels] : undefined }));
}

function listPiModelsViaRpc(timeoutMs = 12_000): Promise<ModelSummary[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pi", ["--mode", "rpc", "--no-session"], {
      cwd: process.env.HOME || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    const stdoutParser = new LfJsonlParser();
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
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

    const handleBatch = (batch: JsonlParseBatch) => {
      const [error] = batch.errors;
      if (error) {
        settle([], error);
        return;
      }

      for (const message of batch.records) {
        if (!isRecord(message) || message.type !== "response" || message.id !== "gui-models") continue;
        if (message.success !== true) {
          settle([], new Error(typeof message.error === "string" ? message.error : "get_available_models failed"));
          return;
        }
        const data = isRecord(message.data) ? message.data : undefined;
        const models = Array.isArray(data?.models) ? data.models : [];
        settle(models.map(modelSummaryFromRpcModel).filter((model): model is ModelSummary => Boolean(model)));
        return;
      }
    };

    const timer = setTimeout(() => settle([], new Error("Timed out while reading Pi models")), timeoutMs);
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += stderrDecoder.write(chunk);
    });
    proc.on("error", (error) => settle([], error));
    proc.on("exit", () => {
      stderrBuffer += stderrDecoder.end();
      if (!settled) {
        handleBatch(stdoutParser.end(stdoutDecoder.end()));
        if (!settled) settle([], new Error(stderrBuffer || "Pi RPC exited before model list response"));
      }
    });
    proc.stdout.on("data", (chunk: Buffer) => {
      handleBatch(stdoutParser.push(stdoutDecoder.write(chunk)));
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

// Fallback parser for older Pi builds. This is a GUI projection fallback only;
// Pi/provider model discovery remains the authoritative source when available.
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

// Adapter hint for showing/sending the GUI's temporary fast-mode shim. The
// provider/Pi layer remains the final authority on whether priority service
// tier is accepted for a request.
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

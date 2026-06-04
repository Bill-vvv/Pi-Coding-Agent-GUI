import { readFileSync } from "node:fs";

type ServiceTier = "auto" | "default" | "flex" | "scale" | "priority";

const VALID_SERVICE_TIERS = new Set<ServiceTier>(["auto", "default", "flex", "scale", "priority"]);
const OPENAI_APIS = new Set(["openai-responses", "openai-codex-responses"]);

function readServiceTier(): ServiceTier | undefined {
  const filePath = process.env.PI_GUI_SERVICE_TIER_FILE;
  if (!filePath) return undefined;

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { serviceTier?: unknown };
    return typeof parsed.serviceTier === "string" && VALID_SERVICE_TIERS.has(parsed.serviceTier as ServiceTier)
      ? (parsed.serviceTier as ServiceTier)
      : undefined;
  } catch {
    return undefined;
  }
}

function isOpenAIServiceTierPayload(payload: unknown, context: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;

  const model = contextModelFromContext(context);
  const api = model && typeof model === "object" && "api" in model ? (model as { api?: unknown }).api : undefined;
  const provider = model && typeof model === "object" && "provider" in model ? (model as { provider?: unknown }).provider : undefined;
  if (typeof api === "string" && typeof provider === "string") {
    return (provider === "openai" && api === "openai-responses") || (provider === "openai-codex" && api === "openai-codex-responses");
  }

  const payloadModel = "model" in payload ? (payload as { model?: unknown }).model : undefined;
  return typeof payloadModel === "string" && /^(?:gpt-|o\d|codex)/i.test(payloadModel);
}

export default function serviceTierExtension(pi: { on: (event: "before_provider_request", handler: (event: { payload: unknown }, context: unknown) => unknown) => void }) {
  pi.on("before_provider_request", (event, context) => {
    const serviceTier = readServiceTier();
    logModelRequest(event.payload, context, serviceTier);
    if (!serviceTier || !isOpenAIServiceTierPayload(event.payload, context)) return undefined;
    return { ...event.payload, service_tier: serviceTier };
  });
}

function contextModelFromContext(context: unknown): unknown {
  return context && typeof context === "object" && "model" in context ? (context as { model?: unknown }).model : undefined;
}

function logModelRequest(payload: unknown, context: unknown, serviceTier: ServiceTier | undefined): void {
  try {
    const model = contextModelFromContext(context);
    const provider = model && typeof model === "object" && "provider" in model ? (model as { provider?: unknown }).provider : undefined;
    const modelId = model && typeof model === "object" && "id" in model ? (model as { id?: unknown }).id : undefined;
    const api = model && typeof model === "object" && "api" in model ? (model as { api?: unknown }).api : undefined;
    const payloadModel = payload && typeof payload === "object" && "model" in payload ? (payload as { model?: unknown }).model : undefined;
    const normalizedProvider = typeof provider === "string" ? provider : undefined;
    const normalizedModelId = typeof modelId === "string" ? modelId : undefined;
    const contextModel = normalizedProvider && normalizedModelId ? `${normalizedProvider}/${normalizedModelId}` : undefined;

    console.error(
      `PI_GUI_MODEL_REQUEST ${JSON.stringify({
        timestamp: Date.now(),
        model: contextModel ?? (typeof payloadModel === "string" ? payloadModel : undefined),
        contextModel,
        payloadModel: typeof payloadModel === "string" ? payloadModel : undefined,
        provider: normalizedProvider,
        modelId: normalizedModelId,
        api: typeof api === "string" ? api : undefined,
        serviceTier,
      })}`,
    );
  } catch {
    // Never let debug logging affect the provider request.
  }
}

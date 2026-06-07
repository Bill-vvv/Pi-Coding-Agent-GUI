import { isServiceTier, type ServiceTier } from "@pi-gui/shared";
import { readFileSync } from "node:fs";

function readServiceTier(): ServiceTier | undefined {
  const filePath = process.env.PI_GUI_SERVICE_TIER_FILE;
  if (!filePath) return undefined;

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { serviceTier?: unknown };
    return isServiceTier(parsed.serviceTier) ? parsed.serviceTier : undefined;
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
    if (!serviceTier || !isOpenAIServiceTierPayload(event.payload, context)) return undefined;
    return { ...event.payload, service_tier: serviceTier };
  });
}

function contextModelFromContext(context: unknown): unknown {
  return context && typeof context === "object" && "model" in context ? (context as { model?: unknown }).model : undefined;
}

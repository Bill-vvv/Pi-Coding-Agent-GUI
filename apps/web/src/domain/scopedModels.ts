import type { ModelSummary } from "@pi-gui/shared";
import { modelKey } from "./models";

export type GuiScopedModelsPreference = {
  mode: "all" | "custom";
  modelKeys: string[];
};

export const DEFAULT_GUI_SCOPED_MODELS: GuiScopedModelsPreference = { mode: "all", modelKeys: [] };

export function normalizeGuiScopedModels(value: unknown): GuiScopedModelsPreference {
  if (!isRecord(value)) return DEFAULT_GUI_SCOPED_MODELS;
  const mode = value.mode === "custom" ? "custom" : "all";
  const seen = new Set<string>();
  const modelKeys = Array.isArray(value.modelKeys)
    ? value.modelKeys.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).filter((item) => {
        if (seen.has(item)) return false;
        seen.add(item);
        return true;
      })
    : [];
  return mode === "custom" ? { mode, modelKeys } : DEFAULT_GUI_SCOPED_MODELS;
}

export function scopedModelKeySet(preference: GuiScopedModelsPreference): Set<string> | undefined {
  return preference.mode === "custom" ? new Set(preference.modelKeys) : undefined;
}

export function modelsInGuiScope(models: ModelSummary[], preference: GuiScopedModelsPreference): ModelSummary[] {
  if (preference.mode !== "custom") return models;
  const byKey = new Map(models.map((model) => [modelKey(model), model]));
  const ordered = preference.modelKeys.map((key) => byKey.get(key)).filter((model): model is ModelSummary => Boolean(model));
  return ordered;
}

export function toggleScopedModel(preference: GuiScopedModelsPreference, key: string, enabled: boolean): GuiScopedModelsPreference {
  const current = preference.mode === "custom" ? preference.modelKeys : [];
  const next = enabled ? [...current.filter((item) => item !== key), key] : current.filter((item) => item !== key);
  return { mode: "custom", modelKeys: next };
}

export function toggleProviderModels(preference: GuiScopedModelsPreference, models: ModelSummary[], provider: string, enabled: boolean): GuiScopedModelsPreference {
  const providerKeys = models.filter((model) => model.provider === provider).map(modelKey);
  const providerKeySet = new Set(providerKeys);
  const baseKeys = preference.mode === "custom" ? preference.modelKeys : models.map(modelKey);
  const current = baseKeys.filter((key) => !providerKeySet.has(key));
  return { mode: "custom", modelKeys: enabled ? [...current, ...providerKeys] : current };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

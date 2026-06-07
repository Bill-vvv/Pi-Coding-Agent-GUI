import assert from "node:assert/strict";
import test from "node:test";
import type { ModelSummary } from "@pi-gui/shared";
import { modelsInGuiScope, normalizeGuiScopedModels, toggleProviderModels, toggleScopedModel } from "../src/domain/scopedModels";

const models: ModelSummary[] = [
  { provider: "a", id: "one", supportsThinking: false, supportsImages: false, supportsFast: false },
  { provider: "a", id: "two", supportsThinking: false, supportsImages: false, supportsFast: false },
  { provider: "b", id: "three", supportsThinking: false, supportsImages: false, supportsFast: false },
];

test("normalizeGuiScopedModels defaults to all and dedupes custom keys", () => {
  assert.deepEqual(normalizeGuiScopedModels(undefined), { mode: "all", modelKeys: [] });
  assert.deepEqual(normalizeGuiScopedModels({ mode: "custom", modelKeys: ["a/one", "a/one", ""] }), { mode: "custom", modelKeys: ["a/one"] });
});

test("modelsInGuiScope filters and orders models by custom preference", () => {
  assert.deepEqual(modelsInGuiScope(models, { mode: "custom", modelKeys: ["b/three", "missing", "a/one"] }).map((model) => `${model.provider}/${model.id}`), ["b/three", "a/one"]);
  assert.equal(modelsInGuiScope(models, { mode: "all", modelKeys: [] }).length, 3);
});

test("scoped model toggles update custom preference", () => {
  const one = toggleScopedModel({ mode: "all", modelKeys: [] }, "a/one", true);
  assert.deepEqual(one, { mode: "custom", modelKeys: ["a/one"] });
  assert.deepEqual(toggleProviderModels(one, models, "a", true).modelKeys, ["a/one", "a/two"]);
});

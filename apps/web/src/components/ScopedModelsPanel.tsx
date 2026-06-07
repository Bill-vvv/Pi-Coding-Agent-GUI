import type { ModelSummary } from "@pi-gui/shared";
import { compactModelLabel, modelKey } from "../domain/models";
import { scopedModelKeySet, toggleProviderModels, toggleScopedModel, type GuiScopedModelsPreference } from "../domain/scopedModels";
import { IconButton } from "./ui";

type ScopedModelsPanelProps = {
  models: ModelSummary[];
  preference: GuiScopedModelsPreference;
  onChange: (preference: GuiScopedModelsPreference) => void;
  onClose: () => void;
};

export function ScopedModelsPanel({ models, preference, onChange, onClose }: ScopedModelsPanelProps) {
  const selected = scopedModelKeySet(preference);
  const providers = [...new Set(models.map((model) => model.provider))].sort();
  const enabledCount = preference.mode === "custom" ? preference.modelKeys.length : models.length;

  return (
    <section className="scoped-models-panel" aria-label="GUI 模型范围">
      <header className="scoped-models-header">
        <div>
          <h2>GUI 模型范围</h2>
          <p>{preference.mode === "custom" ? `已启用 ${enabledCount} 个模型` : "使用全部可用模型"}</p>
        </div>
        <IconButton icon="x" label="关闭" onClick={onClose} />
      </header>

      <div className="scoped-models-toolbar">
        <button type="button" onClick={() => onChange({ mode: "all", modelKeys: [] })}>全部模型</button>
        <button type="button" onClick={() => onChange({ mode: "custom", modelKeys: models.map(modelKey) })}>全选</button>
        <button type="button" onClick={() => onChange({ mode: "custom", modelKeys: [] })}>清空</button>
      </div>

      <p className="scoped-models-note">该范围只影响 GUI 模型选择/补全；当前 Pi RPC 尚未暴露 TUI scoped-models 持久化能力。</p>

      <div className="scoped-models-list">
        {providers.map((provider) => {
          const providerModels = models.filter((model) => model.provider === provider);
          const allEnabled = preference.mode !== "custom" || providerModels.every((model) => selected?.has(modelKey(model)));
          return (
            <section className="scoped-models-provider" key={provider}>
              <header>
                <strong>{provider}</strong>
                <button type="button" onClick={() => onChange(toggleProviderModels(preference, models, provider, !allEnabled))}>{allEnabled ? "禁用" : "启用"}</button>
              </header>
              {providerModels.map((model) => {
                const key = modelKey(model);
                const checked = preference.mode !== "custom" || selected?.has(key) === true;
                return (
                  <label className="scoped-model-row" key={key}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const base = preference.mode === "custom" ? preference : { mode: "custom" as const, modelKeys: models.map(modelKey) };
                        onChange(toggleScopedModel(base, key, event.target.checked));
                      }}
                    />
                    <span>{compactModelLabel(model)}</span>
                    <small>{key}</small>
                  </label>
                );
              })}
            </section>
          );
        })}
      </div>
    </section>
  );
}

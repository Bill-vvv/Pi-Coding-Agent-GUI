import type { ModelSummary, ResponseMode, ThinkingLevel } from "@pi-gui/shared";
import { compactModelLabel, modelKey, THINKING_LEVELS, thinkingLabel } from "../domain/models";

type ModelPickerProps = {
  models: ModelSummary[];
  selectedModel?: ModelSummary;
  selectedThinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
  responseMode: ResponseMode;
  open: boolean;
  onToggleOpen: () => void;
  onChooseModel: (model: ModelSummary) => void;
  onChooseThinkingLevel: (level: ThinkingLevel) => void;
  onChooseResponseMode: (mode: ResponseMode) => void;
};

export function ModelPicker({
  models,
  selectedModel,
  selectedThinkingLevel,
  availableThinkingLevels,
  responseMode,
  open,
  onToggleOpen,
  onChooseModel,
  onChooseThinkingLevel,
  onChooseResponseMode,
}: ModelPickerProps) {
  return (
    <div className="composer-model-controls">
      <button
        className="model-picker-button"
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
      >
        <span className="model-summary-label">{selectedModel ? compactModelLabel(selectedModel) : "选择模型"}</span>
        {selectedModel?.supportsThinking ? <span className="model-summary-meta">{thinkingLabel(selectedThinkingLevel)}</span> : null}
        {selectedModel?.supportsFast && responseMode === "fast" ? <span className="model-summary-meta">快速</span> : null}
      </button>

      {open ? (
        <section className="model-picker-popover" aria-label="模型与思考设置">
          {selectedModel?.supportsThinking ? (
            <div className="model-picker-section">
              <header>思考强度</header>
              <div className="thinking-grid">
                {THINKING_LEVELS.filter((level) => availableThinkingLevels.includes(level.value)).map((level) => (
                  <button
                    className={`picker-option ${selectedThinkingLevel === level.value ? "selected" : ""}`}
                    type="button"
                    key={level.value}
                    onClick={() => onChooseThinkingLevel(level.value)}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="model-picker-section">
            <header>模型</header>
            <div className="model-option-list">
              {models.map((model) => (
                <button
                  className={`model-option ${selectedModel && modelKey(selectedModel) === modelKey(model) ? "selected" : ""}`}
                  type="button"
                  key={modelKey(model)}
                  onClick={() => onChooseModel(model)}
                >
                  <span>{compactModelLabel(model)}</span>
                  <small>{model.provider}</small>
                </button>
              ))}
            </div>
          </div>

          {selectedModel?.supportsFast ? (
            <div className="model-picker-section speed-section">
              <header>速度</header>
              <div className="speed-segmented">
                <button className={responseMode === "normal" ? "selected" : ""} type="button" onClick={() => onChooseResponseMode("normal")}>普通</button>
                <button className={responseMode === "fast" ? "selected" : ""} type="button" onClick={() => onChooseResponseMode("fast")}>快速</button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

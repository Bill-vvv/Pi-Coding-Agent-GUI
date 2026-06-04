import type { AccentColor, ChatFontSize, ThemeMode, UiFontSize, UiPreferences } from "../types";
import { Icon } from "./Icon";

type SettingsModalProps = {
  open: boolean;
  preferences: UiPreferences;
  onClose: () => void;
  onChangePreferences: (preferences: UiPreferences) => void;
};

const UI_FONT_OPTIONS: Array<{ value: UiFontSize; label: string; description: string }> = [
  { value: "small", label: "小", description: "更紧凑的界面文字" },
  { value: "medium", label: "标准", description: "默认界面文字大小" },
  { value: "large", label: "大", description: "更易读的界面文字" },
];

const CHAT_FONT_OPTIONS: Array<{ value: ChatFontSize; label: string; description: string }> = [
  { value: "small", label: "小", description: "更高信息密度" },
  { value: "medium", label: "标准", description: "默认对话正文大小" },
  { value: "large", label: "大", description: "更适合长时间阅读" },
];

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; description: string; disabled?: boolean }> = [
  { value: "dark", label: "深色", description: "当前主题" },
  { value: "system", label: "跟随系统", description: "后续接入浅色主题后启用", disabled: true },
];

const ACCENT_OPTIONS: Array<{ value: AccentColor; label: string }> = [
  { value: "amber", label: "琥珀" },
  { value: "blue", label: "蓝色" },
  { value: "green", label: "绿色" },
  { value: "rose", label: "玫瑰" },
];

export function SettingsModal({ open, preferences, onClose, onChangePreferences }: SettingsModalProps) {
  if (!open) return null;

  function update(next: Partial<UiPreferences>) {
    onChangePreferences({ ...preferences, ...next });
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="设置" onMouseDown={(event) => event.stopPropagation()}>
        <header className="settings-header">
          <div>
            <h2>设置</h2>
            <p>调整界面显示、阅读体验与主题外观。</p>
          </div>
          <button className="icon-button" type="button" title="关闭" aria-label="关闭" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>

        <div className="settings-content">
          <section className="settings-section" aria-labelledby="settings-appearance-title">
            <div className="settings-section-header">
              <div>
                <h3 id="settings-appearance-title">界面外观</h3>
                <p>控制整体 UI 的显示密度与主题。</p>
              </div>
            </div>

            <SettingsOptionGroup
              label="界面字体大小"
              options={UI_FONT_OPTIONS}
              value={preferences.uiFontSize}
              onChange={(value) => update({ uiFontSize: value })}
            />

            <SettingsOptionGroup
              label="主题"
              options={THEME_OPTIONS}
              value={preferences.theme}
              onChange={(value) => update({ theme: value })}
            />
          </section>

          <section className="settings-section" aria-labelledby="settings-chat-title">
            <div className="settings-section-header">
              <div>
                <h3 id="settings-chat-title">对话阅读</h3>
                <p>控制对话正文的阅读大小，不影响模型选择。</p>
              </div>
            </div>

            <SettingsOptionGroup
              label="对话字体大小"
              options={CHAT_FONT_OPTIONS}
              value={preferences.chatFontSize}
              onChange={(value) => update({ chatFontSize: value })}
            />
          </section>

          <section className="settings-section" aria-labelledby="settings-color-title">
            <div className="settings-section-header">
              <div>
                <h3 id="settings-color-title">颜色</h3>
                <p>选择用于强调状态和未来高亮元素的颜色。</p>
              </div>
            </div>

            <div className="settings-field">
              <label>强调色</label>
              <div className="settings-color-options">
                {ACCENT_OPTIONS.map((option) => (
                  <button
                    className={`settings-color-option ${preferences.accentColor === option.value ? "selected" : ""}`}
                    type="button"
                    key={option.value}
                    onClick={() => update({ accentColor: option.value })}
                  >
                    <span className={`settings-color-swatch ${option.value}`} />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function SettingsOptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string; description: string; disabled?: boolean }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-field">
      <label>{label}</label>
      <div className="settings-card-options">
        {options.map((option) => (
          <button
            className={`settings-card-option ${value === option.value ? "selected" : ""}`}
            type="button"
            key={option.value}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            <span>{option.label}</span>
            <small>{option.description}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

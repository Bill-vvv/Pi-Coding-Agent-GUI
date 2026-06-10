import type { AppSettings, Project, RuntimeProfileId } from "@pi-gui/shared";
import { RUNTIME_PROFILES } from "@pi-gui/shared";
import { useBrowserNotificationPermission } from "../hooks/useBrowserNotificationPermission";
import { useEnvironmentDiagnostics } from "../hooks/useEnvironmentDiagnostics";
import { useRemoteAccess } from "../hooks/useRemoteAccess";
import { requiresUnknownExtensionConfirmation, UNKNOWN_USER_EXTENSIONS_CONFIRMATION } from "../domain/capabilities";
import { GUI_KEYBINDING_DEFINITIONS, effectiveGuiKeybindings, normalizeKeyCombo } from "../domain/keybindings";
import type { AccentColor, ChatFontSize, ThemeMode, ThinkingToolDisplayMode, UiFontSize, UiPreferences } from "../types";
import { Icon } from "./Icon";
import { IconButton } from "./ui";
import { RemoteAccessPanel } from "./RemoteAccessPanel";
import { CapabilityPanel } from "./settings/CapabilityPanel";
import { EnvironmentDiagnosticsPanel } from "./settings/EnvironmentDiagnosticsPanel";
import { IntegrationShimPanel } from "./settings/IntegrationShimPanel";
import { SettingsOptionGroup } from "./settings/SettingsOptionGroup";
import { useSettingsScrollbar } from "./settings/useSettingsScrollbar";

type SettingsPanelProps = {
  open: boolean;
  preferences: UiPreferences;
  settings: AppSettings;
  selectedProject?: Project;
  onClose: () => void;
  onChangePreferences: (preferences: UiPreferences) => void;
  onChangeSettings: (settings: Partial<AppSettings>) => boolean;
  onChangeProjectRuntimeProfile: (projectId: string, defaultRuntimeProfileId: RuntimeProfileId | null) => boolean;
  onOpenUsageOverview: () => void;
  focusCapabilityId?: string;
  desktopPetAvailable?: boolean;
};

const UI_FONT_OPTIONS: Array<{ value: UiFontSize; label: string; disabled?: boolean }> = [
  { value: "small", label: "小" },
  { value: "medium", label: "标准" },
  { value: "large", label: "大" },
];

const CHAT_FONT_OPTIONS: Array<{ value: ChatFontSize; label: string; disabled?: boolean }> = [
  { value: "small", label: "小" },
  { value: "medium", label: "标准" },
  { value: "large", label: "大" },
];

const THINKING_TOOL_DISPLAY_OPTIONS: Array<{ value: ThinkingToolDisplayMode; label: string; disabled?: boolean }> = [
  { value: "compact", label: "紧凑" },
  { value: "chronological", label: "正文流" },
];

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; disabled?: boolean }> = [
  { value: "dark", label: "深色" },
  { value: "light", label: "浅色" },
  { value: "system", label: "跟随系统" },
];

const ACCENT_OPTIONS: Array<{ value: AccentColor; label: string }> = [
  { value: "amber", label: "琥珀" },
  { value: "blue", label: "蓝色" },
  { value: "green", label: "绿色" },
  { value: "rose", label: "玫瑰" },
];

const RUNTIME_PROFILE_OPTIONS = RUNTIME_PROFILES.map((profile) => ({ value: profile.id, label: profile.label }));

export function SettingsPanel({
  open,
  preferences,
  settings,
  selectedProject,
  onClose,
  onChangePreferences,
  onChangeSettings,
  onChangeProjectRuntimeProfile,
  onOpenUsageOverview,
  focusCapabilityId,
  desktopPetAvailable,
}: SettingsPanelProps) {
  const {
    permission: notificationPermission,
    supported: browserNotificationsSupported,
    requestPermission: requestBrowserNotificationPermission,
  } = useBrowserNotificationPermission();
  const contentScrollbar = useSettingsScrollbar();
  const environmentDiagnostics = useEnvironmentDiagnostics(open);
  const remoteAccess = useRemoteAccess(open);

  if (!open) return null;

  const desktopNotificationToggleDisabled =
    !preferences.desktopNotificationsEnabled && (!browserNotificationsSupported || notificationPermission === "denied");

  function update(next: Partial<UiPreferences>) {
    onChangePreferences({ ...preferences, ...next });
  }

  async function handleDesktopNotificationsToggle() {
    if (preferences.desktopNotificationsEnabled) {
      update({ desktopNotificationsEnabled: false });
      return;
    }

    if (!browserNotificationsSupported) return;
    const permission = notificationPermission === "granted" ? notificationPermission : await requestBrowserNotificationPermission();
    update({ desktopNotificationsEnabled: permission === "granted" });
  }

  return (
    <section className="settings-panel" aria-label="设置">
      <header className="settings-header">
        <IconButton className="settings-back-button" icon="arrow-left" label="返回聊天" onClick={onClose} />
        <h2>设置</h2>
      </header>

      <div
        className={`settings-content settings-scroll-area${contentScrollbar.isVisible ? " is-scrolling" : ""}`}
        tabIndex={0}
        onKeyDown={contentScrollbar.handleKeyDown}
        onScrollCapture={contentScrollbar.reveal}
        onTouchMove={contentScrollbar.reveal}
        onWheel={contentScrollbar.reveal}
      >
        <section className="settings-section" aria-label="核心设置">
          <h3 className="settings-section-title">Core Settings</h3>
          <SettingsOptionGroup
            name="ui-font-size"
            label="界面字号"
            options={UI_FONT_OPTIONS}
            value={preferences.uiFontSize}
            onChange={(value) => update({ uiFontSize: value })}
          />

          <SettingsOptionGroup
            name="chat-font-size"
            label="对话字号"
            options={CHAT_FONT_OPTIONS}
            value={preferences.chatFontSize}
            onChange={(value) => update({ chatFontSize: value })}
          />

          <SettingsOptionGroup
            name="thinking-tool-display"
            label="思考/工具流"
            options={THINKING_TOOL_DISPLAY_OPTIONS}
            value={preferences.thinkingToolDisplayMode}
            onChange={(value) => update({ thinkingToolDisplayMode: value })}
          />

          <SettingsOptionGroup
            name="theme"
            label="主题"
            options={THEME_OPTIONS}
            value={preferences.theme}
            onChange={(value) => update({ theme: value })}
          />

          <div className="settings-field">
            <label>强调色</label>
            <div className="settings-color-options" role="radiogroup" aria-label="强调色">
              {ACCENT_OPTIONS.map((option) => (
                <label className={`settings-color-option ${preferences.accentColor === option.value ? "selected" : ""}`} key={option.value}>
                  <input
                    type="radio"
                    name="settings-accent-color"
                    checked={preferences.accentColor === option.value}
                    onChange={() => update({ accentColor: option.value })}
                  />
                  <span className={`settings-color-swatch ${option.value}`} />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          <RuntimeProfileSettings settings={settings} selectedProject={selectedProject} onChangeSettings={onChangeSettings} onChangeProjectRuntimeProfile={onChangeProjectRuntimeProfile} />

          <EnvironmentDiagnosticsPanel state={environmentDiagnostics} />

          <ShortcutSettingsPanel preferences={preferences} onChange={(keybindings) => update({ keybindings })} />
        </section>

        <section className="settings-section settings-section-group" aria-label="适配层">
          <h3 className="settings-section-title">Integrations / Temporary Shims</h3>
          <CapabilityPanel preferences={preferences} settings={settings} selectedProject={selectedProject} onChangePreferences={onChangePreferences} onChangeSettings={onChangeSettings} focusCapabilityId={focusCapabilityId} desktopPetAvailable={desktopPetAvailable} />
          <IntegrationShimPanel />

          <button className="settings-setting-row settings-navigation-row" type="button" onClick={onOpenUsageOverview}>
            <span className="settings-setting-copy">
              <span>用量概览</span>
              <small>查看 token 用量统计</small>
            </span>
            <Icon name="arrow-right" />
          </button>

          <RemoteAccessPanel state={remoteAccess} />

          <div className={`settings-setting-row ${desktopNotificationToggleDisabled ? "disabled" : ""}`}>
            <span className="settings-setting-copy">
              <span>系统通知</span>
              <small>{notificationSummary(notificationPermission, preferences.desktopNotificationsEnabled)}</small>
            </span>
            <label className={`settings-toggle-control ${desktopNotificationToggleDisabled ? "disabled" : ""}`}>
              <input
                type="checkbox"
                aria-label="桌面通知"
                checked={preferences.desktopNotificationsEnabled}
                disabled={desktopNotificationToggleDisabled}
                onChange={() => void handleDesktopNotificationsToggle()}
              />
              <span className="settings-toggle-track" />
            </label>
          </div>
        </section>
      </div>
    </section>
  );
}

function RuntimeProfileSettings({
  settings,
  selectedProject,
  onChangeSettings,
  onChangeProjectRuntimeProfile,
}: {
  settings: AppSettings;
  selectedProject?: Project;
  onChangeSettings: (settings: Partial<AppSettings>) => boolean;
  onChangeProjectRuntimeProfile: (projectId: string, defaultRuntimeProfileId: RuntimeProfileId | null) => boolean;
}) {
  const selectedProfileId = settings.defaultRuntimeProfileId ?? "vanilla-pi";
  const projectProfileValue = selectedProject?.defaultRuntimeProfileId ?? "inherit-global";

  function selectProfile(defaultRuntimeProfileId: RuntimeProfileId) {
    if (requiresUnknownExtensionConfirmation(defaultRuntimeProfileId, selectedProfileId) && !window.confirm(UNKNOWN_USER_EXTENSIONS_CONFIRMATION)) return;
    onChangeSettings({ defaultRuntimeProfileId });
  }

  function selectProjectProfile(value: RuntimeProfileId | "inherit-global") {
    if (!selectedProject) return;
    const nextProfileId = value === "inherit-global" ? undefined : value;
    if (nextProfileId && requiresUnknownExtensionConfirmation(nextProfileId, selectedProject.defaultRuntimeProfileId) && !window.confirm(UNKNOWN_USER_EXTENSIONS_CONFIRMATION)) return;
    onChangeProjectRuntimeProfile(selectedProject.id, nextProfileId ?? null);
  }

  return (
    <div className="settings-runtime-profile-block">
      <SettingsOptionGroup
        name="runtime-profile"
        label="默认 Runtime Profile"
        options={RUNTIME_PROFILE_OPTIONS}
        value={selectedProfileId}
        onChange={selectProfile}
      />
      {selectedProject ? (
        <SettingsOptionGroup
          name="project-runtime-profile"
          label="当前项目 Profile"
          options={[{ value: "inherit-global", label: "继承默认" }, ...RUNTIME_PROFILE_OPTIONS]}
          value={projectProfileValue}
          onChange={selectProjectProfile}
        />
      ) : null}
      <div className="settings-shim-list settings-runtime-profile-list">
        {RUNTIME_PROFILES.map((profile) => (
          <div className={`settings-shim-row ${selectedProfileId === profile.id || selectedProject?.defaultRuntimeProfileId === profile.id ? "selected" : ""}`} key={profile.id}>
            <span className="settings-shim-main">
              <span>{profile.label}</span>
              <small>{profile.summary}</small>
            </span>
            <span className="settings-shim-tags">
              <span>{profile.defaultCapabilityIds.length} capabilities</span>
              {selectedProject?.defaultRuntimeProfileId === profile.id ? <span>当前项目</span> : null}
              <span className={profile.inheritsUserExtensions ? "warning" : undefined}>{profile.inheritsUserExtensions ? "继承用户扩展" : "隔离用户扩展"}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="settings-shim-note">默认 profile 只影响新启动的 runtime；当前项目 override 优先于全局默认，历史会话保留启动时的有效能力集合。</p>
    </div>
  );
}

function ShortcutSettingsPanel({ preferences, onChange }: { preferences: UiPreferences; onChange: (keybindings: UiPreferences["keybindings"]) => void }) {
  const effective = effectiveGuiKeybindings(preferences.keybindings);

  function updateBinding(actionId: keyof typeof effective, value: string) {
    const normalized = normalizeKeyCombo(value);
    if (!normalized) return;
    onChange({ ...preferences.keybindings, [actionId]: [normalized] });
  }

  return (
    <details className="settings-hotkeys-dropdown">
      <summary>
        <span className="settings-diagnostics-summary-main">
          <span>快捷键设置</span>
          <small>可自定义核心 GUI 快捷键</small>
        </span>
        <span className="settings-diagnostics-pill ready">Keys</span>
      </summary>

      <div className="settings-hotkeys-body">
        <section className="settings-hotkey-group" aria-label="快捷键">
          <h3>核心动作</h3>
          <div className="settings-hotkey-list">
            {GUI_KEYBINDING_DEFINITIONS.map((definition) => (
              <div className="settings-hotkey-row editable" key={definition.id}>
                <span>{definition.label}</span>
                <span className="settings-hotkey-keys">
                  {effective[definition.id].map((key) => <kbd key={key}>{key}</kbd>)}
                </span>
                {definition.editable ? (
                  <span className="settings-hotkey-editors">
                    <input
                      value={effective[definition.id][0] ?? ""}
                      aria-label={`${definition.label} 快捷键`}
                      onChange={(event) => updateBinding(definition.id, event.target.value)}
                    />
                    <button type="button" onClick={() => onChange({ ...preferences.keybindings, [definition.id]: definition.defaultKeys })}>重置</button>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
        <p className="settings-hotkeys-hint">浏览器保留快捷键可能无法拦截；发送/换行等输入框语义保持默认。</p>
      </div>
    </details>
  );
}



function notificationSummary(permission: "default" | "denied" | "granted" | "unsupported", enabled: boolean): string {
  if (permission === "unsupported") return "当前浏览器不支持系统通知";
  if (permission === "denied") return "系统通知权限已被浏览器拒绝";
  if (permission === "granted") return enabled ? "Pi 后台完成时发送系统通知，点击可回到对应对话" : "系统通知未启用";
  return "需要浏览器授权后才能发送系统通知";
}


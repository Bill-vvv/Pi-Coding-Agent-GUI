import { useEffect, useRef, useState } from "react";
import type { AppSettings, ConversationMessage, GuiSession, Project, Runtime, RuntimeConversationSummary, VoiceInputMode, VoiceInputSettings } from "@pi-gui/shared";
import { useBrowserNotificationPermission } from "../hooks/useBrowserNotificationPermission";
import { useEnvironmentDiagnostics } from "../hooks/useEnvironmentDiagnostics";
import { useRemoteAccess } from "../hooks/useRemoteAccess";
import { GUI_KEYBINDING_DEFINITIONS, effectiveGuiKeybindings, normalizeKeyCombo } from "../domain/keybindings";
import { runtimeHasVisibleConversationContent } from "../domain/conversationVisibility";
import { voiceInputSettingsEqual } from "../domain/voiceInputSettings";
import type { AccentColor, ChatFontSize, ThemeMode, ThinkingToolDisplayMode, UiFontSize, UiPreferences } from "../types";
import { Icon } from "./Icon";
import { IconButton } from "./ui";
import { RemoteAccessPanel } from "./RemoteAccessPanel";
import { EnvironmentDiagnosticsPanel } from "./settings/EnvironmentDiagnosticsPanel";
import { SettingsOptionGroup } from "./settings/SettingsOptionGroup";
import { VoiceInputSettingsPanel } from "./settings/VoiceInputSettingsPanel";
import { useSettingsScrollbar } from "./settings/useSettingsScrollbar";

type SettingsPanelProps = {
  open: boolean;
  settings: AppSettings;
  preferences: UiPreferences;
  projects: Project[];
  sessions: GuiSession[];
  runtimes: Runtime[];
  conversationSummaries: Record<string, RuntimeConversationSummary>;
  messagesByRuntime: Record<string, ConversationMessage[]>;
  onClose: () => void;
  onChangePreferences: (preferences: UiPreferences) => void;
  onChangeSettings: (settings: AppSettings) => boolean;
  onOpenArchivedRuntime: (runtimeId: string) => void;
  onOpenUsageOverview: () => void;
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


export function SettingsPanel({
  open,
  settings,
  preferences,
  projects,
  sessions,
  runtimes,
  conversationSummaries,
  messagesByRuntime,
  onClose,
  onChangePreferences,
  onChangeSettings,
  onOpenArchivedRuntime,
  onOpenUsageOverview,
}: SettingsPanelProps) {
  const [selectedArchivedRuntimeId, setSelectedArchivedRuntimeId] = useState<string | undefined>();
  const [localVoiceInput, setLocalVoiceInput] = useState<VoiceInputSettings | undefined>(settings.voiceInput);
  const localVoiceInputRef = useRef<VoiceInputSettings | undefined>(settings.voiceInput);
  const voiceInputDraftDirtyRef = useRef(false);
  const [voiceInputSaveError, setVoiceInputSaveError] = useState<string | undefined>();
  const {
    permission: notificationPermission,
    supported: browserNotificationsSupported,
    requestPermission: requestBrowserNotificationPermission,
  } = useBrowserNotificationPermission();
  const contentScrollbar = useSettingsScrollbar();
  const archiveScrollbar = useSettingsScrollbar();
  const environmentDiagnostics = useEnvironmentDiagnostics(open);
  const remoteAccess = useRemoteAccess(open);

  useEffect(() => {
    if (!open) setSelectedArchivedRuntimeId(undefined);
  }, [open]);

  useEffect(() => {
    if (!open) {
      localVoiceInputRef.current = settings.voiceInput;
      voiceInputDraftDirtyRef.current = false;
      setLocalVoiceInput(settings.voiceInput);
      setVoiceInputSaveError(undefined);
      return;
    }

    if (voiceInputDraftDirtyRef.current) {
      if (voiceInputSettingsEqual(localVoiceInputRef.current, settings.voiceInput)) {
        voiceInputDraftDirtyRef.current = false;
        setVoiceInputSaveError(undefined);
      }
      return;
    }

    localVoiceInputRef.current = settings.voiceInput;
    setLocalVoiceInput(settings.voiceInput);
  }, [open, settings.voiceInput]);

  if (!open) return null;

  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const archivedRuntimes = runtimes
    .filter((runtime) =>
      Boolean(runtime.archivedAt) &&
      runtimeHasVisibleConversationContent({
        runtime,
        session: runtime.sessionId ? sessionsById.get(runtime.sessionId) : undefined,
        summary: conversationSummaries[runtime.id],
        messages: messagesByRuntime[runtime.id],
      }),
    )
    .sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0));
  const selectedArchivedRuntime = selectedArchivedRuntimeId ? archivedRuntimes.find((runtime) => runtime.id === selectedArchivedRuntimeId) : undefined;
  const selectedArchivedSnippet = selectedArchivedRuntime ? latestArchiveSnippet(messagesByRuntime[selectedArchivedRuntime.id] ?? []) : undefined;
  const desktopNotificationToggleDisabled =
    !preferences.desktopNotificationsEnabled && (!browserNotificationsSupported || notificationPermission === "denied");

  function update(next: Partial<UiPreferences>) {
    onChangePreferences({ ...preferences, ...next });
  }

  function updateVoiceInput(next: Partial<VoiceInputSettings>) {
    const voiceInput = next.mode === "disabled"
      ? { mode: "disabled" as VoiceInputMode }
      : {
        ...(localVoiceInput ?? { mode: "disabled" as VoiceInputMode }),
        ...next,
      };
    localVoiceInputRef.current = voiceInput;
    voiceInputDraftDirtyRef.current = true;
    setLocalVoiceInput(voiceInput);
    const sent = onChangeSettings({ ...settings, voiceInput });
    setVoiceInputSaveError(sent ? undefined : "WebSocket 未连接，语音输入设置未保存。");
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
        <section className="settings-section" aria-label="偏好">
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

            <button className="settings-setting-row settings-navigation-row" type="button" onClick={onOpenUsageOverview}>
              <span className="settings-setting-copy">
                <span>用量概览</span>
                <small>查看 token 用量统计</small>
              </span>
              <Icon name="arrow-right" />
            </button>

            <EnvironmentDiagnosticsPanel state={environmentDiagnostics} />

            <RemoteAccessPanel state={remoteAccess} />

            <VoiceInputSettingsPanel settings={localVoiceInput} saveError={voiceInputSaveError} onChange={updateVoiceInput} />

            <ShortcutSettingsPanel preferences={preferences} onChange={(keybindings) => update({ keybindings })} />

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

            <details className="settings-archive-dropdown">
              <summary>
                <span className="settings-archive-summary-main">
                  <span>归档</span>
                  <small>{archivedRuntimes.length > 0 ? `${archivedRuntimes.length} 个对话` : "暂无"}</small>
                </span>
              </summary>

              {archivedRuntimes.length > 0 ? (
                <div
                  className={`settings-archive-list settings-scroll-area${archiveScrollbar.isVisible ? " is-scrolling" : ""}`}
                  tabIndex={0}
                  onKeyDown={archiveScrollbar.handleKeyDown}
                  onScrollCapture={archiveScrollbar.reveal}
                  onTouchMove={archiveScrollbar.reveal}
                  onWheel={archiveScrollbar.reveal}
                >
                  {archivedRuntimes.map((runtime) => {
                    const project = projectsById.get(runtime.projectId);
                    const session = runtime.sessionId ? sessionsById.get(runtime.sessionId) : undefined;
                    const summary = conversationSummaries[runtime.id];
                    const title = summary?.title ?? session?.title ?? `对话 ${runtime.id.slice(0, 8)}`;
                    const meta = `${project?.name ?? runtime.cwd} · ${runtime.archivedAt ? formatSettingsDate(runtime.archivedAt) : "已归档"}`;
                    return (
                      <div className={`settings-archive-item ${runtime.id === selectedArchivedRuntime?.id ? "selected" : ""}`} key={runtime.id}>
                        <div className="settings-archive-item-main">
                          <strong>{title}</strong>
                          <small>{meta}</small>
                        </div>
                        <IconButton
                          className="settings-action-button"
                          icon="arrow-right"
                          label={`查看 ${title}`}
                          title="查看"
                          onClick={() => {
                            setSelectedArchivedRuntimeId(runtime.id);
                            onOpenArchivedRuntime(runtime.id);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {selectedArchivedSnippet ? <p className="settings-archive-snippet">{selectedArchivedSnippet}</p> : null}
            </details>
        </section>
      </div>
    </section>
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



function latestArchiveSnippet(messages: ConversationMessage[]): string | undefined {
  const message = [...messages].reverse().find((item) => isArchivePreviewMessage(item) && item.text.trim());
  return message?.text.trim();
}

function isArchivePreviewMessage(message: ConversationMessage): boolean {
  return message.role === "user" || message.role === "assistant" || message.role === "error";
}


function notificationSummary(permission: "default" | "denied" | "granted" | "unsupported", enabled: boolean): string {
  if (permission === "unsupported") return "当前浏览器不支持系统通知";
  if (permission === "denied") return "系统通知权限已被浏览器拒绝";
  if (permission === "granted") return enabled ? "Pi 后台完成时发送系统通知，点击可回到对应对话" : "系统通知未启用";
  return "需要浏览器授权后才能发送系统通知";
}

function formatSettingsDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  } catch {
    return "未知时间";
  }
}


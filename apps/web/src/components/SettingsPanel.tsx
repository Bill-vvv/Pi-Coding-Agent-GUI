import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AppSettings, ConversationMessage, GuiSession, Project, Runtime, RuntimeConversationSummary, VoiceInputCaptureMode, VoiceInputMode, VoiceInputSettings, VoiceInputStatus } from "@pi-gui/shared";
import { useBrowserNotificationPermission } from "../hooks/useBrowserNotificationPermission";
import type { AccentColor, ChatFontSize, ThemeMode, UiFontSize, UiPreferences } from "../types";
import { Icon } from "./Icon";

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


const VOICE_INPUT_MODE_OPTIONS: Array<{ value: VoiceInputMode; label: string }> = [
  { value: "disabled", label: "关闭" },
  { value: "managedProcess", label: "自动管理（推荐）" },
  { value: "externalService", label: "连接已有服务" },
];

const VOICE_INPUT_CAPTURE_MODE_OPTIONS: Array<{ value: VoiceInputCaptureMode; label: string }> = [
  { value: "browser", label: "浏览器麦克风" },
  { value: "native", label: "原生桥接" },
];

const DEFAULT_VOICE_SERVICE_URL = "http://127.0.0.1:8765";
const DEFAULT_MANAGED_VOICE_COMMAND = "python";
const DEFAULT_MANAGED_VOICE_ARGS = ["server.py", "--port", "8765"];

const SETTINGS_SCROLLBAR_VISIBLE_MS = 900;
const SCROLL_INTERACTION_KEYS = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "]);

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

  const archivedRuntimes = runtimes.filter((runtime) => runtime.archivedAt).sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0));
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
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
        <button className="settings-back-button icon-button" type="button" title="返回聊天" aria-label="返回聊天" onClick={onClose}>
          <Icon name="arrow-left" />
        </button>
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
                <span>Overview</span>
                <small>查看 token usage 统计</small>
              </span>
              <Icon name="arrow-right" />
            </button>

            <VoiceInputSettingsPanel settings={localVoiceInput} saveError={voiceInputSaveError} onChange={updateVoiceInput} />

            <div className={`settings-setting-row ${desktopNotificationToggleDisabled ? "disabled" : ""}`}>
              <span className="settings-setting-copy">
                <span>通知</span>
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
                        <button
                          className="settings-action-button icon-button"
                          type="button"
                          title="查看"
                          aria-label={`查看 ${title}`}
                          onClick={() => {
                            setSelectedArchivedRuntimeId(runtime.id);
                            onOpenArchivedRuntime(runtime.id);
                          }}
                        >
                          <Icon name="arrow-right" />
                        </button>
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


function VoiceInputSettingsPanel({ settings, saveError, onChange }: { settings?: VoiceInputSettings; saveError?: string; onChange: (settings: Partial<VoiceInputSettings>) => void }) {
  const mode = settings?.mode ?? "disabled";
  const managedArgs = (settings?.managedArgs ?? []).join(" ");
  const [status, setStatus] = useState<VoiceInputStatus | undefined>();
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | undefined>();
  const headerStatus = voiceInputHeaderStatus(mode, status, statusError, statusLoading);
  const setupSummary = voiceInputSetupSummary(mode, settings);

  async function refreshVoiceStatus() {
    setStatusLoading(true);
    setStatusError(undefined);
    try {
      const response = await fetch("/api/voice/status");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setStatus((await response.json()) as VoiceInputStatus);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      setStatusLoading(false);
    }
  }

  function changeMode(nextMode: VoiceInputMode) {
    onChange(voiceInputModeDefaults(nextMode, settings));
  }

  return (
    <details className="settings-archive-dropdown">
      <summary>
        <span className="settings-archive-summary-main">
          <span>语音输入</span>
          <small>{headerStatus.summary}</small>
        </span>
      </summary>

      <div className="settings-voice-body">
        {saveError ? <p className="settings-archive-snippet">{saveError}</p> : null}
        <SettingsOptionGroup name="voice-input-mode" label="模式" options={VOICE_INPUT_MODE_OPTIONS} value={mode} onChange={changeMode} />
        {mode !== "disabled" ? (
          <>
            <p className="settings-archive-snippet">{setupSummary.title} · {setupSummary.detail}</p>
            <SettingsOptionGroup name="voice-input-capture-mode" label="录音来源" options={VOICE_INPUT_CAPTURE_MODE_OPTIONS} value={settings?.captureMode ?? "browser"} onChange={(captureMode) => onChange({ captureMode })} />
          </>
        ) : null}
        {mode === "managedProcess" ? (
          <>
            <SettingsTextInput id="settings-voice-cwd" label="Wrapper 目录" value={settings?.managedCwd ?? ""} placeholder="示例：/home/me/pi-gui/tools/capswriter-wrapper" onChange={(managedCwd) => onChange({ managedCwd })} />
            <SettingsTextInput id="settings-voice-model-path" label="模型路径（可选）" value={settings?.modelPath ?? ""} placeholder="可留空；也可用命令参数指定" onChange={(modelPath) => onChange({ modelPath })} />
            <SettingsTextInput id="settings-voice-url" label="服务地址" value={settings?.externalUrl ?? ""} placeholder={DEFAULT_VOICE_SERVICE_URL} onChange={(externalUrl) => onChange({ externalUrl })} />
            <SettingsTextInput id="settings-voice-command" label="启动命令" value={settings?.managedCommand ?? ""} placeholder={DEFAULT_MANAGED_VOICE_COMMAND} onChange={(managedCommand) => onChange({ managedCommand })} />
            <SettingsTextInput id="settings-voice-args" label="命令参数" value={managedArgs} placeholder={DEFAULT_MANAGED_VOICE_ARGS.join(" ")} onChange={(value) => onChange({ managedArgs: splitManagedArgs(value) })} />
          </>
        ) : null}
        {mode === "externalService" ? <SettingsTextInput id="settings-voice-url" label="服务地址" value={settings?.externalUrl ?? ""} placeholder={`示例：${DEFAULT_VOICE_SERVICE_URL}`} onChange={(externalUrl) => onChange({ externalUrl })} /> : null}
        {mode !== "disabled" ? (
          <>
            <button className="settings-action-button" type="button" disabled={statusLoading} onClick={() => void refreshVoiceStatus()}>{statusLoading ? "检测中…" : "检测服务状态"}</button>
            <p className="settings-archive-snippet">{statusError ? `检测失败：${statusError}` : status ? voiceInputStatusSummary(status) : "尚未检测"}</p>
            <p className="settings-archive-snippet">{settings?.captureMode === "native" ? "原生桥接不会调用浏览器麦克风；wrapper 需要支持 /record/start 和 /record/stop，并能访问本机麦克风。" : "浏览器麦克风适合手机/远程；本机桌面追求准确率时建议使用原生桥接。"}</p>
          </>
        ) : null}
      </div>
    </details>
  );
}

function SettingsTextInput({ id, label, value, placeholder, onChange }: { id: string; label: string; value: string; placeholder?: string; onChange: (value: string) => void }) {
  return (
    <div className="settings-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function voiceInputModeDefaults(mode: VoiceInputMode, current: VoiceInputSettings | undefined): Partial<VoiceInputSettings> {
  if (mode === "disabled") return { mode };
  if (mode === "managedProcess") {
    return {
      ...current,
      mode,
      captureMode: current?.captureMode ?? "browser",
      externalUrl: current?.externalUrl ?? DEFAULT_VOICE_SERVICE_URL,
      managedCommand: current?.managedCommand ?? DEFAULT_MANAGED_VOICE_COMMAND,
      managedArgs: current?.managedArgs?.length ? current.managedArgs : DEFAULT_MANAGED_VOICE_ARGS,
      autoStart: current?.autoStart ?? true,
    };
  }
  return {
    ...current,
    mode,
    captureMode: current?.captureMode ?? "browser",
    externalUrl: current?.externalUrl ?? DEFAULT_VOICE_SERVICE_URL,
  };
}

function voiceInputHeaderStatus(mode: VoiceInputMode, status: VoiceInputStatus | undefined, statusError: string | undefined, loading: boolean): { summary: string } {
  if (loading) return { summary: "正在检测…" };
  if (statusError) return { summary: `检测失败：${statusError}` };
  if (status) return { summary: voiceInputStatusSummary(status) };
  if (mode === "externalService") return { summary: "连接已运行的本地 ASR 服务" };
  if (mode === "managedProcess") return { summary: "自动启动本地 ASR wrapper" };
  return { summary: "未启用" };
}

function voiceInputSetupSummary(mode: VoiceInputMode, settings: VoiceInputSettings | undefined): { title: string; detail: string } {
  if (mode === "externalService") return { title: "连接已有服务", detail: settings?.externalUrl || DEFAULT_VOICE_SERVICE_URL };
  if (settings?.captureMode === "native") return { title: "本机原生录音", detail: "本地 wrapper 直接采集麦克风" };
  return { title: "浏览器麦克风", detail: "浏览器录音并交给本地 ASR" };
}

function voiceInputStatusSummary(status: VoiceInputStatus): string {
  const prefix = status.available ? "可用" : status.state === "disabled" ? "已关闭" : "不可用";
  return status.message ? `${prefix} · ${status.message}` : prefix;
}

function voiceInputSettingsEqual(left: VoiceInputSettings | undefined, right: VoiceInputSettings | undefined): boolean {
  return JSON.stringify(left ?? { mode: "disabled" }) === JSON.stringify(right ?? { mode: "disabled" });
}

function splitManagedArgs(value: string): string[] {
  return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function latestArchiveSnippet(messages: ConversationMessage[]): string | undefined {
  const message = [...messages].reverse().find((item) => isArchivePreviewMessage(item) && item.text.trim());
  return message?.text.trim();
}

function isArchivePreviewMessage(message: ConversationMessage): boolean {
  return message.role === "user" || message.role === "assistant" || message.role === "error";
}

function useSettingsScrollbar() {
  const [isVisible, setIsVisible] = useState(false);
  const hideTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  const reveal = useCallback(() => {
    setIsVisible(true);
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = undefined;
      setIsVisible(false);
    }, SETTINGS_SCROLLBAR_VISIBLE_MS);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (SCROLL_INTERACTION_KEYS.has(event.key)) reveal();
    },
    [reveal],
  );

  return { isVisible, reveal, handleKeyDown };
}

function notificationSummary(permission: "default" | "denied" | "granted" | "unsupported", enabled: boolean): string {
  const desktop = permission === "unsupported" ? "桌面不支持" : permission === "denied" ? "桌面被拒绝" : permission === "granted" ? (enabled ? "桌面已启用" : "桌面未启用") : "桌面未授权";
  return `应用内开启 · ${desktop}`;
}

function formatSettingsDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  } catch {
    return "未知时间";
  }
}

function SettingsOptionGroup<T extends string>({
  name,
  label,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-field">
      <label>{label}</label>
      <div className="settings-radio-options" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <label className={`settings-radio-option ${value === option.value ? "selected" : ""} ${option.disabled ? "disabled" : ""}`} key={option.value}>
            <input
              type="radio"
              name={`settings-${name}`}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ConversationMessage, GuiSession, Project, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";
import { useBrowserNotificationPermission } from "../hooks/useBrowserNotificationPermission";
import type { AccentColor, ChatFontSize, ThemeMode, UiFontSize, UiPreferences } from "../types";
import { Icon } from "./Icon";

type SettingsPanelProps = {
  open: boolean;
  preferences: UiPreferences;
  projects: Project[];
  sessions: GuiSession[];
  runtimes: Runtime[];
  conversationSummaries: Record<string, RuntimeConversationSummary>;
  messagesByRuntime: Record<string, ConversationMessage[]>;
  onClose: () => void;
  onChangePreferences: (preferences: UiPreferences) => void;
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

const SETTINGS_SCROLLBAR_VISIBLE_MS = 900;
const SCROLL_INTERACTION_KEYS = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "]);

export function SettingsPanel({
  open,
  preferences,
  projects,
  sessions,
  runtimes,
  conversationSummaries,
  messagesByRuntime,
  onClose,
  onChangePreferences,
  onOpenArchivedRuntime,
  onOpenUsageOverview,
}: SettingsPanelProps) {
  const [selectedArchivedRuntimeId, setSelectedArchivedRuntimeId] = useState<string | undefined>();
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

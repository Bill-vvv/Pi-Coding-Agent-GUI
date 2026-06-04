import { useState } from "react";
import type { ConversationMessage, GuiSession, Project, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";
import type { AccentColor, ChatFontSize, ThemeMode, UiFontSize, UiPreferences } from "../types";
import { Icon } from "./Icon";

type SettingsModalProps = {
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

export function SettingsModal({
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
}: SettingsModalProps) {
  const [selectedArchivedRuntimeId, setSelectedArchivedRuntimeId] = useState<string | undefined>();
  if (!open) return null;

  const archivedRuntimes = runtimes.filter((runtime) => runtime.archivedAt).sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0));
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const selectedArchivedRuntime = archivedRuntimes.find((runtime) => runtime.id === selectedArchivedRuntimeId) ?? archivedRuntimes[0];
  const selectedArchivedMessages = selectedArchivedRuntime ? messagesByRuntime[selectedArchivedRuntime.id] ?? [] : [];

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

          <section className="settings-section" aria-labelledby="settings-archive-title">
            <div className="settings-section-header">
              <div>
                <h3 id="settings-archive-title">已归档对话</h3>
                <p>这里集中查看从左侧导航归档的对话。归档内容不会出现在普通对话导航中。</p>
              </div>
              <span className="settings-archive-count">{archivedRuntimes.length}</span>
            </div>

            {archivedRuntimes.length > 0 ? (
              <>
                <div className="settings-archive-list">
                  {archivedRuntimes.map((runtime) => {
                    const project = projectsById.get(runtime.projectId);
                    const session = runtime.sessionId ? sessionsById.get(runtime.sessionId) : undefined;
                    const summary = conversationSummaries[runtime.id];
                    return (
                      <button
                        className={`settings-archive-item ${runtime.id === selectedArchivedRuntime?.id ? "selected" : ""}`}
                        type="button"
                        key={runtime.id}
                        onClick={() => {
                          setSelectedArchivedRuntimeId(runtime.id);
                          onOpenArchivedRuntime(runtime.id);
                        }}
                      >
                        <div className="settings-archive-item-main">
                          <strong>{summary?.title ?? session?.title ?? `对话 ${runtime.id.slice(0, 8)}`}</strong>
                          <small>{summary?.detail ?? (runtime.sessionId ? `Session ${runtime.sessionId.slice(0, 8)}` : "无关联 Pi session")}</small>
                        </div>
                        <div className="settings-archive-meta">
                          <span>{project?.name ?? runtime.cwd}</span>
                          <span>{runtime.archivedAt ? formatSettingsDate(runtime.archivedAt) : "已归档"}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <ArchivedConversationPreview runtime={selectedArchivedRuntime} messages={selectedArchivedMessages} onLoad={onOpenArchivedRuntime} />
              </>
            ) : (
              <p className="settings-empty-state">暂无已归档对话。</p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function ArchivedConversationPreview({ runtime, messages, onLoad }: { runtime?: Runtime; messages: ConversationMessage[]; onLoad: (runtimeId: string) => void }) {
  if (!runtime) return null;
  const visibleMessages = messages.filter((message) => message.role === "user" || message.role === "assistant" || message.role === "error").slice(-30);
  return (
    <section className="settings-archive-preview" aria-label="已归档对话内容">
      <header>
        <strong>对话内容预览</strong>
        <button type="button" onClick={() => onLoad(runtime.id)}>加载/刷新内容</button>
      </header>
      {visibleMessages.length > 0 ? (
        <div className="settings-archive-messages">
          {visibleMessages.map((message) => (
            <article className={`settings-archive-message ${message.role}`} key={message.id}>
              <span>{message.role === "user" ? "用户" : message.role === "assistant" ? "Assistant" : "错误"}</span>
              <p>{message.text || message.thinking || "（空消息）"}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="settings-empty-state">尚未加载此归档对话内容，点击“加载/刷新内容”。</p>
      )}
    </section>
  );
}

function formatSettingsDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  } catch {
    return "未知时间";
  }
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

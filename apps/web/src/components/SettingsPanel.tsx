import { useEffect, useState } from "react";
import type {
  AppSettings,
  Project,
  RewindCheckpointOperation,
  RewindCheckpointPreview,
  RewindCheckpointRestoreResult,
  RewindCheckpointSummary,
  RewindGarbageCollectResult,
  RewindJumpHistoryEntry,
  RewindStorageHealth,
  Runtime,
  RuntimeProfileId,
} from "@pi-gui/shared";
import { DEFAULT_RUNTIME_PROFILE_ID, RUNTIME_PROFILES } from "@pi-gui/shared";
import { useBrowserNotificationPermission } from "../hooks/useBrowserNotificationPermission";
import { useEnvironmentDiagnostics } from "../hooks/useEnvironmentDiagnostics";
import { useRemoteAccess } from "../hooks/useRemoteAccess";
import { requiresUnknownExtensionConfirmation, UNKNOWN_USER_EXTENSIONS_CONFIRMATION } from "../domain/capabilities";
import { GUI_KEYBINDING_DEFINITIONS, effectiveGuiKeybindings, normalizeKeyCombo } from "../domain/keybindings";
import type { PendingCommandSummary } from "../domain/pendingCommands";
import type { DesktopPetListPayload, DesktopShellBridge } from "../domain/desktopShell";
import type { ReplayRecoveryState } from "../state/appReducer";
import type { AccentColor, ChatFontSize, ConnectionState, ThemeMode, ThinkingToolDisplayMode, UiFontSize, UiPreferences, WebSocketDiagnostics } from "../types";
import { Icon } from "./Icon";
import { IconButton } from "./ui";
import { RemoteAccessPanel } from "./RemoteAccessPanel";
import { CapabilityPanel } from "./settings/CapabilityPanel";
import { CheckpointPanel } from "./settings/CheckpointPanel";
import { EnvironmentDiagnosticsPanel } from "./settings/EnvironmentDiagnosticsPanel";
import { SettingsOptionGroup } from "./settings/SettingsOptionGroup";
import { WebSocketDiagnosticsPanel } from "./settings/WebSocketDiagnosticsPanel";
import { useSettingsScrollbar } from "./settings/useSettingsScrollbar";

type SettingsTab = "ui" | "function" | "extension";

type SettingsPanelProps = {
  open: boolean;
  preferences: UiPreferences;
  settings: AppSettings;
  connection: ConnectionState;
  webSocketDiagnostics: WebSocketDiagnostics;
  replayRecovery?: ReplayRecoveryState;
  pendingCommandSummary?: PendingCommandSummary;
  selectedProject?: Project;
  activeRuntime?: Runtime;
  checkpoints: RewindCheckpointSummary[];
  checkpointOperations: RewindCheckpointOperation[];
  checkpointJumps: RewindJumpHistoryEntry[];
  checkpointHealth?: RewindStorageHealth;
  checkpointGcResult?: RewindGarbageCollectResult;
  checkpointPreview?: RewindCheckpointPreview;
  checkpointRestoreResult?: RewindCheckpointRestoreResult;
  checkpointPreviewSnapshotId?: string;
  checkpointPreviewLoading?: boolean;
  checkpointListLoading?: boolean;
  checkpointHealthLoading?: boolean;
  checkpointJumpsLoading?: boolean;
  pendingCheckpointCapture?: boolean;
  pendingCheckpointRestoreSnapshotId?: string;
  pendingCheckpointGcMode?: "dry-run" | "run";
  onRefreshCheckpoints: () => void;
  onRefreshCheckpointHealth: () => void;
  onRefreshCheckpointJumps: () => void;
  onCaptureCheckpoint: () => void;
  onOpenCheckpointPreview: (snapshotId: string) => void;
  onCloseCheckpointPreview: () => void;
  onRestoreCheckpoint: (snapshotId: string, target?: { runtimeId: string; entryId: string }) => void;
  onRunCheckpointGc: (dryRun: boolean) => void;
  onClose: () => void;
  onChangePreferences: (preferences: UiPreferences) => void;
  onChangeSettings: (settings: Partial<AppSettings>) => boolean;
  onChangeProjectRuntimeProfile: (projectId: string, defaultRuntimeProfileId: RuntimeProfileId | null) => boolean;
  onOpenUsageOverview: () => void;
  focusTab?: SettingsTab;
  focusCapabilityId?: string;
  desktopPetAvailable?: boolean;
  desktopShell?: DesktopShellBridge;
};

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; summary: string }> = [
  { id: "ui", label: "UI 设置", summary: "外观、字号、快捷键" },
  { id: "function", label: "功能设置", summary: "连接、诊断、通知" },
  { id: "extension", label: "拓展设置", summary: "运行模式、GUI / 项目拓展" },
];

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
  { value: "tui", label: "TUI 流" },
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

const DESKTOP_PET_SCALE_OPTIONS: Array<{ value: "0.75" | "1" | "1.25" | "1.5"; label: string }> = [
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.25", label: "125%" },
  { value: "1.5", label: "150%" },
];

const RUNTIME_PROFILE_OPTIONS = RUNTIME_PROFILES.map((profile) => ({ value: profile.id, label: runtimeProfileOptionLabel(profile.id, profile.label) }));

export function SettingsPanel({
  open,
  preferences,
  settings,
  connection,
  webSocketDiagnostics,
  replayRecovery,
  pendingCommandSummary,
  selectedProject,
  activeRuntime,
  checkpoints,
  checkpointOperations,
  checkpointJumps,
  checkpointHealth,
  checkpointGcResult,
  checkpointPreview,
  checkpointRestoreResult,
  checkpointPreviewSnapshotId,
  checkpointPreviewLoading,
  checkpointListLoading,
  checkpointHealthLoading,
  checkpointJumpsLoading,
  pendingCheckpointCapture,
  pendingCheckpointRestoreSnapshotId,
  pendingCheckpointGcMode,
  onRefreshCheckpoints,
  onRefreshCheckpointHealth,
  onRefreshCheckpointJumps,
  onCaptureCheckpoint,
  onOpenCheckpointPreview,
  onCloseCheckpointPreview,
  onRestoreCheckpoint,
  onRunCheckpointGc,
  onClose,
  onChangePreferences,
  onChangeSettings,
  onChangeProjectRuntimeProfile,
  onOpenUsageOverview,
  focusTab,
  focusCapabilityId,
  desktopPetAvailable,
  desktopShell,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(focusTab ?? (focusCapabilityId === "pi-pet-companion" ? "function" : focusCapabilityId ? "extension" : "ui"));
  const functionTabOpen = open && activeTab === "function";
  const {
    permission: notificationPermission,
    supported: browserNotificationsSupported,
    requestPermission: requestBrowserNotificationPermission,
  } = useBrowserNotificationPermission();
  const contentScrollbar = useSettingsScrollbar();
  const environmentDiagnostics = useEnvironmentDiagnostics(functionTabOpen);
  const remoteAccess = useRemoteAccess(functionTabOpen);

  useEffect(() => {
    if (!open) return;
    if (focusTab) {
      setActiveTab(focusTab);
      return;
    }
    if (focusCapabilityId) setActiveTab(focusCapabilityId === "pi-pet-companion" ? "function" : "extension");
  }, [focusCapabilityId, focusTab, open]);

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
      <aside className="settings-sidebar" aria-label="设置分区">
        <header className="settings-header">
          <IconButton className="settings-back-button" icon="arrow-left" label="返回聊天" onClick={onClose} />
          <h2>设置</h2>
        </header>

        <nav className="settings-section-nav" aria-label="设置分类" role="tablist">
          {SETTINGS_TABS.map((tab) => (
            <button
              className={`settings-section-nav-item ${activeTab === tab.id ? "selected" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`settings-tabpanel-${tab.id}`}
              id={`settings-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.label}</span>
              <small>{tab.summary}</small>
            </button>
          ))}
        </nav>
      </aside>

      <div
        className={`settings-content settings-scroll-area${contentScrollbar.isVisible ? " is-scrolling" : ""}`}
        tabIndex={0}
        onKeyDown={contentScrollbar.handleKeyDown}
        onScrollCapture={contentScrollbar.reveal}
        onTouchMove={contentScrollbar.reveal}
        onWheel={contentScrollbar.reveal}
      >
        {activeTab === "ui" ? (
          <section className="settings-section settings-content-panel" aria-label="UI 设置" role="tabpanel" id="settings-tabpanel-ui" aria-labelledby="settings-tab-ui">
            <h3 className="settings-section-title">UI Settings</h3>
            <SettingsOptionGroup
              name="ui-font-size"
              label="界面字号"
              options={UI_FONT_OPTIONS}
              value={preferences.uiFontSize}
              onChange={(value) => update({ uiFontSize: value })}
              variant="dropdown"
              renderOptionVisual={(option, currentValue) => <FontSizeComparison current={currentValue} target={option.value} kind="ui" />}
            />

            <SettingsOptionGroup
              name="chat-font-size"
              label="对话字号"
              options={CHAT_FONT_OPTIONS}
              value={preferences.chatFontSize}
              onChange={(value) => update({ chatFontSize: value })}
              variant="dropdown"
              renderOptionVisual={(option, currentValue) => <FontSizeComparison current={currentValue} target={option.value} kind="chat" />}
            />

            <SettingsOptionGroup
              name="thinking-tool-display"
              label="思考/工具流"
              options={THINKING_TOOL_DISPLAY_OPTIONS}
              value={preferences.thinkingToolDisplayMode}
              onChange={(value) => update({ thinkingToolDisplayMode: value })}
              variant="dropdown"
              renderOptionVisual={(option) => <ThinkingToolFlowPreview mode={option.value} />}
              describeOption={(option) => thinkingToolDisplayDescription(option.value)}
            />

            <SettingsOptionGroup
              name="theme"
              label="主题"
              options={THEME_OPTIONS}
              value={preferences.theme}
              onChange={(value) => update({ theme: value })}
              variant="dropdown"
              renderOptionVisual={(option) => <ThemePreview mode={option.value} />}
              describeOption={(option) => themeOptionDescription(option.value)}
            />

            <SettingsOptionGroup
              name="accent-color"
              label="强调色"
              options={ACCENT_OPTIONS}
              value={preferences.accentColor}
              onChange={(value) => update({ accentColor: value })}
              variant="dropdown"
              renderOptionVisual={(option) => <AccentPreview accent={option.value} />}
              describeOption={(option) => accentOptionDescription(option.value)}
            />

            <ShortcutSettingsPanel preferences={preferences} onChange={(keybindings) => update({ keybindings })} />
          </section>
        ) : activeTab === "function" ? (
          <section className="settings-section settings-content-panel" aria-label="功能设置" role="tabpanel" id="settings-tabpanel-function" aria-labelledby="settings-tab-function">
            <h3 className="settings-section-title">Function Settings</h3>

            <button className="settings-setting-row settings-navigation-row" type="button" onClick={onOpenUsageOverview}>
              <span className="settings-setting-copy">
                <span>用量概览</span>
                <small>查看 token 用量统计</small>
              </span>
              <Icon name="arrow-right" />
            </button>

            <EnvironmentDiagnosticsPanel state={environmentDiagnostics} />
            <WebSocketDiagnosticsPanel connection={connection} diagnostics={webSocketDiagnostics} replayRecovery={replayRecovery} pendingCommandSummary={pendingCommandSummary} />
            <RemoteAccessPanel state={remoteAccess} />

            <PiPetSettings preferences={preferences} desktopPetAvailable={Boolean(desktopPetAvailable)} desktopShell={desktopShell} onChange={update} />

            <CheckpointPanel
              connection={connection}
              project={selectedProject}
              activeRuntime={activeRuntime}
              checkpoints={checkpoints}
              checkpointOperations={checkpointOperations}
              checkpointJumps={checkpointJumps}
              checkpointHealth={checkpointHealth}
              checkpointGcResult={checkpointGcResult}
              checkpointPreview={checkpointPreview}
              checkpointRestoreResult={checkpointRestoreResult}
              checkpointPreviewSnapshotId={checkpointPreviewSnapshotId}
              checkpointPreviewLoading={checkpointPreviewLoading}
              checkpointListLoading={checkpointListLoading}
              checkpointHealthLoading={checkpointHealthLoading}
              checkpointJumpsLoading={checkpointJumpsLoading}
              pendingCheckpointCapture={pendingCheckpointCapture}
              pendingCheckpointRestoreSnapshotId={pendingCheckpointRestoreSnapshotId}
              pendingCheckpointGcMode={pendingCheckpointGcMode}
              onRefreshCheckpoints={onRefreshCheckpoints}
              onRefreshCheckpointHealth={onRefreshCheckpointHealth}
              onRefreshCheckpointJumps={onRefreshCheckpointJumps}
              onCaptureCheckpoint={onCaptureCheckpoint}
              onOpenCheckpointPreview={onOpenCheckpointPreview}
              onCloseCheckpointPreview={onCloseCheckpointPreview}
              onRestoreCheckpoint={onRestoreCheckpoint}
              onRunCheckpointGc={onRunCheckpointGc}
            />

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
        ) : (
          <section className="settings-section settings-content-panel" aria-label="拓展设置" role="tabpanel" id="settings-tabpanel-extension" aria-labelledby="settings-tab-extension">
            <h3 className="settings-section-title">拓展设置</h3>
            <RuntimeProfileSettings settings={settings} selectedProject={selectedProject} onChangeSettings={onChangeSettings} onChangeProjectRuntimeProfile={onChangeProjectRuntimeProfile} />
            <CapabilityPanel settings={settings} selectedProject={selectedProject} onChangeSettings={onChangeSettings} focusCapabilityId={focusCapabilityId} />
          </section>
        )}
      </div>
    </section>
  );
}

const FONT_SIZE_LABELS: Record<UiFontSize | ChatFontSize, string> = {
  small: "小",
  medium: "标准",
  large: "大",
};

function FontSizeComparison({ current, target, kind }: { current: UiFontSize | ChatFontSize; target: UiFontSize | ChatFontSize; kind: "ui" | "chat" }) {
  return (
    <span className="settings-font-comparison">
      <span className="settings-font-sample" style={{ fontSize: fontSizePreviewValue(kind, current) }}>{FONT_SIZE_LABELS[current]}</span>
      <span className="settings-font-sample" style={{ fontSize: fontSizePreviewValue(kind, target) }}>{FONT_SIZE_LABELS[target]}</span>
    </span>
  );
}

function fontSizePreviewValue(_kind: "ui" | "chat", size: UiFontSize | ChatFontSize): string {
  if (size === "small") return "12px";
  if (size === "large") return "18px";
  return "15px";
}

function ThemePreview({ mode }: { mode: ThemeMode }) {
  return (
    <span className={`settings-theme-preview ${mode}`}>
      <span />
      <span />
    </span>
  );
}

function themeOptionDescription(mode: ThemeMode) {
  if (mode === "dark") return "深色表面与浅色文字";
  if (mode === "light") return "浅色表面与深色文字";
  return "按系统在深色 / 浅色间切换";
}

function AccentPreview({ accent }: { accent: AccentColor }) {
  return <span className={`settings-accent-preview ${accent}`} />;
}

function accentOptionDescription(accent: AccentColor) {
  const labels: Record<AccentColor, string> = {
    amber: "琥珀高亮",
    blue: "蓝色高亮",
    green: "绿色高亮",
    rose: "玫瑰高亮",
  };
  return labels[accent];
}

function ThinkingToolFlowPreview({ mode }: { mode: ThinkingToolDisplayMode }) {
  return (
    <span className={`settings-flow-preview ${mode}`}>
      <span />
      <span />
      <span />
    </span>
  );
}

function thinkingToolDisplayDescription(mode: ThinkingToolDisplayMode) {
  if (mode === "compact") return "将思考与工具结果收拢成紧凑块";
  if (mode === "tui") return "按 TUI 节奏展示逐条过程事件";
  return "按发生顺序穿插在正文流里";
}

function scaleOptionValue(value: string): "0.75" | "1" | "1.25" | "1.5" {
  return value === "0.75" || value === "1.25" || value === "1.5" ? value : "1";
}

function PiPetSettings({
  preferences,
  desktopPetAvailable,
  desktopShell,
  onChange,
}: {
  preferences: UiPreferences;
  desktopPetAvailable: boolean;
  desktopShell?: DesktopShellBridge;
  onChange: (preferences: Partial<UiPreferences>) => void;
}) {
  const [petList, setPetList] = useState<DesktopPetListPayload | undefined>();

  useEffect(() => {
    let cancelled = false;
    if (!desktopPetAvailable || !desktopShell?.listDesktopPets) {
      setPetList(undefined);
      return undefined;
    }
    void desktopShell.listDesktopPets().then((list) => {
      if (!cancelled) setPetList(list);
    }).catch(() => {
      if (!cancelled) setPetList(undefined);
    });
    return () => { cancelled = true; };
  }, [desktopPetAvailable, desktopShell]);

  async function refreshPetList() {
    if (!desktopShell?.listDesktopPets) return;
    const list = await desktopShell.listDesktopPets().catch(() => undefined);
    if (list) setPetList(list);
  }

  async function selectPet(petId: string) {
    if (!desktopShell?.setDesktopPetSelection) return;
    await desktopShell.setDesktopPetSelection(petId);
    await refreshPetList();
  }

  async function setScale(scaleValue: string) {
    if (!desktopShell?.setDesktopPetScale) return;
    await desktopShell.setDesktopPetScale(Number(scaleValue));
    await refreshPetList();
  }

  async function resetPosition() {
    if (!desktopShell?.resetDesktopPetPosition) return;
    await desktopShell.resetDesktopPetPosition();
  }

  const petOptions = petList?.pets.map((pet) => ({ value: pet.id, label: pet.displayName })) ?? [];
  const selectedPetId = petList?.selectedPetId ?? petOptions[0]?.value ?? "";
  const scaleValue = String(petList?.scale ?? 1);

  return (
    <div className="settings-pet-block" id="capability-pi-pet-companion">
      <div className={`settings-setting-row ${!desktopPetAvailable ? "disabled" : ""}`}>
        <span className="settings-setting-copy">
          <span>桌面 PET</span>
          <small>{desktopPetSummary(desktopPetAvailable)}</small>
        </span>
        <label className={`settings-toggle-control ${!desktopPetAvailable ? "disabled" : ""}`}>
          <input
            type="checkbox"
            aria-label="桌面 PET"
            checked={preferences.desktopPetEnabled}
            disabled={!desktopPetAvailable}
            onChange={(event) => onChange({ desktopPetEnabled: event.target.checked })}
          />
          <span className="settings-toggle-track" />
        </label>
      </div>

      {desktopPetAvailable && petOptions.length > 0 ? (
        <SettingsOptionGroup
          name="desktop-pet-bundle"
          label="PET 外观"
          options={petOptions}
          value={selectedPetId}
          onChange={(petId) => void selectPet(petId)}
          variant="dropdown"
        />
      ) : null}

      {desktopPetAvailable ? (
        <>
          <SettingsOptionGroup
            name="desktop-pet-scale"
            label="PET 缩放"
            options={DESKTOP_PET_SCALE_OPTIONS}
            value={scaleOptionValue(scaleValue)}
            onChange={(value) => void setScale(value)}
            variant="dropdown"
          />
          <button className="settings-setting-row settings-navigation-row" type="button" onClick={() => void resetPosition()}>
            <span className="settings-setting-copy">
              <span>重置 PET 位置</span>
              <small>移动回屏幕右下角</small>
            </span>
            <Icon name="arrow-right" />
          </button>
        </>
      ) : null}
    </div>
  );
}

function desktopPetSummary(desktopPetAvailable: boolean): string {
  if (!desktopPetAvailable) return "仅 Electron 桌面壳可用";
  return "打开 always-on-top 原生桌宠窗口";
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
  const rawSelectedProfileId = settings.defaultRuntimeProfileId ?? DEFAULT_RUNTIME_PROFILE_ID;
  const selectedProfileId = visibleRuntimeProfileId(rawSelectedProfileId);
  const projectProfileValue = selectedProject?.defaultRuntimeProfileId ? visibleRuntimeProfileId(selectedProject.defaultRuntimeProfileId) : "inherit-global";

  function selectProfile(defaultRuntimeProfileId: RuntimeProfileId) {
    if (requiresUnknownExtensionConfirmation(defaultRuntimeProfileId, rawSelectedProfileId) && !window.confirm(UNKNOWN_USER_EXTENSIONS_CONFIRMATION)) return;
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
        label="运行模式"
        options={RUNTIME_PROFILE_OPTIONS}
        value={selectedProfileId}
        onChange={selectProfile}
        variant="dropdown"
        labelHelp={runtimeProfileDescription(selectedProfileId)}
      />
      {selectedProject ? (
        <SettingsOptionGroup
          name="project-runtime-profile"
          label="项目覆盖"
          options={[{ value: "inherit-global", label: "继承默认" }, ...RUNTIME_PROFILE_OPTIONS]}
          value={projectProfileValue}
          onChange={selectProjectProfile}
          variant="dropdown"
          labelHelp={projectRuntimeProfileDescription(projectProfileValue)}
        />
      ) : null}

    </div>
  );
}

function visibleRuntimeProfileId(profileId: RuntimeProfileId): RuntimeProfileId {
  return RUNTIME_PROFILES.some((profile) => profile.id === profileId) ? profileId : "custom";
}

function runtimeProfileOptionLabel(_profileId: RuntimeProfileId, label: string): string {
  return label;
}

function runtimeProfileDescription(profileId: RuntimeProfileId): string | undefined {
  return RUNTIME_PROFILES.find((profile) => profile.id === profileId)?.summary;
}

function projectRuntimeProfileDescription(profileId: RuntimeProfileId | "inherit-global"): string | undefined {
  if (profileId === "inherit-global") return "使用全局运行模式。";
  return runtimeProfileDescription(profileId);
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


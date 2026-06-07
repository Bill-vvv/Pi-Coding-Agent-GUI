import { useEffect, useRef, useState } from "react";
import type { VoiceInputCaptureMode, VoiceInputMode, VoiceInputSettings, VoiceInputStatus } from "@pi-gui/shared";
import { apiUrl } from "../../domain/apiUrl";
import { authHeaders } from "../../domain/runtimeConfig";
import {
  DEFAULT_CAPSWRITER_SERVICE_URL,
  DEFAULT_CAPSWRITER_WS_URL,
  DEFAULT_MANAGED_VOICE_ARGS,
  DEFAULT_MANAGED_VOICE_COMMAND,
  DEFAULT_VOICE_SERVICE_URL,
  capswriterBridgeSettings,
  capsWriterBridgeFieldsFromSettings,
  deriveVoiceInputUserMode,
  rawVoiceInputCaptureModeOrDefault,
  rawVoiceInputModeOrEnabledDefault,
  splitManagedArgs,
  voiceInputSettingsForUserMode,
  type CapsWriterBridgeFields,
  type VoiceInputUserMode,
} from "../../domain/voiceInputSettings";
import { SettingsOptionGroup } from "./SettingsOptionGroup";

const VOICE_INPUT_USER_MODE_OPTIONS: Array<{ value: VoiceInputUserMode; label: string }> = [
  { value: "off", label: "关闭" },
  { value: "browserMicrophone", label: "浏览器麦克风" },
  { value: "capswriterNativeBridge", label: "CapsWriter 原生桥接" },
];

const RAW_VOICE_INPUT_MODE_OPTIONS: Array<{ value: VoiceInputMode; label: string }> = [
  { value: "disabled", label: "关闭" },
  { value: "managedProcess", label: "自动管理 wrapper" },
  { value: "externalService", label: "连接已有服务" },
];

const RAW_VOICE_INPUT_CAPTURE_MODE_OPTIONS: Array<{ value: VoiceInputCaptureMode; label: string }> = [
  { value: "browser", label: "浏览器录音" },
  { value: "native", label: "wrapper 原生录音" },
];

export function VoiceInputSettingsPanel({ settings, saveError, onChange }: { settings?: VoiceInputSettings; saveError?: string; onChange: (settings: Partial<VoiceInputSettings>) => void }) {
  const userMode = deriveVoiceInputUserMode(settings);
  const userModeOptions = userMode === "customAdvanced"
    ? [...VOICE_INPUT_USER_MODE_OPTIONS, { value: "customAdvanced" as const, label: "自定义 / 高级" }]
    : VOICE_INPUT_USER_MODE_OPTIONS;
  const fields = capsWriterBridgeFieldsFromSettings(settings);
  const settingsStatusKey = voiceInputStatusKey(settings, userMode);
  const statusKeyRef = useRef(settingsStatusKey);
  const [status, setStatus] = useState<VoiceInputStatus | undefined>();
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | undefined>();
  const headerStatus = voiceInputHeaderStatus(userMode, status, statusError, statusLoading);
  const setupSummary = voiceInputSetupSummary(userMode, settings);

  useEffect(() => {
    statusKeyRef.current = settingsStatusKey;
    setStatus(undefined);
    setStatusError(undefined);
    setStatusLoading(false);
  }, [settingsStatusKey]);

  async function refreshVoiceStatus() {
    const requestedStatusKey = statusKeyRef.current;
    setStatusLoading(true);
    setStatusError(undefined);
    try {
      const response = await fetch(apiUrl("/api/voice/status"), { headers: authHeaders() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextStatus = (await response.json()) as VoiceInputStatus;
      if (statusKeyRef.current === requestedStatusKey) setStatus(nextStatus);
    } catch (error) {
      if (statusKeyRef.current === requestedStatusKey) setStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      if (statusKeyRef.current === requestedStatusKey) setStatusLoading(false);
    }
  }

  function changeUserMode(nextMode: VoiceInputUserMode) {
    onChange(voiceInputSettingsForUserMode(nextMode, settings));
  }

  function updateCapsWriterBridge(next: Partial<CapsWriterBridgeFields>) {
    onChange(capswriterBridgeSettings(settings, { ...fields, ...next }));
  }

  return (
    <details className="settings-diagnostics-dropdown">
      <summary>
        <span className="settings-diagnostics-summary-main">
          <span>语音输入</span>
          <small>{headerStatus.summary}</small>
        </span>
        <span className={`settings-diagnostics-pill ${headerStatus.tone}`}>{headerStatus.label}</span>
      </summary>

      <div className="settings-diagnostics-body">
        {saveError ? <p className="settings-diagnostics-error">{saveError}</p> : null}
        <SettingsOptionGroup name="voice-input-user-mode" label="模式" options={userModeOptions} value={userMode} onChange={changeUserMode} />
        <div className="settings-voice-summary">
          <span>{setupSummary.title}</span>
          <small>{setupSummary.detail}</small>
        </div>

        {userMode === "capswriterNativeBridge" ? (
          <CapsWriterBridgeEditor fields={fields} onChange={updateCapsWriterBridge} />
        ) : null}

        {userMode === "browserMicrophone" ? (
          <p className="settings-voice-hint">浏览器会请求麦克风权限并用 MediaRecorder 录音；适合手机、远程浏览器或原生 helper 无法访问麦克风时使用。</p>
        ) : null}

        {userMode !== "off" ? <VoiceStatusRow status={status} statusError={statusError} statusLoading={statusLoading} onRefresh={refreshVoiceStatus} /> : null}

        {userMode !== "off" ? <VoiceInputModeHints userMode={userMode} /> : null}

        <VoiceInputAdvancedSettings settings={settings} userMode={userMode} onChange={onChange} />
      </div>
    </details>
  );
}

function CapsWriterBridgeEditor({ fields, onChange }: { fields: CapsWriterBridgeFields; onChange: (fields: Partial<CapsWriterBridgeFields>) => void }) {
  return (
    <div className="settings-voice-preset-fields">
      <div className="settings-field">
        <label htmlFor="settings-voice-capswriter-service-url">Wrapper 服务地址</label>
        <input id="settings-voice-capswriter-service-url" className="settings-text-input" value={fields.serviceUrl} placeholder={DEFAULT_CAPSWRITER_SERVICE_URL} onChange={(event) => onChange({ serviceUrl: event.target.value })} />
      </div>
      <div className="settings-field">
        <label htmlFor="settings-voice-capswriter-ws">CapsWriter WebSocket</label>
        <input id="settings-voice-capswriter-ws" className="settings-text-input" value={fields.capswriterWsUrl} placeholder={DEFAULT_CAPSWRITER_WS_URL} onChange={(event) => onChange({ capswriterWsUrl: event.target.value })} />
      </div>
      <div className="settings-field">
        <label htmlFor="settings-voice-capswriter-exe">CapsWriter server.exe</label>
        <input id="settings-voice-capswriter-exe" className="settings-text-input" value={fields.serverExe} placeholder="/mnt/d/CapsWriter-Offline/start_server.exe" onChange={(event) => onChange({ serverExe: event.target.value })} />
      </div>
      <div className="settings-field">
        <label htmlFor="settings-voice-capswriter-cwd">CapsWriter 工作目录</label>
        <input id="settings-voice-capswriter-cwd" className="settings-text-input" value={fields.serverCwd} placeholder="/mnt/d/CapsWriter-Offline" onChange={(event) => onChange({ serverCwd: event.target.value })} />
      </div>
      <div className="settings-field">
        <label htmlFor="settings-voice-capswriter-language">语言</label>
        <input id="settings-voice-capswriter-language" className="settings-text-input" value={fields.language} placeholder="chinese" onChange={(event) => onChange({ language: event.target.value })} />
      </div>
    </div>
  );
}

function VoiceStatusRow({ status, statusError, statusLoading, onRefresh }: { status?: VoiceInputStatus; statusError?: string; statusLoading: boolean; onRefresh: () => Promise<void> }) {
  return (
    <div className="settings-setting-row">
      <span className="settings-setting-copy">
        <span>Wrapper HTTP 服务</span>
        <small>{statusError ? `检测失败：${statusError}` : status ? voiceInputStatusSummary(status) : "尚未检测"}</small>
      </span>
      <button className="settings-secondary-button compact" type="button" disabled={statusLoading} onClick={() => void onRefresh()}>
        {statusLoading ? "检测中…" : "检测"}
      </button>
    </div>
  );
}

function VoiceInputModeHints({ userMode }: { userMode: VoiceInputUserMode }) {
  if (userMode === "capswriterNativeBridge") {
    return (
      <>
        <p className="settings-voice-hint">原生桥接不会调用浏览器麦克风；wrapper 必须支持 <code>/record/start</code> 和 <code>/record/stop</code>，并能访问本机麦克风。</p>
        <p className="settings-voice-hint">CapsWriter 模式下 ASR 模型由 CapsWriter Offline server 配置管理，Pi GUI 只负责启动/连接 wrapper 并接收识别文本。</p>
      </>
    );
  }
  if (userMode === "customAdvanced") {
    return <p className="settings-voice-hint">自定义模式保留原始配置；请确认 wrapper 支持当前录音来源需要的 HTTP 路由。</p>;
  }
  return <p className="settings-voice-hint">浏览器麦克风模式适合手机/远程使用；本机桌面追求稳定输入时建议使用 CapsWriter 原生桥接。</p>;
}

function VoiceInputAdvancedSettings({ settings, userMode, onChange }: { settings?: VoiceInputSettings; userMode: VoiceInputUserMode; onChange: (settings: Partial<VoiceInputSettings>) => void }) {
  const managedArgs = (settings?.managedArgs ?? []).join(" ");
  const rawMode = rawVoiceInputModeOrEnabledDefault(settings);
  const rawCaptureMode = rawVoiceInputCaptureModeOrDefault(settings);
  const [advancedOpen, setAdvancedOpen] = useState(userMode === "customAdvanced");
  const previousUserModeRef = useRef(userMode);

  useEffect(() => {
    if (previousUserModeRef.current === userMode) return;
    previousUserModeRef.current = userMode;
    setAdvancedOpen(userMode === "customAdvanced");
  }, [userMode]);

  return (
    <details className="settings-voice-advanced" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
      <summary>{userMode === "customAdvanced" ? "自定义配置" : "高级：原始 wrapper 配置"}</summary>
      <div className="settings-voice-advanced-body">
        <SettingsOptionGroup name="voice-input-raw-mode" label="服务管理方式" options={RAW_VOICE_INPUT_MODE_OPTIONS} value={rawMode} onChange={(mode) => onChange(voiceInputRawModeDefaults(mode, settings))} />
        {rawMode !== "disabled" ? (
          <SettingsOptionGroup name="voice-input-raw-capture-mode" label="录音来源" options={RAW_VOICE_INPUT_CAPTURE_MODE_OPTIONS} value={rawCaptureMode} onChange={(captureMode) => onChange({ captureMode })} />
        ) : null}
        {rawMode !== "disabled" ? (
          <div className="settings-field">
            <label htmlFor="settings-voice-url">服务地址</label>
            <input id="settings-voice-url" className="settings-text-input" value={settings?.externalUrl ?? ""} placeholder={rawCaptureMode === "native" ? DEFAULT_CAPSWRITER_SERVICE_URL : DEFAULT_VOICE_SERVICE_URL} onChange={(event) => onChange({ externalUrl: event.target.value })} />
          </div>
        ) : null}
        {rawMode === "managedProcess" ? (
          <>
            <div className="settings-field">
              <label htmlFor="settings-voice-cwd">Wrapper 目录</label>
              <input id="settings-voice-cwd" className="settings-text-input" value={settings?.managedCwd ?? ""} placeholder="示例：/home/me/CapsWriter-wrapper" onChange={(event) => onChange({ managedCwd: event.target.value })} />
            </div>
            <div className="settings-field">
              <label htmlFor="settings-voice-command">启动命令</label>
              <input id="settings-voice-command" className="settings-text-input" value={settings?.managedCommand ?? ""} placeholder={DEFAULT_MANAGED_VOICE_COMMAND} onChange={(event) => onChange({ managedCommand: event.target.value })} />
            </div>
            <div className="settings-field">
              <label htmlFor="settings-voice-args">命令参数</label>
              <input id="settings-voice-args" className="settings-text-input" value={managedArgs} placeholder={DEFAULT_MANAGED_VOICE_ARGS.join(" ")} onChange={(event) => onChange({ managedArgs: splitManagedArgs(event.target.value) })} />
            </div>
            <div className="settings-field">
              <label htmlFor="settings-voice-model-path">模型路径（自定义/FunASR 可选）</label>
              <input id="settings-voice-model-path" className="settings-text-input" value={settings?.modelPath ?? ""} placeholder="CapsWriter bridge 通常留空；模型在 CapsWriter server 中配置" onChange={(event) => onChange({ modelPath: event.target.value })} />
            </div>
            <div className="settings-setting-row">
              <span className="settings-setting-copy">
                <span>随 Pi GUI 自动启动</span>
                <small>启动用户已安装的本地 wrapper；若服务地址已可用则直接复用。</small>
              </span>
              <label className="settings-toggle-control">
                <input type="checkbox" aria-label="随 Pi GUI 自动启动语音识别服务" checked={settings?.autoStart ?? true} onChange={(event) => onChange({ autoStart: event.target.checked })} />
                <span className="settings-toggle-track" />
              </label>
            </div>
          </>
        ) : null}
        {rawMode === "externalService" ? (
          <p className="settings-voice-hint">外部服务需要支持 <code>GET /health</code>、<code>POST /transcribe</code>；原生录音还需要 <code>/record/start</code> 和 <code>/record/stop</code>。</p>
        ) : null}
      </div>
    </details>
  );
}

function voiceInputStatusKey(settings: VoiceInputSettings | undefined, userMode: VoiceInputUserMode): string {
  return [
    userMode,
    settings?.mode ?? "disabled",
    settings?.captureMode ?? "browser",
    settings?.externalUrl ?? "",
    settings?.managedCommand ?? "",
    settings?.managedCwd ?? "",
    (settings?.managedArgs ?? []).join("\u0000"),
  ].join("\u0001");
}

function voiceInputRawModeDefaults(mode: VoiceInputMode, current: VoiceInputSettings | undefined): Partial<VoiceInputSettings> {
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

function voiceInputHeaderStatus(userMode: VoiceInputUserMode, status: VoiceInputStatus | undefined, statusError: string | undefined, loading: boolean): { label: string; summary: string; tone: "ready" | "warning" | "error" } {
  if (loading) return { label: "Check", summary: "正在检测 wrapper HTTP 服务…", tone: "warning" };
  if (statusError) return { label: "Error", summary: `Wrapper HTTP 检测失败：${statusError}`, tone: "error" };
  if (status) {
    if (status.available) return { label: "Ready", summary: voiceInputStatusSummary(status), tone: "ready" };
    return { label: status.state === "disabled" ? "Off" : "Error", summary: voiceInputStatusSummary(status), tone: status.state === "disabled" ? "warning" : "error" };
  }
  if (userMode === "capswriterNativeBridge") return { label: "Desktop", summary: "推荐：CapsWriter 原生桥接", tone: "ready" };
  if (userMode === "browserMicrophone") return { label: "Browser", summary: "浏览器麦克风 fallback", tone: "ready" };
  if (userMode === "customAdvanced") return { label: "Custom", summary: "自定义 wrapper 配置", tone: "warning" };
  return { label: "Off", summary: "未启用", tone: "warning" };
}

function voiceInputSetupSummary(userMode: VoiceInputUserMode, settings: VoiceInputSettings | undefined): { title: string; detail: string } {
  if (userMode === "capswriterNativeBridge") return { title: "CapsWriter 原生桥接（桌面推荐）", detail: "Pi GUI 不录浏览器麦克风；本地 wrapper 录音并桥接到 CapsWriter Offline server" };
  if (userMode === "browserMicrophone") return { title: "浏览器麦克风 fallback", detail: "浏览器录音后发送到本地 wrapper 识别，适合手机或远程浏览器" };
  if (userMode === "customAdvanced") return { title: "自定义语音 wrapper", detail: `${settings?.mode ?? "externalService"} · ${settings?.captureMode ?? "browser"} · ${settings?.externalUrl ?? "未配置服务地址"}` };
  return { title: "语音输入已关闭", detail: "麦克风按钮将不可用" };
}

function voiceInputStatusSummary(status: VoiceInputStatus): string {
  const prefix = status.available ? "可用" : status.state === "disabled" ? "已关闭" : "不可用";
  return status.message ? `${prefix} · ${status.message}` : prefix;
}

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { RemoteAccessCandidateUrl, RemoteAccessPairingInfo, RemoteAccessSetupHint, RemoteAccessStatus } from "@pi-gui/shared";
import type { RemoteAccessState } from "../hooks/useRemoteAccess";
import { IconButton } from "./ui";

type RemoteAccessPanelProps = {
  state: RemoteAccessState;
};

export function RemoteAccessPanel({ state }: RemoteAccessPanelProps) {
  const { status, pairing, loading, updating, restarting, setupRunning, error, refresh, loadPairing, update, restartServer, configureWindowsPortProxy, forgetSavedToken } = state;
  const [qrDataUrl, setQrDataUrl] = useState<string | undefined>();
  const [localNotice, setLocalNotice] = useState<string | undefined>();
  const pairingUrl = pairing?.pairingUrl;

  useEffect(() => {
    let cancelled = false;
    setQrDataUrl(undefined);
    if (!pairingUrl) return;
    void QRCode.toDataURL(pairingUrl, { margin: 1, width: 176, errorCorrectionLevel: "M" }).then(
      (dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      },
      () => {
        if (!cancelled) setQrDataUrl(undefined);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pairingUrl]);

  const statusCopy = useMemo(() => remoteStatusCopy(status, loading), [status, loading]);
  const busy = loading || updating || restarting || setupRunning;

  async function copyText(text: string | undefined, label: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setLocalNotice(`${label}已复制`);
    } catch {
      setLocalNotice(`${label}复制失败`);
    }
  }

  async function requestServerRestart() {
    const response = await restartServer();
    if (!response) return;
    setLocalNotice("正在重启 Pi GUI 服务；连接可能短暂断开，请等待页面自动重连。");
  }

  async function requestWindowsPortProxy() {
    const message = await configureWindowsPortProxy();
    if (!message) return;
    setLocalNotice(message);
  }

  return (
    <details className="settings-remote-access-dropdown" open>
      <summary>
        <span className="settings-remote-access-summary-main">
          <span>Remote Access</span>
          <small>{statusCopy.detail}</small>
        </span>
        <span className={`settings-remote-access-pill ${statusCopy.tone}`}>{statusCopy.label}</span>
      </summary>

      <div className="settings-remote-access-body">
        {error ? <p className="settings-remote-access-error">{error}</p> : null}
        {localNotice ? <p className="settings-remote-access-notice">{localNotice}</p> : null}

        <div className="settings-remote-access-row">
          <span>
            <strong>局域网访问</strong>
            <small>{status?.enabled ? "已开启；需要重启时会提示。" : "默认关闭，开启后仅建议在可信局域网使用。"}</small>
          </span>
          <label className={`settings-toggle-control ${busy ? "disabled" : ""}`}>
            <input
              type="checkbox"
              aria-label="启用 Remote Access"
              checked={status?.enabled === true}
              disabled={busy}
              onChange={(event) => void update({ enabled: event.target.checked })}
            />
            <span className="settings-toggle-track" />
          </label>
        </div>

        {status?.restartRequired ? (
          <div className="settings-remote-access-warning settings-remote-access-restart-callout">
            <span>设置已保存，重启 Pi GUI 服务后生效。</span>
            <button className="settings-secondary-button compact" type="button" disabled={busy} onClick={() => void requestServerRestart()}>
              {restarting ? "重启中…" : "立即重启服务"}
            </button>
          </div>
        ) : null}

        <PrimaryRemoteAccessCard
          status={status}
          pairing={pairing}
          qrDataUrl={qrDataUrl}
          disabled={busy}
          setupRunning={setupRunning}
          onLoadPairing={() => void loadPairing()}
          onCopyPairingUrl={() => void copyText(pairing?.pairingUrl ?? primaryRemoteAccessUrl(status), pairing ? "手机入口" : "手机 URL")}
          onConfigureWindowsPortProxy={() => void requestWindowsPortProxy()}
          onForgetSavedToken={() => {
            forgetSavedToken();
            setLocalNotice("本机保存的 Remote Access token 已清除");
          }}
        />

        <p className="settings-remote-access-warning compact">仅在可信局域网使用；拿到二维码或 token 的设备可控制 Pi GUI。</p>

        <details className="settings-remote-access-advanced">
          <summary>高级排查</summary>
          <RemoteUrlList status={status} disabled={busy} onSelect={(host) => void update({ selectedHost: host })} onCopy={(url) => void copyText(url, "URL")} />
          <RemoteSetupHints
            hints={status?.setupHints ?? []}
            disabled={busy}
            setupDisabled={busy || status?.active !== true || status.restartRequired === true}
            setupRunning={setupRunning}
            onConfigureWindowsPortProxy={() => void requestWindowsPortProxy()}
            onCopy={(text, label) => void copyText(text, label)}
          />
          <div className="settings-remote-access-actions compact">
            <button className="settings-secondary-button compact" type="button" disabled={busy} onClick={() => void update({ rotateToken: true })}>轮换 token</button>
            <button className="settings-secondary-button compact danger" type="button" disabled={busy} onClick={() => void update({ clearToken: true })}>清除 token</button>
          </div>
        </details>

        <div className="settings-remote-access-actions">
          <button className="settings-secondary-button" type="button" disabled={busy} onClick={() => void refresh()}>
            {loading ? "刷新中…" : "刷新状态"}
          </button>
        </div>
      </div>
    </details>
  );
}

function PrimaryRemoteAccessCard({
  status,
  pairing,
  qrDataUrl,
  disabled,
  setupRunning,
  onLoadPairing,
  onCopyPairingUrl,
  onConfigureWindowsPortProxy,
  onForgetSavedToken,
}: {
  status?: RemoteAccessStatus;
  pairing?: RemoteAccessPairingInfo;
  qrDataUrl?: string;
  disabled: boolean;
  setupRunning: boolean;
  onLoadPairing: () => void;
  onCopyPairingUrl: () => void;
  onConfigureWindowsPortProxy: () => void;
  onForgetSavedToken: () => void;
}) {
  const phoneUrl = primaryRemoteAccessUrl(status);
  const needsWindowsForwarding = status?.setupHints?.some((hint) => hint.code === "wsl_portproxy_required") === true;
  const setupDisabled = disabled || status?.active !== true || status.restartRequired === true;
  return (
    <div className="settings-remote-access-primary-card">
      <div className="settings-remote-access-primary-copy">
        <span>手机访问入口</span>
        <strong>{phoneUrl ?? "等待检测局域网地址…"}</strong>
        <small>{primaryRemoteAccessHint(status, pairing)}</small>
      </div>
      <div className="settings-remote-access-primary-actions">
        {needsWindowsForwarding ? (
          <button className="settings-secondary-button" type="button" disabled={setupDisabled} onClick={onConfigureWindowsPortProxy}>
            {setupRunning ? "正在请求管理员权限…" : "一键配置手机访问"}
          </button>
        ) : null}
        <button className="settings-secondary-button" type="button" disabled={disabled || !phoneUrl} onClick={onLoadPairing}>
          {pairing ? "刷新二维码" : "显示二维码"}
        </button>
        <button className="settings-secondary-button" type="button" disabled={!phoneUrl} onClick={onCopyPairingUrl}>{pairing ? "复制入口" : "复制 URL"}</button>
      </div>
      {pairing && phoneUrl ? <PairingCard pairing={pairing} qrDataUrl={qrDataUrl} onForgetSavedToken={onForgetSavedToken} /> : null}
    </div>
  );
}

function primaryRemoteAccessUrl(status: RemoteAccessStatus | undefined): string | undefined {
  return primaryRemoteAccessCandidate(status)?.url;
}

function primaryRemoteAccessCandidate(status: RemoteAccessStatus | undefined): RemoteAccessCandidateUrl | undefined {
  if (!status) return undefined;
  const recommended = status.candidateUrls.find((candidate) => candidate.recommended) ?? status.candidateUrls[0];
  if (status.networkEnvironment === "wsl") {
    if (recommended?.source === "windows-host") return recommended;
    return status.candidateUrls.find((candidate) => candidate.source === "windows-host");
  }
  return status.candidateUrls.find((candidate) => candidate.url === status.selectedUrl) ?? recommended;
}

function primaryRemoteAccessHint(status: RemoteAccessStatus | undefined, pairing: RemoteAccessPairingInfo | undefined): string {
  if (!status) return "打开后会生成带 token 的手机配对入口。";
  if (status.networkEnvironment === "wsl") {
    const candidate = primaryRemoteAccessCandidate(status);
    return candidate?.source === "windows-host"
      ? "已使用 Windows 主机 IP；打不开时点一键配置。"
      : "未自动检测到 Windows 主机 IP；请点一键配置后使用电脑的局域网 IP。";
  }
  if (pairing) return "扫码或复制入口到手机浏览器。";
  if (status.enabled) return "点击显示二维码，生成带 token 的手机入口。";
  return "开启后可生成手机二维码。";
}

function RemoteUrlList({ status, disabled, onSelect, onCopy }: { status?: RemoteAccessStatus; disabled: boolean; onSelect: (host: string) => void; onCopy: (url: string) => void }) {
  const candidates = status?.candidateUrls ?? [];
  if (candidates.length === 0) {
    return <p className="settings-remote-access-empty">未检测到私有 IPv4 LAN 地址。请检查 Wi‑Fi/以太网连接，或查看终端日志。</p>;
  }
  return (
    <div className="settings-remote-access-url-list" aria-label="LAN URL 候选">
      {candidates.map((candidate) => (
        <RemoteUrlRow
          key={`${candidate.interfaceName ?? "lan"}-${candidate.host}`}
          candidate={candidate}
          selected={candidate.url === status?.selectedUrl || (!status?.selectedUrl && candidate.recommended === true)}
          disabled={disabled}
          onSelect={onSelect}
          onCopy={onCopy}
        />
      ))}
    </div>
  );
}

function RemoteUrlRow({ candidate, selected, disabled, onSelect, onCopy }: { candidate: RemoteAccessCandidateUrl; selected: boolean; disabled: boolean; onSelect: (host: string) => void; onCopy: (url: string) => void }) {
  return (
    <div className={`settings-remote-access-url-row ${selected ? "selected" : ""}`}>
      <span>
        <strong>{candidate.url}</strong>
        <small>{candidateMeta(candidate)}</small>
      </span>
      <button className="settings-secondary-button compact" type="button" disabled={disabled || selected} onClick={() => onSelect(candidate.host)}>
        {selected ? "当前" : "用于二维码"}
      </button>
      <IconButton className="settings-action-button" icon="copy" label="复制 URL" onClick={() => onCopy(candidate.url)} />
    </div>
  );
}

function candidateMeta(candidate: RemoteAccessCandidateUrl): string {
  const parts = [candidate.interfaceName ?? candidate.host];
  if (candidate.source === "windows-host") parts.push("Windows 主机地址");
  if (candidate.requiresPortProxy) parts.push("可能需要端口转发");
  if (candidate.recommended) parts.push("推荐");
  return parts.join(" · ");
}

function RemoteSetupHints({
  hints,
  disabled,
  setupDisabled,
  setupRunning,
  onConfigureWindowsPortProxy,
  onCopy,
}: {
  hints: RemoteAccessSetupHint[];
  disabled: boolean;
  setupDisabled: boolean;
  setupRunning: boolean;
  onConfigureWindowsPortProxy: () => void;
  onCopy: (text: string, label: string) => void;
}) {
  if (hints.length === 0) return <p className="settings-remote-access-empty">暂无额外排查信息。</p>;
  return (
    <div className="settings-remote-access-hints" aria-label="Remote Access setup diagnostics">
      {hints.map((hint) => (
        <div className={`settings-remote-access-hint ${hint.severity}`} key={hint.code}>
          <strong>{hint.message}</strong>
          {hint.detail ? <small>{hint.detail}</small> : null}
          {hint.remediation ? <small>{hint.remediation}</small> : null}
          {hint.code === "wsl_portproxy_required" ? (
            <div className="settings-remote-access-hint-commands">
              <button className="settings-secondary-button compact" type="button" disabled={setupDisabled} onClick={onConfigureWindowsPortProxy}>
                {setupRunning ? "正在请求管理员权限…" : "自动配置 Windows 转发"}
              </button>
            </div>
          ) : null}
          {hint.commands?.length ? (
            <div className="settings-remote-access-hint-commands">
              {hint.commands.map((command) => (
                <button className="settings-secondary-button compact" type="button" key={`${hint.code}-${command.label}`} onClick={() => onCopy(command.command, command.label)}>
                  复制{command.requiresAdmin ? "管理员" : ""}{command.platform === "windows-powershell" ? " PowerShell" : ""}命令
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PairingCard({ pairing, qrDataUrl, onForgetSavedToken }: { pairing: RemoteAccessPairingInfo; qrDataUrl?: string; onForgetSavedToken: () => void }) {
  return (
    <div className="settings-remote-access-pairing">
      <div className="settings-remote-access-qr" aria-label="Remote Access QR code">
        {qrDataUrl ? <img src={qrDataUrl} alt="Remote Access pairing QR" /> : <span>QR 生成中…</span>}
      </div>
      <div className="settings-remote-access-pairing-copy">
        <strong>{primaryRemoteAccessUrl(pairing.status) ?? "LAN URL"}</strong>
        <small>Token：{maskToken(pairing.token)}</small>
        <button className="settings-secondary-button" type="button" onClick={onForgetSavedToken}>清除此设备保存</button>
        {pairing.warnings.slice(0, 1).map((warning) => <small className="settings-remote-access-warning-line" key={warning}>{warning}</small>)}
      </div>
    </div>
  );
}

function remoteStatusCopy(status: RemoteAccessStatus | undefined, loading: boolean): { label: string; detail: string; tone: "off" | "warn" | "on" } {
  if (loading && !status) return { label: "Load", detail: "正在读取远程访问状态…", tone: "warn" };
  if (!status) return { label: "Off", detail: "尚未读取状态", tone: "off" };
  if (status.restartRequired) return { label: "Restart", detail: "设置已保存，重启后生效", tone: "warn" };
  if (status.active) return { label: "LAN", detail: primaryRemoteAccessUrl(status) ?? "已在局域网监听", tone: "on" };
  if (status.enabled) return { label: "Saved", detail: "已启用，等待重启或 LAN 地址", tone: "warn" };
  return { label: "Off", detail: "局域网远程访问关闭", tone: "off" };
}

function maskToken(token: string): string {
  return token.length <= 8 ? "••••" : `${token.slice(0, 4)}…${token.slice(-4)}`;
}

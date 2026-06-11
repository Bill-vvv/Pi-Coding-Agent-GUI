import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_RUNTIME_PROFILE_ID, type AppSettings, type Project, type RemoteAccessStatus, type RuntimeProfileId } from "@pi-gui/shared";
import { DEFAULT_GUI_SCOPED_MODELS } from "./domain/scopedModels";
import { SettingsPanel } from "./components/SettingsPanel";
import type { UiPreferences } from "./types";
import "./styles.css";
import "./styles/settings-preview.css";

installSettingsPreviewApiMocks();

const DEFAULT_PREVIEW_PREFERENCES: UiPreferences = {
  uiFontSize: "medium",
  chatFontSize: "medium",
  theme: "dark",
  accentColor: "amber",
  thinkingToolDisplayMode: "compact",
  desktopNotificationsEnabled: false,
  desktopPetEnabled: false,
  guiScopedModels: DEFAULT_GUI_SCOPED_MODELS,
  keybindings: {},
};

const DEFAULT_PREVIEW_SETTINGS: AppSettings = {
  defaultModel: "gpt-5-codex",
  defaultThinkingLevel: "medium",
  responseMode: "normal",
  defaultRuntimeProfileId: DEFAULT_RUNTIME_PROFILE_ID,
  customRuntimeCapabilityIds: ["pi-ready-notifications", "trellis-subagent"],
  confirmedProjectExtensionIds: ["trellis-workflow"],
};

const PREVIEW_PROJECT: Project = {
  id: "preview-project",
  name: "pi-gui",
  cwd: "/home/vvv/projects/pi-gui",
  lastOpenedAt: Date.now(),
  defaultRuntimeProfileId: "custom",
  host: { kind: "wsl", id: "preview-wsl", label: "WSL" },
};

type PreviewWidth = "wide" | "standard" | "narrow";

function SettingsPreviewApp() {
  const [preferences, setPreferences] = useState<UiPreferences>(DEFAULT_PREVIEW_PREFERENCES);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_PREVIEW_SETTINGS);
  const [project, setProject] = useState<Project>(PREVIEW_PROJECT);
  const [width, setWidth] = useState<PreviewWidth>("standard");

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.uiFontSize = preferences.uiFontSize;
    root.dataset.chatFontSize = preferences.chatFontSize;
    root.dataset.theme = preferences.theme;
    root.dataset.accentColor = preferences.accentColor;
  }, [preferences]);

  function updateSettings(next: Partial<AppSettings>) {
    setSettings((current) => ({ ...current, ...next }));
    return true;
  }

  function updateProjectRuntimeProfile(projectId: string, defaultRuntimeProfileId: RuntimeProfileId | null) {
    if (projectId !== project.id) return false;
    setProject((current) => ({
      ...current,
      defaultRuntimeProfileId: defaultRuntimeProfileId ?? undefined,
    }));
    return true;
  }

  return (
    <main className="settings-preview-shell">
      <header className="settings-preview-toolbar" aria-label="Settings preview tools">
        <div className="settings-preview-title">
          <span>Settings Preview</span>
          <small>Vite HMR · mock backend · production component</small>
        </div>
        <div className="settings-preview-controls" role="group" aria-label="Preview width">
          {(["wide", "standard", "narrow"] as const).map((option) => (
            <button className={width === option ? "selected" : ""} type="button" key={option} onClick={() => setWidth(option)}>
              {previewWidthLabel(option)}
            </button>
          ))}
        </div>
      </header>

      <section className="settings-preview-stage" aria-label="Settings panel preview">
        <div className={`settings-preview-frame ${width}`}>
          <SettingsPanel
            open={true}
            preferences={preferences}
            settings={settings}
            connection="open"
            selectedProject={project}
            activeRuntime={undefined}
            checkpoints={[]}
            checkpointOperations={[]}
            checkpointJumps={[]}
            onRefreshCheckpoints={() => undefined}
            onRefreshCheckpointHealth={() => undefined}
            onRefreshCheckpointJumps={() => undefined}
            onCaptureCheckpoint={() => undefined}
            onOpenCheckpointPreview={() => undefined}
            onCloseCheckpointPreview={() => undefined}
            onRestoreCheckpoint={() => undefined}
            onRunCheckpointGc={() => undefined}
            onClose={() => undefined}
            onChangePreferences={setPreferences}
            onChangeSettings={updateSettings}
            onChangeProjectRuntimeProfile={updateProjectRuntimeProfile}
            onOpenUsageOverview={() => undefined}
            desktopPetAvailable={true}
          />
        </div>
      </section>
    </main>
  );
}

function previewWidthLabel(width: PreviewWidth): string {
  switch (width) {
    case "wide": return "宽";
    case "narrow": return "窄";
    case "standard": return "标准";
  }
}

function installSettingsPreviewApiMocks() {
  const originalFetch = window.fetch.bind(window);
  let remoteAccessStatus = createRemoteAccessStatus();

  window.fetch = async (input, init) => {
    const path = requestPath(input);
    if (path === "/api/environment") {
      return jsonResponse({
        environment: {
          checkedAt: Date.now(),
          platform: "linux",
          arch: "x64",
          nodeVersion: "v22.0.0",
          npmVersion: "10.8.0",
          cwd: "/home/vvv/projects/pi-gui",
          home: "/home/vvv",
          backend: { host: "127.0.0.1", port: 8787, mode: "preview" },
          wsl: { isWsl: true, distroName: "Ubuntu", kernelRelease: "preview", interop: true },
          pi: { installed: true, path: "/usr/bin/pi", version: "preview", rpcSmoke: { ok: true, command: "pi --mode rpc", durationMs: 42 } },
          readiness: { status: "ready", issues: [] },
        },
      });
    }

    if (path === "/api/remote-access/status") {
      return jsonResponse(remoteAccessStatus);
    }

    if (path === "/api/remote-access/pairing") {
      const token = "preview-token-123456";
      return jsonResponse({
        status: remoteAccessStatus,
        token,
        pairingUrl: `${remoteAccessStatus.recommendedUrl ?? "http://192.168.1.24:8787"}?token=${token}`,
        warnings: ["预览页使用 mock token，不会改写真实设置。"],
      });
    }

    if (path === "/api/remote-access") {
      const body = await parseJsonBody(init?.body);
      remoteAccessStatus = {
        ...remoteAccessStatus,
        enabled: typeof body.enabled === "boolean" ? body.enabled : remoteAccessStatus.enabled,
        active: typeof body.enabled === "boolean" ? body.enabled : remoteAccessStatus.active,
        selectedHost: typeof body.selectedHost === "string" ? body.selectedHost : remoteAccessStatus.selectedHost,
        selectedUrl: typeof body.selectedHost === "string" ? `http://${body.selectedHost}:8787` : remoteAccessStatus.selectedUrl,
        tokenConfigured: body.clearToken === true ? false : true,
        tokenPreview: body.clearToken === true ? undefined : "prev…3456",
      };
      return jsonResponse({ status: remoteAccessStatus });
    }

    if (path === "/api/remote-access/restart") {
      remoteAccessStatus = { ...remoteAccessStatus, restartRequired: false, active: remoteAccessStatus.enabled };
      return jsonResponse({ accepted: true, reconnectDelayMs: 1200, message: "Preview restart accepted", status: remoteAccessStatus });
    }

    if (path === "/api/remote-access/windows-portproxy") {
      return jsonResponse({
        accepted: true,
        status: remoteAccessStatus,
        targetHost: "127.0.0.1",
        listenPort: 8787,
        requiresAdmin: true,
        message: "预览：已模拟 Windows portproxy 配置请求。",
      });
    }

    return originalFetch(input, init);
  };
}

function requestPath(input: RequestInfo | URL): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw, window.location.origin).pathname;
  } catch {
    return raw;
  }
}

async function parseJsonBody(body: BodyInit | null | undefined): Promise<Record<string, unknown>> {
  if (typeof body !== "string") return {};
  try {
    const value = JSON.parse(body) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createRemoteAccessStatus(): RemoteAccessStatus {
  return {
    enabled: true,
    active: true,
    restartRequired: false,
    mode: "remote-lan",
    bindHost: "0.0.0.0",
    port: 8787,
    selectedHost: "192.168.1.24",
    selectedUrl: "http://192.168.1.24:8787",
    recommendedUrl: "http://192.168.1.24:8787",
    tokenConfigured: true,
    tokenPreview: "prev…3456",
    tokenSource: "persisted",
    networkEnvironment: "wsl",
    candidateUrls: [
      { host: "192.168.1.24", url: "http://192.168.1.24:8787", interfaceName: "Windows Wi‑Fi", recommended: true, source: "windows-host" },
      { host: "172.27.64.1", url: "http://172.27.64.1:8787", interfaceName: "WSL", source: "server-interface", requiresPortProxy: true },
    ],
    setupHints: [
      {
        code: "wsl_portproxy_required",
        severity: "info",
        message: "WSL 访问可能需要 Windows 转发",
        detail: "预览页展示高级排查区域的常见状态。",
      },
    ],
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsPreviewApp />
  </StrictMode>,
);

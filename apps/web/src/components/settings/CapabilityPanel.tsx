import { useEffect, useMemo, useState } from "react";
import type { AppSettings, DiscoveredPiExtensionDescriptor, Project } from "@pi-gui/shared";
import { capabilityCounts, PI_GUI_CAPABILITIES } from "@pi-gui/shared";
import { apiUrl } from "../../domain/apiUrl";
import { capabilityDisplayModels, confirmProjectExtension, type CapabilityDisplayModel, projectExtensionConfirmationMessage, projectExtensionDisplayModels, type ProjectExtensionDisplayModel, userExtensionPlaceholderModel } from "../../domain/capabilities";
import { authHeaders } from "../../domain/runtimeConfig";
import type { UiPreferences } from "../../types";

type CapabilityPanelProps = {
  preferences: UiPreferences;
  settings: AppSettings;
  selectedProject?: Project;
  onChangePreferences: (preferences: UiPreferences) => void;
  onChangeSettings: (settings: Partial<AppSettings>) => boolean;
  focusCapabilityId?: string;
  desktopPetAvailable?: boolean;
};

export function CapabilityPanel({ preferences, settings, selectedProject, onChangePreferences, onChangeSettings, focusCapabilityId, desktopPetAvailable }: CapabilityPanelProps) {
  const builtin = capabilityDisplayModels(PI_GUI_CAPABILITIES.filter((capability) => capability.origin === "builtin"));
  const counts = capabilityCounts();
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(Boolean(focusCapabilityId));
  const projectExtensions = useProjectExtensions(selectedProject?.id, capabilitiesOpen);
  const projectExtensionModels = useMemo(() => projectExtensionDisplayModels(projectExtensions.extensions, settings), [projectExtensions.extensions, settings]);

  useEffect(() => {
    if (focusCapabilityId) setCapabilitiesOpen(true);
  }, [focusCapabilityId]);

  function updatePetEnabled(enabled: boolean) {
    onChangePreferences({ ...preferences, petEnabled: enabled, petCollapsed: false, desktopPetEnabled: enabled ? preferences.desktopPetEnabled : false });
  }

  function updateDesktopPetEnabled(enabled: boolean) {
    onChangePreferences({ ...preferences, petEnabled: true, petCollapsed: false, desktopPetEnabled: enabled });
  }

  function confirmExtension(extension: ProjectExtensionDisplayModel) {
    if (!window.confirm(projectExtensionConfirmationMessage(extension))) return;
    onChangeSettings({ confirmedProjectExtensionIds: confirmProjectExtension(settings, extension.id).confirmedProjectExtensionIds });
  }

  return (
    <details className="settings-shim-dropdown" open={capabilitiesOpen} onToggle={(event) => setCapabilitiesOpen(event.currentTarget.open)}>
      <summary>
        <span className="settings-diagnostics-summary-main">
          <span>Capabilities</span>
          <small>{counts.total} 个能力 · {counts.changesAgentBehavior} 个改 Agent 行为 · {counts.explicitSetup} 个需要显式设置</small>
        </span>
        <span className="settings-diagnostics-pill ready">L3</span>
      </summary>

      <div className="settings-shim-body">
        <div className="settings-capability-group-heading">
          <span>Built-in capabilities</span>
          <small>Pi GUI 维护的能力，不等同于 Pi Agent 核心。</small>
        </div>
        <div className="settings-shim-list">
          {builtin.map((capability) => (
            <CapabilityRow capability={capability} key={capability.id} petEnabled={preferences.petEnabled} desktopPetEnabled={preferences.desktopPetEnabled} desktopPetAvailable={desktopPetAvailable} focused={capability.id === focusCapabilityId} onPetEnabledChange={updatePetEnabled} onDesktopPetEnabledChange={updateDesktopPetEnabled} />
          ))}
        </div>

        <div className="settings-capability-group-heading">
          <span>User extensions</span>
          <small>现阶段以 profile 隔离、项目扩展发现和低信任提示为主。</small>
        </div>
        <div className="settings-shim-list">
          <CapabilityRow capability={userExtensionPlaceholderModel()} focused={false} />
        </div>

        <ProjectExtensionsList
          projectName={selectedProject?.name}
          loading={projectExtensions.loading}
          error={projectExtensions.error}
          extensions={projectExtensionModels}
          onConfirmExtension={confirmExtension}
        />

        <p className="settings-shim-note">Vanilla Pi profile 不注入 GUI runtime 增强，也不会继承用户扩展；隔离 profile 只会显式注入已确认且匹配 capability 的项目扩展。</p>
      </div>
    </details>
  );
}

function ProjectExtensionsList({
  projectName,
  loading,
  error,
  extensions,
  onConfirmExtension,
}: {
  projectName?: string;
  loading: boolean;
  error?: string;
  extensions: ProjectExtensionDisplayModel[];
  onConfirmExtension: (extension: ProjectExtensionDisplayModel) => void;
}) {
  return (
    <>
      <div className="settings-capability-group-heading">
        <span>Project extensions</span>
        <small>{projectName ? `${projectName} · .pi/extensions` : "选择项目后显示"}</small>
      </div>
      <div className="settings-shim-list">
        {loading ? <div className="settings-shim-row"><span className="settings-shim-main"><span>扫描项目扩展…</span></span></div> : null}
        {error ? <div className="settings-shim-row"><span className="settings-shim-main"><span>项目扩展扫描失败</span><small>{error}</small></span></div> : null}
        {!loading && !error && extensions.length === 0 ? <div className="settings-shim-row"><span className="settings-shim-main"><span>未发现项目扩展</span><small>当前项目没有可管理的 .pi/extensions 或 .pi/settings.json extension 条目。</small></span></div> : null}
        {extensions.map((extension) => <ProjectExtensionRow extension={extension} key={extension.id} onConfirm={() => onConfirmExtension(extension)} />)}
      </div>
    </>
  );
}

function ProjectExtensionRow({ extension, onConfirm }: { extension: ProjectExtensionDisplayModel; onConfirm: () => void }) {
  return (
    <div className="settings-shim-row settings-capability-row">
      <span className="settings-shim-main">
        <span>{extension.label}</span>
        <small>{extension.relativePath}</small>
        <small className="settings-capability-surfaces">{extension.summary}</small>
      </span>
      <span className="settings-shim-tags settings-capability-tags">
        <span>{extension.integrationLevelLabel}</span>
        <span>{extension.sourceLabel}</span>
        {extension.capabilityLabels.map((label) => <span key={`capability-${label}`}>{label}</span>)}
        {extension.warningLabels.map((warning) => <span className="warning" key={`warning-${warning}`}>{warning}</span>)}
        {extension.confirmed ? <span>已确认</span> : <span className="warning">未确认</span>}
        {!extension.confirmed && extension.injectable ? (
          <button className="settings-inline-action" type="button" onClick={onConfirm}>确认启用</button>
        ) : null}
      </span>
    </div>
  );
}

function CapabilityRow({
  capability,
  petEnabled,
  desktopPetEnabled,
  desktopPetAvailable,
  focused,
  onPetEnabledChange,
  onDesktopPetEnabledChange,
}: {
  capability: CapabilityDisplayModel;
  petEnabled?: boolean;
  desktopPetEnabled?: boolean;
  desktopPetAvailable?: boolean;
  focused: boolean;
  onPetEnabledChange?: (enabled: boolean) => void;
  onDesktopPetEnabledChange?: (enabled: boolean) => void;
}) {
  const isPet = capability.id === "pi-pet-companion";
  return (
    <div className={`settings-shim-row settings-capability-row ${focused ? "focused" : ""}`} aria-current={focused ? "true" : undefined} id={`capability-${capability.id}`}>
      <span className="settings-shim-main">
        <span>{capability.label}</span>
        <small>{capability.summary}</small>
        {capability.surfaceLabels.length > 0 ? <small className="settings-capability-surfaces">{capability.surfaceLabels.join(" · ")}</small> : null}
      </span>
      <span className="settings-shim-tags settings-capability-tags">
        <span>{capability.integrationLevelLabel}</span>
        <span>{capability.originLabel}</span>
        <span>{capability.implementationHostLabel}</span>
        <span>{capability.releaseStanceLabel}</span>
        <span>{capability.compatibilityLabel}</span>
        {capability.profileLabels.map((profile) => <span key={`profile-${profile}`}>{profile}</span>)}
        {capability.riskLabels.map((risk) => <span className={risk === "UI-only" ? undefined : "warning"} key={`risk-${risk}`}>{risk}</span>)}
        {capability.behaviorLabels.map((label) => <span className="warning" key={`behavior-${label}`}>{label}</span>)}
        {capability.docsLabel ? <span>{capability.docsLabel}</span> : null}
        {isPet && onPetEnabledChange ? (
          <label className="settings-toggle-control settings-capability-toggle" title="GUI 内 PET">
            <input type="checkbox" aria-label="Pi PET capability" checked={Boolean(petEnabled)} onChange={(event) => onPetEnabledChange(event.target.checked)} />
            <span className="settings-toggle-track" />
          </label>
        ) : null}
        {isPet && desktopPetAvailable && onDesktopPetEnabledChange ? (
          <label className="settings-toggle-control settings-capability-toggle" title="系统级桌宠">
            <input type="checkbox" aria-label="Pi PET desktop companion" checked={Boolean(desktopPetEnabled)} onChange={(event) => onDesktopPetEnabledChange(event.target.checked)} />
            <span className="settings-toggle-track" />
          </label>
        ) : null}
      </span>
    </div>
  );
}

function useProjectExtensions(projectId: string | undefined, enabled: boolean): { extensions: DiscoveredPiExtensionDescriptor[]; loading: boolean; error?: string } {
  const [state, setState] = useState<{ extensions: DiscoveredPiExtensionDescriptor[]; loading: boolean; error?: string }>({ extensions: [], loading: false });

  useEffect(() => {
    if (!enabled || !projectId) {
      setState({ extensions: [], loading: false });
      return undefined;
    }

    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: undefined }));
    void fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}/extensions`), { headers: authHeaders(), signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setState({ extensions: extensionsFromPayload(payload), loading: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ extensions: [], loading: false, error: error instanceof Error ? error.message : String(error) });
      });

    return () => controller.abort();
  }, [enabled, projectId]);

  return state;
}

function extensionsFromPayload(payload: unknown): DiscoveredPiExtensionDescriptor[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { extensions?: unknown }).extensions)) return [];
  return (payload as { extensions: unknown[] }).extensions.filter(isDiscoveredExtension);
}

function isDiscoveredExtension(value: unknown): value is DiscoveredPiExtensionDescriptor {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DiscoveredPiExtensionDescriptor>;
  return typeof record.id === "string"
    && record.scope === "project"
    && (record.source === "project-convention" || record.source === "project-settings")
    && typeof record.path === "string"
    && typeof record.relativePath === "string"
    && typeof record.integrationLevel === "number"
    && Array.isArray(record.capabilityIds)
    && record.capabilityIds.every((item) => typeof item === "string")
    && Array.isArray(record.warnings)
    && record.warnings.every((item) => typeof item === "string");
}

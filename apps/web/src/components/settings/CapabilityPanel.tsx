import { useEffect, useMemo, useState } from "react";
import type { AppSettings, DiscoveredPiExtensionDescriptor, Project } from "@pi-gui/shared";
import { DEFAULT_RUNTIME_PROFILE_ID, PI_GUI_CAPABILITIES, runtimeProfileById } from "@pi-gui/shared";
import { apiUrl } from "../../domain/apiUrl";
import { capabilityDisplayModels, confirmProjectExtension, type CapabilityDisplayModel, projectExtensionConfirmationMessage, projectExtensionDisplayModels, type ProjectExtensionDisplayModel } from "../../domain/capabilities";
import { authHeaders } from "../../domain/runtimeConfig";

type CapabilityPanelProps = {
  settings: AppSettings;
  selectedProject?: Project;
  onChangeSettings: (settings: Partial<AppSettings>) => boolean;
  focusCapabilityId?: string;
};

const CUSTOM_RUNTIME_CAPABILITY_IDS = new Set([
  "pi-ready-notifications",
  "trellis-subagent",
  "provider-models",
  "codex-transport-monitor",
]);

export function CapabilityPanel({ settings, selectedProject, onChangeSettings, focusCapabilityId }: CapabilityPanelProps) {
  const configurableCapabilities = useMemo(
    () => capabilityDisplayModels(PI_GUI_CAPABILITIES.filter((capability) => capability.origin === "builtin" && CUSTOM_RUNTIME_CAPABILITY_IDS.has(capability.id))),
    [],
  );
  const effectiveProfileId = selectedProject?.defaultRuntimeProfileId ?? settings.defaultRuntimeProfileId ?? DEFAULT_RUNTIME_PROFILE_ID;
  const effectiveProfile = runtimeProfileById(effectiveProfileId);
  const customCapabilityIds = settings.customRuntimeCapabilityIds ?? [];
  const customCapabilitySet = new Set(customCapabilityIds);
  const enabledCapabilityIds = new Set(effectiveProfileId === "custom" ? customCapabilityIds : effectiveProfile.defaultCapabilityIds);
  const editable = effectiveProfileId === "custom";
  const projectExtensions = useProjectExtensions(selectedProject?.id, true);
  const projectExtensionModels = useMemo(() => projectExtensionDisplayModels(projectExtensions.extensions, settings), [projectExtensions.extensions, settings]);

  function setCustomCapability(capabilityId: string, enabled: boolean) {
    const next = new Set(customCapabilityIds);
    if (enabled) next.add(capabilityId);
    else next.delete(capabilityId);
    onChangeSettings({ customRuntimeCapabilityIds: [...next].sort() });
  }

  function confirmExtension(extension: ProjectExtensionDisplayModel) {
    if (!window.confirm(projectExtensionConfirmationMessage(extension))) return;
    onChangeSettings({ confirmedProjectExtensionIds: confirmProjectExtension(settings, extension.id).confirmedProjectExtensionIds });
  }

  return (
    <div className="settings-custom-pi-panel">
      <div className="settings-capability-group-heading settings-capability-group-heading-block">
        <span>自定义 Pi 拓展</span>
      </div>

      <section className="settings-custom-section" aria-label="GUI 拓展">
        <div className="settings-custom-section-heading">
          <span>GUI 拓展</span>
        </div>
        <div className="settings-capability-card-grid">
          {configurableCapabilities.map((capability) => (
            <CustomCapabilityCard
              capability={capability}
              checked={customCapabilitySet.has(capability.id)}
              active={enabledCapabilityIds.has(capability.id)}
              editable={editable}
              focused={capability.id === focusCapabilityId}
              key={capability.id}
              onChange={(enabled) => setCustomCapability(capability.id, enabled)}
            />
          ))}
        </div>
      </section>

      <ProjectExtensionsList
        loading={projectExtensions.loading}
        error={projectExtensions.error}
        extensions={projectExtensionModels}
        onConfirmExtension={confirmExtension}
      />
    </div>
  );
}

function CustomCapabilityCard({ capability, checked, active, editable, focused, onChange }: { capability: CapabilityDisplayModel; checked: boolean; active: boolean; editable: boolean; focused: boolean; onChange: (enabled: boolean) => void }) {
  const tags = capabilityTags(capability, active);
  return (
    <article className={`settings-capability-card ${focused ? "focused" : ""} ${!editable ? "readonly" : ""}`} id={`capability-${capability.id}`} aria-current={focused ? "true" : undefined}>
      <header className="settings-capability-card-header">
        <span>{capability.label}</span>
        <label className={`settings-toggle-control settings-capability-toggle ${editable ? "" : "disabled"}`} title={editable ? "启用 GUI 拓展" : "选择自定义 Pi 后可编辑"}>
          <input type="checkbox" aria-label={`${capability.label} capability`} checked={checked} disabled={!editable} onChange={(event) => onChange(event.target.checked)} />
          <span className="settings-toggle-track" />
        </label>
      </header>
      <p>{capability.summary}</p>
      {capability.surfaceLabels.length > 0 ? <small className="settings-capability-surfaces">{capability.surfaceLabels.join(" · ")}</small> : null}
      {tags.length > 0 ? (
        <span className="settings-capability-card-tags">
          {tags.map((tag) => <span className={tag.tone === "warning" ? "warning" : undefined} key={tag.label}>{tag.label}</span>)}
        </span>
      ) : null}
    </article>
  );
}

function capabilityTags(capability: CapabilityDisplayModel, active: boolean): Array<{ label: string; tone?: "warning" }> {
  const tags: Array<{ label: string; tone?: "warning" }> = [];
  if (active) tags.push({ label: "当前启用" });
  for (const label of capability.behaviorLabels.slice(0, 2)) tags.push({ label, tone: "warning" });
  for (const label of capability.riskLabels.filter((risk) => risk !== "UI-only").slice(0, 2)) tags.push({ label, tone: "warning" });
  if (capability.compatibilityLabel !== "Local only") tags.push({ label: capability.compatibilityLabel });
  return tags;
}

function ProjectExtensionsList({
  loading,
  error,
  extensions,
  onConfirmExtension,
}: {
  loading: boolean;
  error?: string;
  extensions: ProjectExtensionDisplayModel[];
  onConfirmExtension: (extension: ProjectExtensionDisplayModel) => void;
}) {
  return (
    <section className="settings-custom-section" aria-label="项目拓展">
      <div className="settings-custom-section-heading">
        <span>项目拓展</span>
      </div>
      <div className="settings-project-extension-grid">
        {loading ? <ProjectExtensionState title="扫描项目拓展…" /> : null}
        {error ? <ProjectExtensionState title="项目拓展扫描失败" detail={error} tone="warning" /> : null}
        {!loading && !error && extensions.length === 0 ? <ProjectExtensionState title="未发现项目拓展" detail="当前项目没有可管理的 .pi/extensions 或 .pi/settings.json extension 条目。" /> : null}
        {extensions.map((extension) => <ProjectExtensionCard extension={extension} key={extension.id} onConfirm={() => onConfirmExtension(extension)} />)}
      </div>
    </section>
  );
}

function ProjectExtensionState({ title, detail, tone }: { title: string; detail?: string; tone?: "warning" }) {
  return (
    <div className={`settings-project-extension-card ${tone ?? ""}`}>
      <span>{title}</span>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function ProjectExtensionCard({ extension, onConfirm }: { extension: ProjectExtensionDisplayModel; onConfirm: () => void }) {
  return (
    <article className="settings-project-extension-card">
      <header>
        <span>{extension.label}</span>
        <span className={`settings-status-chip ${extension.confirmed ? "" : "warning"}`}>{extension.confirmed ? "已确认" : "未确认"}</span>
      </header>
      <small>{extension.relativePath}</small>
      <p>{extension.summary}</p>
      <span className="settings-capability-card-tags">
        {extension.capabilityLabels.slice(0, 3).map((label) => <span key={`capability-${label}`}>{label}</span>)}
        {extension.warningLabels.slice(0, 2).map((warning) => <span className="warning" key={`warning-${warning}`}>{warning}</span>)}
      </span>
      {!extension.confirmed && extension.injectable ? <button className="settings-inline-action" type="button" onClick={onConfirm}>确认启用</button> : null}
    </article>
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

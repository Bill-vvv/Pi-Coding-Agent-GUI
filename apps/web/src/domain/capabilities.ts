import type { AppSettings, CapabilityDescriptor, CapabilityImplementationHost, CapabilityOrigin, CapabilityReleaseStance, CapabilityRisk, DiscoveredPiExtensionDescriptor, RuntimeProfileDescriptor, RuntimeProfileId } from "@pi-gui/shared";
import { PI_GUI_CAPABILITIES, RUNTIME_PROFILES } from "@pi-gui/shared";

export type CapabilityDisplayModel = {
  id: string;
  label: string;
  summary: string;
  originLabel: string;
  integrationLevelLabel: string;
  implementationHostLabel: string;
  releaseStanceLabel: string;
  riskLabels: string[];
  compatibilityLabel: string;
  surfaceLabels: string[];
  behaviorLabels: string[];
  profileLabels: string[];
  docsLabel?: string;
};

export function capabilityDisplayModels(
  capabilities: readonly CapabilityDescriptor[] = PI_GUI_CAPABILITIES,
  profiles: readonly RuntimeProfileDescriptor[] = RUNTIME_PROFILES,
): CapabilityDisplayModel[] {
  return capabilities.map((capability) => capabilityDisplayModel(capability, profiles));
}

export function capabilityDisplayModel(capability: CapabilityDescriptor, profiles: readonly RuntimeProfileDescriptor[] = RUNTIME_PROFILES): CapabilityDisplayModel {
  return {
    id: capability.id,
    label: capability.label,
    summary: capability.summary,
    originLabel: originLabel(capability.origin),
    integrationLevelLabel: `L${capability.integrationLevel}`,
    implementationHostLabel: implementationHostLabel(capability.implementationHost),
    releaseStanceLabel: releaseStanceLabel(capability.releaseStance),
    riskLabels: capability.risks.map(riskLabel),
    compatibilityLabel: compatibilityLabel(capability),
    surfaceLabels: surfaceLabels(capability),
    behaviorLabels: behaviorLabels(capability),
    profileLabels: profiles.filter((profile) => profile.defaultCapabilityIds.includes(capability.id)).map((profile) => profile.label),
    docsLabel: capability.docsUrl ? "Docs" : undefined,
  };
}

export const UNKNOWN_USER_EXTENSIONS_CONFIRMATION = "Pi + User Extensions 会继承现有用户 Pi extension 设置。无 manifest 的扩展权限和行为未声明，且不会被视为 Pi GUI 内建能力。确认启用这个默认 profile？";

export function requiresUnknownExtensionConfirmation(nextProfileId: RuntimeProfileId, currentProfileId: RuntimeProfileId | undefined): boolean {
  return nextProfileId === "pi-user-extensions" && currentProfileId !== "pi-user-extensions";
}

export type ProjectExtensionDisplayModel = {
  id: string;
  label: string;
  summary: string;
  relativePath: string;
  integrationLevelLabel: string;
  sourceLabel: string;
  capabilityLabels: string[];
  warningLabels: string[];
  confirmed: boolean;
  injectable: boolean;
};

export function projectExtensionDisplayModels(extensions: readonly DiscoveredPiExtensionDescriptor[], settings: AppSettings): ProjectExtensionDisplayModel[] {
  const confirmed = new Set(settings.confirmedProjectExtensionIds ?? []);
  return extensions.map((extension) => ({
    id: extension.id,
    label: extensionLabel(extension),
    summary: extensionSummary(extension),
    relativePath: extension.relativePath,
    integrationLevelLabel: `L${extension.integrationLevel}`,
    sourceLabel: extensionSourceLabel(extension.source),
    capabilityLabels: extension.capabilityIds.map(capabilityLabel),
    warningLabels: extension.warnings,
    confirmed: confirmed.has(extension.id),
    injectable: extension.capabilityIds.length > 0,
  }));
}

export function confirmProjectExtension(settings: AppSettings, extensionId: string): AppSettings {
  return {
    ...settings,
    confirmedProjectExtensionIds: [...new Set([...(settings.confirmedProjectExtensionIds ?? []), extensionId])].sort(),
  };
}

export function projectExtensionConfirmationMessage(extension: ProjectExtensionDisplayModel): string {
  return `确认允许 Pi GUI 在隔离 profile 中显式注入项目扩展 ${extension.relativePath}？无 manifest 的扩展权限和行为未声明，仅应启用你信任的项目扩展。`;
}

export function userExtensionPlaceholderModel(): CapabilityDisplayModel {
  return {
    id: "unknown-user-extension",
    label: "Unknown / no-manifest user extensions",
    summary: "Pi + User Extensions profile can inherit existing user extension setup. Without a manifest, Pi GUI treats behavior and permissions as undeclared.",
    originLabel: "User",
    integrationLevelLabel: "L0",
    implementationHostLabel: "Pi extension",
    releaseStanceLabel: "Requires confirmation",
    riskLabels: ["权限未声明"],
    compatibilityLabel: "取决于用户环境",
    surfaceLabels: ["Generic tools/logs only"],
    behaviorLabels: ["Not inherited by Vanilla Pi", "First enable requires confirmation"],
    profileLabels: ["Pi + User Extensions"],
  };
}

function extensionLabel(extension: DiscoveredPiExtensionDescriptor): string {
  if (extension.capabilityIds.includes("trellis-subagent")) return "Trellis project extension";
  if (extension.capabilityIds.includes("interactive-prompts")) return "Interactive Prompts project extension";
  return "Unknown project extension";
}

function extensionSummary(extension: DiscoveredPiExtensionDescriptor): string {
  if (extension.capabilityIds.length === 0) return "未检测到可映射的 Pi GUI capability；当前只作为低信任项目扩展列出。";
  return "可在匹配 runtime profile 中显式注入；首次启用需要确认，因为没有 Pi GUI manifest。";
}

function extensionSourceLabel(source: DiscoveredPiExtensionDescriptor["source"]): string {
  switch (source) {
    case "project-convention": return "Project convention";
    case "project-settings": return "Project settings";
  }
}

function capabilityLabel(capabilityId: string): string {
  const capability = PI_GUI_CAPABILITIES.find((candidate) => candidate.id === capabilityId);
  return capability?.label ?? capabilityId;
}

function originLabel(origin: CapabilityOrigin): string {
  switch (origin) {
    case "builtin": return "Built-in";
    case "third-party": return "Third-party";
    case "user": return "User";
  }
}

function releaseStanceLabel(stance: CapabilityReleaseStance): string {
  switch (stance) {
    case "core": return "核心";
    case "default-on": return "默认开启";
    case "default-off": return "默认关闭";
    case "explicit-setup": return "显式设置";
    case "private-or-deferred": return "暂缓公开";
  }
}

function implementationHostLabel(host: CapabilityImplementationHost): string {
  switch (host) {
    case "pi-gui": return "GUI";
    case "pi-extension": return "Pi extension";
    case "external-wrapper": return "外部 wrapper";
    case "user-local-pi-wrapper": return "本地 Pi shim";
  }
}

function riskLabel(risk: CapabilityRisk): string {
  switch (risk) {
    case "ui-only": return "UI-only";
    case "filesystem": return "文件系统";
    case "network": return "网络";
    case "credential": return "凭据";
    case "process": return "进程";
    case "microphone": return "麦克风";
    case "pi-environment-mutation": return "改 Pi 环境";
  }
}

function compatibilityLabel(capability: CapabilityDescriptor): string {
  if (capability.supportsLocalRuntime && capability.supportsRemoteRuntime) return "Local + Remote";
  if (capability.supportsLocalRuntime) return "Local only";
  if (capability.supportsRemoteRuntime) return "Remote only";
  return "No runtime support";
}

function surfaceLabels(capability: CapabilityDescriptor): string[] {
  const tools = capability.providedTools?.map((tool) => `Tool: ${tool}`) ?? [];
  const uiMethods = capability.extensionUiMethods?.map((method) => `UI: ${method}`) ?? [];
  return [...tools, ...uiMethods];
}

function behaviorLabels(capability: CapabilityDescriptor): string[] {
  const labels: string[] = [];
  if (capability.changesAgentBehavior) labels.push("改 Agent 行为");
  if (capability.startsProcesses) labels.push("启动进程");
  if (capability.mutatesPiEnvironment) labels.push("会修改环境");
  if (capability.requiresExplicitSetup) labels.push("需要显式设置");
  return labels;
}

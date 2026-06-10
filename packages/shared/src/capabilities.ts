export type CapabilityImplementationHost = "pi-gui" | "pi-extension" | "external-wrapper" | "user-local-pi-wrapper";
export type CapabilityRisk = "network" | "process" | "credential" | "filesystem" | "ui-only" | "microphone" | "pi-environment-mutation";
export type CapabilityReleaseStance = "core" | "default-on" | "default-off" | "explicit-setup" | "private-or-deferred";
export type CapabilityOrigin = "builtin" | "user" | "third-party";
export type CapabilityIntegrationLevel = 0 | 1 | 2 | 3;
export type RuntimeProfileId = "vanilla-pi" | "pi-user-extensions" | "pi-gui-enhanced" | "trellis-workflow" | "custom";

export const RUNTIME_PROFILE_IDS: readonly RuntimeProfileId[] = ["vanilla-pi", "pi-user-extensions", "pi-gui-enhanced", "trellis-workflow", "custom"] as const;

export function isRuntimeProfileId(value: unknown): value is RuntimeProfileId {
  return typeof value === "string" && (RUNTIME_PROFILE_IDS as readonly string[]).includes(value);
}

export type CapabilityDescriptor = {
  id: string;
  label: string;
  summary: string;
  origin: CapabilityOrigin;
  integrationLevel: CapabilityIntegrationLevel;
  implementationHost: CapabilityImplementationHost;
  risks: CapabilityRisk[];
  releaseStance: CapabilityReleaseStance;
  mutatesPiEnvironment: boolean;
  changesAgentBehavior: boolean;
  startsProcesses: boolean;
  providedTools?: string[];
  extensionUiMethods?: string[];
  supportsLocalRuntime: boolean;
  supportsRemoteRuntime: boolean;
  requiresExplicitSetup?: boolean;
  docsUrl?: string;
  legacyTemporaryShim?: boolean;
};

export type RuntimeProfileDescriptor = {
  id: RuntimeProfileId;
  label: string;
  summary: string;
  defaultCapabilityIds: string[];
  inheritsUserExtensions: boolean;
};

export type PiExtensionDiscoveryScope = "project";
export type PiExtensionDiscoverySource = "project-convention" | "project-settings";

export type DiscoveredPiExtensionDescriptor = {
  id: string;
  scope: PiExtensionDiscoveryScope;
  source: PiExtensionDiscoverySource;
  path: string;
  relativePath: string;
  integrationLevel: 0 | 1 | 2;
  capabilityIds: string[];
  warnings: string[];
};

export const PI_GUI_CAPABILITIES: CapabilityDescriptor[] = [
  {
    id: "interactive-prompts",
    label: "Interactive Prompts",
    summary: "用 GUI 原生表单承载 agent 的结构化澄清、选择和确认问题。",
    origin: "builtin",
    integrationLevel: 3,
    implementationHost: "pi-extension",
    risks: ["ui-only"],
    releaseStance: "default-off",
    mutatesPiEnvironment: false,
    changesAgentBehavior: true,
    startsProcesses: false,
    extensionUiMethods: ["askBatch"],
    supportsLocalRuntime: true,
    supportsRemoteRuntime: false,
  },
  {
    id: "trellis-subagent",
    label: "Trellis Sub-agent Workflow",
    summary: "允许 Trellis 工作流启动隔离的子 Pi agent 执行 bounded task。",
    origin: "builtin",
    integrationLevel: 3,
    implementationHost: "pi-extension",
    risks: ["process", "filesystem"],
    releaseStance: "default-off",
    mutatesPiEnvironment: false,
    changesAgentBehavior: true,
    startsProcesses: true,
    providedTools: ["trellis_subagent"],
    supportsLocalRuntime: true,
    supportsRemoteRuntime: false,
  },
  {
    id: "pi-pet-companion",
    label: "Pi PET Companion",
    summary: "用 GUI 原生小宠物展示 Pi runtime、工具、subagent 和等待用户输入等运行状态。",
    origin: "builtin",
    integrationLevel: 3,
    implementationHost: "pi-gui",
    risks: ["ui-only"],
    releaseStance: "default-off",
    mutatesPiEnvironment: false,
    changesAgentBehavior: false,
    startsProcesses: false,
    supportsLocalRuntime: true,
    supportsRemoteRuntime: true,
    docsUrl: "docs/pi-pet-companion.md",
  },
  {
    id: "remote-access",
    label: "Remote Access / Android LAN",
    summary: "手机或局域网浏览器访问当前 GUI。",
    origin: "builtin",
    integrationLevel: 3,
    implementationHost: "pi-gui",
    risks: ["network", "credential"],
    releaseStance: "default-off",
    mutatesPiEnvironment: false,
    changesAgentBehavior: false,
    startsProcesses: false,
    supportsLocalRuntime: true,
    supportsRemoteRuntime: false,
    legacyTemporaryShim: true,
  },
  {
    id: "windows-portproxy",
    label: "Windows 端口转发设置",
    summary: "为 WSL Remote Access 配置 Windows portproxy/firewall。",
    origin: "builtin",
    integrationLevel: 3,
    implementationHost: "pi-gui",
    risks: ["network", "process", "pi-environment-mutation"],
    releaseStance: "explicit-setup",
    mutatesPiEnvironment: true,
    changesAgentBehavior: false,
    startsProcesses: true,
    supportsLocalRuntime: true,
    supportsRemoteRuntime: false,
    requiresExplicitSetup: true,
    legacyTemporaryShim: true,
  },
  {
    id: "ssh-runtime",
    label: "SSH 远程项目 runtime",
    summary: "通过 SSH 在远端目录启动 pi --mode rpc。",
    origin: "builtin",
    integrationLevel: 3,
    implementationHost: "pi-gui",
    risks: ["network", "process", "filesystem"],
    releaseStance: "default-off",
    mutatesPiEnvironment: false,
    changesAgentBehavior: false,
    startsProcesses: true,
    supportsLocalRuntime: true,
    supportsRemoteRuntime: true,
    legacyTemporaryShim: true,
  },
  {
    id: "pi-ready-notifications",
    label: "Pi ready notifications",
    summary: "通过 GUI-safe Pi extension 转为浏览器系统通知。",
    origin: "builtin",
    integrationLevel: 3,
    implementationHost: "pi-extension",
    risks: ["ui-only"],
    releaseStance: "default-off",
    mutatesPiEnvironment: false,
    changesAgentBehavior: false,
    startsProcesses: false,
    extensionUiMethods: ["notify"],
    supportsLocalRuntime: true,
    supportsRemoteRuntime: false,
    legacyTemporaryShim: true,
  },
  {
    id: "usage-telemetry",
    label: "Token usage telemetry",
    summary: "只读扫描本地 Pi session usage 并展示统计。",
    origin: "builtin",
    integrationLevel: 3,
    implementationHost: "pi-gui",
    risks: ["filesystem", "ui-only"],
    releaseStance: "default-off",
    mutatesPiEnvironment: false,
    changesAgentBehavior: false,
    startsProcesses: false,
    supportsLocalRuntime: true,
    supportsRemoteRuntime: false,
    legacyTemporaryShim: true,
  },
  {
    id: "provider-models",
    label: "Provider / model UI",
    summary: "GUI 适配非权威模型列表和未来 provider 配置入口，不保存 provider 凭据。",
    origin: "builtin",
    integrationLevel: 3,
    implementationHost: "pi-gui",
    risks: ["credential", "process"],
    releaseStance: "default-off",
    mutatesPiEnvironment: false,
    changesAgentBehavior: false,
    startsProcesses: true,
    supportsLocalRuntime: true,
    supportsRemoteRuntime: false,
    legacyTemporaryShim: true,
  },
  {
    id: "codex-transport-monitor",
    label: "Codex transport monitor",
    summary: "通过 Pi extension 输出已脱敏的 Codex transport 诊断。",
    origin: "builtin",
    integrationLevel: 3,
    implementationHost: "pi-extension",
    risks: ["network", "credential"],
    releaseStance: "default-off",
    mutatesPiEnvironment: false,
    changesAgentBehavior: false,
    startsProcesses: false,
    supportsLocalRuntime: true,
    supportsRemoteRuntime: false,
    legacyTemporaryShim: true,
  },
  {
    id: "codex-proxy-setup",
    label: "Codex proxy wrapper/preload setup",
    summary: "用户本地 Pi wrapper/preload/settings 适配，必须显式执行。",
    origin: "builtin",
    integrationLevel: 3,
    implementationHost: "user-local-pi-wrapper",
    risks: ["network", "credential", "pi-environment-mutation"],
    releaseStance: "explicit-setup",
    mutatesPiEnvironment: true,
    changesAgentBehavior: true,
    startsProcesses: false,
    supportsLocalRuntime: true,
    supportsRemoteRuntime: false,
    requiresExplicitSetup: true,
    legacyTemporaryShim: true,
  },
];

export const RUNTIME_PROFILES: RuntimeProfileDescriptor[] = [
  {
    id: "vanilla-pi",
    label: "Vanilla Pi",
    summary: "不注入 Pi GUI 增强工具，也不继承用户扩展的干净 Pi runtime。",
    defaultCapabilityIds: [],
    inheritsUserExtensions: false,
  },
  {
    id: "pi-user-extensions",
    label: "Pi + User Extensions",
    summary: "继承或发现用户已有 Pi extensions，但不默认启用 Pi GUI workflow 增强。",
    defaultCapabilityIds: [],
    inheritsUserExtensions: true,
  },
  {
    id: "pi-gui-enhanced",
    label: "Pi GUI Enhanced",
    summary: "启用低风险 GUI 增强能力，但不隐含 Trellis workflow。",
    defaultCapabilityIds: ["interactive-prompts", "pi-ready-notifications"],
    inheritsUserExtensions: false,
  },
  {
    id: "trellis-workflow",
    label: "Trellis Workflow",
    summary: "启用 Trellis/sub-agent/task workflow 能力，并明确标注其为 Pi GUI/Trellis 扩展。",
    defaultCapabilityIds: ["interactive-prompts", "pi-ready-notifications", "trellis-subagent"],
    inheritsUserExtensions: false,
  },
  {
    id: "custom",
    label: "Custom",
    summary: "用户自定义能力和扩展组合。",
    defaultCapabilityIds: [],
    inheritsUserExtensions: false,
  },
];

export function runtimeProfileById(profileId: RuntimeProfileId, profiles: readonly RuntimeProfileDescriptor[] = RUNTIME_PROFILES): RuntimeProfileDescriptor {
  const profile = profiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error(`Unknown runtime profile: ${profileId}`);
  return profile;
}

export function capabilitiesForRuntimeProfile(
  profileId: RuntimeProfileId,
  capabilities: readonly CapabilityDescriptor[] = PI_GUI_CAPABILITIES,
  profiles: readonly RuntimeProfileDescriptor[] = RUNTIME_PROFILES,
): CapabilityDescriptor[] {
  const profile = runtimeProfileById(profileId, profiles);
  const byId = new Map(capabilities.map((capability) => [capability.id, capability]));
  return profile.defaultCapabilityIds.map((id) => {
    const capability = byId.get(id);
    if (!capability) throw new Error(`Runtime profile ${profile.id} references unknown capability: ${id}`);
    return capability;
  });
}

export function capabilityCounts(capabilities: readonly CapabilityDescriptor[] = PI_GUI_CAPABILITIES): { total: number; explicitSetup: number; mutating: number; changesAgentBehavior: number } {
  return {
    total: capabilities.length,
    explicitSetup: capabilities.filter((capability) => capability.releaseStance === "explicit-setup" || capability.requiresExplicitSetup).length,
    mutating: capabilities.filter((capability) => capability.mutatesPiEnvironment).length,
    changesAgentBehavior: capabilities.filter((capability) => capability.changesAgentBehavior).length,
  };
}

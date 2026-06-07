export type RuntimeStatus = "stopped" | "starting" | "running" | "crashed";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ResponseMode = "normal" | "fast";
export type ServiceTier = "auto" | "default" | "flex" | "scale" | "priority";

export const SERVICE_TIERS: readonly ServiceTier[] = ["auto", "default", "flex", "scale", "priority"] as const;

export function isServiceTier(value: unknown): value is ServiceTier {
  return typeof value === "string" && (SERVICE_TIERS as readonly string[]).includes(value);
}

export type Project = {
  id: string;
  name: string;
  cwd: string;
  lastOpenedAt: number;
  defaultModel?: string;
};

export type ResolvedPathSource = "linux" | "windows-drive" | "wsl-unc" | "ssh";

export type ResolvePathErrorCode =
  | "empty_path"
  | "relative_path"
  | "home_expansion_unsupported"
  | "windows_path_requires_wsl"
  | "wsl_unc_invalid"
  | "wsl_unc_distro_mismatch"
  | "path_not_found"
  | "path_not_directory";

export type ResolvedPath = {
  inputPath: string;
  cwd: string;
  displayPath?: string;
  source: ResolvedPathSource;
  exists: boolean;
  isDirectory: boolean;
  error?: string;
  errorCode?: ResolvePathErrorCode;
};

export type DirectoryEntry = {
  name: string;
  path: string;
  type: "directory";
};

export type DirectoryListing = {
  cwd: string;
  parent?: string;
  entries: DirectoryEntry[];
};

export type FileSearchEntry = {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory";
};

export type FileSearchResponse = {
  root: string;
  query: string;
  entries: FileSearchEntry[];
};

export type ImportedFileResponse = {
  path: string;
  name: string;
  size: number;
};

export type Runtime = {
  id: string;
  projectId: string;
  cwd: string;
  status: RuntimeStatus;
  pid?: number;
  sessionId?: string;
  startedAt?: number;
  archivedAt?: number;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  responseMode?: ResponseMode;
};

export type GuiSession = {
  id: string;
  projectId: string;
  piSessionFile: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  runtimeId?: string;
};

export type GuiEventKind = "pi_event" | "runtime_status" | "stderr" | "error";

export type GuiEvent = {
  id: number;
  runtimeId: string;
  projectId: string;
  timestamp: number;
  kind: GuiEventKind;
  payload: unknown;
};

export type ConversationRole = "user" | "assistant" | "tool" | "error" | "log";

// Provider-agnostic optional capability for child agent/tool runs launched by a
// Pi extension or workflow adapter. Core Pi GUI must not require Trellis or any
// specific workflow provider for these shapes to be valid.
export type SubagentRunStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";
export type SubagentRunMode = "single" | "parallel" | "chain";
export type SubagentContextMode = "fork" | "isolated";
export type SubagentToolStatus = "running" | "succeeded" | "failed";

export type SubagentUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  ctxTokens?: number;
  turns?: number;
};

export type SubagentToolTrace = {
  id: string;
  name: string;
  args?: string;
  status: SubagentToolStatus;
  startedAt?: number;
  finishedAt?: number;
};

export type SubagentChildRun = {
  id: string;
  agent: string;
  prompt?: string;
  step?: number;
  status: SubagentRunStatus;
  startedAt?: number;
  finishedAt?: number;
  sessionFile?: string;
  finalText?: string;
  textTail?: string;
  thinkingTail?: string;
  stderrTail?: string;
  tools?: SubagentToolTrace[];
  usage?: SubagentUsage;
  model?: string;
  thinking?: string;
  errorMessage?: string;
};

export type SubagentRun = {
  id: string;
  projectId: string;
  parentRuntimeId: string;
  parentToolCallId: string;
  parentToolMessageId: string;
  agent: string;
  mode: SubagentRunMode;
  contextMode?: SubagentContextMode;
  status: SubagentRunStatus;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  finalText?: string;
  errorMessage?: string;
  runs: SubagentChildRun[];
};

export type ConversationMessage = {
  id: string;
  runtimeId: string;
  projectId: string;
  role: ConversationRole;
  text: string;
  timestamp?: number;
  updatedAt?: number;
  title?: string;
  isStreaming?: boolean;
  thinking?: string;
};

export type ConversationTokenUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
  cost?: number;
};

export type ConversationContextUsage = {
  tokens?: number | null;
  contextWindow?: number;
  percent?: number | null;
  sessionTokens?: ConversationTokenUsage;
  updatedAt?: number;
};

export type RuntimeQueue = {
  steering: string[];
  followUp: string[];
};

export type SlashCommand = {
  name: string;
  description?: string;
  source: "builtin" | "extension" | "prompt" | "skill";
  location?: string;
  path?: string;
  sourceInfo?: unknown;
};

export type PiRpcCommand = {
  type: string;
  [key: string]: unknown;
};

export type ExtensionUiAskBatchQuestionKind = "single" | "multi" | "confirm" | "text";

export type ExtensionUiAskBatchOption = {
  value: string;
  label: string;
  description?: string;
};

export type ExtensionUiAskBatchQuestion = {
  id: string;
  label?: string;
  prompt: string;
  situation?: string;
  suggestion?: string;
  kind?: ExtensionUiAskBatchQuestionKind;
  options?: ExtensionUiAskBatchOption[];
  allowOther?: boolean;
  required?: boolean;
  defaultValue?: string | string[] | boolean;
};

export type ExtensionUiRequest =
  | { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
  | { type: "extension_ui_request"; id: string; method: "askBatch"; title?: string; context?: string; questions: ExtensionUiAskBatchQuestion[]; submitPolicy?: "require_all" | "allow_partial"; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "notify"; message: string; notifyType?: "info" | "warning" | "error" }
  | { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText?: string }
  | { type: "extension_ui_request"; id: string; method: "setWidget"; widgetKey: string; widgetLines?: string[]; widgetPlacement?: "aboveEditor" | "belowEditor" }
  | { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
  | { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

export type ExtensionUiResponse =
  | { value: string }
  | { confirmed: boolean }
  | { cancelled: true };

export type RuntimeConversationSummary = {
  runtimeId: string;
  projectId: string;
  title: string;
  detail?: string;
  updatedAt?: number;
  messageCount: number;
  latestAssistantCompletedAt?: number;
};

export type ConversationDelta = {
  runtimeId: string;
  projectId: string;
  messageId: string;
  timestamp: number;
  appendText?: string;
  appendThinking?: string;
  text?: string;
  thinking?: string;
  role?: ConversationRole;
  title?: string;
  isStreaming?: boolean;
};

export type RemoteAccessCandidateUrl = {
  host: string;
  url: string;
  interfaceName?: string;
  recommended?: boolean;
  source?: "server-interface" | "windows-host";
  requiresPortProxy?: boolean;
};

export type RemoteAccessSetupCommand = {
  label: string;
  command: string;
  platform: "shell" | "windows-powershell";
  requiresAdmin?: boolean;
};

export type RemoteAccessSetupHint = {
  code: "restart_required" | "bind_loopback" | "wsl_portproxy_required" | "windows_firewall_required" | "no_lan_candidates";
  severity: "info" | "warning" | "error";
  message: string;
  detail?: string;
  remediation?: string;
  commands?: RemoteAccessSetupCommand[];
};

export type RemoteAccessStatus = {
  enabled: boolean;
  active: boolean;
  restartRequired: boolean;
  mode: "local" | "remote-lan";
  bindHost: string;
  port: number;
  selectedHost?: string;
  selectedUrl?: string;
  recommendedUrl?: string;
  candidateUrls: RemoteAccessCandidateUrl[];
  tokenConfigured: boolean;
  tokenPreview?: string;
  tokenSource?: "env" | "persisted";
  networkEnvironment?: "native" | "wsl";
  setupHints?: RemoteAccessSetupHint[];
};

export type RemoteAccessPairingInfo = {
  status: RemoteAccessStatus;
  token: string;
  pairingUrl: string;
  warnings: string[];
};

export type RemoteAccessUpdateRequest = {
  enabled?: boolean;
  selectedHost?: string;
  rotateToken?: boolean;
  clearToken?: boolean;
};

export type RemoteAccessUpdateResponse = {
  status: RemoteAccessStatus;
  pairing?: RemoteAccessPairingInfo;
};

export type RemoteAccessWindowsPortProxyResponse = {
  accepted: boolean;
  status: RemoteAccessStatus;
  targetHost: string;
  listenPort: number;
  requiresAdmin: boolean;
  message: string;
};

export type RemoteAccessRestartResponse = {
  accepted: boolean;
  reconnectDelayMs: number;
  message: string;
  status: RemoteAccessStatus;
};

export type VoiceInputMode = "disabled" | "externalService" | "managedProcess";
export type VoiceInputCaptureMode = "browser" | "native";

export type VoiceInputSettings = {
  mode?: VoiceInputMode;
  captureMode?: VoiceInputCaptureMode;
  externalUrl?: string;
  managedCommand?: string;
  managedArgs?: string[];
  managedCwd?: string;
  modelPath?: string;
  autoStart?: boolean;
  startupTimeoutMs?: number;
  transcriptionTimeoutMs?: number;
  maxRecordingMs?: number;
  maxUploadBytes?: number;
};

export type VoiceInputStatusState = "disabled" | "not_configured" | "starting" | "ready" | "error";

export type VoiceInputStatus = {
  available: boolean;
  mode: VoiceInputMode;
  state: VoiceInputStatusState;
  message?: string;
  maxRecordingMs: number;
  maxUploadBytes: number;
  transcriptionTimeoutMs: number;
};

export type VoiceTranscriptionResponse = {
  text: string;
  durationMs?: number;
};

export type VoiceRecordingStartResponse = {
  recording: true;
  startedAt: number;
};

export type AppSettings = {
  defaultModel?: string;
  defaultThinkingLevel?: ThinkingLevel;
  responseMode?: ResponseMode;
  voiceInput?: VoiceInputSettings;
};

export type ModelSummary = {
  provider: string;
  id: string;
  label: string;
  supportsThinking: boolean;
  supportedThinkingLevels?: ThinkingLevel[];
  supportsImages: boolean;
  supportsFast: boolean;
  contextWindow?: number;
};

export type TokenUsageRange = "all" | "30d" | "7d";
export type TokenUsageQuality = "recorded" | "partial" | "empty";

export type TokenUsageBreakdown = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total: number;
  cost?: number;
};

export type TokenUsageDay = {
  day: string;
  tokens: TokenUsageBreakdown;
  sessions: number;
  assistantMessages: number;
  models: Array<{ provider?: string; model: string; totalTokens: number }>;
};

export type TokenUsageOverview = {
  range: TokenUsageRange;
  projectId?: string;
  generatedAt: number;
  days: TokenUsageDay[];
  summary: {
    sessions: number;
    messages: number;
    totalTokens: number;
    activeDays: number;
    currentStreakDays: number;
    longestStreakDays: number;
    peakHour?: number;
    favoriteModel?: string;
    quality: TokenUsageQuality;
  };
  coverage: {
    scannedFiles: number;
    cachedFiles: number;
    assistantMessages: number;
    recordedUsageMessages: number;
    missingUsageMessages: number;
    skippedMissingTimestamp: number;
    malformedLines: number;
    truncatedLines: number;
    scanLimited: boolean;
  };
  models: Array<{ provider?: string; model: string; totalTokens: number; messages: number; activeDays: number }>;
};

export type EnvironmentReadinessIssue = {
  code: string;
  severity: "warning" | "error";
  message: string;
  detail?: string;
  remediation?: string;
};

export type EnvironmentDiagnostics = {
  checkedAt: number;
  platform: string;
  arch: string;
  nodeVersion: string;
  npmVersion?: string;
  cwd: string;
  home?: string;
  backend?: {
    host: string;
    port: number;
    mode: string;
  };
  wsl: {
    isWsl: boolean;
    distroName?: string;
    kernelRelease?: string;
    interop?: boolean;
  };
  pi: {
    installed: boolean;
    path?: string;
    version?: string;
    error?: string;
    rpcSmoke?: {
      ok: boolean;
      command?: string;
      durationMs?: number;
      error?: string;
    };
  };
  readiness?: {
    status: "ready" | "warning" | "error";
    issues: EnvironmentReadinessIssue[];
  };
};

export type RuntimeStatus = "stopped" | "starting" | "running" | "crashed";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ResponseMode = "normal" | "fast";
export type ServiceTier = "auto" | "default" | "flex" | "scale" | "priority";

export type Project = {
  id: string;
  name: string;
  cwd: string;
  lastOpenedAt: number;
  defaultModel?: string;
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

export type ConversationContextUsage = {
  tokens?: number;
  contextWindow?: number;
  percent?: number;
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

export type ExtensionUiRequest =
  | { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
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

export type AppSettings = {
  defaultModel?: string;
  defaultThinkingLevel?: ThinkingLevel;
  responseMode?: ResponseMode;
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

export type EnvironmentDiagnostics = {
  checkedAt: number;
  platform: string;
  arch: string;
  nodeVersion: string;
  cwd: string;
  home?: string;
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
  };
};

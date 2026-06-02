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

export type ClientCommand =
  | { type: "project.list"; requestId?: string }
  | { type: "project.create"; requestId?: string; name?: string; cwd: string; defaultModel?: string }
  | { type: "settings.get"; requestId?: string }
  | { type: "settings.update"; requestId?: string; settings: AppSettings }
  | { type: "runtime.start"; requestId?: string; projectId: string; model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode }
  | { type: "runtime.configure"; requestId?: string; runtimeId: string; modelProvider?: string; modelId?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode }
  | { type: "runtime.stop"; requestId?: string; runtimeId: string }
  | { type: "runtime.archive"; requestId?: string; runtimeId: string }
  | { type: "runtime.prompt"; requestId?: string; runtimeId: string; message: string; streamingBehavior?: "steer" | "followUp" }
  | { type: "runtime.abort"; requestId?: string; runtimeId: string }
  | { type: "event.replay"; requestId?: string; afterEventId?: number; limit?: number };

export type ServerEvent =
  | { type: "hello"; serverTime: number; projects: Project[]; runtimes: Runtime[]; recentEvents: GuiEvent[]; settings: AppSettings }
  | { type: "command.result"; requestId?: string; command: ClientCommand["type"] | "unknown"; success: boolean; error?: string; data?: unknown }
  | { type: "project.list"; projects: Project[] }
  | { type: "project.created"; project: Project }
  | { type: "settings.updated"; settings: AppSettings }
  | { type: "runtime.status"; runtime: Runtime }
  | { type: "gui.event"; event: GuiEvent };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

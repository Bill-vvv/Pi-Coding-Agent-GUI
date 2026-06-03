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

export type ClientCommand =
  | { type: "project.list"; requestId?: string }
  | { type: "project.create"; requestId?: string; name?: string; cwd: string; defaultModel?: string }
  | { type: "session.list"; requestId?: string; projectId?: string }
  | { type: "settings.get"; requestId?: string }
  | { type: "settings.update"; requestId?: string; settings: AppSettings }
  | { type: "runtime.start"; requestId?: string; projectId: string; model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode }
  | { type: "runtime.resume"; requestId?: string; runtimeId: string; model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode }
  | { type: "runtime.configure"; requestId?: string; runtimeId: string; modelProvider?: string; modelId?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode }
  | { type: "runtime.stop"; requestId?: string; runtimeId: string }
  | { type: "runtime.archive"; requestId?: string; runtimeId: string }
  | { type: "runtime.prompt"; requestId?: string; runtimeId: string; message: string; streamingBehavior?: "steer" | "followUp" }
  | { type: "runtime.abort"; requestId?: string; runtimeId: string }
  | { type: "conversation.open"; requestId?: string; runtimeId: string; limit?: number }
  | { type: "event.replay"; requestId?: string; afterEventId?: number; limit?: number };

export type ServerEvent =
  | { type: "hello"; serverTime: number; projects: Project[]; runtimes: Runtime[]; settings: AppSettings; lastEventId: number; conversationSummaries?: RuntimeConversationSummary[]; sessions?: GuiSession[] }
  | { type: "command.result"; requestId?: string; command: ClientCommand["type"] | "unknown"; success: boolean; error?: string; data?: unknown }
  | { type: "project.list"; projects: Project[] }
  | { type: "project.created"; project: Project }
  | { type: "session.list"; sessions: GuiSession[] }
  | { type: "session.updated"; session: GuiSession }
  | { type: "settings.updated"; settings: AppSettings }
  | { type: "runtime.status"; runtime: Runtime }
  | { type: "conversation.snapshot"; runtimeId: string; projectId: string; messages: ConversationMessage[]; contextUsage?: ConversationContextUsage; busy: boolean }
  | { type: "conversation.message"; message: ConversationMessage }
  | { type: "conversation.delta"; delta: ConversationDelta }
  | { type: "conversation.context"; runtimeId: string; projectId: string; contextUsage: ConversationContextUsage }
  | { type: "conversation.busy"; runtimeId: string; projectId: string; busy: boolean }
  | { type: "gui.event"; event: GuiEvent };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function containsSerializedToolCallText(text: string): boolean {
  return removeSerializedToolCalls(text).removed;
}

export function isSerializedToolCallText(text: string): boolean {
  const result = removeSerializedToolCalls(text);
  return result.removed && result.text.trim() === "";
}

export function stripSerializedToolCallsFromText(text: string): string {
  return removeSerializedToolCalls(text).text;
}

function removeSerializedToolCalls(text: string): { text: string; removed: boolean } {
  const fencedToolCallText = wholeJsonCodeFenceContent(text);
  if (fencedToolCallText !== undefined) {
    const fencedResult = removeSerializedToolCalls(fencedToolCallText);
    if (fencedResult.removed && fencedResult.text.trim() === "") return { text: "", removed: true };
  }

  let output = "";
  let index = 0;
  let removed = false;

  while (index < text.length) {
    const start = nextJsonContainerStart(text, index);
    if (start === -1) {
      output += text.slice(index);
      break;
    }

    output += text.slice(index, start);
    const end = findJsonContainerEnd(text, start);
    if (end === -1) {
      output += text[start];
      index = start + 1;
      continue;
    }

    const candidate = text.slice(start, end + 1);
    if (isSerializedToolCallJson(candidate)) {
      removed = true;
      index = end + 1;
      continue;
    }

    output += candidate;
    index = end + 1;
  }

  return { text: cleanupRemovedToolCallText(output), removed };
}

function wholeJsonCodeFenceContent(text: string): string | undefined {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  return match?.[1]?.trim();
}

function nextJsonContainerStart(text: string, startIndex: number): number {
  const objectStart = text.indexOf("{", startIndex);
  const arrayStart = text.indexOf("[", startIndex);
  if (objectStart === -1) return arrayStart;
  if (arrayStart === -1) return objectStart;
  return Math.min(objectStart, arrayStart);
}

function findJsonContainerEnd(text: string, startIndex: number): number {
  const opener = text[startIndex];
  if (opener !== "{" && opener !== "[") return -1;

  const expectedClosers = [opener === "{" ? "}" : "]"];
  let inString = false;
  let escaped = false;

  for (let index = startIndex + 1; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      expectedClosers.push("}");
      continue;
    }

    if (char === "[") {
      expectedClosers.push("]");
      continue;
    }

    if (char === expectedClosers[expectedClosers.length - 1]) {
      expectedClosers.pop();
      if (expectedClosers.length === 0) return index;
    }
  }

  return -1;
}

function isSerializedToolCallJson(text: string): boolean {
  try {
    return isToolCallJson(JSON.parse(text));
  } catch {
    return false;
  }
}

function isToolCallJson(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0 && value.every(isToolCallJson);
  if (!isRecord(value)) return false;
  return value.type === "toolCall" || value.type === "tool_call" || value.type === "tool_use";
}

function cleanupRemovedToolCallText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

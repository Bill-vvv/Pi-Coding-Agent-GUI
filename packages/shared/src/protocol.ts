import type {
  AppSettings,
  ConversationContextUsage,
  ConversationDelta,
  ConversationMessage,
  GuiEvent,
  GuiEventKind,
  ExtensionUiRequest,
  ExtensionUiResponse,
  GuiSession,
  PiRpcCommand,
  Project,
  ResponseMode,
  Runtime,
  RuntimeConversationSummary,
  RuntimeQueue,
  SlashCommand,
  SubagentRun,
  ThinkingLevel,
} from "./domain.js";

export type ClientCommand =
  | { type: "project.list"; requestId?: string }
  | { type: "project.create"; requestId?: string; name?: string; cwd: string; defaultModel?: string }
  | { type: "session.list"; requestId?: string; projectId?: string }
  | { type: "session.resume"; requestId?: string; sessionId: string; model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode }
  | { type: "settings.get"; requestId?: string }
  | { type: "settings.update"; requestId?: string; settings: AppSettings }
  | { type: "runtime.start"; requestId?: string; projectId: string; model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode }
  | { type: "runtime.resume"; requestId?: string; runtimeId: string; model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode }
  | { type: "runtime.restart"; requestId?: string; runtimeId: string; model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode }
  | { type: "runtime.configure"; requestId?: string; runtimeId: string; modelProvider?: string; modelId?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode }
  | { type: "runtime.stop"; requestId?: string; runtimeId: string }
  | { type: "runtime.archive"; requestId?: string; runtimeId: string }
  // Safe blank-runtime cleanup command. The server must no-op unless the
  // runtime is still an unused new conversation; frontend selection-away
  // cleanup may send this but must tolerate guard-denied success results.
  | { type: "runtime.archiveBlank"; requestId?: string; runtimeId: string }
  | { type: "runtime.prompt"; requestId?: string; runtimeId: string; message: string; streamingBehavior?: "steer" | "followUp"; displayMessage?: string }
  | { type: "runtime.queue.dequeue"; requestId?: string; runtimeId: string }
  | { type: "runtime.queue.reorder"; requestId?: string; runtimeId: string; queue: RuntimeQueue }
  | { type: "runtime.rpc"; requestId?: string; runtimeId: string; command: PiRpcCommand; label?: string; displayMessage?: string }
  | { type: "runtime.abort"; requestId?: string; runtimeId: string }
  | { type: "runtime.commands.list"; requestId?: string; runtimeId: string }
  | { type: "runtime.logs"; requestId?: string; runtimeId: string; afterEventId?: number; limit?: number; kinds?: GuiEventKind[] }
  | { type: "extension.ui.respond"; requestId?: string; runtimeId: string; responseId: string; response: ExtensionUiResponse }
  | { type: "conversation.open"; requestId?: string; runtimeId: string; limit?: number }
  | { type: "conversation.page"; requestId?: string; runtimeId: string; beforeMessageId: string; limit?: number }
  // Optional provider-agnostic child-agent capability; unsupported providers may return no runs.
  | { type: "subagent.detail.open"; requestId?: string; runId: string; childRunId?: string; limit?: number }
  | { type: "event.replay"; requestId?: string; afterEventId?: number; limit?: number; projectId?: string; runtimeId?: string };

export type ServerEvent =
  | { type: "hello"; serverTime: number; projects: Project[]; runtimes: Runtime[]; settings: AppSettings; lastEventId: number; conversationSummaries?: RuntimeConversationSummary[]; sessions?: GuiSession[]; subagentRuns?: SubagentRun[] }
  | { type: "command.result"; requestId?: string; command: ClientCommand["type"] | "unknown"; success: boolean; error?: string; data?: unknown }
  | { type: "project.list"; projects: Project[] }
  | { type: "project.created"; project: Project }
  | { type: "session.list"; sessions: GuiSession[]; projectId?: string }
  | { type: "session.updated"; session: GuiSession }
  | { type: "settings.updated"; settings: AppSettings }
  | { type: "runtime.status"; runtime: Runtime }
  | { type: "conversation.snapshot"; runtimeId: string; projectId: string; messages: ConversationMessage[]; contextUsage?: ConversationContextUsage; busy: boolean; hasMoreBefore: boolean }
  | { type: "conversation.page"; runtimeId: string; projectId: string; messages: ConversationMessage[]; beforeMessageId: string; hasMoreBefore: boolean }
  | { type: "conversation.message"; message: ConversationMessage }
  | { type: "conversation.delta"; delta: ConversationDelta }
  | { type: "conversation.context"; runtimeId: string; projectId: string; contextUsage: ConversationContextUsage }
  | { type: "conversation.busy"; runtimeId: string; projectId: string; busy: boolean }
  | { type: "runtime.queue"; runtimeId: string; projectId: string; queue: RuntimeQueue }
  | { type: "runtime.commands"; runtimeId: string; projectId: string; commands: SlashCommand[] }
  | { type: "runtime.logs"; runtimeId: string; projectId: string; events: GuiEvent[]; hasMore?: boolean }
  | { type: "runtime.rpc.response"; runtimeId: string; projectId: string; command: string; success: boolean; data?: unknown; error?: string; label?: string }
  | { type: "extension.ui.request"; runtimeId: string; projectId: string; request: ExtensionUiRequest }
  // Optional provider-agnostic child-agent events; absent/empty means no provider is active.
  | { type: "subagent.snapshot"; runs: SubagentRun[] }
  | { type: "subagent.run"; run: SubagentRun }
  | { type: "subagent.detail"; runId: string; childRunId: string; messages: ConversationMessage[]; readAt: number; error?: string }
  | { type: "gui.event"; event: GuiEvent };

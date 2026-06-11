import type {
  AppSettings,
  ConversationContextUsage,
  ConversationDelta,
  ConversationMessage,
  ExtensionUiRequest,
  GuiEvent,
  GuiSession,
  GitRepositoryStatus,
  Project,
  RewindCheckpointOperation,
  RewindCheckpointPreview,
  RewindCheckpointRestoreResult,
  RewindCheckpointSummary,
  RewindGarbageCollectResult,
  RewindJumpHistoryEntry,
  RewindStorageHealth,
  Runtime,
  RuntimeQueue,
  SlashCommand,
  SubagentRun,
} from "../domain.js";
import type { BootstrapEvent, ConnectionReadyEvent, HelloEvent } from "./bootstrap.js";
import type { CommandResultEvent } from "./diagnostics.js";
import type { ReplayServerEvent } from "./replay.js";

export type ProjectServerEvent = { type: "project.list"; projects: Project[] } | { type: "project.created"; project: Project };

export type GitServerEvent = { type: "git.status"; status: GitRepositoryStatus };

export type SessionServerEvent =
  | { type: "session.list"; sessions: GuiSession[]; projectId?: string; hasMore?: boolean; nextCursor?: string; cursor?: string }
  | { type: "session.updated"; session: GuiSession };

export type RuntimeServerEvent =
  | { type: "runtime.status"; runtime: Runtime }
  | { type: "runtime.queue"; runtimeId: string; projectId: string; queue: RuntimeQueue }
  | { type: "runtime.commands"; runtimeId: string; projectId: string; commands: SlashCommand[] }
  | { type: "runtime.logs"; runtimeId: string; projectId: string; events: GuiEvent[]; hasMore?: boolean }
  | { type: "runtime.rpc.response"; runtimeId: string; projectId: string; command: string; success: boolean; data?: unknown; error?: string; label?: string };

export type ConversationServerEvent =
  | { type: "conversation.snapshot"; runtimeId: string; projectId: string; messages: ConversationMessage[]; contextUsage?: ConversationContextUsage; busy: boolean; hasMoreBefore: boolean }
  | { type: "conversation.page"; runtimeId: string; projectId: string; messages: ConversationMessage[]; beforeMessageId: string; hasMoreBefore: boolean }
  | { type: "conversation.message"; message: ConversationMessage }
  | { type: "conversation.delta"; delta: ConversationDelta }
  | { type: "conversation.context"; runtimeId: string; projectId: string; contextUsage: ConversationContextUsage }
  | { type: "conversation.busy"; runtimeId: string; projectId: string; busy: boolean };

export type CheckpointServerEvent =
  | { type: "checkpoint.list"; projectId: string; checkpoints: RewindCheckpointSummary[] }
  | { type: "checkpoint.captured"; projectId: string; checkpoint: RewindCheckpointSummary }
  | { type: "checkpoint.preview"; projectId: string; preview: RewindCheckpointPreview }
  | { type: "checkpoint.restored"; projectId: string; result: RewindCheckpointRestoreResult }
  | { type: "checkpoint.operation"; operation: RewindCheckpointOperation }
  | { type: "checkpoint.jumps"; projectId: string; jumps: RewindJumpHistoryEntry[] }
  | { type: "checkpoint.health"; projectId: string; health: RewindStorageHealth }
  | { type: "checkpoint.gc"; projectId: string; result: RewindGarbageCollectResult };

export type ExtensionUiServerEvent = { type: "extension.ui.request"; runtimeId: string; projectId: string; request: ExtensionUiRequest };

// Optional provider-agnostic child-agent events; absent/empty means no provider is active.
export type SubagentServerEvent =
  | { type: "subagent.snapshot"; runs: SubagentRun[] }
  | { type: "subagent.run"; run: SubagentRun }
  | { type: "subagent.detail"; runId: string; childRunId: string; messages: ConversationMessage[]; readAt: number; error?: string };

export type ServerEvent =
  | HelloEvent
  | BootstrapEvent
  | ConnectionReadyEvent
  | ReplayServerEvent
  | CommandResultEvent
  | ProjectServerEvent
  | GitServerEvent
  | SessionServerEvent
  | { type: "settings.updated"; settings: AppSettings }
  | RuntimeServerEvent
  | ConversationServerEvent
  | CheckpointServerEvent
  | ExtensionUiServerEvent
  | SubagentServerEvent;

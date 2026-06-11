import type { RuntimeProfileId } from "../capabilities.js";
import type { AppSettings, ExtensionUiResponse, GuiEventKind, PiRpcCommand, ResponseMode, RuntimeQueue, ThinkingLevel } from "../domain.js";

// ClientCommand is the frontend → server command bus. Keep this module focused
// on request shapes only; server push/state recovery events live in events.ts.
export type ClientCommand =
  | { type: "project.list"; requestId?: string }
  | { type: "project.create"; requestId?: string; name?: string; cwd: string; defaultModel?: string; defaultRuntimeProfileId?: RuntimeProfileId }
  | { type: "project.configure"; requestId?: string; projectId: string; defaultRuntimeProfileId?: RuntimeProfileId | null }
  | { type: "session.list"; requestId?: string; projectId?: string; limit?: number; cursor?: string }
  | { type: "session.resume"; requestId?: string; sessionId: string; model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode; runtimeProfileId?: RuntimeProfileId }
  | { type: "settings.get"; requestId?: string }
  | { type: "settings.update"; requestId?: string; settings: AppSettings }
  | { type: "runtime.start"; requestId?: string; projectId: string; model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode; runtimeProfileId?: RuntimeProfileId }
  | { type: "runtime.resume"; requestId?: string; runtimeId: string; model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode; runtimeProfileId?: RuntimeProfileId }
  | { type: "runtime.restart"; requestId?: string; runtimeId: string; model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode; runtimeProfileId?: RuntimeProfileId }
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
  | { type: "checkpoint.list"; requestId?: string; projectId: string }
  | { type: "checkpoint.capture"; requestId?: string; projectId: string }
  | { type: "checkpoint.preview"; requestId?: string; projectId: string; snapshotId: string }
  | { type: "checkpoint.restore"; requestId?: string; projectId: string; snapshotId: string; runtimeId?: string; entryId?: string }
  | { type: "checkpoint.jumps"; requestId?: string; projectId: string; limit?: number }
  | { type: "checkpoint.health"; requestId?: string; projectId: string }
  | { type: "checkpoint.gc"; requestId?: string; projectId: string; dryRun?: boolean; keepRecent?: number }
  // Optional provider-agnostic child-agent capability; unsupported providers may return no runs.
  | { type: "subagent.detail.open"; requestId?: string; runId: string; childRunId?: string; limit?: number }
  | { type: "event.replay"; requestId?: string; afterEventId?: number; limit?: number; projectId?: string; runtimeId?: string };

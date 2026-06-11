import type { ExtensionUiRequest, ResponseMode, Runtime, RuntimeProfileId, ThinkingLevel } from "@pi-gui/shared";
import type { ConversationProjection } from "./conversationProjection.js";
import type { PiRpcClient } from "./piRpcClient.js";
import type { SubagentRunProjection } from "./subagent/subagentRunProjection.js";

export type RuntimeConfigOptions = { model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode; runtimeProfileId?: RuntimeProfileId };

export type ManagedRuntime = {
  runtime: Runtime;
  client: PiRpcClient;
  serviceTierConfigFile?: string;
  enabledCapabilityIds: string[];
  stateRequestId?: string;
  stateRequestConfigRevision?: number;
  statsRequestId?: string;
  messageRequestId?: string;
  commandsRequestId?: string;
  pendingCompactStatsNotice?: { tokensBefore?: number };
  pendingNativeRpcCommands: Map<string, { command: string; label?: string }>;
  pendingExtensionUiRequest?: ExtensionUiRequest;
  pendingRewindPromptCheckpoint?: { projectId: string; snapshotId: string; sessionId?: string; promptText: string; createdAt: number };
  configRevision: number;
  projection: ConversationProjection;
  subagents: SubagentRunProjection;
};

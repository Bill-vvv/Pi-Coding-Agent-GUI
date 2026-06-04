import type { ResponseMode, Runtime, ThinkingLevel } from "@pi-gui/shared";
import type { ConversationProjection } from "./conversationProjection.js";
import type { PiRpcClient } from "./piRpcClient.js";
import type { SubagentRunProjection } from "./subagent/subagentRunProjection.js";

export type RuntimeConfigOptions = { model?: string; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode };

export type ManagedRuntime = {
  runtime: Runtime;
  client: PiRpcClient;
  serviceTierConfigFile?: string;
  stateRequestId?: string;
  stateRequestConfigRevision?: number;
  statsRequestId?: string;
  messageRequestId?: string;
  commandsRequestId?: string;
  pendingNativeRpcCommands: Map<string, { command: string; label?: string }>;
  configRevision: number;
  projection: ConversationProjection;
  subagents: SubagentRunProjection;
};

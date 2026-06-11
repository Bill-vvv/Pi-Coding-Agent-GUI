import type {
  AppSettings,
  ExecutionHostRef,
  GuiSession,
  Project,
  RewindCheckpointOperation,
  RewindJumpHistoryEntry,
  Runtime,
  RuntimeConversationSummary,
  SubagentRun,
} from "../domain.js";

// Bootstrap events define when the browser can trust snapshot state during a
// connection. `connection.ready` remains the final product-ready boundary.
export type HelloEvent = {
  type: "hello";
  serverTime: number;
  lastEventId: number;
  connectionId?: string;
  protocolVersion?: number;
  capabilities?: string[];
  projects?: Project[];
  runtimes?: Runtime[];
  settings?: AppSettings;
  executionHost?: ExecutionHostRef;
  conversationSummaries?: RuntimeConversationSummary[];
  sessions?: GuiSession[];
  sessionsHasMore?: boolean;
  sessionsNextCursor?: string;
  subagentRuns?: SubagentRun[];
  checkpointOperations?: RewindCheckpointOperation[];
  checkpointJumps?: RewindJumpHistoryEntry[];
};

export type BootstrapEvent =
  | { type: "bootstrap.begin"; connectionId: string; serverTime: number; lastEventId: number }
  | { type: "bootstrap.chunk"; connectionId: string; scope: "projects"; projects: Project[]; executionHost?: ExecutionHostRef }
  | { type: "bootstrap.chunk"; connectionId: string; scope: "runtimes"; runtimes: Runtime[] }
  | { type: "bootstrap.chunk"; connectionId: string; scope: "settings"; settings: AppSettings }
  | { type: "bootstrap.chunk"; connectionId: string; scope: "sessions"; sessions: GuiSession[]; hasMore?: boolean; nextCursor?: string }
  | { type: "bootstrap.chunk"; connectionId: string; scope: "conversationSummaries"; conversationSummaries: RuntimeConversationSummary[] }
  | { type: "bootstrap.chunk"; connectionId: string; scope: "subagents"; subagentRuns: SubagentRun[] }
  | { type: "bootstrap.chunk"; connectionId: string; scope: "checkpoints"; checkpointOperations: RewindCheckpointOperation[]; checkpointJumps: RewindJumpHistoryEntry[] }
  | { type: "bootstrap.complete"; connectionId: string; serverTime: number; lastEventId: number };

export type ConnectionReadyEvent = { type: "connection.ready"; serverTime: number; lastEventId: number; connectionId?: string };

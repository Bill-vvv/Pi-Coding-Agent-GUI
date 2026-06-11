import { isAbsolute } from "node:path";
import type { ClientCommand, RewindCheckpointSummary } from "@pi-gui/shared";
import { RewindSnapshotStore, rewindPreviewForWire, rewindRestoreResultForWire, rewindSnapshotSummaryForWire } from "../../services/rewind/index.js";
import type { WsClient } from "../wsHub.js";
import { sendCommandResult, type CommandHandlerContext } from "./types.js";

type CommandOf<TType extends ClientCommand["type"]> = Extract<ClientCommand, { type: TType }>;

export async function handleCheckpointList(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"checkpoint.list">): Promise<void> {
  const { project, store } = rewindStoreForProject(context, command.projectId);
  const checkpoints = await rebuildRewindCheckpointIndex(context, project.id, store);
  context.send(socket, { type: "checkpoint.list", projectId: project.id, checkpoints });
  sendCommandResult(context, socket, command, true, { checkpoints });
}

export async function handleCheckpointCapture(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"checkpoint.capture">): Promise<void> {
  const { project, store } = rewindStoreForProject(context, command.projectId);
  const checkpoint = rewindSnapshotSummaryForWire(project.id, await store.captureWorkspace());
  context.db.upsertRewindCheckpoint(checkpoint);
  context.db.upsertRewindCheckpointConversationLink({
    projectId: project.id,
    snapshotId: checkpoint.id,
    captureSource: "manual",
    createdAt: checkpoint.createdAt,
  });
  const operation = context.db.appendRewindCheckpointOperation({
    projectId: project.id,
    kind: "capture",
    snapshotId: checkpoint.id,
    createdAt: Date.now(),
    ok: true,
  });
  context.broadcast({ type: "checkpoint.captured", projectId: project.id, checkpoint });
  context.broadcast({ type: "checkpoint.operation", operation });
  sendCommandResult(context, socket, command, true, { checkpoint });
}

export async function handleCheckpointPreview(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"checkpoint.preview">): Promise<void> {
  const { project, store } = rewindStoreForProject(context, command.projectId);
  const preview = rewindPreviewForWire(project.id, await store.previewRestore(command.snapshotId));
  context.send(socket, { type: "checkpoint.preview", projectId: project.id, preview });
  sendCommandResult(context, socket, command, true, { preview });
}

export async function handleCheckpointJumps(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"checkpoint.jumps">): Promise<void> {
  const project = context.db.getProject(command.projectId);
  if (!project) throw new Error(`Project not found: ${command.projectId}`);
  const jumps = context.db.listRecentRewindJumpHistory(command.limit ?? 50, project.id);
  context.send(socket, { type: "checkpoint.jumps", projectId: project.id, jumps });
  sendCommandResult(context, socket, command, true, { jumps });
}

export async function handleCheckpointHealth(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"checkpoint.health">): Promise<void> {
  const { project, store } = rewindStoreForProject(context, command.projectId);
  const health = await store.storageHealth(project.id);
  context.send(socket, { type: "checkpoint.health", projectId: project.id, health });
  sendCommandResult(context, socket, command, true, { health });
}

export async function handleCheckpointGc(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"checkpoint.gc">): Promise<void> {
  const { project, store } = rewindStoreForProject(context, command.projectId);
  const result = await store.garbageCollect(project.id, { dryRun: command.dryRun, keepRecent: command.keepRecent });
  const operation = context.db.appendRewindCheckpointOperation({
    projectId: project.id,
    kind: "gc",
    snapshotId: "__gc__",
    createdAt: Date.now(),
    ok: true,
  });
  context.broadcast({ type: "checkpoint.gc", projectId: project.id, result });
  context.broadcast({ type: "checkpoint.operation", operation });
  sendCommandResult(context, socket, command, true, { result });
}

export async function handleCheckpointRestore(context: CommandHandlerContext, socket: WsClient, command: CommandOf<"checkpoint.restore">): Promise<void> {
  const { project, store } = rewindStoreForProject(context, command.projectId);
  const restoreTarget = resolveCheckpointConversationTarget(context, project.id, command.snapshotId, command.runtimeId, command.entryId);
  if (restoreTarget) assertCheckpointConversationTarget(context, project.id, command.snapshotId, restoreTarget.runtimeId);
  let result = rewindRestoreResultForWire(project.id, await store.restoreSnapshot(command.snapshotId));
  let jumpHistoryEntry:
    | {
        projectId: string;
        snapshotId: string;
        runtimeId: string;
        sourceSessionId?: string;
        targetEntryId: string;
        resultSessionId?: string;
        resultEntryId?: string;
        createdAt: number;
        ok: boolean;
        rollbackSnapshotId?: string;
        error?: string;
      }
    | undefined;
  if (result.rollbackSnapshotId) {
    const rollback = await store.loadSnapshot(result.rollbackSnapshotId).catch(() => undefined);
    if (rollback) {
      const rollbackCheckpoint = rewindSnapshotSummaryForWire(project.id, rollback);
      context.db.upsertRewindCheckpoint(rollbackCheckpoint);
      context.db.upsertRewindCheckpointConversationLink({
        projectId: project.id,
        snapshotId: rollbackCheckpoint.id,
        runtimeId: command.runtimeId,
        sessionId: currentRuntimeSessionId(context, command.runtimeId),
        captureSource: "rollback",
        createdAt: rollbackCheckpoint.createdAt,
      });
    }
  }

  if (result.ok && restoreTarget) {
    try {
      const fork = await context.supervisor.forkRuntime(restoreTarget.runtimeId, restoreTarget.entryId);
      jumpHistoryEntry = {
        projectId: project.id,
        snapshotId: command.snapshotId,
        runtimeId: fork.runtimeId,
        sourceSessionId: fork.sourceSessionId,
        targetEntryId: fork.targetEntryId,
        resultSessionId: fork.resultSessionId,
        resultEntryId: fork.resultEntryId,
        createdAt: Date.now(),
        ok: true,
        rollbackSnapshotId: result.rollbackSnapshotId,
      };
    } catch (error) {
      jumpHistoryEntry = {
        projectId: project.id,
        snapshotId: command.snapshotId,
        runtimeId: restoreTarget.runtimeId,
        sourceSessionId: currentRuntimeSessionId(context, restoreTarget.runtimeId),
        targetEntryId: restoreTarget.entryId,
        createdAt: Date.now(),
        ok: false,
        rollbackSnapshotId: result.rollbackSnapshotId,
        error: error instanceof Error ? error.message : String(error),
      };
      result = await rollbackAfterConversationFailure(project.id, command.snapshotId, store, result.rollbackSnapshotId, error);
    }
  }

  if (jumpHistoryEntry) context.db.appendRewindJumpHistory(jumpHistoryEntry);

  const operation = context.db.appendRewindCheckpointOperation({
    projectId: project.id,
    kind: "restore",
    snapshotId: result.snapshotId,
    createdAt: Date.now(),
    ok: result.ok,
    rollbackSnapshotId: result.rollbackSnapshotId,
    error: result.error,
  });

  context.broadcast({ type: "checkpoint.restored", projectId: project.id, result });
  context.broadcast({ type: "checkpoint.operation", operation });
  sendCommandResult(context, socket, command, result.ok, { result }, result.ok ? undefined : result.error);
}

function currentRuntime(context: CommandHandlerContext, runtimeId: string | undefined): { id: string; projectId: string; sessionId?: string } | undefined {
  if (!runtimeId) return undefined;
  const supervisor = context.supervisor as { getRuntime?: (id: string) => { id: string; projectId: string; sessionId?: string } | undefined };
  return supervisor.getRuntime?.(runtimeId);
}

function currentRuntimeSessionId(context: CommandHandlerContext, runtimeId: string | undefined): string | undefined {
  return currentRuntime(context, runtimeId)?.sessionId;
}

function resolveCheckpointConversationTarget(context: CommandHandlerContext, projectId: string, snapshotId: string, runtimeId: string | undefined, entryId: string | undefined): { runtimeId: string; entryId: string } | undefined {
  if (runtimeId && entryId) return { runtimeId, entryId };
  if (!runtimeId) return undefined;
  const link = context.db.getRewindCheckpointConversationLink(projectId, snapshotId);
  if (!link?.targetEntryId) return undefined;
  return { runtimeId, entryId: link.targetEntryId };
}

function assertCheckpointConversationTarget(context: CommandHandlerContext, projectId: string, snapshotId: string, runtimeId: string): void {
  const runtime = currentRuntime(context, runtimeId);
  if (!runtime) throw new Error(`Runtime not found: ${runtimeId}`);
  if (runtime.projectId !== projectId) throw new Error(`Checkpoint restore runtime belongs to a different project: ${runtimeId}`);

  const link = context.db.getRewindCheckpointConversationLink(projectId, snapshotId);
  if (!link) {
    throw new Error(`Checkpoint ${snapshotId} has no persisted conversation link; restore files only or use a prompt-captured checkpoint.`);
  }
  if (link.captureSource === "manual" && !link.runtimeId && !link.sessionId) {
    throw new Error(`Checkpoint ${snapshotId} was captured without conversation ownership metadata; restore files only or use a prompt-captured checkpoint.`);
  }
  if (link.sessionId) {
    if (!runtime.sessionId) {
      throw new Error(`Checkpoint ${snapshotId} belongs to Pi session ${link.sessionId}; resume that session before restoring the conversation branch.`);
    }
    if (runtime.sessionId !== link.sessionId) {
      throw new Error(`Checkpoint ${snapshotId} belongs to Pi session ${link.sessionId}, but runtime ${runtimeId} is using ${runtime.sessionId}.`);
    }
    return;
  }
  if (link.runtimeId && link.runtimeId !== runtimeId) {
    throw new Error(`Checkpoint ${snapshotId} belongs to runtime ${link.runtimeId}; use that runtime for conversation restore.`);
  }
}

function rewindStoreForProject(context: CommandHandlerContext, projectId: string) {
  const project = context.db.getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (!isAbsolute(project.cwd)) throw new Error(`Rewind checkpoints require a local project cwd: ${project.cwd}`);
  return { project, store: new RewindSnapshotStore({ root: project.cwd }) };
}

async function rollbackAfterConversationFailure(projectId: string, targetSnapshotId: string, store: RewindSnapshotStore, rollbackSnapshotId: string | undefined, error: unknown) {
  const forkError = error instanceof Error ? error.message : String(error);
  if (!rollbackSnapshotId) {
    return { projectId, snapshotId: targetSnapshotId, ok: false, applied: [], error: `Conversation fork failed after file restore and no rollback snapshot was available: ${forkError}` };
  }
  const rollback = rewindRestoreResultForWire(projectId, await store.restoreSnapshot(rollbackSnapshotId));
  return {
    ...rollback,
    snapshotId: targetSnapshotId,
    ok: false,
    error: rollback.ok
      ? `Conversation fork failed after file restore; workspace was rolled back: ${forkError}`
      : `Conversation fork failed after file restore and workspace rollback failed: ${forkError}; rollback error: ${rollback.error ?? "unknown"}`,
  };
}

async function rebuildRewindCheckpointIndex(context: CommandHandlerContext, projectId: string, store: RewindSnapshotStore): Promise<RewindCheckpointSummary[]> {
  const checkpointSummaries = (await store.listSnapshots()).map((snapshot) => rewindSnapshotSummaryForWire(projectId, snapshot));
  context.db.replaceProjectRewindCheckpoints(projectId, checkpointSummaries);
  return context.db.listRewindCheckpoints(projectId);
}


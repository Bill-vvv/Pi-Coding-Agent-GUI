import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, Runtime, ServerEvent } from "@pi-gui/shared";
import type { GuiSocketSend } from "../types";

type RestoreConversationTarget = {
  runtimeId: string;
  entryId: string;
};

type UseCheckpointControlsOptions = {
  open: boolean;
  selectedProject?: Project;
  send: GuiSocketSend;
};

export function useCheckpointControls({ open, selectedProject, send }: UseCheckpointControlsOptions) {
  const [previewSnapshotId, setPreviewSnapshotId] = useState<string | undefined>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [loadingJumps, setLoadingJumps] = useState(false);
  const [pendingCapture, setPendingCapture] = useState(false);
  const [pendingRestoreSnapshotId, setPendingRestoreSnapshotId] = useState<string | undefined>();
  const [pendingGcMode, setPendingGcMode] = useState<"dry-run" | "run" | undefined>();
  const selectedProjectIdRef = useRef<string | undefined>(selectedProject?.id);
  const previewSnapshotIdRef = useRef<string | undefined>(previewSnapshotId);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProject?.id;
  }, [selectedProject?.id]);

  useEffect(() => {
    previewSnapshotIdRef.current = previewSnapshotId;
  }, [previewSnapshotId]);

  const refreshCheckpointList = useCallback((projectId = selectedProjectIdRef.current) => {
    if (!projectId) return;
    setLoadingList(true);
    if (!send({ type: "checkpoint.list", projectId }, { notifyOnDisconnected: false })) setLoadingList(false);
  }, [send]);

  const refreshCheckpointHealth = useCallback((projectId = selectedProjectIdRef.current) => {
    if (!projectId) return;
    setLoadingHealth(true);
    if (!send({ type: "checkpoint.health", projectId }, { notifyOnDisconnected: false })) setLoadingHealth(false);
  }, [send]);

  const refreshCheckpointJumps = useCallback((projectId = selectedProjectIdRef.current) => {
    if (!projectId) return;
    setLoadingJumps(true);
    if (!send({ type: "checkpoint.jumps", projectId, limit: 20 }, { notifyOnDisconnected: false })) setLoadingJumps(false);
  }, [send]);

  const refreshAllCheckpointData = useCallback((projectId = selectedProjectIdRef.current) => {
    refreshCheckpointList(projectId);
    refreshCheckpointHealth(projectId);
    refreshCheckpointJumps(projectId);
  }, [refreshCheckpointHealth, refreshCheckpointJumps, refreshCheckpointList]);

  useEffect(() => {
    if (!open) return;
    if (!selectedProject?.id) {
      setPreviewSnapshotId(undefined);
      setPreviewLoading(false);
      return;
    }
    setPreviewSnapshotId(undefined);
    setPreviewLoading(false);
    refreshAllCheckpointData(selectedProject.id);
  }, [open, refreshAllCheckpointData, selectedProject?.id]);

  const captureCheckpoint = useCallback(() => {
    const projectId = selectedProjectIdRef.current;
    if (!projectId) return;
    setPendingCapture(true);
    if (!send({ type: "checkpoint.capture", projectId })) setPendingCapture(false);
  }, [send]);

  const openPreview = useCallback((snapshotId: string) => {
    const projectId = selectedProjectIdRef.current;
    if (!projectId) return;
    setPreviewSnapshotId(snapshotId);
    setPreviewLoading(true);
    if (!send({ type: "checkpoint.preview", projectId, snapshotId })) setPreviewLoading(false);
  }, [send]);

  const closePreview = useCallback(() => {
    setPreviewSnapshotId(undefined);
    setPreviewLoading(false);
  }, []);

  const restoreCheckpoint = useCallback((snapshotId: string, target?: RestoreConversationTarget) => {
    const projectId = selectedProjectIdRef.current;
    if (!projectId) return;
    setPendingRestoreSnapshotId(snapshotId);
    if (!send({ type: "checkpoint.restore", projectId, snapshotId, runtimeId: target?.runtimeId, entryId: target?.entryId })) {
      setPendingRestoreSnapshotId(undefined);
    }
  }, [send]);

  const runCheckpointGc = useCallback((dryRun: boolean) => {
    const projectId = selectedProjectIdRef.current;
    if (!projectId) return;
    setPendingGcMode(dryRun ? "dry-run" : "run");
    if (!send({ type: "checkpoint.gc", projectId, dryRun, keepRecent: 20 })) setPendingGcMode(undefined);
  }, [send]);

  const handleCheckpointServerEvent = useCallback((event: ServerEvent) => {
    const projectId = selectedProjectIdRef.current;
    switch (event.type) {
      case "checkpoint.list":
        if (event.projectId === projectId) setLoadingList(false);
        return;
      case "checkpoint.preview":
        if (event.projectId === projectId && event.preview.snapshotId === previewSnapshotIdRef.current) setPreviewLoading(false);
        return;
      case "checkpoint.health":
        if (event.projectId === projectId) setLoadingHealth(false);
        return;
      case "checkpoint.jumps":
        if (event.projectId === projectId) setLoadingJumps(false);
        return;
      case "checkpoint.captured":
        if (event.projectId !== projectId) return;
        setPendingCapture(false);
        refreshCheckpointHealth(event.projectId);
        return;
      case "checkpoint.restored":
        if (event.projectId !== projectId) return;
        setPendingRestoreSnapshotId(undefined);
        refreshCheckpointList(event.projectId);
        refreshCheckpointHealth(event.projectId);
        refreshCheckpointJumps(event.projectId);
        if (event.result.ok && event.result.snapshotId === previewSnapshotIdRef.current) closePreview();
        return;
      case "checkpoint.gc":
        if (event.projectId !== projectId) return;
        setPendingGcMode(undefined);
        setLoadingHealth(false);
        refreshCheckpointList(event.projectId);
        return;
      case "command.result":
        switch (event.command) {
          case "checkpoint.capture":
            if (!event.success) setPendingCapture(false);
            return;
          case "checkpoint.preview":
            if (!event.success) setPreviewLoading(false);
            return;
          case "checkpoint.restore":
            if (!event.success) setPendingRestoreSnapshotId(undefined);
            return;
          case "checkpoint.list":
            if (!event.success) setLoadingList(false);
            return;
          case "checkpoint.health":
            if (!event.success) setLoadingHealth(false);
            return;
          case "checkpoint.jumps":
            if (!event.success) setLoadingJumps(false);
            return;
          case "checkpoint.gc":
            if (!event.success) setPendingGcMode(undefined);
            return;
          default:
            return;
        }
      default:
        return;
    }
  }, [closePreview, refreshCheckpointHealth, refreshCheckpointJumps, refreshCheckpointList]);

  return {
    previewSnapshotId,
    previewLoading,
    loadingList,
    loadingHealth,
    loadingJumps,
    pendingCapture,
    pendingRestoreSnapshotId,
    pendingGcMode,
    refreshAllCheckpointData,
    refreshCheckpointHealth,
    refreshCheckpointJumps,
    captureCheckpoint,
    openPreview,
    closePreview,
    restoreCheckpoint,
    runCheckpointGc,
    handleCheckpointServerEvent,
  };
}

export function checkpointConversationRestoreTarget(checkpoint: { runtimeId?: string; sessionId?: string; targetEntryId?: string }, activeRuntime?: Runtime): RestoreConversationTarget | undefined {
  if (!checkpoint.targetEntryId || !activeRuntime) return undefined;
  if (checkpoint.sessionId) {
    if (!activeRuntime.sessionId || activeRuntime.sessionId !== checkpoint.sessionId) return undefined;
    return { runtimeId: activeRuntime.id, entryId: checkpoint.targetEntryId };
  }
  if (checkpoint.runtimeId && checkpoint.runtimeId !== activeRuntime.id) return undefined;
  return { runtimeId: activeRuntime.id, entryId: checkpoint.targetEntryId };
}

import type { ExtensionUiRequest, ExtensionUiResponse, GuiSession, Project, RewindCheckpoint, Runtime } from "@pi-gui/shared";
import type { ConnectionState, DirectoryEntry } from "../types";
import { CheckpointPanel } from "./CheckpointPanel";
import { ExtensionUiDialog } from "./ExtensionUiDialog";
import { PathPickerModal } from "./PathPickerModal";
import { SessionHistoryModal } from "./SessionHistoryModal";

type PathPickerState = {
  open: boolean;
  cwd: string;
  parent?: string;
  entries: DirectoryEntry[];
  loading: boolean;
  error?: string;
  closePicker: () => void;
  loadDirectory: (path?: string) => void | Promise<void>;
};

type AppModalsProps = {
  extensionUiRequest?: ExtensionUiRequest;
  onRespondExtensionUi: (response: ExtensionUiResponse) => void;
  sessionHistoryProject?: Project;
  sessions: GuiSession[];
  checkpointPanelProject?: Project;
  checkpointPanelRuntime?: Runtime;
  checkpoints: RewindCheckpoint[];
  pendingCheckpointActionId?: string;
  runtimes: Runtime[];
  connection: ConnectionState;
  pendingHistoryRestoreId?: string;
  onCloseSessionHistory: () => void;
  onResumeSession: (sessionId: string) => void;
  onSelectRuntime: (projectId: string, runtimeId: string) => void;
  onCloseCheckpointPanel: () => void;
  onRefreshCheckpoints: () => void;
  onRestoreCheckpoint: (checkpointId: string, restoreFiles: boolean) => void;
  onFastForwardCheckpoint: (restoreFiles: boolean) => void;
  pathPicker: PathPickerState;
  onChoosePickerCwd: () => void;
  pathPickerTitle: string;
  pathPickerConfirmLabel: string;
};

export function AppModals({
  extensionUiRequest,
  onRespondExtensionUi,
  sessionHistoryProject,
  sessions,
  checkpointPanelProject,
  checkpointPanelRuntime,
  checkpoints,
  pendingCheckpointActionId,
  runtimes,
  connection,
  pendingHistoryRestoreId,
  onCloseSessionHistory,
  onResumeSession,
  onSelectRuntime,
  onCloseCheckpointPanel,
  onRefreshCheckpoints,
  onRestoreCheckpoint,
  onFastForwardCheckpoint,
  pathPicker,
  onChoosePickerCwd,
  pathPickerTitle,
  pathPickerConfirmLabel,
}: AppModalsProps) {
  return (
    <>
      <ExtensionUiDialog
        request={extensionUiRequest}
        onRespond={onRespondExtensionUi}
        onCancel={() => onRespondExtensionUi({ cancelled: true })}
      />

      <SessionHistoryModal
        open={Boolean(sessionHistoryProject)}
        project={sessionHistoryProject}
        sessions={sessions}
        runtimes={runtimes}
        connection={connection}
        pendingRestoreId={pendingHistoryRestoreId}
        onClose={onCloseSessionHistory}
        onResumeSession={onResumeSession}
        onSelectRuntime={onSelectRuntime}
      />

      <CheckpointPanel
        open={Boolean(checkpointPanelProject)}
        project={checkpointPanelProject}
        runtime={checkpointPanelRuntime}
        checkpoints={checkpoints}
        connection={connection}
        pendingActionId={pendingCheckpointActionId}
        onClose={onCloseCheckpointPanel}
        onRefresh={onRefreshCheckpoints}
        onRestore={onRestoreCheckpoint}
        onFastForward={onFastForwardCheckpoint}
      />

      <PathPickerModal
        open={pathPicker.open}
        cwd={pathPicker.cwd}
        parent={pathPicker.parent}
        entries={pathPicker.entries}
        loading={pathPicker.loading}
        error={pathPicker.error}
        onClose={pathPicker.closePicker}
        onLoadDirectory={pathPicker.loadDirectory}
        onChooseCurrentCwd={onChoosePickerCwd}
        title={pathPickerTitle}
        confirmLabel={pathPickerConfirmLabel}
      />
    </>
  );
}

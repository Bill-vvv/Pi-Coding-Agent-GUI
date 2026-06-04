import type { ExtensionUiRequest, ExtensionUiResponse, GuiSession, Project, Runtime } from "@pi-gui/shared";
import type { ConnectionState, DirectoryEntry, UiPreferences } from "../types";
import { ExtensionUiDialog } from "./ExtensionUiDialog";
import { PathPickerModal } from "./PathPickerModal";
import { SessionHistoryModal } from "./SessionHistoryModal";
import { SettingsModal } from "./SettingsModal";

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
  settingsOpen: boolean;
  preferences: UiPreferences;
  onCloseSettings: () => void;
  onChangePreferences: (preferences: UiPreferences) => void;
  sessionHistoryProject?: Project;
  sessions: GuiSession[];
  runtimes: Runtime[];
  connection: ConnectionState;
  pendingHistoryRestoreId?: string;
  onCloseSessionHistory: () => void;
  onResumeSession: (sessionId: string) => void;
  onSelectRuntime: (projectId: string, runtimeId: string) => void;
  pathPicker: PathPickerState;
  onChoosePickerCwd: () => void;
  pathPickerTitle: string;
  pathPickerConfirmLabel: string;
};

export function AppModals({
  extensionUiRequest,
  onRespondExtensionUi,
  settingsOpen,
  preferences,
  onCloseSettings,
  onChangePreferences,
  sessionHistoryProject,
  sessions,
  runtimes,
  connection,
  pendingHistoryRestoreId,
  onCloseSessionHistory,
  onResumeSession,
  onSelectRuntime,
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

      <SettingsModal
        open={settingsOpen}
        preferences={preferences}
        onClose={onCloseSettings}
        onChangePreferences={onChangePreferences}
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

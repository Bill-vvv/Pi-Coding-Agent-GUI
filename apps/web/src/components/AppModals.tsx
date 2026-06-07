import type { DirectoryEntry, ExtensionUiRequest, ExtensionUiResponse, ResolvedPath } from "@pi-gui/shared";
import { ExtensionUiDialog } from "./ExtensionUiDialog";
import { PathPickerModal } from "./PathPickerModal";

type PathPickerState = {
  open: boolean;
  cwd: string;
  parent?: string;
  entries: DirectoryEntry[];
  loading: boolean;
  resolving: boolean;
  creatingDirectory: boolean;
  error?: string;
  manualPath: string;
  resolvedPath?: ResolvedPath;
  setManualPath: (path: string) => void;
  closePicker: () => void;
  loadDirectory: (path?: string) => void | Promise<void>;
  resolveManualPath: (path?: string) => Promise<ResolvedPath | undefined>;
  createDirectory: (name: string, parent?: string) => Promise<boolean>;
};

type AppModalsProps = {
  extensionUiRequest?: ExtensionUiRequest;
  onRespondExtensionUi: (response: ExtensionUiResponse) => void;
  pathPicker: PathPickerState;
  onChoosePickerCwd: () => void | Promise<void>;
  pathPickerTitle: string;
  pathPickerConfirmLabel: string;
  pathPickerAllowCreateFolder: boolean;
};

export function AppModals({
  extensionUiRequest,
  onRespondExtensionUi,
  pathPicker,
  onChoosePickerCwd,
  pathPickerTitle,
  pathPickerConfirmLabel,
  pathPickerAllowCreateFolder,
}: AppModalsProps) {
  return (
    <>
      <ExtensionUiDialog
        request={extensionUiRequest}
        onRespond={onRespondExtensionUi}
        onCancel={() => onRespondExtensionUi({ cancelled: true })}
      />

      <PathPickerModal
        open={pathPicker.open}
        cwd={pathPicker.cwd}
        parent={pathPicker.parent}
        entries={pathPicker.entries}
        loading={pathPicker.loading}
        resolving={pathPicker.resolving}
        creatingDirectory={pathPicker.creatingDirectory}
        error={pathPicker.error}
        manualPath={pathPicker.manualPath}
        resolvedPath={pathPicker.resolvedPath}
        onManualPathChange={pathPicker.setManualPath}
        onResolveManualPath={pathPicker.resolveManualPath}
        onClose={pathPicker.closePicker}
        onLoadDirectory={pathPicker.loadDirectory}
        onChooseCurrentCwd={onChoosePickerCwd}
        onCreateDirectory={pathPicker.createDirectory}
        title={pathPickerTitle}
        confirmLabel={pathPickerConfirmLabel}
        allowCreateFolder={pathPickerAllowCreateFolder}
      />
    </>
  );
}

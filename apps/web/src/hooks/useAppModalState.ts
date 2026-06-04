import { useState } from "react";

export function useAppModalState() {
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return {
    modelPickerOpen,
    setModelPickerOpen,
    settingsOpen,
    setSettingsOpen,
    toggleModelPicker: () => setModelPickerOpen((value) => !value),
    closeModelPicker: () => setModelPickerOpen(false),
    closeSettings: () => setSettingsOpen(false),
  };
}

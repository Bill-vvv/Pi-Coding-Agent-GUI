import { useEffect, useState } from "react";
import { effectiveGuiKeybindings, eventMatchesKeyCombos, type GuiKeybindingMap } from "../domain/keybindings";

type UseCommandMenuHotkeyOptions = {
  onOpenCommandMenu?: () => void;
  onOpenSettings?: () => void;
  keybindings?: GuiKeybindingMap;
};

export function useCommandMenuHotkey({ onOpenCommandMenu, onOpenSettings, keybindings }: UseCommandMenuHotkeyOptions = {}): number {
  const [commandMenuOpenSignal, setCommandMenuOpenSignal] = useState(0);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const effective = effectiveGuiKeybindings(keybindings);
      if (eventMatchesKeyCombos(event, effective["app.commandMenu.open"])) {
        event.preventDefault();
        onOpenCommandMenu?.();
        setCommandMenuOpenSignal((value) => value + 1);
        return;
      }
      if (eventMatchesKeyCombos(event, effective["app.settings.open"])) {
        event.preventDefault();
        onOpenSettings?.();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [keybindings, onOpenCommandMenu, onOpenSettings]);

  return commandMenuOpenSignal;
}

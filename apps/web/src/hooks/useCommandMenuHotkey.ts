import { useEffect, useState } from "react";

export function useCommandMenuHotkey(): number {
  const [commandMenuOpenSignal, setCommandMenuOpenSignal] = useState(0);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandMenuOpenSignal((value) => value + 1);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return commandMenuOpenSignal;
}

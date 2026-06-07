import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

const SETTINGS_SCROLLBAR_VISIBLE_MS = 900;
const SCROLL_INTERACTION_KEYS = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "]);

export function useSettingsScrollbar() {
  const [isVisible, setIsVisible] = useState(false);
  const hideTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  const reveal = useCallback(() => {
    setIsVisible(true);
    if (hideTimerRef.current !== undefined) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = undefined;
      setIsVisible(false);
    }, SETTINGS_SCROLLBAR_VISIBLE_MS);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (SCROLL_INTERACTION_KEYS.has(event.key)) reveal();
    },
    [reveal],
  );

  return { isVisible, reveal, handleKeyDown };
}

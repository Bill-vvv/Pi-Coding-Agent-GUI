import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export function ScrollableContent({ className, children }: { className: string; children: ReactNode }) {
  const scrollbar = useStealthScrollbar();

  return (
    <div
      className={`${className} stealth-scroll${scrollbar.isVisible ? " is-scrolling" : ""}`}
      tabIndex={0}
      onKeyDown={scrollbar.handleKeyDown}
      onScrollCapture={scrollbar.reveal}
      onTouchMove={scrollbar.reveal}
      onWheel={scrollbar.reveal}
    >
      {children}
    </div>
  );
}

export function ScrollablePre({ children }: { children: string }) {
  const scrollbar = useStealthScrollbar();

  return (
    <pre
      className={`stealth-scroll${scrollbar.isVisible ? " is-scrolling" : ""}`}
      tabIndex={0}
      onKeyDown={scrollbar.handleKeyDown}
      onScrollCapture={scrollbar.reveal}
      onTouchMove={scrollbar.reveal}
      onWheel={scrollbar.reveal}
    >
      {children}
    </pre>
  );
}

export function useStealthScrollbar() {
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
    }, STEALTH_SCROLLBAR_VISIBLE_MS);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (SCROLL_INTERACTION_KEYS.has(event.key)) reveal();
    },
    [reveal],
  );

  return { isVisible, reveal, handleKeyDown };
}

const STEALTH_SCROLLBAR_VISIBLE_MS = 900;
const SCROLL_INTERACTION_KEYS = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "]);

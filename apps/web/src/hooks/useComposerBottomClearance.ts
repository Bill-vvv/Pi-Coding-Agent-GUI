import { useLayoutEffect, type RefObject } from "react";

type UseComposerBottomClearanceOptions = {
  containerRef: RefObject<HTMLElement | null>;
  composerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onClearanceChange?: () => void;
};

const COMPOSER_MEASURED_CLEARANCE_PROPERTY = "--composer-measured-clearance";

export function useComposerBottomClearance({ containerRef, composerRef, enabled, onClearanceChange }: UseComposerBottomClearanceOptions): void {
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) {
      container?.style.removeProperty(COMPOSER_MEASURED_CLEARANCE_PROPERTY);
      return undefined;
    }

    let animationFrame: number | undefined;
    let lastClearance: number | undefined;

    const measure = () => {
      animationFrame = undefined;
      const composer = composerRef.current;
      if (!composer) {
        container.style.removeProperty(COMPOSER_MEASURED_CLEARANCE_PROPERTY);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      const clearance = Math.max(0, Math.ceil(containerRect.bottom - composerRect.top));
      container.style.setProperty(COMPOSER_MEASURED_CLEARANCE_PROPERTY, `${clearance}px`);
      if (clearance !== lastClearance) {
        lastClearance = clearance;
        onClearanceChange?.();
      }
    };

    const scheduleMeasure = () => {
      if (animationFrame !== undefined) return;
      animationFrame = window.requestAnimationFrame(measure);
    };

    measure();
    scheduleMeasure();

    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleMeasure);
    const composer = composerRef.current;
    if (composer) resizeObserver?.observe(composer);
    resizeObserver?.observe(container);

    window.addEventListener("resize", scheduleMeasure);
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener("resize", scheduleMeasure);
    visualViewport?.addEventListener("scroll", scheduleMeasure);

    return () => {
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      visualViewport?.removeEventListener("resize", scheduleMeasure);
      visualViewport?.removeEventListener("scroll", scheduleMeasure);
      container.style.removeProperty(COMPOSER_MEASURED_CLEARANCE_PROPERTY);
    };
  }, [composerRef, containerRef, enabled, onClearanceChange]);
}

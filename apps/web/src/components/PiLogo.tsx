import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const SVG_WIDTH = 70;
const SVG_HEIGHT = 42;
const DOT_CENTER_X = 42.65;
const DOT_CENTER_Y = 8.3;
const FULL_OVERLAY_SIZE = 160;
const FULL_OVERLAY_CENTER = FULL_OVERLAY_SIZE / 2;
const MINI_DWELL_MS = 420;
const MINI_DURATION_MS = 820;
const FULL_DURATION_MS = 2800;

type PiLogoState = "idle" | "mini" | "full";
type OverlayBounds = { left: number; top: number };

type PiLogoProps = {
  compactMode?: boolean;
  compactExpanded?: boolean;
  onToggleCompact?: () => void;
};

export function PiLogo({ compactMode = false, compactExpanded = false, onToggleCompact }: PiLogoProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dwellTimerRef = useRef<number | undefined>(undefined);
  const miniTimerRef = useRef<number | undefined>(undefined);
  const fullTimerRef = useRef<number | undefined>(undefined);
  const miniPlayedInSessionRef = useRef(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const [logoStateValue, setLogoStateValue] = useState<PiLogoState>("idle");
  const logoStateRef = useRef<PiLogoState>("idle");
  const [overlayBounds, setOverlayBounds] = useState<OverlayBounds | undefined>();

  function setLogoState(nextState: PiLogoState) {
    logoStateRef.current = nextState;
    setLogoStateValue(nextState);
  }

  function clearDwellTimer() {
    if (dwellTimerRef.current === undefined) return;
    window.clearTimeout(dwellTimerRef.current);
    dwellTimerRef.current = undefined;
  }

  function clearMiniTimer() {
    if (miniTimerRef.current === undefined) return;
    window.clearTimeout(miniTimerRef.current);
    miniTimerRef.current = undefined;
  }

  function clearFullTimer() {
    if (fullTimerRef.current === undefined) return;
    window.clearTimeout(fullTimerRef.current);
    fullTimerRef.current = undefined;
  }

  function stopDecorativeAnimation() {
    clearDwellTimer();
    clearMiniTimer();
    clearFullTimer();
    miniPlayedInSessionRef.current = false;
    setOverlayBounds(undefined);
    setLogoState("idle");
  }

  useEffect(() => {
    return () => {
      clearDwellTimer();
      clearMiniTimer();
      clearFullTimer();
    };
  }, []);

  useEffect(() => {
    if (!prefersReducedMotion && !compactMode) return;
    stopDecorativeAnimation();
  }, [prefersReducedMotion, compactMode]);

  function scheduleMiniAnimation() {
    if (compactMode || prefersReducedMotion || miniPlayedInSessionRef.current || logoStateRef.current !== "idle") return;
    clearDwellTimer();
    dwellTimerRef.current = window.setTimeout(() => {
      dwellTimerRef.current = undefined;
      beginMiniAnimation();
    }, MINI_DWELL_MS);
  }

  function beginMiniAnimation() {
    if (compactMode || prefersReducedMotion || miniPlayedInSessionRef.current || logoStateRef.current !== "idle") return;
    miniPlayedInSessionRef.current = true;
    clearMiniTimer();
    setLogoState("mini");
    miniTimerRef.current = window.setTimeout(() => {
      miniTimerRef.current = undefined;
      if (logoStateRef.current === "mini") setLogoState("idle");
    }, MINI_DURATION_MS);
  }

  function beginFullAnimation() {
    if (compactMode) {
      onToggleCompact?.();
      return;
    }
    if (prefersReducedMotion || logoStateRef.current === "full") return;

    clearDwellTimer();
    clearMiniTimer();
    clearFullTimer();
    miniPlayedInSessionRef.current = true;
    setOverlayBounds(measureOverlayBounds());
    setLogoState("full");
    fullTimerRef.current = window.setTimeout(() => {
      fullTimerRef.current = undefined;
      setOverlayBounds(undefined);
      setLogoState("idle");
    }, FULL_DURATION_MS);
  }

  function measureOverlayBounds(): OverlayBounds {
    const svgRect = svgRef.current?.getBoundingClientRect();
    if (svgRect) {
      const dotX = svgRect.left + (DOT_CENTER_X / SVG_WIDTH) * svgRect.width;
      const dotY = svgRect.top + (DOT_CENTER_Y / SVG_HEIGHT) * svgRect.height;
      return {
        left: dotX - FULL_OVERLAY_SIZE / 2,
        top: dotY - FULL_OVERLAY_SIZE / 2,
      };
    }

    const buttonRect = buttonRef.current?.getBoundingClientRect();
    if (!buttonRect) return { left: 0, top: 0 };
    return {
      left: buttonRect.left + buttonRect.width / 2 - FULL_OVERLAY_SIZE / 2,
      top: buttonRect.top + buttonRect.height / 2 - FULL_OVERLAY_SIZE / 2,
    };
  }

  function handlePointerEnter(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "touch") return;
    miniPlayedInSessionRef.current = false;
    scheduleMiniAnimation();
  }

  function handlePointerLeave() {
    clearDwellTimer();
    miniPlayedInSessionRef.current = false;
  }

  function handleFocus() {
    miniPlayedInSessionRef.current = false;
    scheduleMiniAnimation();
  }

  function handleBlur() {
    clearDwellTimer();
    miniPlayedInSessionRef.current = false;
  }

  const compactLabel = compactExpanded ? "收起侧边栏" : "展开侧边栏";
  const buttonTitle = compactMode ? compactLabel : "Pi GUI";
  const buttonAriaLabel = compactMode ? compactLabel : "Pi GUI 标志动画";
  const buttonClassName = [
    "sidebar-logo-button",
    "pi-logo-button",
    `is-${logoStateValue}`,
    compactMode ? "is-compact-toggle" : "",
    prefersReducedMotion ? "is-reduced-motion" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <button
        ref={buttonRef}
        className={buttonClassName}
        type="button"
        title={buttonTitle}
        aria-label={buttonAriaLabel}
        aria-expanded={compactMode ? compactExpanded : undefined}
        onClick={beginFullAnimation}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <span className="pi-logo-stage" aria-hidden="true">
          <svg ref={svgRef} className="pi-logo-svg" viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} focusable="false">
            <PiWordmarkBody />
          </svg>
          <PiLogoCore className="pi-logo-core-local" />
        </span>
      </button>
      {logoStateValue === "full" && overlayBounds ? <PiLogoFullOverlay bounds={overlayBounds} /> : null}
    </>
  );
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return prefersReducedMotion;
}

function PiLogoFullOverlay({ bounds }: { bounds: OverlayBounds }) {
  if (typeof document === "undefined") return null;

  const style = {
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
  } satisfies CSSProperties;
  const wordmarkOffsetX = FULL_OVERLAY_CENTER - DOT_CENTER_X;
  const wordmarkOffsetY = FULL_OVERLAY_CENTER - DOT_CENTER_Y;

  return createPortal(
    <span className="pi-logo-full-overlay" style={style} aria-hidden="true">
      <svg className="pi-logo-full-svg" viewBox={`0 0 ${FULL_OVERLAY_SIZE} ${FULL_OVERLAY_SIZE}`} focusable="false">
        <defs>
          <clipPath id="pi-logo-slice-p-left">
            <rect x="0" y="0" width="22" height="42" />
          </clipPath>
          <clipPath id="pi-logo-slice-p-bowl">
            <rect x="14" y="0" width="29" height="29" />
          </clipPath>
          <clipPath id="pi-logo-slice-p-base">
            <rect x="0" y="24" width="36" height="18" />
          </clipPath>
          <clipPath id="pi-logo-slice-i">
            <rect x="36" y="0" width="22" height="42" />
          </clipPath>
        </defs>
        <g className="pi-logo-overlay-position" transform={`translate(${wordmarkOffsetX} ${wordmarkOffsetY})`}>
          <g className="pi-logo-full-body">
            <PiWordmarkBody />
          </g>
          <g className="pi-logo-gravity-slices">
            <g className="pi-logo-gravity-slice pi-logo-slice-p-left" clipPath="url(#pi-logo-slice-p-left)">
              <PiWordmarkBody />
            </g>
            <g className="pi-logo-gravity-slice pi-logo-slice-p-bowl" clipPath="url(#pi-logo-slice-p-bowl)">
              <PiWordmarkBody />
            </g>
            <g className="pi-logo-gravity-slice pi-logo-slice-p-base" clipPath="url(#pi-logo-slice-p-base)">
              <PiWordmarkBody />
            </g>
            <g className="pi-logo-gravity-slice pi-logo-slice-i" clipPath="url(#pi-logo-slice-i)">
              <PiWordmarkBody />
            </g>
          </g>
          <g className="pi-logo-reveal-body">
            <PiWordmarkBody />
          </g>
        </g>
      </svg>
      <PiLogoCore className="pi-logo-core-full" />
    </span>,
    document.body,
  );
}

function PiWordmarkBody() {
  return (
    <g className="pi-logo-wordmark-body">
      <text
        className="pi-logo-letter-serif"
        x="2"
        y="35"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="42"
        fontWeight="700"
      >
        P
      </text>
      <path
        className="pi-logo-letter-i"
        d="M37.9 36V32.35H40.15V18.45H38.25V14.85H47.05V18.45H45.15V32.35H47.4V36H37.9Z"
      />
    </g>
  );
}

function PiLogoCore({ className }: { className: string }) {
  return (
    <span className={`pi-logo-core ${className}`}>
      <span className="pi-logo-core-shape" />
    </span>
  );
}

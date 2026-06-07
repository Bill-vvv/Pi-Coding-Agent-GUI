import type { Dispatch, DragEvent, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Runtime } from "@pi-gui/shared";
import { mediaQueryMatches } from "../../domain/mediaQuery";
import { moveOrderedId, type DropPosition } from "./sidebarOrdering";

const PROJECT_DRAG_MIME = "application/x-pi-gui-project";
const SESSION_DRAG_MIME = "application/x-pi-gui-session";
const TOUCH_DRAG_DELAY_MS = 180;
const TOUCH_DRAG_CANCEL_DISTANCE_PX = 12;
const POINTER_DRAG_CLICK_SUPPRESS_MS = 240;

type DraggingSession = { projectId: string; runtimeId: string };
type DragTarget =
  | { kind: "project"; projectId: string; position: DropPosition }
  | { kind: "session"; projectId: string; runtimeId: string; position: DropPosition };
type PointerDrag =
  | { kind: "project"; pointerId: number; projectId: string; startX: number; startY: number; active: boolean; timerId?: number; source: HTMLElement }
  | { kind: "session"; pointerId: number; projectId: string; runtimeId: string; startX: number; startY: number; active: boolean; timerId?: number; source: HTMLElement };

type UseSidebarDragReorderOptions = {
  projects: { id: string }[];
  runtimes: Runtime[];
  setProjectOrder: Dispatch<SetStateAction<string[]>>;
  setSessionOrderByProject: Dispatch<SetStateAction<Record<string, string[]>>>;
};

export function useSidebarDragReorder({ projects, runtimes, setProjectOrder, setSessionOrderByProject }: UseSidebarDragReorderOptions) {
  const [draggingProjectId, setDraggingProjectId] = useState<string | undefined>();
  const [draggingSession, setDraggingSession] = useState<DraggingSession | undefined>();
  const [dragTarget, setDragTarget] = useState<DragTarget | undefined>();
  const rowElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const previousRowRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const pointerDragRef = useRef<PointerDrag | undefined>(undefined);
  const suppressNextPointerDragClickRef = useRef(false);
  const clickSuppressTimerRef = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const previousRects = previousRowRectsRef.current;
    if (previousRects.size === 0) return;
    previousRowRectsRef.current = new Map();
    if (mediaQueryMatches("(prefers-reduced-motion: reduce)")) return;

    for (const [key, element] of rowElementsRef.current) {
      const previousRect = previousRects.get(key);
      if (!previousRect) continue;

      const nextRect = element.getBoundingClientRect();
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;

      element.getAnimations?.().forEach((animation) => animation.cancel());
      if (!element.animate) continue;
      element.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: 190, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)" },
      );
    }
  });

  useEffect(() => {
    return () => {
      clearPointerDrag(false);
      if (clickSuppressTimerRef.current !== undefined) window.clearTimeout(clickSuppressTimerRef.current);
    };
  }, []);

  function registerRowElement(key: string, element: HTMLElement | null) {
    if (element) rowElementsRef.current.set(key, element);
    else rowElementsRef.current.delete(key);
  }

  function handleProjectDragStart(event: DragEvent<HTMLElement>, projectId: string) {
    setDraggingProjectId(projectId);
    setDragTarget(undefined);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(PROJECT_DRAG_MIME, projectId);
    event.dataTransfer.setData("text/plain", projectId);
    setSidebarDragImage(event);
  }

  function handleProjectDragOver(event: DragEvent<HTMLElement>, targetProjectId: string) {
    if (draggingSession) return;
    const draggedProjectId = draggingProjectId ?? event.dataTransfer.getData(PROJECT_DRAG_MIME);
    if (!draggedProjectId || draggedProjectId === targetProjectId) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const position = dropPositionForPointer(event);
    setDragTarget({ kind: "project", projectId: targetProjectId, position });
    captureRowRects();
    setProjectOrder((current) => moveOrderedId(current, projects.map((project) => project.id), draggedProjectId, targetProjectId, position));
  }

  function handleProjectDrop(event: DragEvent<HTMLElement>) {
    if (!draggingProjectId) return;
    event.preventDefault();
    clearDragState();
  }

  function handleProjectPointerDown(event: ReactPointerEvent<HTMLElement>, projectId: string) {
    beginPointerDrag(event, { kind: "project", projectId });
  }

  function handleSessionDragStart(event: DragEvent<HTMLElement>, projectId: string, runtimeId: string) {
    const payload = { projectId, runtimeId };
    setDraggingSession(payload);
    setDragTarget(undefined);
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(SESSION_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", runtimeId);
    setSidebarDragImage(event);
  }

  function handleSessionDragOver(event: DragEvent<HTMLElement>, targetProjectId: string, targetRuntimeId: string) {
    const dragged = readSessionDragData(event, draggingSession);
    if (!dragged || dragged.projectId !== targetProjectId || dragged.runtimeId === targetRuntimeId) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const position = dropPositionForPointer(event);
    setDragTarget({ kind: "session", projectId: targetProjectId, runtimeId: targetRuntimeId, position });
    captureRowRects();
    setSessionOrderByProject((current) => {
      const runtimeIds = runtimes.filter((runtime) => runtime.projectId === targetProjectId).map((runtime) => runtime.id);
      const currentOrder = current[targetProjectId] ?? [];
      const nextOrder = moveOrderedId(currentOrder, runtimeIds, dragged.runtimeId, targetRuntimeId, position);
      return nextOrder === currentOrder ? current : { ...current, [targetProjectId]: nextOrder };
    });
  }

  function handleSessionDrop(event: DragEvent<HTMLElement>) {
    if (!draggingSession) return;
    event.preventDefault();
    event.stopPropagation();
    clearDragState();
  }

  function handleSessionPointerDown(event: ReactPointerEvent<HTMLElement>, projectId: string, runtimeId: string) {
    beginPointerDrag(event, { kind: "session", projectId, runtimeId });
  }

  function beginPointerDrag(
    event: ReactPointerEvent<HTMLElement>,
    target: { kind: "project"; projectId: string } | { kind: "session"; projectId: string; runtimeId: string },
  ) {
    if (event.pointerType === "mouse" || event.button > 0) return;

    clearPointerDrag(false);
    const drag = {
      ...target,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      source: event.currentTarget,
    } as PointerDrag;
    pointerDragRef.current = drag;
    addPointerDragListeners();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is a progressive enhancement for the touch drag path.
    }
    drag.timerId = window.setTimeout(() => activatePointerDrag(drag), TOUCH_DRAG_DELAY_MS);
  }

  function activatePointerDrag(drag: PointerDrag) {
    if (pointerDragRef.current !== drag) return;

    drag.active = true;
    drag.timerId = undefined;
    setDragTarget(undefined);
    captureRowRects();
    if (drag.kind === "project") {
      setDraggingProjectId(drag.projectId);
      setDraggingSession(undefined);
      return;
    }
    setDraggingProjectId(undefined);
    setDraggingSession({ projectId: drag.projectId, runtimeId: drag.runtimeId });
  }

  function handlePointerDragMove(event: globalThis.PointerEvent) {
    const drag = pointerDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (!drag.active) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance > TOUCH_DRAG_CANCEL_DISTANCE_PX) clearPointerDrag(false);
      return;
    }

    event.preventDefault();
    if (drag.kind === "project") {
      const hit = rowHitForPointer("project", event);
      if (!hit || hit.id === drag.projectId) return;

      setDragTarget({ kind: "project", projectId: hit.id, position: hit.position });
      captureRowRects();
      setProjectOrder((current) => moveOrderedId(current, projects.map((project) => project.id), drag.projectId, hit.id, hit.position));
      return;
    }

    const hit = rowHitForPointer("session", event);
    if (!hit || hit.id === drag.runtimeId) return;
    const targetRuntime = runtimes.find((runtime) => runtime.id === hit.id);
    if (!targetRuntime || targetRuntime.projectId !== drag.projectId) return;

    setDragTarget({ kind: "session", projectId: drag.projectId, runtimeId: hit.id, position: hit.position });
    captureRowRects();
    setSessionOrderByProject((current) => {
      const runtimeIds = runtimes.filter((runtime) => runtime.projectId === drag.projectId).map((runtime) => runtime.id);
      const currentOrder = current[drag.projectId] ?? [];
      const nextOrder = moveOrderedId(currentOrder, runtimeIds, drag.runtimeId, hit.id, hit.position);
      return nextOrder === currentOrder ? current : { ...current, [drag.projectId]: nextOrder };
    });
  }

  function handlePointerDragFinish(event: globalThis.PointerEvent) {
    const drag = pointerDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (drag.active) {
      event.preventDefault();
      suppressNextPointerDragClick();
      clearPointerDrag(true);
      return;
    }
    clearPointerDrag(false);
  }

  function consumePointerDragClick(): boolean {
    if (!suppressNextPointerDragClickRef.current) return false;
    suppressNextPointerDragClickRef.current = false;
    return true;
  }

  function suppressNextPointerDragClick() {
    suppressNextPointerDragClickRef.current = true;
    if (clickSuppressTimerRef.current !== undefined) window.clearTimeout(clickSuppressTimerRef.current);
    clickSuppressTimerRef.current = window.setTimeout(() => {
      suppressNextPointerDragClickRef.current = false;
      clickSuppressTimerRef.current = undefined;
    }, POINTER_DRAG_CLICK_SUPPRESS_MS);
  }

  function addPointerDragListeners() {
    window.addEventListener("pointermove", handlePointerDragMove, { passive: false });
    window.addEventListener("pointerup", handlePointerDragFinish);
    window.addEventListener("pointercancel", handlePointerDragFinish);
  }

  function removePointerDragListeners() {
    window.removeEventListener("pointermove", handlePointerDragMove);
    window.removeEventListener("pointerup", handlePointerDragFinish);
    window.removeEventListener("pointercancel", handlePointerDragFinish);
  }

  function clearPointerDrag(resetState: boolean) {
    const drag = pointerDragRef.current;
    if (drag?.timerId !== undefined) window.clearTimeout(drag.timerId);
    try {
      if (drag) drag.source.releasePointerCapture?.(drag.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    pointerDragRef.current = undefined;
    removePointerDragListeners();
    if (!resetState) return;
    setDraggingProjectId(undefined);
    setDraggingSession(undefined);
    setDragTarget(undefined);
  }

  function clearDragState() {
    clearPointerDrag(false);
    setDraggingProjectId(undefined);
    setDraggingSession(undefined);
    setDragTarget(undefined);
  }

  function projectDropClass(projectId: string): string {
    if (dragTarget?.kind !== "project" || dragTarget.projectId !== projectId || draggingProjectId === projectId) return "";
    return dragTarget.position === "before" ? "drop-before" : "drop-after";
  }

  function sessionDropClass(projectId: string, runtimeId: string): string {
    if (dragTarget?.kind !== "session" || dragTarget.projectId !== projectId || dragTarget.runtimeId !== runtimeId || draggingSession?.runtimeId === runtimeId) {
      return "";
    }
    return dragTarget.position === "before" ? "drop-before" : "drop-after";
  }

  function captureRowRects() {
    previousRowRectsRef.current = new Map(
      [...rowElementsRef.current].map(([key, element]) => [key, element.getBoundingClientRect()]),
    );
  }

  function rowHitForPointer(prefix: "project" | "session", event: globalThis.PointerEvent): { id: string; position: DropPosition } | undefined {
    const keyPrefix = `${prefix}:`;
    for (const [key, element] of rowElementsRef.current) {
      if (!key.startsWith(keyPrefix)) continue;
      const bounds = element.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) continue;
      return { id: key.slice(keyPrefix.length), position: event.clientY > bounds.top + bounds.height / 2 ? "after" : "before" };
    }
    return undefined;
  }

  return {
    draggingProjectId,
    draggingSession,
    registerRowElement,
    handleProjectDragStart,
    handleProjectDragOver,
    handleProjectDrop,
    handleProjectPointerDown,
    handleSessionDragStart,
    handleSessionDragOver,
    handleSessionDrop,
    handleSessionPointerDown,
    consumePointerDragClick,
    clearDragState,
    projectDropClass,
    sessionDropClass,
  };
}

function dropPositionForPointer(event: DragEvent<HTMLElement>): DropPosition {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
}

function readSessionDragData(event: DragEvent<HTMLElement>, fallback: DraggingSession | undefined): DraggingSession | undefined {
  if (fallback) return fallback;
  const raw = event.dataTransfer.getData(SESSION_DRAG_MIME);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Partial<DraggingSession>;
    if (typeof parsed.projectId === "string" && typeof parsed.runtimeId === "string") return parsed as DraggingSession;
  } catch {
    // Ignore invalid drag payloads from outside the app.
  }
  return undefined;
}

function setSidebarDragImage(event: DragEvent<HTMLElement>) {
  const source = event.currentTarget.closest<HTMLElement>(".project-row, .session-row") ?? event.currentTarget;
  const bounds = source.getBoundingClientRect();
  const preview = source.cloneNode(true) as HTMLElement;
  preview.classList.add("sidebar-drag-preview");
  preview.style.position = "fixed";
  preview.style.top = "-1000px";
  preview.style.left = "-1000px";
  preview.style.width = `${bounds.width}px`;
  preview.style.pointerEvents = "none";
  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(preview, 18, Math.min(28, bounds.height / 2));
  window.setTimeout(() => preview.remove(), 0);
}

import { useCallback, useLayoutEffect, useRef } from "react";
import type { ConversationDelta, ServerEvent } from "@pi-gui/shared";
import { dispatchAppServerEvent } from "../domain/serverEventDispatcher";
import type { AppAction } from "../state/appReducer";

type AppServerEventSideEffectHandlers = {
  handleRuntimeLogsServerEvent: (event: ServerEvent) => void;
  handleProjectRuntimeServerEvent: (event: ServerEvent) => void;
  handleSessionRestoreServerEvent: (event: ServerEvent) => void;
  handleSessionTreeForkServerEvent: (event: ServerEvent) => void;
  handleExtensionUiServerEvent: (event: ServerEvent) => void;
  handleComposerCommandServerEvent: (event: ServerEvent) => void;
};

type UseAppServerEventsOptions = {
  performanceFixtureMode: boolean;
  dispatch: (action: AppAction) => void;
  queueConversationDelta: (delta: ConversationDelta) => void;
  flushConversationDeltas: () => void;
};

type UseAppServerEventSideEffectsOptions = AppServerEventSideEffectHandlers & {
  setServerEventSideEffectHandlers: (handlers: AppServerEventSideEffectHandlers) => void;
};

const noopSideEffectHandlers: AppServerEventSideEffectHandlers = {
  handleRuntimeLogsServerEvent: () => undefined,
  handleProjectRuntimeServerEvent: () => undefined,
  handleSessionRestoreServerEvent: () => undefined,
  handleSessionTreeForkServerEvent: () => undefined,
  handleExtensionUiServerEvent: () => undefined,
  handleComposerCommandServerEvent: () => undefined,
};

export function useAppServerEvents({
  performanceFixtureMode,
  dispatch,
  queueConversationDelta,
  flushConversationDeltas,
}: UseAppServerEventsOptions) {
  const sideEffectHandlersRef = useRef<AppServerEventSideEffectHandlers>(noopSideEffectHandlers);

  const setServerEventSideEffectHandlers = useCallback((handlers: AppServerEventSideEffectHandlers) => {
    sideEffectHandlersRef.current = handlers;
  }, []);

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      dispatchAppServerEvent({
        event,
        performanceFixtureMode,
        dispatch,
        queueConversationDelta,
        flushConversationDeltas,
        ...sideEffectHandlersRef.current,
      });
    },
    [dispatch, flushConversationDeltas, performanceFixtureMode, queueConversationDelta],
  );

  return { handleServerEvent, setServerEventSideEffectHandlers };
}

export function useAppServerEventSideEffects({
  setServerEventSideEffectHandlers,
  handleRuntimeLogsServerEvent,
  handleProjectRuntimeServerEvent,
  handleSessionRestoreServerEvent,
  handleSessionTreeForkServerEvent,
  handleExtensionUiServerEvent,
  handleComposerCommandServerEvent,
}: UseAppServerEventSideEffectsOptions): void {
  useLayoutEffect(() => {
    setServerEventSideEffectHandlers({
      handleRuntimeLogsServerEvent,
      handleProjectRuntimeServerEvent,
      handleSessionRestoreServerEvent,
      handleSessionTreeForkServerEvent,
      handleExtensionUiServerEvent,
      handleComposerCommandServerEvent,
    });
  }, [
    setServerEventSideEffectHandlers,
    handleRuntimeLogsServerEvent,
    handleProjectRuntimeServerEvent,
    handleSessionRestoreServerEvent,
    handleSessionTreeForkServerEvent,
    handleExtensionUiServerEvent,
    handleComposerCommandServerEvent,
  ]);
}

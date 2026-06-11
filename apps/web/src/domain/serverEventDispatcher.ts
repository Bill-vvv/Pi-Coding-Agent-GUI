import type { ConversationDelta, ServerEvent } from "@pi-gui/shared";
import type { AppAction } from "../state/appReducer";

type ServerEventDispatcherContext = {
  event: ServerEvent;
  performanceFixtureMode: boolean;
  dispatch: (action: AppAction) => void;
  queueConversationDelta: (delta: ConversationDelta) => void;
  flushConversationDeltas: () => void;
  handleRuntimeLogsServerEvent: (event: ServerEvent) => void;
  handleProjectRuntimeServerEvent: (event: ServerEvent) => void;
  handleSessionRestoreServerEvent: (event: ServerEvent) => void;
  handleSessionTreeForkServerEvent: (event: ServerEvent) => void;
  handleExtensionUiServerEvent: (event: ServerEvent) => void;
  handleComposerCommandServerEvent: (event: ServerEvent) => void;
  handleCheckpointServerEvent: (event: ServerEvent) => void;
};

export function dispatchAppServerEvent({
  event,
  performanceFixtureMode,
  dispatch,
  queueConversationDelta,
  flushConversationDeltas,
  handleRuntimeLogsServerEvent,
  handleProjectRuntimeServerEvent,
  handleSessionRestoreServerEvent,
  handleSessionTreeForkServerEvent,
  handleExtensionUiServerEvent,
  handleComposerCommandServerEvent,
  handleCheckpointServerEvent,
}: ServerEventDispatcherContext): void {
  if (performanceFixtureMode) return;
  if (event.type === "conversation.delta") {
    queueConversationDelta(event.delta);
    return;
  }

  flushConversationDeltas();
  handleRuntimeLogsServerEvent(event);
  dispatch({ type: "server.event", event });
  handleProjectRuntimeServerEvent(event);
  handleSessionRestoreServerEvent(event);
  handleSessionTreeForkServerEvent(event);
  handleExtensionUiServerEvent(event);
  handleComposerCommandServerEvent(event);
  handleCheckpointServerEvent(event);
}

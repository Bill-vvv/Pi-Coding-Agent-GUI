import { useEffect, useRef, type Dispatch } from "react";
import type { ConversationDelta } from "@pi-gui/shared";
import type { AppAction } from "../state/appReducer";

type UseConversationDeltaBatchOptions = {
  dispatch: Dispatch<AppAction>;
};

export function useConversationDeltaBatch({ dispatch }: UseConversationDeltaBatchOptions) {
  const pendingConversationDeltasRef = useRef<ConversationDelta[]>([]);
  const conversationDeltaFrameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (conversationDeltaFrameRef.current !== undefined) window.cancelAnimationFrame(conversationDeltaFrameRef.current);
    };
  }, []);

  function flushConversationDeltas() {
    if (pendingConversationDeltasRef.current.length === 0) return;
    const deltas = pendingConversationDeltasRef.current;
    pendingConversationDeltasRef.current = [];
    dispatch({ type: "server.deltaBatch", deltas });
  }

  function queueConversationDelta(delta: ConversationDelta) {
    pendingConversationDeltasRef.current.push(delta);
    if (conversationDeltaFrameRef.current !== undefined) return;

    conversationDeltaFrameRef.current = window.requestAnimationFrame(() => {
      conversationDeltaFrameRef.current = undefined;
      flushConversationDeltas();
    });
  }

  return {
    queueConversationDelta,
    flushConversationDeltas,
  };
}

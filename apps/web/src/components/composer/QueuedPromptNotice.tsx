import { useState, type DragEvent } from "react";
import type { RuntimeQueue } from "@pi-gui/shared";
import { isConnectionReady } from "../../domain/connection";
import { adjacentRuntimeQueueItemKey, moveRuntimeQueueItem, runtimeQueueFromOrderItems, type RuntimeQueueOrderItem } from "../../domain/runtimeQueueOrdering";
import type { ConnectionState } from "../../types";
import { Icon } from "../Icon";

type QueuedPromptNoticeProps = {
  items: RuntimeQueueOrderItem[];
  runtimeId?: string;
  connection: ConnectionState;
  onDequeueRuntimeQueue: (runtimeId: string) => void;
  onReorderRuntimeQueue: (runtimeId: string, queue: RuntimeQueue) => void;
};

export function QueuedPromptNotice({ items, runtimeId, connection, onDequeueRuntimeQueue, onReorderRuntimeQueue }: QueuedPromptNoticeProps) {
  const [draggedKey, setDraggedKey] = useState<string | undefined>();
  const connectionReady = isConnectionReady(connection);
  const canReorder = Boolean(runtimeId && connectionReady);
  if (items.length === 0) return null;

  function reorderTo(sourceKey: string | undefined, targetKey: string | undefined) {
    if (!runtimeId || !sourceKey || !targetKey) return;
    const reorderedItems = moveRuntimeQueueItem(items, sourceKey, targetKey);
    if (reorderedItems === items) return;
    onReorderRuntimeQueue(runtimeId, runtimeQueueFromOrderItems(reorderedItems));
  }

  function handleItemDragStart(event: DragEvent<HTMLDivElement>, item: RuntimeQueueOrderItem) {
    if (!canReorder) return;
    setDraggedKey(item.key);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.key);
  }

  function handleItemDragOver(event: DragEvent<HTMLDivElement>, item: RuntimeQueueOrderItem) {
    if (!canReorder || !draggedKey) return;
    const source = items.find((candidate) => candidate.key === draggedKey);
    if (!source || source.kind !== item.kind) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleItemDrop(event: DragEvent<HTMLDivElement>, item: RuntimeQueueOrderItem) {
    event.preventDefault();
    const sourceKey = event.dataTransfer.getData("text/plain") || draggedKey;
    reorderTo(sourceKey, item.key);
    setDraggedKey(undefined);
  }

  return (
    <div className="composer-queued-prompt-notice" aria-live="polite" aria-label="等待处理的 follow up 和 steer up">
      <div className="composer-queued-prompt-list">
        {items.map((item) => (
          <div
            className={`composer-queued-prompt-item ${draggedKey === item.key ? "is-dragging" : ""}`}
            key={item.key}
            draggable={canReorder}
            onDragStart={(event) => handleItemDragStart(event, item)}
            onDragOver={(event) => handleItemDragOver(event, item)}
            onDrop={(event) => handleItemDrop(event, item)}
            onDragEnd={() => setDraggedKey(undefined)}
          >
            <span className="composer-queued-prompt-drag-handle" aria-hidden="true">⋮⋮</span>
            <span className="composer-queued-prompt-label">{item.kind === "steering" ? "Steer up" : "Follow up"}</span>
            <span className="composer-queued-prompt-text">{queuedPromptPreview(item.text)}</span>
            {canReorder ? (
              <span className="composer-queued-prompt-order-actions" role="group" aria-label={`${item.kind === "steering" ? "Steer up" : "Follow up"} 排序`}>
                <button
                  className="composer-queued-prompt-order-action"
                  type="button"
                  title="上移"
                  aria-label="上移队列消息"
                  onClick={() => reorderTo(item.key, adjacentRuntimeQueueItemKey(items, item.key, -1))}
                  disabled={!adjacentRuntimeQueueItemKey(items, item.key, -1)}
                >
                  ↑
                </button>
                <button
                  className="composer-queued-prompt-order-action"
                  type="button"
                  title="下移"
                  aria-label="下移队列消息"
                  onClick={() => reorderTo(item.key, adjacentRuntimeQueueItemKey(items, item.key, 1))}
                  disabled={!adjacentRuntimeQueueItemKey(items, item.key, 1)}
                >
                  ↓
                </button>
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {runtimeId ? (
        <button
          className="composer-queued-prompt-dequeue"
          type="button"
          title="撤回队列并放回输入框（Alt+↑）"
          aria-label="撤回队列并放回输入框"
          onClick={() => onDequeueRuntimeQueue(runtimeId)}
          disabled={!connectionReady}
        >
          <Icon name="x" />
        </button>
      ) : null}
    </div>
  );
}

function queuedPromptPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized || "（空内容）";
}

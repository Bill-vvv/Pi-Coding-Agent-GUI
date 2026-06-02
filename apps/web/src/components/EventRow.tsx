import type { GuiEvent } from "@pi-gui/shared";
import { formatPayload } from "../domain/conversation";

export function EventRow({ event }: { event: GuiEvent }) {
  return (
    <article className={`event-row ${event.kind}`}>
      <header>
        <span>#{event.id}</span>
        <strong>{event.kind}</strong>
        <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
      </header>
      <pre>{formatPayload(event.payload)}</pre>
    </article>
  );
}

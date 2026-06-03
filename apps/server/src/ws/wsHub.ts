import type { ServerEvent } from "@pi-gui/shared";

export type WsClient = {
  send(data: string): void;
  on(event: "message", listener: (data: Buffer | string) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};

export class WsHub {
  private readonly clients = new Set<WsClient>();

  add(socket: WsClient): void {
    this.clients.add(socket);
  }

  remove(socket: WsClient): void {
    this.clients.delete(socket);
  }

  send(socket: WsClient, event: ServerEvent): void {
    socket.send(JSON.stringify(event));
  }

  broadcast(event: ServerEvent): void {
    const serialized = JSON.stringify(event);
    for (const client of this.clients) {
      try {
        client.send(serialized);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}

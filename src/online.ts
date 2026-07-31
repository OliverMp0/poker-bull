import Peer, { type DataConnection } from "peerjs";
import type { Call, GameState } from "./game/types";

export type OnlineAction =
  | { type: "RAISE"; call: Call }
  | { type: "CHALLENGE" };

export type ClientMessage =
  | { type: "JOIN"; name: string }
  | { type: "ACTION"; action: OnlineAction };

export type ServerMessage =
  | { type: "LOBBY"; players: string[]; botCount: number }
  | { type: "START"; playerIndex: number; state: GameState }
  | { type: "STATE"; state: GameState; announcement?: string }
  | { type: "ERROR"; message: string };

const roomPeerId = (code: string) => `poker-bull-${code.trim().toLowerCase()}`;

export class OnlineHost {
  private peer: Peer;
  private connections = new Map<string, DataConnection>();

  constructor(
    code: string,
    private onMessage: (peerId: string, message: ClientMessage) => void,
    private onConnectionsChanged: () => void,
  ) {
    this.peer = new Peer(roomPeerId(code));
    this.peer.on("connection", connection => {
      connection.on("open", () => {
        this.connections.set(connection.peer, connection);
        this.onConnectionsChanged();
      });
      connection.on("data", data => this.onMessage(connection.peer, data as ClientMessage));
      connection.on("close", () => {
        this.connections.delete(connection.peer);
        this.onConnectionsChanged();
      });
    });
  }

  ready(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.peer.open) return resolve();
      this.peer.once("open", () => resolve());
      this.peer.once("error", reject);
    });
  }

  peerIds(): string[] {
    return [...this.connections.keys()];
  }

  send(peerId: string, message: ServerMessage): void {
    this.connections.get(peerId)?.send(message);
  }

  broadcast(messageForPeer: (peerId: string) => ServerMessage): void {
    for (const [peerId, connection] of this.connections) connection.send(messageForPeer(peerId));
  }

  close(): void {
    for (const connection of this.connections.values()) connection.close();
    this.peer.destroy();
  }
}

export class OnlineClient {
  private peer = new Peer();
  private connection: DataConnection | null = null;

  constructor(private onMessage: (message: ServerMessage) => void) {}

  connect(code: string, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const connect = () => {
        const connection = this.peer.connect(roomPeerId(code), { reliable: true });
        this.connection = connection;
        connection.on("open", () => {
          connection.send({ type: "JOIN", name } satisfies ClientMessage);
          resolve();
        });
        connection.on("data", data => this.onMessage(data as ServerMessage));
        connection.on("error", reject);
      };

      if (this.peer.open) connect();
      else this.peer.once("open", connect);
      this.peer.once("error", reject);
    });
  }

  send(message: ClientMessage): void {
    this.connection?.send(message);
  }

  close(): void {
    this.connection?.close();
    this.peer.destroy();
  }
}

/** A player of a multiplayer room. */
export interface RoomPlayer<S = unknown> {
  id: string
  name: string
  avatar: string | null
  state: S | null
}

export interface TransportEvents {
  join(player: RoomPlayer): void
  leave(id: string): void
  state(id: string, state: unknown): void
  message(data: unknown, from: string): void
  close(reason: string): void
}

export interface TransportSession {
  me: RoomPlayer
  players: RoomPlayer[]
  send(data: unknown, to?: string): void
  setState(state: unknown): void
  leave(): void
}

/** Connects players of a room: a rooms server, a realtime database, tabs of a browser... */
export interface RoomTransport {
  join(room: string, me: { name: string; avatar: string | null; state: unknown }, events: TransportEvents): Promise<TransportSession>
}

/** Players connected to a rooms server (`noru dev` serves one at "/@noru/play", `noru play-server` for production). */
export function webSocketTransport(url: string): RoomTransport
/** Players in tabs of the same browser, without a server (to try a game). */
export function broadcastChannelTransport(): RoomTransport

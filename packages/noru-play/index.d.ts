import type { RoomPlayer, RoomTransport } from './multiplayer'

export type { RoomPlayer, RoomTransport } from './multiplayer'

/** Something the website sells (coins, a pack...). `price` is a text to show ("500 FCFA", "0,99 €"). */
export interface Product {
  id: string
  title: string
  price: string
  description?: string
  /** Any other field the website and the game agree on (e.g. `coins: 500`). */
  [key: string]: unknown
}

/** A paid purchase: give it to the player, save, then `consumePurchase(purchaseId)`. */
export interface Purchase<P extends Product = Product> {
  purchaseId: string
  productId: string
  product: P
  time: number
}

/** A multiplayer room joined with `play.joinRoom()`. */
export interface Room<S = unknown, M = unknown> {
  readonly name: string
  /** You (your id, name and picture come from the website). */
  readonly me: RoomPlayer<S>
  /** The other players, by id. */
  readonly players: Map<string, RoomPlayer<S>>
  readonly closed: boolean
  on(kind: 'join' | 'leave' | 'state', listener: (player: RoomPlayer<S>) => void): () => void
  on(kind: 'message', listener: (data: M, from: RoomPlayer<S>) => void): () => void
  on(kind: 'close', listener: (reason: string) => void): () => void
  /** Sends a JSON value (up to 16 kB) to every other player, or to one (`to`: a player id). */
  send(data: M, to?: string): void
  /** Your shared state (position, look...), seen by the others and by players who join later. */
  setState(state: S): void
  leave(): void
}

/** The noru play SDK, used by a game. */
export interface Play {
  configure(options: {
    /** Origins allowed to host the game (default: the game's own origin). */
    allowedOrigins?: string[]
    /** Standalone only: products "bought" for free, to develop a shop without a website. */
    testProducts?: Product[]
    /** Standalone only: a rooms server URL or a transport (default: tabs of the same browser). */
    multiplayer?: string | RoomTransport
  }): void
  /** Resolves once the SDK knows whether a host is there. */
  readonly ready: Promise<void>
  /** true inside a noru play host, false when the game runs on its own. */
  readonly inHost: boolean
  /** The player logged in on the website, given by the host (null outside a host or when nobody is logged in). */
  readonly player: { name: string; avatar: string | null } | null
  /** Player's language ("fr", "en"...). */
  readonly language: string
  readonly isPaused: boolean
  readonly isAudioEnabled: boolean
  /** The first frame is on screen: the host removes its loading screen. */
  firstFrameReady(): void
  /** The player can play. */
  gameReady(): void
  onPause(listener: () => void): () => void
  onResume(listener: () => void): () => void
  onAudioChange(listener: (enabled: boolean) => void): () => void
  /** Saves the player's progress (any JSON value, up to 1 MB). */
  save(data: unknown): Promise<void>
  /** The last saved progress, or null. */
  load<T = unknown>(): Promise<T | null>
  sendScore(score: number): Promise<void>

  /** true when the website sells things to the player. */
  readonly canPurchase: boolean
  /** What the website sells. */
  getProducts<P extends Product = Product>(): Promise<P[]>
  /** The website takes the payment. Resolves once paid, or with null if the player cancelled. */
  purchase<P extends Product = Product>(productId: string): Promise<Purchase<P> | null>
  /** Paid purchases not consumed yet (the game closed before giving them): give them at start. */
  getPendingPurchases<P extends Product = Product>(): Promise<Purchase<P>[]>
  /** The player received this purchase. */
  consumePurchase(purchaseId: string): Promise<void>

  /** true when the game can join multiplayer rooms. */
  readonly canJoinRooms: boolean
  /** Joins a multiplayer room (name: 1-64 letters, digits, "-", "_", "." or ":"). */
  joinRoom<S = unknown, M = unknown>(name: string, options?: { state?: S; name?: string; avatar?: string }): Promise<Room<S, M>>

  logError(error: unknown): void
  logWarning(warning: unknown): void
}

export const play: Play
export default play

import type { Product, Purchase } from './index'
import type { RoomTransport } from './multiplayer'

export type { Product, Purchase } from './index'
export type { RoomPlayer, RoomTransport } from './multiplayer'
export { broadcastChannelTransport, webSocketTransport } from './multiplayer'

/** Where a game's saves are kept (your API, a database, localStorage...). */
export interface PlayStorage {
  load(): Promise<unknown>
  save(data: unknown): Promise<void>
}

/** Purchases paid but not given to the player yet (default: localStorage; your server with accounts). */
export interface PurchaseStore {
  list(): Promise<Purchase[]>
  add(purchase: Purchase): Promise<void>
  remove(purchaseId: string): Promise<void>
}

export interface HostCallbacks {
  /** Saves of the game (default: localStorage, one entry per game). */
  storage?: PlayStorage
  /** What the website sells in the game (a list, or a function that loads it). */
  products?: Product[] | (() => Product[] | Promise<Product[]>)
  /**
   * Takes the payment of a product (your checkout, mobile money...). Return something truthy once
   * paid (optionally `{ purchaseId }` from your payment system), falsy if the player cancelled.
   * Without it, the game sells nothing.
   */
  onPurchase?(product: Product): unknown | Promise<unknown>
  purchaseStore?: PurchaseStore
  /** The game gave a purchase to the player. */
  onPurchaseConsumed?(purchaseId: string): void
  /** Multiplayer: the URL of a rooms server ("/@noru/play" with noru dev) or a transport. */
  multiplayer?: string | RoomTransport | null
  /** Multiplayer: the room the players actually join, from the game's room name (to put groups apart). */
  room?(name: string): string
  /** The game (re)started its session. */
  onConnect?(): void
  onFirstFrame?(): void
  onReady?(): void
  /** A score sent by the game. Throw (or reject) to refuse it. */
  onScore?(score: number): void | Promise<void>
  onError?(error: Error): void
  onWarning?(message: string): void
  onPause?(): void
  onResume?(): void
}

export interface HostOptions extends HostCallbacks {
  /** Origin of the game (default: the origin of the iframe's src). */
  allowedOrigin?: string
  language?: string
  audioEnabled?: boolean
  /** The logged-in user, shown by the game: name and picture URL (same website, or a data: URL). */
  player?: { name: string; avatar?: string | null } | null
  /** Give the keyboard focus to the game once its first frame is shown (keyboard games). */
  autoFocus?: boolean
  /** Start paused. */
  paused?: boolean
  /** Pause when the tab is hidden or the game is scrolled out of view (default: true). */
  autoPause?: boolean
  /** Largest save accepted, in bytes (default: 1 MB). */
  maxSaveBytes?: number
}

export interface HostState {
  connected: boolean
  firstFrame: boolean
  ready: boolean
  paused: boolean
  audioEnabled: boolean
  /** Multiplayer rooms the game is in. */
  rooms: string[]
}

export interface Host {
  pause(): void
  resume(): void
  setAudio(enabled: boolean): void
  setLanguage(language: string): void
  setPlayer(player: { name: string; avatar?: string | null } | null): void
  setCallbacks(callbacks: HostCallbacks): void
  readonly state: HostState
  destroy(): void
}

export function createHost(iframe: HTMLIFrameElement, options?: HostOptions): Host
export function localStorageAdapter(key: string): PlayStorage
export function localPurchaseStore(key: string): PurchaseStore

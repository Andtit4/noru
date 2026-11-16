/** Where a game's saves are kept (your API, a database, localStorage...). */
export interface PlayStorage {
  load(): Promise<unknown>
  save(data: unknown): Promise<void>
}

export interface HostCallbacks {
  /** Saves of the game (default: localStorage, one entry per game). */
  storage?: PlayStorage
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

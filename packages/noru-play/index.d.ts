/** The noru play SDK, used by a game. */
export interface Play {
  /** Origins allowed to host the game (default: the game's own origin). Call right after the import. */
  configure(options: { allowedOrigins?: string[] }): void
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
  logError(error: unknown): void
  logWarning(warning: unknown): void
}

export const play: Play
export default play

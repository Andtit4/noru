import type * as React from 'react'
import type { HostCallbacks, HostState } from './host'

export interface PlayableProps extends HostCallbacks {
  /** URL of the game, e.g. "/games/cloud-acres/". */
  src: string
  title?: string
  paused?: boolean
  muted?: boolean
  language?: string
  /** The logged-in user ({ name, avatar }), shown in the game. */
  player?: { name: string; avatar?: string | null } | null
  /** Pause when the tab is hidden or the game is scrolled out of view (default: true). */
  autoPause?: boolean
  /** Shown until the game's first frame (default: a spinner). */
  loading?: React.ReactNode
  /** CSS aspect-ratio of the game (default: "16 / 9"). */
  aspectRatio?: string
  className?: string
  style?: React.CSSProperties
  allow?: string
  sandbox?: string
}

export interface PlayableHandle {
  pause(): void
  resume(): void
  readonly state: HostState | null
  readonly iframe: HTMLIFrameElement | null
}

export const Playable: React.ForwardRefExoticComponent<PlayableProps & React.RefAttributes<PlayableHandle>>
export default Playable

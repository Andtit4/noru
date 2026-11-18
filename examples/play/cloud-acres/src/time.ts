// Cloud Acres: the time of day. By default the island follows the player's own clock (it is night
// in the game when it is night at home); "fast days" make one day last 24 minutes instead.

export type ClockMode = 'real' | 'fast'

const KEY = 'cloud-acres:clock'

export function clockMode(): ClockMode {
  try {
    return localStorage.getItem(KEY) === 'fast' ? 'fast' : 'real'
  } catch {
    return 'real'
  }
}

export function setClockMode(mode: ClockMode) {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // Private browsing: kept for this session only.
  }
  fallback = mode
}
let fallback: ClockMode | null = null

/** ?light=night (or dawn, morning, noon, golden, dusk) shows that moment, to see it at once. */
const PREVIEW: Record<string, number> = { dawn: 5.8, morning: 8, noon: 12.5, golden: 17.6, dusk: 19.4, night: 23 }
const preview = typeof location !== 'undefined' ? PREVIEW[new URLSearchParams(location.search).get('light') || ''] : undefined

/** The hour of the day, 0 to 24 (with minutes as decimals). `elapsed`: seconds since the start, for the preview. */
export function hourOfDay(elapsed: number): number {
  if (preview !== undefined) return (preview + elapsed / 600) % 24
  const mode = fallback ?? clockMode()
  if (mode === 'fast') return (Date.now() / 60000) % 24
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}

export function formatHour(hour: number) {
  const h = Math.floor(hour) % 24
  const m = Math.floor((hour - Math.floor(hour)) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Sky colors (top, bottom) and the light multiplied on the island, hour by hour. */
const KEYS: [number, number[], number[], number[]][] = [
  [0, [16, 18, 48], [42, 38, 92], [112, 122, 196]],
  [4.6, [16, 18, 48], [42, 38, 92], [112, 122, 196]],
  [5.8, [88, 86, 168], [255, 168, 150], [206, 168, 196]],
  [7.2, [140, 196, 255], [255, 216, 190], [255, 242, 228]],
  [12, [110, 188, 255], [205, 238, 255], [255, 255, 255]],
  [16.6, [118, 160, 236], [250, 214, 170], [255, 240, 214]],
  [18, [118, 148, 228], [255, 190, 136], [255, 222, 182]],
  [19.4, [74, 72, 152], [232, 142, 162], [190, 170, 236]],
  [20.8, [22, 24, 62], [58, 48, 108], [118, 126, 200]],
  [24, [16, 18, 48], [42, 38, 92], [112, 122, 196]],
]

const rgb = (c: number[]) => `rgb(${c.map(Math.round).join(',')})`

export interface Daylight {
  hour: number
  top: string
  bottom: string
  /** Multiplied on the island (white: no change). */
  tint: string
  /** 0 by day, 1 in the middle of the night. */
  night: number
  /** Around sunset and dawn: fireflies come out. */
  dusk: number
}

export function daylightAt(hour: number): Daylight {
  let i = 0
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= hour) i++
  const [h0, top0, bottom0, tint0] = KEYS[i]
  const [h1, top1, bottom1, tint1] = KEYS[i + 1]
  const k = h1 > h0 ? (hour - h0) / (h1 - h0) : 0
  const mix = (a: number[], b: number[]) => a.map((v, j) => v + (b[j] - v) * k)
  const night = hour >= 21 || hour < 4.6 ? 1 : hour >= 19 ? (hour - 19) / 2 : hour < 6.2 ? (6.2 - hour) / 1.6 : 0
  const dusk = Math.max(0, 1 - Math.abs(hour - 20) / 2.5, 1 - Math.abs(hour - 5) / 1.5)
  return { hour, top: rgb(mix(top0, top1)), bottom: rgb(mix(bottom0, bottom1)), tint: rgb(mix(tint0, tint1)), night: Math.min(1, Math.max(0, night)), dusk: Math.min(1, dusk) }
}

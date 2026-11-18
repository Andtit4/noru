// Cloud Acres: the map of each island — where you arrive, where you can walk, what you can use.
// Positions are in tiles (TILE pixels); the drawing is in islandArt.ts, the rules in farm.ts.

import { CRYSTAL_PLOTS, ISLANDS, ORCHARD_SPOTS, TILE, WORLD_H, WORLD_W, type SceneId } from './data'

export type Interactive =
  | { kind: 'dock' }
  | { kind: 'house' }
  | { kind: 'pad' }
  | { kind: 'tree'; spot: number }
  | { kind: 'hut' }
  | { kind: 'merchant' }
  | { kind: 'stall' }
  | { kind: 'keeper' }
  | { kind: 'crystal'; plot: number }
  | { kind: 'lantern'; index: number }
  | { kind: 'rune'; index: number }
  | { kind: 'mural' }
  | { kind: 'altar' }

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

/** Size of an island in pixels. */
export function sceneSize(scene: SceneId) {
  if (scene === 'home') return { w: WORLD_W * TILE, h: WORLD_H * TILE }
  return { w: ISLANDS[scene].w * TILE, h: ISLANDS[scene].h * TILE }
}

const px = (p: Point): Point => ({ x: p.x * TILE, y: p.y * TILE })

// --- your farm: the pier and the balloon pad ------------------------------------------------------

export const HOME_PIER = { x: 17.1, y: 13.5, length: 2.3 }
export const HOME_PAD = { x: 21.6, y: 3.2 }
/** The farmer's house, where they sleep (footprint in tiles; the door at the bottom middle). */
export const HOME_HOUSE = { x: 12.3, y: 12.3, w: 2.4, h: 2.3 }
export const HOUSE_DOOR = { x: HOME_HOUSE.x + HOME_HOUSE.w / 2, y: HOME_HOUSE.y + HOME_HOUSE.h + 0.25 }

// --- the orchard ----------------------------------------------------------------------------------

export const ORCHARD = {
  pier: { x: 12, y: 12.2, length: 2.2 },
  hut: { x: 10.4, y: 0.7, w: 3.2, h: 3 },
  keeper: { x: 14.4, y: 3.6 },
  spots: Array.from({ length: ORCHARD_SPOTS }, (_, i) => ({ x: [3.5, 6.5, 9.5, 14.5, 17.5, 20.5][i % 6], y: i < 6 ? 6 : 9.6 })),
  palms: [[1.2, 3], [22.6, 2.4], [1, 12.4], [22.8, 12.6], [16.2, 1.6], [7.4, 1.8]] as [number, number][],
  hammock: { x1: 2.6, x2: 5.2, y: 3.2 },
  waterfall: { x: 23.3, y: 7.2 },
  baskets: [[9, 3.9, 'orange'], [9.8, 4.3, 'mango']] as [number, number, 'orange' | 'mango'][],
}

// --- the market -----------------------------------------------------------------------------------

export const MARKET = {
  pier: { x: 10, y: 10.3, length: 2 },
  merchantStall: { x: 8, y: 0.8, w: 4, h: 2.6 },
  merchant: { x: 10, y: 3.9 },
  myStall: { x: 2, y: 3.6, w: 3.4, h: 2.4 },
  stalls: [
    { x: 14.6, y: 3.6, w: 3.4, h: 2.4 },
    { x: 14.6, y: 7, w: 3.4, h: 2.4 },
    { x: 2, y: 7, w: 3.4, h: 2.4 },
  ] as Rect[],
  fountain: { x: 10, y: 6.4 },
  palms: [[0.9, 1.4], [19, 1.6], [0.8, 10.6], [19.2, 10.4]] as [number, number][],
}

// --- the celestial ruins --------------------------------------------------------------------------

export const RUINS = {
  platforms: {
    main: { x: 1, y: 8, w: 14, h: 7.2 },
    east: { x: 18, y: 8.4, w: 9.2, h: 6.4 },
    north: { x: 4.6, y: 0.6, w: 10.6, h: 5 },
    sanctum: { x: 19, y: 0.6, w: 8.2, h: 5.6 },
  } as Record<string, Rect>,
  bridges: {
    east: { x: 15, y: 10.6, w: 3, h: 1.2 },
    north: { x: 8.4, y: 5.6, w: 1.2, h: 2.4 },
    secret: { x: 15.2, y: 2.4, w: 3.8, h: 1.2 },
  } as Record<string, Rect>,
  pad: { x: 3, y: 13.4 },
  keeper: { x: 6.4, y: 10.2 },
  plots: Array.from({ length: CRYSTAL_PLOTS }, (_, i) => ({ x: 10.2 + (i % 3) * 1.6, y: i < 3 ? 10.2 : 12.6 })),
  lanterns: [{ x: 19.6, y: 9.8 }, { x: 22.8, y: 13.8 }, { x: 25.8, y: 9.8 }],
  mural: { x: 8, y: 0.9, w: 4.4, h: 1.5 },
  runes: [{ x: 6.2, y: 4.4 }, { x: 8.3, y: 4.8 }, { x: 11.7, y: 4.8 }, { x: 13.8, y: 4.4 }],
  altar: { x: 23.1, y: 3.4 },
  dust: [{ x: 20.4, y: 1.8 }, { x: 25.6, y: 1.9 }, { x: 21, y: 5.2 }, { x: 25.4, y: 5.3 }, { x: 23.1, y: 1.4 }],
  statues: [[2.4, 9.4, false], [13.8, 14.6, true], [26.2, 13.6, true], [5.4, 1.6, false]] as [number, number, boolean][],
}

// --- arriving, walking, using -----------------------------------------------------------------

/** Where you stand when you arrive on an island (pixels). */
export function arrival(scene: SceneId): Point {
  if (scene === 'orchard') return px({ x: ORCHARD.pier.x, y: ORCHARD.pier.y - 0.6 })
  if (scene === 'market') return px({ x: MARKET.pier.x, y: MARKET.pier.y - 0.6 })
  if (scene === 'ruins') return px({ x: RUINS.pad.x + 1.4, y: RUINS.pad.y - 0.2 })
  return px({ x: HOME_PIER.x, y: HOME_PIER.y - 0.6 })
}

const inside = (r: Rect, x: number, y: number, margin = 0) => x > (r.x + margin) * TILE && x < (r.x + r.w - margin) * TILE && y > (r.y + margin) * TILE && y < (r.y + r.h - margin) * TILE

/** The house on your farm: you cannot walk through it. */
export function houseSolid(x: number, y: number) {
  return inside({ x: HOME_HOUSE.x + 0.15, y: HOME_HOUSE.y + HOME_HOUSE.h * 0.4, w: HOME_HOUSE.w - 0.3, h: HOME_HOUSE.h * 0.55 }, x, y)
}

/** Things you cannot walk through on an island (pixels). `bridgeOpen`: the secret bridge of the ruins. */
export function solidOn(scene: SceneId, x: number, y: number, bridgeOpen: boolean) {
  const { w, h } = sceneSize(scene)
  if (scene === 'ruins') {
    const onPlatform = Object.entries(RUINS.platforms).some(([id, r]) => (id !== 'sanctum' || bridgeOpen) && inside(r, x, y, 0.15))
    const onBridge = Object.entries(RUINS.bridges).some(([id, r]) => (id !== 'secret' || bridgeOpen) && inside(r, x, y, 0))
    if (!onPlatform && !onBridge) return true
    if (inside({ ...RUINS.mural, h: RUINS.mural.h * 0.8 }, x, y)) return true
    return false
  }
  if (x < 14 || y < 30 || x > w - 14 || y > h - 8) {
    // The pier goes out over the clouds.
    const pier = scene === 'orchard' ? ORCHARD.pier : MARKET.pier
    if (!(Math.abs(x - pier.x * TILE) < 24 && y > h - 20 && y < (pier.y + pier.length) * TILE)) return true
  }
  if (scene === 'orchard') {
    const hut = ORCHARD.hut
    if (inside({ x: hut.x + 0.2, y: hut.y + hut.h * 0.45, w: hut.w - 0.4, h: hut.h * 0.5 }, x, y)) return true
  }
  if (scene === 'market') {
    for (const r of [MARKET.merchantStall, MARKET.myStall, ...MARKET.stalls]) if (inside({ x: r.x, y: r.y + r.h * 0.5, w: r.w, h: r.h * 0.45 }, x, y)) return true
    if (Math.hypot(x - MARKET.fountain.x * TILE, y - MARKET.fountain.y * TILE) < 0.9 * TILE) return true
  }
  return false
}

/** Everything you can use on an island, with its position (pixels). */
export function interactives(scene: SceneId, bridgeOpen: boolean): { what: Interactive; at: Point }[] {
  const list: { what: Interactive; at: Point }[] = []
  if (scene === 'home') {
    list.push({ what: { kind: 'dock' }, at: px({ x: HOME_PIER.x, y: HOME_PIER.y + 0.3 }) })
    list.push({ what: { kind: 'pad' }, at: px(HOME_PAD) })
    list.push({ what: { kind: 'house' }, at: px(HOUSE_DOOR) })
  } else if (scene === 'orchard') {
    list.push({ what: { kind: 'dock' }, at: px({ x: ORCHARD.pier.x, y: ORCHARD.pier.y + 0.4 }) })
    list.push({ what: { kind: 'hut' }, at: px(ORCHARD.keeper) })
    ORCHARD.spots.forEach((p, spot) => list.push({ what: { kind: 'tree', spot }, at: px({ x: p.x, y: p.y + 0.3 }) }))
  } else if (scene === 'market') {
    list.push({ what: { kind: 'dock' }, at: px({ x: MARKET.pier.x, y: MARKET.pier.y + 0.4 }) })
    list.push({ what: { kind: 'merchant' }, at: px(MARKET.merchant) })
    list.push({ what: { kind: 'stall' }, at: px({ x: MARKET.myStall.x + MARKET.myStall.w / 2, y: MARKET.myStall.y + MARKET.myStall.h + 0.3 }) })
  } else {
    list.push({ what: { kind: 'pad' }, at: px(RUINS.pad) })
    list.push({ what: { kind: 'keeper' }, at: px(RUINS.keeper) })
    RUINS.plots.forEach((p, plot) => list.push({ what: { kind: 'crystal', plot }, at: px(p) }))
    RUINS.lanterns.forEach((p, index) => list.push({ what: { kind: 'lantern', index }, at: px(p) }))
    RUINS.runes.forEach((p, index) => list.push({ what: { kind: 'rune', index }, at: px(p) }))
    list.push({ what: { kind: 'mural' }, at: px({ x: RUINS.mural.x + RUINS.mural.w / 2, y: RUINS.mural.y + RUINS.mural.h + 0.4 }) })
    if (bridgeOpen) list.push({ what: { kind: 'altar' }, at: px(RUINS.altar) })
  }
  return list
}

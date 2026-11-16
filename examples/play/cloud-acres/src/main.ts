// Cloud Acres — a farm seen from above, made with noru play.
// Swipe over the fields to plant and harvest, feed the animals, run the workshops, fill the
// villagers' orders and grow the farm. It keeps working while the game is closed.

import { play } from 'noru-play'
import { Sound } from './audio'
import {
  CROPS,
  ITEMS,
  PENS,
  PLACES,
  POND,
  TILE,
  TREES,
  WORKSHOPS,
  WORKSHOP_QUEUE,
  WORLD_H,
  WORLD_W,
  ZONES,
  MACHINES,
  DECORS,
  SKINS,
  SHIRTS,
  PANTS,
  HATS,
  SPRINKLER_PRICES,
  SPRINKLER_LEVEL,
  SILO_PRICES,
  SILO_LEVEL,
  type DecorKind,
  type MachineId,
  type Zone,
  type CropId,
  type ItemId,
  type Place,
  type Save,
} from './data'
import { drawAnimal, drawBarn, drawBoard, drawFence, drawItem, drawPond, drawTree, drawTrough, drawWorkshop } from './art'
import { VILLAGERS, drawCloud, drawCoin, drawPlant, drawPlot, drawVillager, roundRect, star4 } from './draw'
import { Farm, ORDER_SLOTS, type Missing } from './farm'
import { texts } from './i18n'
import { drawDecor, drawFarmer, drawFarmerFace, drawForest, drawSilo, drawSprinkler, drawTractor, drawTruck, type Look } from './extras'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
const sound = new Sound()
const t = texts(play.language)
const FONT = '"Trebuchet MS", "Segoe UI", system-ui, -apple-system, sans-serif'
const WORLD_PX_W = WORLD_W * TILE
const WORLD_PX_H = WORLD_H * TILE
// ?speed=10 makes time go faster (to try the game quickly).
const speedUp = Math.min(Math.max(Number(new URLSearchParams(location.search).get('speed')) || 1, 1), 50)

let farm = new Farm(null)
let width = 0
let height = 0
let dpr = 1
let ui = 1 // interface scale
const cam = { x: 5.2 * TILE, y: WORLD_PX_H * 0.34, zoom: 1 }
let started = false
let paused = false
let clock = 0
let dirty = false
let saveTimer = 0
let selected: CropId = 'wheat'
type Panel = null | 'barn' | 'orders' | 'shop' | 'avatar' | { buy: Place } | { zone: Zone }
let panel: Panel = null
let toast: { title: string; text: string; life: number } | null = null
let levelBanner: { level: number; news: string[]; life: number } | null = null
let coinBump = 0
let seedBarRight = 0
let shopTab = 0
let tool: 'seed' | 'tractor' = 'seed'
let placing: DecorKind | null = null
let hover: { x: number; y: number } | null = null // world, for the decoration being placed

// The player logged in on the website (noru play), shown in the profile badge.
const player = play.player
const playerImage = new Image()
let playerImageReady = false
if (player && player.avatar) {
  playerImage.onload = () => (playerImageReady = true)
  playerImage.src = player.avatar
}

// The farmer walks where the player acts; the tractor works the fields.
const HOME = { x: 3.5 * TILE, y: 4.9 * TILE }
const farmer = { x: HOME.x, y: HOME.y, tx: HOME.x, ty: HOME.y, facing: 1, idle: 0 }
const TRACTOR_HOME = { x: 1.3 * TILE, y: 4.75 * TILE }
const tractor = { x: TRACTOR_HOME.x, y: TRACTOR_HOME.y, facing: 1, job: null as null | { place: Place; order: number[]; i: number } }
const TRUCK_HOME = { x: 8.7 * TILE, y: 3.75 * TILE }

function look(): Look {
  const a = farm.s.avatar
  return { skin: SKINS[a.skin % SKINS.length], shirt: SHIRTS[a.shirt % SHIRTS.length], pants: PANTS[a.pants % PANTS.length], hat: HATS[a.hat % HATS.length] }
}

function goTo(x: number, y: number) {
  farmer.tx = x
  farmer.ty = y
  farmer.idle = 0
}

// Keyboard: the farmer walks with the arrow keys (or WASD / ZQSD), the camera follows them.
const held = new Set<string>()
const KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  a: [-1, 0], q: [-1, 0], d: [1, 0], w: [0, -1], z: [0, -1], s: [0, 1],
}
let keyboard = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches)
let followCamera = false
let walkPlot = '' // plot under the farmer's feet (plants / harvests once per plot entered)

/** Things the farmer cannot walk through. */
function solidAt(x: number, y: number) {
  if (x < 12 || y < 30 || x > WORLD_PX_W - 12 || y > WORLD_PX_H - 6) return true
  for (const p of PLACES) {
    if (p.kind === 'field') continue
    if (p.zone && !farm.owns(p.zone)) continue
    if (!farm.owns(p.id)) continue
    const top = p.kind === 'pen' ? p.y * TILE + 14 : p.y * TILE + p.h * TILE * 0.35
    if (x > p.x * TILE + 6 && x < (p.x + p.w) * TILE - 6 && y > top && y < (p.y + p.h) * TILE - 2) return true
  }
  for (const z of ZONES) if (!farm.owns(z.id) && x > z.x * TILE && y > z.y * TILE && y < (z.y + z.h) * TILE) return true
  if (x > POND.x * TILE && x < (POND.x + POND.w) * TILE && y > POND.y * TILE + 8 && y < (POND.y + POND.h) * TILE - 4) return true
  if (farm.s.silo > 0 && x > 0.35 * TILE && x < 1.6 * TILE && y > 1.6 * TILE && y < 3.7 * TILE) return true
  return false
}

/** The building / pen / sign the farmer stands next to (for Space). */
function nearPlace() {
  let best: Place | null = null
  let bestD = 70
  for (const p of PLACES) {
    if (p.kind === 'field' || (p.zone && !farm.owns(p.zone))) continue
    const cx = Math.min(Math.max(farmer.x, p.x * TILE), (p.x + p.w) * TILE)
    const cy = Math.min(Math.max(farmer.y, p.y * TILE), (p.y + p.h) * TILE)
    const d = Math.hypot(cx - farmer.x, cy - farmer.y)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

function nearZone() {
  return ZONES.find((z) => !farm.owns(z.id) && farmer.x > z.x * TILE - 60 && farmer.y > z.y * TILE && farmer.y < (z.y + z.h) * TILE)
}

function useNearby() {
  const place = nearPlace()
  if (place) {
    const keep = { tx: farmer.tx, ty: farmer.ty }
    tapPlace(place)
    // Space does not make the farmer walk away.
    farmer.tx = keep.tx
    farmer.ty = keep.ty
    return
  }
  const zone = nearZone()
  if (zone) panel = { zone }
}
let barnBump = 0

// --- effects ---------------------------------------------------------------------------------

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; star: boolean; screen: boolean }
interface FloatText { x: number; y: number; text: string; life: number; color: string; size: number }
interface Flyer { item: ItemId | 'coin'; x0: number; y0: number; x1: number; y1: number; t: number; duration: number; arrive: () => void }
let particles: Particle[] = []
let floats: FloatText[] = [] // world space
let flyers: Flyer[] = [] // screen space

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]

function burst(x: number, y: number, count: number, colors: string[], power = 1, stars = false, screen = false) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2
    const v = rand(40, 160) * power
    const life = rand(0.4, 0.9)
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80 * power, life, max: life, size: rand(2, 4.5), color: pick(colors), star: stars && Math.random() < 0.5, screen })
  }
}

function floatText(wx: number, wy: number, text: string, color = '#ffffff', size = 18) {
  floats.push({ x: wx, y: wy, text, life: 1, color, size })
}

// --- camera ----------------------------------------------------------------------------------

function minZoom() {
  return Math.max(width / WORLD_PX_W, height / WORLD_PX_H)
}

function clampCamera() {
  cam.zoom = Math.min(Math.max(cam.zoom, minZoom()), 2.4)
  const halfW = width / 2 / cam.zoom
  const halfH = height / 2 / cam.zoom
  cam.x = Math.min(Math.max(cam.x, halfW), WORLD_PX_W - halfW)
  cam.y = Math.min(Math.max(cam.y, halfH), WORLD_PX_H - halfH)
}

const toScreen = (wx: number, wy: number) => ({ x: (wx - cam.x) * cam.zoom + width / 2, y: (wy - cam.y) * cam.zoom + height / 2 })
const toWorld = (sx: number, sy: number) => ({ x: (sx - width / 2) / cam.zoom + cam.x, y: (sy - height / 2) / cam.zoom + cam.y })

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  width = window.innerWidth
  height = window.innerHeight
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = width + 'px'
  canvas.style.height = height + 'px'
  ui = Math.min(Math.max(Math.min(width, height) / 420, 0.75), 1.5)
  // About 15 tiles across in landscape (the whole barn and the first fields).
  cam.zoom = Math.max(Math.min(width / (15 * TILE), height / (9 * TILE)), minZoom())
  clampCamera()
}

// --- the ground, drawn once ------------------------------------------------------------------

const ground = document.createElement('canvas')
function paintGround() {
  ground.width = WORLD_PX_W
  ground.height = WORLD_PX_H
  const g = ground.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#86c95a'
  g.fillRect(0, 0, WORLD_PX_W, WORLD_PX_H)
  // Soft checker of grass shades.
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
      const v = n - Math.floor(n)
      g.fillStyle = v < 0.33 ? '#8fd062' : v < 0.66 ? '#82c455' : '#7cbf50'
      g.fillRect(x * TILE, y * TILE, TILE, TILE)
    }
  }
  // Grass tufts and flowers.
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * WORLD_PX_W
    const y = Math.random() * WORLD_PX_H
    if (Math.random() < 0.12) {
      g.fillStyle = pick(['#ffffff', '#ffe066', '#ffadc6', '#b9d8ff'])
      g.beginPath()
      g.arc(x, y, 2.4, 0, Math.PI * 2)
      g.fill()
    } else {
      g.strokeStyle = 'rgba(60, 120, 40, 0.35)'
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x - 2, y - 5)
      g.moveTo(x, y)
      g.lineTo(x + 2, y - 5)
      g.stroke()
    }
  }
  // Dirt paths.
  const paths: [number, number][][] = [
    [[0.6, 4.5], [31.6, 4.5]],
    [[10.1, 0.4], [10.1, 14.6]],
    [[10.1, 9], [31.6, 9]],
    [[5.5, 4.5], [5.5, 14.6]],
    [[3.5, 3.6], [3.5, 4.5]],
    [[7, 3.6], [7, 4.5]],
  ]
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const [color, w] of [
    ['#c9a26f', 44],
    ['#dcbb88', 36],
  ] as [string, number][]) {
    g.strokeStyle = color
    g.lineWidth = w
    for (const path of paths) {
      g.beginPath()
      path.forEach(([x, y], i) => (i ? g.lineTo(x * TILE, y * TILE) : g.moveTo(x * TILE, y * TILE)))
      g.stroke()
    }
  }
  for (let i = 0; i < 260; i++) {
    const path = pick(paths)
    const k = Math.random()
    const x = (path[0][0] + (path[1][0] - path[0][0]) * k) * TILE + rand(-14, 14)
    const y = (path[0][1] + (path[1][1] - path[0][1]) * k) * TILE + rand(-14, 14)
    g.fillStyle = 'rgba(150, 110, 70, 0.35)'
    g.beginPath()
    g.arc(x, y, rand(1, 2.5), 0, Math.PI * 2)
    g.fill()
  }
}

// --- animals wandering in their pens ---------------------------------------------------------

interface Walker { x: number; y: number; tx: number; ty: number; wait: number; facing: number }
const walkers: Record<string, Walker[]> = {}

function penWalkers(place: Place) {
  if (!walkers[place.id]) {
    walkers[place.id] = Array.from({ length: PENS[place.animal!].animals }, () => {
      const x = (place.x + rand(0.6, place.w - 0.6)) * TILE
      const y = (place.y + rand(0.9, place.h - 0.5)) * TILE
      return { x, y, tx: x, ty: y, wait: rand(0, 3), facing: Math.random() < 0.5 ? 1 : -1 }
    })
  }
  return walkers[place.id]
}

function updateWalkers(dt: number) {
  for (const place of PLACES) {
    if (place.kind !== 'pen' || !farm.usable(place)) continue
    const speed = place.animal === 'chicken' ? 40 : 22
    for (const w of penWalkers(place)) {
      const dx = w.tx - w.x
      const dy = w.ty - w.y
      const d = Math.hypot(dx, dy)
      if (d < 2) {
        w.wait -= dt
        if (w.wait <= 0) {
          w.tx = (place.x + rand(0.6, place.w - 0.6)) * TILE
          w.ty = (place.y + rand(0.9, place.h - 0.5)) * TILE
          w.wait = rand(1.5, 4)
        }
      } else {
        w.x += (dx / d) * speed * dt
        w.y += (dy / d) * speed * dt
        w.facing = dx >= 0 ? 1 : -1
      }
    }
  }
}

// --- actions ---------------------------------------------------------------------------------

function changed() {
  dirty = true
}

function persist() {
  dirty = false
  saveTimer = 0
  play.save(farm.toSave()).catch((error) => play.logWarning(error))
}

let menuY = 0
function screenOfBarnButton() {
  return { x: width - 46 * ui, y: menuY || height - 46 * ui }
}

function flyToBarn(item: ItemId, wx: number, wy: number, count = 1) {
  const from = toScreen(wx, wy)
  const to = screenOfBarnButton()
  for (let i = 0; i < Math.min(count, 4); i++) {
    flyers.push({ item, x0: from.x + rand(-6, 6), y0: from.y + rand(-6, 6), x1: to.x, y1: to.y, t: -i * 0.08, duration: 0.65, arrive: () => (barnBump = 1) })
  }
}

function flyCoins(sx: number, sy: number, amount: number) {
  const n = Math.min(6, Math.max(1, Math.round(amount / 8)))
  for (let i = 0; i < n; i++) {
    flyers.push({
      item: 'coin',
      x0: sx + rand(-10, 10),
      y0: sy + rand(-10, 10),
      x1: width - 128 * ui,
      y1: 33 * ui,
      t: -i * 0.06,
      duration: 0.6,
      arrive: () => {
        coinBump = 1
        sound.coin()
      },
    })
  }
}

function missingText(missing: Missing) {
  return `${t.missing} ${missing.map((m) => `${m.count} ${t.items[m.item].toLowerCase()}`).join(', ')}`
}

function placeAt(wx: number, wy: number) {
  return PLACES.find((p) => (!p.zone || farm.owns(p.zone)) && wx >= p.x * TILE && wx <= (p.x + p.w) * TILE && wy >= p.y * TILE && wy <= (p.y + p.h) * TILE)
}

/** A land plot not bought yet. */
function zoneAt(wx: number, wy: number) {
  return ZONES.find((z) => !farm.owns(z.id) && wx >= z.x * TILE && wx <= (z.x + z.w) * TILE && wy >= z.y * TILE && wy <= (z.y + z.h) * TILE)
}

function plotAt(wx: number, wy: number) {
  const place = placeAt(wx, wy)
  if (!place || place.kind !== 'field' || !farm.usable(place)) return null
  const col = Math.min(place.w - 1, Math.floor(wx / TILE - place.x))
  const row = Math.min(place.h - 1, Math.floor(wy / TILE - place.y))
  return { place, index: row * place.w + col }
}

function placeName(place: Place) {
  if (place.animal) return t.animals[place.animal]
  if (place.workshop) return t.workshops[place.workshop]
  return t.places[place.kind]
}

function barnFull(wx: number, wy: number) {
  sound.denied()
  floatText(wx, wy, t.barnFull, '#ffe0e0', 16)
}

function tapPlace(place: Place) {
  const cx = (place.x + place.w / 2) * TILE
  const top = place.y * TILE
  goTo(cx, (place.y + place.h) * TILE + 12)
  if (!farm.owns(place.id)) {
    panel = { buy: place }
    return
  }
  if (place.kind === 'barn') panel = 'barn'
  else if (place.kind === 'board') panel = 'orders'
  else if (place.kind === 'pen') {
    const status = farm.penStatus(place)
    if (status === 'ready') {
      const product = farm.collectPen(place)
      if (product === 'full') barnFull(cx, top)
      else if (product) {
        sound.harvest(3)
        flyToBarn(product.item, cx, top + TILE, product.count)
        floatText(cx, top, `+${product.count} ${t.items[product.item]}`, '#fff6b3')
        burst(cx, top + TILE, 14, ['#fff', '#ffe08a'], 0.8, true)
        changed()
      }
    } else if (status === 'hungry') {
      const result = farm.feed(place)
      if (result === 'ok') {
        sound.plant()
        floatText(cx, top, t.feed, '#e8ffd6')
        burst(cx, top + place.h * TILE * 0.6, 10, ['#f2c14e', '#ff8a2b', '#ffd93d'], 0.5)
        changed()
      } else {
        sound.denied()
        floatText(cx, top, missingText(result), '#ffe0e0', 15)
      }
    } else {
      const left = Math.ceil(farm.s.pens[place.id].readyAt - farm.clock)
      floatText(cx, top, `${left} s`, '#ffffff', 16)
    }
  } else if (place.kind === 'workshop') {
    const collected = farm.collectWorkshop(place)
    if (collected === 'full') {
      barnFull(cx, top)
      return
    }
    if (collected) {
      const output = WORKSHOPS[place.workshop!].output
      sound.order()
      flyToBarn(output, cx, top + TILE, collected)
      floatText(cx, top, `+${collected} ${t.items[output]}`, '#fff6b3')
      burst(cx, top + TILE, 18, ['#fff', '#ffe08a', '#ff8fab'], 0.9, true)
      changed()
      return
    }
    const result = farm.startWorkshop(place)
    if (result === 'ok') {
      sound.plant()
      floatText(cx, top, `+1 ${t.items[WORKSHOPS[place.workshop!].output]}…`, '#e8ffd6', 15)
      changed()
    } else {
      sound.denied()
      floatText(cx, top, result === 'full' ? t.queueFull : missingText(result), '#ffe0e0', 15)
    }
  }
}

// Swipe planting / harvesting.
let chain = 0
const touchedPlots = new Set<string>()
let lastDenied = -1

function touchPlot(hit: { place: Place; index: number } | null) {
  if (!hit) return
  const key = hit.place.id + ':' + hit.index
  if (touchedPlots.has(key)) return
  touchedPlots.add(key)
  actOnPlot(hit)
}

function actOnPlot(hit: { place: Place; index: number }) {
  const plot = farm.plots(hit.place)[hit.index]
  const col = hit.index % hit.place.w
  const row = Math.floor(hit.index / hit.place.w)
  const wx = (hit.place.x + col + 0.5) * TILE
  const wy = (hit.place.y + row + 0.5) * TILE
  if (!plot.crop) {
    const result = farm.plant(hit.place, hit.index, selected)
    if (result === 'ok') {
      sound.plant()
      burst(wx, wy + 10, 5, ['#8a5a36', '#a87148'], 0.4)
      changed()
    } else if (result === 'coins' && clock - lastDenied > 1) {
      lastDenied = clock
      sound.denied()
      floatText(wx, wy - 20, t.noCoins, '#ffe0e0', 15)
    }
  } else if (plot.readyAt <= farm.clock) {
    const crop = farm.harvest(hit.place, hit.index)
    if (crop === 'full') {
      if (clock - lastDenied > 1) {
        lastDenied = clock
        barnFull(wx, wy - 20)
      }
    } else if (crop) {
      chain++
      sound.harvest(chain - 1)
      burst(wx, wy, 8, [CROPS.find((c) => c.id === crop)!.color, '#7bc950', '#fff'], 0.5)
      flyToBarn(crop, wx, wy)
      changed()
    }
  }
}

function endSwipe(wx: number, wy: number) {
  if (chain >= 4) {
    const bonus = chain
    farm.s.coins += bonus
    floatText(wx, wy - 30, `COMBO x${chain} +${bonus}`, '#ffffff', 20)
    const s = toScreen(wx, wy)
    flyCoins(s.x, s.y, bonus)
    changed()
  }
  chain = 0
  touchedPlots.clear()
}

function sendTractor(place: Place) {
  if (tractor.job) {
    floatText((place.x + place.w / 2) * TILE, place.y * TILE, t.tractorBusy, '#ffe0e0', 15)
    sound.denied()
    return
  }
  const order: number[] = []
  for (let row = 0; row < place.h; row++) {
    for (let k = 0; k < place.w; k++) order.push(row * place.w + (row % 2 ? place.w - 1 - k : k))
  }
  tractor.job = { place, order, i: 0 }
  chain = 0
  sound.plant()
}

function updateTractor(dt: number) {
  const job = tractor.job
  let target = TRACTOR_HOME
  if (job) {
    const index = job.order[job.i]
    target = { x: (job.place.x + (index % job.place.w) + 0.5) * TILE, y: (job.place.y + Math.floor(index / job.place.w) + 0.75) * TILE }
  }
  const dx = target.x - tractor.x
  const dy = target.y - tractor.y
  const d = Math.hypot(dx, dy)
  const speed = job && job.i > 0 ? 150 : 260
  if (d > 3) {
    const step = Math.min(d, speed * dt)
    tractor.x += (dx / d) * step
    tractor.y += (dy / d) * step
    if (Math.abs(dx) > 1) tractor.facing = dx > 0 ? 1 : -1
  } else if (job) {
    const hit = { place: job.place, index: job.order[job.i] }
    actOnPlot(hit)
    if (!farm.plots(hit.place)[hit.index].crop) actOnPlot(hit)
    job.i++
    if (job.i >= job.order.length) {
      endSwipe(tractor.x, tractor.y)
      tractor.job = null
    }
  }
}

function updateFarmer(dt: number) {
  let kx = 0
  let ky = 0
  if (!panel && !paused && started) {
    for (const key of held) {
      const dir = KEYS[key]
      if (dir) {
        kx += dir[0]
        ky += dir[1]
      }
    }
  }
  if (kx || ky) {
    const len = Math.hypot(kx, ky)
    const step = 190 * dt
    const nx = farmer.x + (kx / len) * step
    const ny = farmer.y + (ky / len) * step
    // Slide along walls: try both axes, then each one.
    if (!solidAt(nx, ny)) {
      farmer.x = nx
      farmer.y = ny
    } else if (!solidAt(nx, farmer.y)) farmer.x = nx
    else if (!solidAt(farmer.x, ny)) farmer.y = ny
    if (kx) farmer.facing = kx > 0 ? 1 : -1
    farmer.tx = farmer.x
    farmer.ty = farmer.y
    farmer.idle = 0
    followCamera = true
    // Walking over a field plants and harvests, one plot at a time (with a combo).
    const hit = plotAt(farmer.x, farmer.y - 6)
    const key = hit ? hit.place.id + ':' + hit.index : ''
    if (key !== walkPlot) {
      if (!hit && walkPlot) endSwipe(farmer.x, farmer.y)
      walkPlot = key
      if (hit) {
        actOnPlot(hit)
        // Same plot: planting right after harvesting it, like the tractor.
        if (!farm.plots(hit.place)[hit.index].crop && tool === 'seed') actOnPlot(hit)
      }
    }
    return
  }
  const dx = farmer.tx - farmer.x
  const dy = farmer.ty - farmer.y
  const d = Math.hypot(dx, dy)
  if (d > 2) {
    const step = Math.min(d, 170 * dt)
    farmer.x += (dx / d) * step
    farmer.y += (dy / d) * step
    if (Math.abs(dx) > 1) farmer.facing = dx > 0 ? 1 : -1
  } else {
    farmer.idle += dt
    // A little walk around the barn now and then (not when the player drives the farmer).
    if (farmer.idle > 7 && !keyboard) goTo(HOME.x + rand(-1.5, 2.5) * TILE, HOME.y + rand(-0.2, 0.3) * TILE)
  }
}

function canPlaceDecor(wx: number, wy: number) {
  if (wx < 30 || wy < 50 || wx > WORLD_PX_W - 30 || wy > WORLD_PX_H - 10) return false
  if (PLACES.some((p) => wx > p.x * TILE - 20 && wx < (p.x + p.w) * TILE + 20 && wy > p.y * TILE - 10 && wy < (p.y + p.h) * TILE + 30)) return false
  if (ZONES.some((z) => !farm.owns(z.id) && wx > z.x * TILE && wy > z.y * TILE && wy < (z.y + z.h) * TILE)) return false
  if (wx > POND.x * TILE - 20 && wx < (POND.x + POND.w) * TILE + 20 && wy > POND.y * TILE - 10 && wy < (POND.y + POND.h) * TILE + 20) return false
  if (farm.s.decor.some((d) => Math.hypot(d.x - wx, d.y - wy) < 44)) return false
  if (Math.hypot(TRUCK_HOME.x - wx, TRUCK_HOME.y - wy) < 50 || Math.hypot(TRACTOR_HOME.x - wx, TRACTOR_HOME.y - wy) < 50) return false
  return true
}

function placeDecorAt(wx: number, wy: number) {
  if (!placing) return
  if (!canPlaceDecor(wx, wy)) {
    sound.denied()
    floatText(wx, wy - 20, t.notHere, '#ffe0e0', 15)
    return
  }
  if (farm.placeDecor(placing, wx, wy) === 'ok') {
    sound.buy()
    burst(wx, wy - 10, 24, ['#ffd54a', '#7bc950', '#ff8fab', '#fff'], 0.9, true)
    goTo(wx + 30, wy + 10)
    persist()
  } else sound.denied()
  placing = null
}

function handleFarmEvents() {
  for (const event of farm.events.splice(0)) {
    if (event.type === 'truck-out') {
      sound.coin()
      floatText(TRUCK_HOME.x, TRUCK_HOME.y - 50, t.delivery + '…', '#e8f4ff', 15)
    } else {
      floatText(TRUCK_HOME.x, TRUCK_HOME.y - 50, '+' + event.coins, '#fff6b3', 20)
      const p = toScreen(TRUCK_HOME.x, TRUCK_HOME.y - 30)
      flyCoins(p.x, p.y, event.coins)
      changed()
    }
  }
}

/** Where the truck is on its trip (out along the road, then back). */
function truckPosition(k: number) {
  const route = [TRUCK_HOME, { x: TRUCK_HOME.x, y: 4.5 * TILE }, { x: WORLD_PX_W + 80, y: 4.5 * TILE }]
  const lengths = [route[1].y - route[0].y, route[2].x - route[1].x]
  const total = lengths[0] + lengths[1]
  const along = (k < 0.5 ? k / 0.5 : (1 - k) / 0.5) * total
  const out = k < 0.5
  if (along <= lengths[0]) return { x: route[0].x, y: route[0].y + along, facing: out ? 1 : -1 }
  return { x: route[1].x + (along - lengths[0]), y: route[1].y + (out ? 0 : 0), facing: out ? 1 : -1 }
}

function levelUp(level: number) {
  const news: string[] = []
  for (const crop of CROPS) if (crop.level === level) news.push(t.items[crop.id])
  for (const place of PLACES) if (place.level === level) news.push(placeName(place))
  levelBanner = { level, news: [...new Set(news)], life: 3.5 }
  sound.golden()
  burst(width / 2, height * 0.35, 60, ['#ffd54a', '#7bc950', '#ff8fab', '#6ec6ff', '#fff'], 2, true, true)
}

// --- update ----------------------------------------------------------------------------------

function update(dt: number) {
  clock += dt
  if (started && !paused) farm.advance(dt * speedUp)
  updateWalkers(dt)
  updateFarmer(dt)
  if (followCamera) {
    const k = Math.min(1, dt * 4)
    cam.x += (farmer.x - cam.x) * k
    cam.y += (farmer.y - 40 - cam.y) * k
    clampCamera()
  }
  updateTractor(dt)
  handleFarmEvents()
  coinBump = Math.max(0, coinBump - dt * 4)
  barnBump = Math.max(0, barnBump - dt * 4)
  for (const p of particles) {
    p.vy += 260 * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.life -= dt
  }
  particles = particles.filter((p) => p.life > 0)
  for (const f of floats) {
    f.y -= 30 * dt
    f.life -= dt * 0.7
  }
  floats = floats.filter((f) => f.life > 0)
  for (const f of flyers) {
    f.t += dt
    if (f.t >= f.duration) f.arrive()
  }
  flyers = flyers.filter((f) => f.t < f.duration)
  if (toast) {
    toast.life -= dt
    if (toast.life <= 0) toast = null
  }
  if (levelBanner) {
    levelBanner.life -= dt
    if (levelBanner.life <= 0) levelBanner = null
  }
  saveTimer += dt
  if (dirty && saveTimer > 4) persist()
}

// --- drawing helpers -------------------------------------------------------------------------

function text(value: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = 800, outline: string | null = 'rgba(40, 30, 60, 0.55)') {
  ctx.font = `${weight} ${Math.round(size)}px ${FONT}`
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  if (outline) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(2, size * 0.18)
    ctx.strokeStyle = outline
    ctx.strokeText(value, x, y)
  }
  ctx.fillStyle = color
  ctx.fillText(value, x, y)
}

interface Button { x: number; y: number; w: number; h: number; action: () => void; enabled: boolean }
let buttons: Button[] = []

function button(label: string, x: number, y: number, w: number, h: number, color: string, enabled: boolean, action: () => void) {
  ctx.fillStyle = 'rgba(40, 30, 60, 0.25)'
  roundRect(ctx, x, y + 3, w, h, h / 2)
  ctx.fill()
  ctx.fillStyle = enabled ? color : '#c9c1b6'
  roundRect(ctx, x, y, w, h, h / 2)
  ctx.fill()
  text(label, x + w / 2, y + h / 2, Math.min(h * 0.42, (w / Math.max(label.length, 1)) * 1.7), '#fff', 'center', 900, 'rgba(0,0,0,0.22)')
  buttons.push({ x, y, w, h, action, enabled })
}

function bubble(x: number, y: number, r: number, draw: () => void, bounce = 0) {
  const by = y - Math.abs(Math.sin(clock * 4)) * bounce
  ctx.fillStyle = 'rgba(40, 30, 60, 0.18)'
  ctx.beginPath()
  ctx.arc(x, by + 3, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fffaf0'
  ctx.beginPath()
  ctx.arc(x, by, r, 0, Math.PI * 2)
  ctx.moveTo(x - r * 0.3, by + r * 0.85)
  ctx.lineTo(x, by + r * 1.35)
  ctx.lineTo(x + r * 0.3, by + r * 0.85)
  ctx.fill()
  ctx.save()
  ctx.translate(0, by - y)
  draw()
  ctx.restore()
}

function ring(x: number, y: number, r: number, k: number, color: string) {
  ctx.strokeStyle = 'rgba(90, 70, 54, 0.2)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2)
  ctx.stroke()
}

// --- world -----------------------------------------------------------------------------------

function drawLockedSign(place: Place) {
  const x = (place.x + place.w / 2) * TILE
  const y = (place.y + place.h / 2) * TILE
  const canBuy = farm.level >= place.level
  ctx.setLineDash([10, 8])
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'
  ctx.lineWidth = 3
  roundRect(ctx, place.x * TILE + 6, place.y * TILE + 6, place.w * TILE - 12, place.h * TILE - 12, 14)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
  roundRect(ctx, place.x * TILE + 6, place.y * TILE + 6, place.w * TILE - 12, place.h * TILE - 12, 14)
  ctx.fill()
  // Wooden sign.
  ctx.fillStyle = '#7a5236'
  ctx.fillRect(x - 3, y, 6, 26)
  ctx.fillStyle = canBuy ? '#fff3c4' : '#efe6d8'
  roundRect(ctx, x - 50, y - 26, 100, 34, 8)
  ctx.fill()
  ctx.strokeStyle = '#a8754b'
  ctx.lineWidth = 2
  roundRect(ctx, x - 50, y - 26, 100, 34, 8)
  ctx.stroke()
  if (canBuy) {
    drawCoin(ctx, x - 24, y - 9, 9)
    text(String(place.price), x + 8, y - 9, 16, '#8a5a1a', 'center', 900, null)
    if (farm.s.coins >= place.price) {
      ctx.fillStyle = `rgba(123, 201, 80, ${0.6 + 0.4 * Math.sin(clock * 5)})`
      star4(ctx, x + 44, y - 26, 4)
    }
  } else {
    text(`🔒 ${t.levelNeeded} ${place.level}`, x, y - 9, 14, '#7a6a5a', 'center', 800, null)
  }
}

function drawField(place: Place) {
  const plots = farm.plots(place)
  for (let i = 0; i < plots.length; i++) {
    const plot = plots[i]
    const x = (place.x + (i % place.w) + 0.5) * TILE
    const y = (place.y + Math.floor(i / place.w) + 0.5) * TILE
    drawPlot(ctx, x, y, TILE * 0.9, 0, false)
    if (!plot.crop) continue
    const growth = farm.growth(plot)
    const ripe = plot.readyAt <= farm.clock
    drawPlant(ctx, plot.crop, x, y, TILE * 0.9, growth, ripe, false, false, clock)
    if (ripe) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + 0.5 * Math.sin(clock * 6 + i)})`
      star4(ctx, x + TILE * 0.3, y - TILE * 0.3, 2.6)
    }
  }
}

function drawPen(place: Place) {
  const px = place.x * TILE
  const py = place.y * TILE
  const pen = PENS[place.animal!]
  drawFence(ctx, px + 8, py + 18, place.w * TILE - 16, place.h * TILE - 24)
  const status = farm.penStatus(place)
  drawTrough(ctx, px + place.w * TILE * 0.5, py + 44, TILE * 0.9, status !== 'hungry', '#f2c14e')
  if (place.animal === 'chicken') {
    // Little coop.
    ctx.fillStyle = '#c98b52'
    roundRect(ctx, px + 16, py + 4, 46, 38, 5)
    ctx.fill()
    ctx.fillStyle = '#a24a3a'
    ctx.beginPath()
    ctx.moveTo(px + 10, py + 12)
    ctx.lineTo(px + 39, py - 10)
    ctx.lineTo(px + 68, py + 12)
    ctx.fill()
    ctx.fillStyle = '#5e3d27'
    roundRect(ctx, px + 31, py + 22, 16, 20, 7)
    ctx.fill()
  }
  const list = [...penWalkers(place)].sort((a, b) => a.y - b.y)
  for (const w of list) {
    const moving = Math.hypot(w.tx - w.x, w.ty - w.y) > 2
    drawAnimal(ctx, pen.kind, w.x, w.y, pen.kind === 'chicken' ? 26 : pen.kind === 'cow' ? 54 : 40, clock + w.x, w.facing, moving)
  }
}

function drawPlaceBubble(place: Place) {
  const x = (place.x + place.w / 2) * TILE
  const y = place.y * TILE - 6
  if (place.kind === 'pen') {
    const pen = PENS[place.animal!]
    const status = farm.penStatus(place)
    if (status === 'ready') bubble(x, y, 20, () => drawItem(ctx, pen.product.item, x, y, 26), 6)
    else if (status === 'busy') {
      bubble(x, y, 20, () => {
        ring(x, y, 14, farm.penProgress(place), '#7bc950')
        drawItem(ctx, pen.product.item, x, y, 16)
      })
    } else {
      const enough = farm.count(pen.feed.item) >= pen.feed.count
      bubble(
        x,
        y,
        20,
        () => {
          ctx.globalAlpha = enough ? 1 : 0.45
          drawItem(ctx, pen.feed.item, x - 4, y, 22)
          ctx.globalAlpha = 1
          text(`${pen.feed.count}`, x + 10, y + 8, 13, enough ? '#2e7d32' : '#c0392b', 'center', 900, '#fffaf0')
        },
        enough ? 3 : 0,
      )
    }
  } else if (place.kind === 'workshop') {
    const type = WORKSHOPS[place.workshop!]
    const ready = farm.readyCount(place)
    const progress = farm.workshopProgress(place)
    if (ready) {
      bubble(
        x,
        y,
        20,
        () => {
          drawItem(ctx, type.output, x, y, 26)
          if (ready > 1) text(`x${ready}`, x + 14, y + 10, 13, '#5a4636', 'center', 900, '#fffaf0')
        },
        6,
      )
    } else if (progress >= 0) {
      bubble(x, y, 20, () => {
        ring(x, y, 14, progress, '#ffb627')
        drawItem(ctx, type.output, x, y, 16)
      })
    } else {
      const enough = farm.missing(type.inputs).length === 0
      bubble(
        x,
        y,
        20,
        () => {
          ctx.globalAlpha = enough ? 1 : 0.45
          drawItem(ctx, type.output, x, y, 22)
          ctx.globalAlpha = 1
        },
        enough ? 3 : 0,
      )
    }
    const queued = farm.queue(place).length
    if (queued > 1) text(`${queued}/${WORKSHOP_QUEUE}`, x, (place.y + place.h) * TILE + 6, 12, '#fff', 'center', 800)
  } else if (place.kind === 'board') {
    const deliverable = farm.s.orders.filter((_, i) => farm.canDeliver(i)).length
    if (deliverable) bubble(x, y, 16, () => text('✓', x, y, 20, '#2e7d32', 'center', 900, null), 5)
  }
}

function drawWorld() {
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.scale(cam.zoom, cam.zoom)
  ctx.translate(-cam.x, -cam.y)
  ctx.drawImage(ground, 0, 0)
  drawPond(ctx, POND.x * TILE, POND.y * TILE, POND.w * TILE, POND.h * TILE, clock)
  // Flat things first: fields and pens.
  for (const place of PLACES) {
    if (!farm.usable(place)) continue
    if (place.kind === 'field') drawField(place)
    if (place.kind === 'pen') drawPen(place)
  }
  // Sprinklers at the corners of the fields.
  if (farm.s.sprinkler > 0) {
    for (const place of PLACES) {
      if (place.kind !== 'field' || !farm.usable(place)) continue
      drawSprinkler(ctx, place.x * TILE + 4, place.y * TILE + 6, clock + place.x)
      if (farm.s.sprinkler > 1) drawSprinkler(ctx, (place.x + place.w) * TILE - 4, (place.y + place.h) * TILE - 2, clock + place.y)
    }
  }
  // Then buildings and trees, back to front.
  const tall: { y: number; draw: () => void }[] = []
  for (const place of PLACES) {
    const x = place.x * TILE
    const y = place.y * TILE
    const w = place.w * TILE
    const h = place.h * TILE
    if (place.zone && !farm.owns(place.zone)) continue
    if (!farm.owns(place.id)) {
      tall.push({ y: y + h, draw: () => drawLockedSign(place) })
      continue
    }
    if (place.kind === 'barn') tall.push({ y: y + h, draw: () => drawBarn(ctx, x, y, w, h) })
    if (place.kind === 'board') tall.push({ y: y + h, draw: () => drawBoard(ctx, x, y, w, h, farm.s.orders.filter((o) => o.nextAt === 0).length) })
    if (place.kind === 'workshop') tall.push({ y: y + h, draw: () => drawWorkshop(ctx, place.workshop!, x, y, w, h, clock, farm.workshopProgress(place) >= 0) })
  }
  for (const [tx, ty, s] of TREES) tall.push({ y: ty * TILE + 20, draw: () => drawTree(ctx, tx * TILE, ty * TILE, 70 * s, clock) })
  for (const d of farm.s.decor) tall.push({ y: d.y, draw: () => drawDecor(ctx, d.kind, d.x, d.y, clock) })
  if (farm.s.silo > 0) tall.push({ y: 3.7 * TILE, draw: () => drawSilo(ctx, 0.35 * TILE, 0.7 * TILE, 1.25 * TILE, 3 * TILE, farm.s.silo) })
  const farmerWalking = Math.hypot(farmer.tx - farmer.x, farmer.ty - farmer.y) > 2
  tall.push({ y: farmer.y, draw: () => drawFarmer(ctx, look(), farmer.x, farmer.y, 46, clock, farmer.facing, farmerWalking) })
  if (keyboard && started && !panel) {
    const near = nearPlace() || null
    const zone = near ? null : nearZone()
    if (near || zone) {
      const hx = farmer.x
      const hy = farmer.y - 74 - Math.abs(Math.sin(clock * 4)) * 4
      tall.push({
        y: 1e9,
        draw: () => {
          ctx.font = '900 13px ' + FONT
          const w = ctx.measureText(t.use).width + 18
          ctx.fillStyle = 'rgba(40, 30, 60, 0.75)'
          roundRect(ctx, hx - w / 2, hy - 12, w, 24, 12)
          ctx.fill()
          text(t.use, hx, hy, 13, '#fff', 'center', 900, null)
        },
      })
    }
  }
  if (farm.s.machines.tractor) {
    const moving = !!tractor.job || Math.hypot(tractor.x - TRACTOR_HOME.x, tractor.y - TRACTOR_HOME.y) > 3
    tall.push({ y: tractor.y, draw: () => drawTractor(ctx, tractor.x, tractor.y, 54, tractor.facing, clock, moving) })
  }
  if (farm.s.machines.truck) {
    const trip = farm.truckTrip()
    const p = trip < 0 ? { x: TRUCK_HOME.x, y: TRUCK_HOME.y, facing: -1 } : truckPosition(trip)
    tall.push({ y: p.y, draw: () => drawTruck(ctx, p.x, p.y, 60, p.facing, clock, trip >= 0, trip >= 0 && trip < 0.5) })
  }
  if (placing && hover) {
    const ok = canPlaceDecor(hover.x, hover.y)
    const at = { ...hover }
    tall.push({
      y: at.y,
      draw: () => {
        ctx.globalAlpha = 0.6
        drawDecor(ctx, placing as string, at.x, at.y, clock)
        ctx.globalAlpha = 1
        ctx.strokeStyle = ok ? 'rgba(123, 201, 80, 0.9)' : 'rgba(230, 57, 70, 0.9)'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.ellipse(at.x, at.y, 30, 12, 0, 0, Math.PI * 2)
        ctx.stroke()
      },
    })
  }
  tall.sort((a, b) => a.y - b.y).forEach((item) => item.draw())
  // Land plots not bought yet: forest, and a sign.
  for (const zone of ZONES) {
    if (farm.owns(zone.id)) continue
    drawForest(ctx, zone.x * TILE, zone.y * TILE, zone.w * TILE, zone.h * TILE, clock)
    const cx = (zone.x + zone.w / 2) * TILE
    const cy = (zone.y + zone.h / 2) * TILE
    const canBuy = farm.level >= zone.level
    ctx.fillStyle = '#7a5236'
    ctx.fillRect(cx - 4, cy, 8, 34)
    ctx.fillStyle = canBuy ? '#fff3c4' : '#efe6d8'
    roundRect(ctx, cx - 78, cy - 46, 156, 54, 10)
    ctx.fill()
    ctx.strokeStyle = '#a8754b'
    ctx.lineWidth = 3
    roundRect(ctx, cx - 78, cy - 46, 156, 54, 10)
    ctx.stroke()
    text(t.zones[zone.id], cx, cy - 30, 15, '#5a4636', 'center', 900, null)
    if (canBuy) {
      drawCoin(ctx, cx - 26, cy - 9, 9)
      text(String(zone.price), cx + 8, cy - 9, 16, '#8a5a1a', 'center', 900, null)
    } else text('🔒 ' + t.levelNeeded + ' ' + zone.level, cx, cy - 9, 14, '#7a6a5a', 'center', 800, null)
  }
  for (const place of PLACES) if (farm.usable(place)) drawPlaceBubble(place)
  // Cloud shadows drifting over the farm.
  for (let i = 0; i < 4; i++) {
    const cx = ((clock * 14 + i * 520) % (WORLD_PX_W + 600)) - 300
    const cy = 120 + i * 230
    ctx.globalAlpha = 0.05
    drawCloud(ctx, cx, cy, 220, '#1d3b5a')
    ctx.globalAlpha = 1
  }
  for (const p of particles) {
    if (p.screen) continue
    ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5)
    ctx.fillStyle = p.color
    if (p.star) star4(ctx, p.x, p.y, p.size * 0.8)
    else {
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
  for (const f of floats) {
    ctx.globalAlpha = Math.min(1, f.life * 2)
    text(f.text, f.x, f.y, f.size, f.color)
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

// --- interface -------------------------------------------------------------------------------

function drawHud() {
  // Profile: the player's picture from the website (or their farmer), name, level and XP.
  const r = 24 * ui
  const cx = 14 * ui + r
  const cy = 12 * ui + r
  const name = (player && player.name) || t.farmer
  ctx.fillStyle = 'rgba(40, 30, 60, 0.35)'
  roundRect(ctx, cx, cy - 18 * ui, 150 * ui, 36 * ui, 18 * ui)
  ctx.fill()
  text(name.length > 14 ? name.slice(0, 13) + '…' : name, cx + r + 8 * ui, cy - 6 * ui, 13 * ui, '#fff', 'left', 900)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
  roundRect(ctx, cx + r + 8 * ui, cy + 5 * ui, 100 * ui, 7 * ui, 3.5 * ui)
  ctx.fill()
  ctx.fillStyle = '#7bc950'
  roundRect(ctx, cx + r + 8 * ui, cy + 5 * ui, 100 * ui * Math.max(0.06, farm.levelProgress()), 7 * ui, 3.5 * ui)
  ctx.fill()
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#bfe3ff'
  ctx.fill()
  ctx.clip()
  if (playerImageReady) ctx.drawImage(playerImage, cx - r, cy - r, r * 2, r * 2)
  else drawFarmerFace(ctx, look(), cx, cy + r * 0.12, r * 1.7)
  ctx.restore()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  // Level, on the badge.
  ctx.fillStyle = '#ffb627'
  ctx.beginPath()
  ctx.arc(cx + r * 0.72, cy + r * 0.72, 11 * ui, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.stroke()
  text(String(farm.level), cx + r * 0.72, cy + r * 0.74, 12 * ui, '#fff', 'center', 900, null)
  buttons.push({ x: cx - r, y: cy - r, w: r * 2 + 150 * ui, h: r * 2, enabled: true, action: () => (panel = 'avatar') })
  const ly = 12 * ui
  // Coins.
  const s = 1 + coinBump * 0.2
  ctx.fillStyle = 'rgba(40, 30, 60, 0.35)'
  roundRect(ctx, width - 140 * ui, ly + 8 * ui, 126 * ui, 26 * ui, 13 * ui)
  ctx.fill()
  drawCoin(ctx, width - 128 * ui, ly + 21 * ui, 15 * ui * s)
  text(String(farm.s.coins), width - 24 * ui, ly + 21 * ui, 17 * ui * s, '#fff', 'right', 900)
}

function drawSeedBar() {
  const crops = farm.crops()
  const size = 54 * ui
  const total = crops.length * size + 12 * ui
  const x0 = 12 * ui
  seedBarRight = x0 + total
  const y0 = height - size - 16 * ui
  ctx.fillStyle = 'rgba(255, 250, 240, 0.9)'
  roundRect(ctx, x0, y0 - 6 * ui, total, size + 12 * ui, 18 * ui)
  ctx.fill()
  crops.forEach((crop, i) => {
    const x = x0 + 6 * ui + i * size
    if (crop.id === selected) {
      ctx.fillStyle = '#ffe08a'
      roundRect(ctx, x + 2, y0, size - 4, size, 14 * ui)
      ctx.fill()
    }
    const affordable = farm.s.coins >= crop.cost
    ctx.globalAlpha = affordable ? 1 : 0.4
    drawItem(ctx, crop.id, x + size / 2, y0 + size * 0.4, size * 0.5)
    drawCoin(ctx, x + size * 0.36, y0 + size * 0.84, 6 * ui)
    text(String(crop.cost), x + size * 0.48, y0 + size * 0.84, 12 * ui, '#5a4636', 'left', 800, null)
    ctx.globalAlpha = 1
    buttons.push({
      x,
      y: y0,
      w: size,
      h: size,
      enabled: true,
      action: () => {
        selected = crop.id
        tool = 'seed'
      },
    })
  })
  if (farm.s.machines.tractor) {
    // The tractor tool: tap a field to send the tractor.
    const x = x0 + total + 8 * ui
    ctx.fillStyle = tool === 'tractor' ? '#ffe08a' : 'rgba(255, 250, 240, 0.9)'
    roundRect(ctx, x, y0 - 6 * ui, size + 4 * ui, size + 12 * ui, 18 * ui)
    ctx.fill()
    drawTractor(ctx, x + size / 2 + 2 * ui, y0 + size * 0.72, size * 0.62, 1, clock, !!tractor.job)
    seedBarRight = x + size + 4 * ui
    buttons.push({ x, y: y0 - 6 * ui, w: size + 4 * ui, h: size + 12 * ui, enabled: true, action: () => (tool = tool === 'tractor' ? 'seed' : 'tractor') })
  }
}

function drawMenuButtons() {
  const size = 58 * ui
  // Above the seed bar when the screen is too narrow for both.
  const narrow = seedBarRight + 8 * ui > width - size * 3 - 38 * ui
  const y = height - size - 16 * ui - (narrow ? size + 24 * ui : 0)
  menuY = y + size / 2
  const entries: [string, number, () => void, number][] = [
    [t.shop, width - size * 3 - 38 * ui, () => (panel = 'shop'), 0],
    [t.orders, width - size * 2 - 26 * ui, () => (panel = 'orders'), farm.s.orders.filter((_, i) => farm.canDeliver(i)).length],
    [t.barn, width - size - 14 * ui, () => (panel = 'barn'), 0],
  ]
  entries.forEach(([label, x, action, badge], i) => {
    const bump = i === 2 ? 1 + barnBump * 0.15 : 1
    ctx.save()
    ctx.translate(x + size / 2, y + size / 2)
    ctx.scale(bump, bump)
    ctx.fillStyle = 'rgba(40, 30, 60, 0.25)'
    roundRect(ctx, -size / 2, -size / 2 + 3, size, size, 16 * ui)
    ctx.fill()
    ctx.fillStyle = '#fffaf0'
    roundRect(ctx, -size / 2, -size / 2, size, size, 16 * ui)
    ctx.fill()
    if (i === 2) drawBarn(ctx, -size * 0.3, -size * 0.36, size * 0.6, size * 0.52)
    else if (i === 1) drawBoard(ctx, -size * 0.3, -size * 0.42, size * 0.6, size * 0.56, 3)
    else {
      drawCoin(ctx, -size * 0.12, -size * 0.06, size * 0.17)
      drawCoin(ctx, size * 0.12, -size * 0.12, size * 0.15)
      drawCoin(ctx, 0, -size * 0.2, size * 0.13)
    }
    text(label, 0, size * 0.36, 11 * ui, '#5a4636', 'center', 800, null)
    ctx.restore()
    if (badge) {
      ctx.fillStyle = '#e63946'
      ctx.beginPath()
      ctx.arc(x + size - 4, y + 4, 10 * ui, 0, Math.PI * 2)
      ctx.fill()
      text(String(badge), x + size - 4, y + 5, 12 * ui, '#fff', 'center', 900, null)
    }
    buttons.push({ x, y, w: size, h: size, enabled: true, action })
  })
}

function panelFrame(title: string, wMax: number, hMax: number) {
  ctx.fillStyle = 'rgba(30, 20, 40, 0.45)'
  ctx.fillRect(0, 0, width, height)
  buttons.push({ x: 0, y: 0, w: width, h: height, enabled: true, action: () => {} }) // blocks the farm
  const w = Math.min(width - 24, wMax * ui)
  const h = Math.min(height - 24, hMax * ui)
  const x = (width - w) / 2
  const y = (height - h) / 2
  ctx.fillStyle = '#fffaf0'
  roundRect(ctx, x, y, w, h, 22 * ui)
  ctx.fill()
  ctx.fillStyle = '#ffd27a'
  roundRect(ctx, x, y, w, 48 * ui, 22 * ui)
  ctx.fill()
  ctx.fillRect(x, y + 26 * ui, w, 22 * ui)
  text(title, x + w / 2, y + 25 * ui, 20 * ui, '#5a4636', 'center', 900, null)
  // Close button (registered last so it wins over the blocker).
  const cs = 32 * ui
  const close = { x: x + w - cs - 8 * ui, y: y + 8 * ui, w: cs, h: cs, enabled: true, action: () => (panel = null) }
  ctx.fillStyle = '#e8735a'
  roundRect(ctx, close.x, close.y, cs, cs, cs / 2)
  ctx.fill()
  text('✕', close.x + cs / 2, close.y + cs / 2 + 1, 16 * ui, '#fff', 'center', 900, null)
  return { x, y: y + 48 * ui, w, h: h - 48 * ui, close }
}

function drawBarnPanel() {
  const box = panelFrame(`${t.barn} · ${farm.used()}/${farm.capacity()}`, 560, 420)
  const items = (Object.keys(ITEMS) as ItemId[]).filter((id) => farm.count(id) > 0)
  if (!items.length) text(t.emptyBarn, box.x + box.w / 2, box.y + box.h / 2, 15 * ui, '#8a7a6a', 'center', 700, null)
  const cell = 96 * ui
  const cols = Math.max(1, Math.floor((box.w - 20 * ui) / cell))
  const x0 = box.x + (box.w - cols * cell) / 2
  items.forEach((id, i) => {
    const x = x0 + (i % cols) * cell
    const y = box.y + 12 * ui + Math.floor(i / cols) * cell * 1.08
    ctx.fillStyle = '#f3ead9'
    roundRect(ctx, x + 4, y, cell - 8, cell, 14 * ui)
    ctx.fill()
    drawItem(ctx, id, x + cell / 2, y + cell * 0.3, cell * 0.36)
    text(`x${farm.count(id)}`, x + cell - 14 * ui, y + 12 * ui, 13 * ui, '#5a4636', 'right', 900, null)
    button(`${t.sell} ${ITEMS[id].price}`, x + 12 * ui, y + cell * 0.64, cell - 24 * ui, cell * 0.26, '#ffb627', true, () => {
      const coins = farm.sell(id, 1)
      if (coins) {
        flyCoins(x + cell / 2, y + cell * 0.6, coins)
        changed()
      }
    })
  })
  buttons.push(box.close)
}

function drawOrdersPanel() {
  const box = panelFrame(t.orders, 640, 380)
  const gapX = 10 * ui
  const cw = (box.w - gapX * (ORDER_SLOTS + 1)) / ORDER_SLOTS
  const ch = box.h - 20 * ui
  farm.s.orders.forEach((order, i) => {
    const x = box.x + gapX + i * (cw + gapX)
    const y = box.y + 10 * ui
    ctx.fillStyle = '#f3ead9'
    roundRect(ctx, x, y, cw, ch, 16 * ui)
    ctx.fill()
    if (order.nextAt > 0) {
      text(t.nextOrder, x + cw / 2, y + ch * 0.42, 13 * ui, '#8a7a6a', 'center', 700, null)
      text(`${Math.ceil(order.nextAt - farm.clock)} s`, x + cw / 2, y + ch * 0.55, 18 * ui, '#8a7a6a', 'center', 900, null)
      return
    }
    const villager = VILLAGERS[order.villager % VILLAGERS.length]
    const can = farm.canDeliver(i)
    drawVillager(ctx, villager.id, x + cw / 2, y + ch * 0.17, Math.min(cw * 0.42, ch * 0.24), can ? 'happy' : 'neutral', clock)
    order.items.forEach((it, k) => {
      const iy = y + ch * (0.38 + k * 0.13)
      drawItem(ctx, it.item, x + cw * 0.3, iy, Math.min(26 * ui, ch * 0.11))
      const have = farm.count(it.item)
      text(`${Math.min(have, it.count)}/${it.count}`, x + cw * 0.62, iy, 14 * ui, have >= it.count ? '#2e7d32' : '#c0392b', 'center', 900, null)
    })
    const ry = y + ch * 0.78
    drawCoin(ctx, x + cw * 0.22, ry, 8 * ui)
    text(String(order.coins), x + cw * 0.3, ry, 13 * ui, '#b7791f', 'left', 900, null)
    text(`+${order.xp} XP`, x + cw * 0.92, ry, 12 * ui, '#5c9e3a', 'right', 800, null)
    const bh = Math.min(30 * ui, ch * 0.13)
    button(t.deliver, x + cw * 0.08, y + ch - bh - 8 * ui, cw * 0.58, bh, '#5cbf3a', can, () => {
      const reward = farm.deliver(i)
      if (reward) {
        sound.order()
        burst(x + cw / 2, y + ch / 2, 30, ['#ffd54a', '#7bc950', '#ff8fab', '#fff'], 1.2, true, true)
        flyCoins(x + cw / 2, y + ch * 0.6, reward.coins)
        changed()
      }
    })
    button('↻', x + cw * 0.7, y + ch - bh - 8 * ui, cw * 0.22, bh, '#9b8f80', true, () => {
      farm.skip(i)
      changed()
    })
  })
  buttons.push(box.close)
}

function drawBuyPanel(place: Place) {
  const box = panelFrame(placeName(place), 360, 260)
  const cx = box.x + box.w / 2
  const levelOk = farm.level >= place.level
  if (place.kind === 'pen') {
    drawAnimal(ctx, place.animal!, cx, box.y + box.h * 0.28, 64 * ui, clock, 1, false)
    const pen = PENS[place.animal!]
    text(`${t.items[pen.feed.item]} → ${t.items[pen.product.item]}`, cx, box.y + box.h * 0.52, 14 * ui, '#8a7a6a', 'center', 700, null)
  } else if (place.kind === 'workshop') {
    const type = WORKSHOPS[place.workshop!]
    drawItem(ctx, type.output, cx, box.y + box.h * 0.26, 48 * ui)
    text(`${type.inputs.map((i) => `${i.count} ${t.items[i.item].toLowerCase()}`).join(' + ')} → ${t.items[type.output]}`, cx, box.y + box.h * 0.52, 14 * ui, '#8a7a6a', 'center', 700, null)
  } else {
    drawPlot(ctx, cx - 22 * ui, box.y + box.h * 0.26, 40 * ui, 0, false)
    drawPlot(ctx, cx + 22 * ui, box.y + box.h * 0.26, 40 * ui, 0, false)
    text(`+${place.w * place.h}`, cx, box.y + box.h * 0.52, 15 * ui, '#8a7a6a', 'center', 800, null)
  }
  const bw = box.w * 0.6
  const bh = 44 * ui
  if (levelOk) {
    button(`${t.buy} · ${place.price}`, cx - bw / 2, box.y + box.h - bh - 18 * ui, bw, bh, '#5cbf3a', farm.s.coins >= place.price, () => {
      if (farm.unlock(place) === 'ok') {
        sound.buy()
        panel = null
        const x = (place.x + place.w / 2) * TILE
        const y = (place.y + place.h / 2) * TILE
        burst(x, y, 40, ['#ffd54a', '#7bc950', '#ff8fab', '#fff'], 1.4, true)
        persist()
      }
    })
  } else {
    text(`🔒 ${t.levelNeeded} ${place.level}`, cx, box.y + box.h - 40 * ui, 18 * ui, '#8a7a6a', 'center', 900, null)
  }
  buttons.push(box.close)
}

/** A row of the shop: icon, name, help, and a price button / owned / level. */
function shopRow(x: number, y: number, w: number, h: number, icon: () => void, name: string, help: string, level: number, price: number | null, buy: () => void) {
  ctx.fillStyle = '#f3ead9'
  roundRect(ctx, x, y, w, h - 8 * ui, 14 * ui)
  ctx.fill()
  icon()
  const mid = y + (h - 8 * ui) / 2
  text(name, x + h * 1.05, mid - 10 * ui, 15 * ui, '#5a4636', 'left', 900, null)
  text(help, x + h * 1.05, mid + 11 * ui, 12 * ui, '#8a7a6a', 'left', 600, null)
  const bw = 104 * ui
  const bh = 36 * ui
  const bx = x + w - bw - 10 * ui
  if (price === null) text(t.owned + ' ✓', bx + bw / 2, mid, 15 * ui, '#5c9e3a', 'center', 900, null)
  else if (farm.level < level) text('🔒 ' + t.levelNeeded + ' ' + level, bx + bw / 2, mid, 13 * ui, '#8a7a6a', 'center', 800, null)
  else {
    button('    ' + price, bx, mid - bh / 2, bw, bh, '#ffb627', farm.s.coins >= price, buy)
    drawCoin(ctx, bx + 24 * ui, mid, 9 * ui)
  }
}

function bought(result: string, wx?: number, wy?: number) {
  if (result !== 'ok') {
    sound.denied()
    return
  }
  sound.buy()
  burst(width / 2, height / 2, 40, ['#ffd54a', '#7bc950', '#ff8fab', '#6ec6ff', '#fff'], 1.6, true, true)
  if (wx !== undefined && wy !== undefined) {
    cam.x = wx
    cam.y = wy
    clampCamera()
    panel = null
  }
  persist()
}

function drawShopPanel() {
  const box = panelFrame(t.shop, 600, 470)
  // Tabs.
  const tw = (box.w - 40 * ui) / 3
  t.tabs.forEach((label, i) => {
    const x = box.x + 20 * ui + i * tw
    ctx.fillStyle = i === shopTab ? '#ffb627' : '#efe2c8'
    roundRect(ctx, x + 4 * ui, box.y + 10 * ui, tw - 8 * ui, 34 * ui, 17 * ui)
    ctx.fill()
    text(label, x + tw / 2, box.y + 27 * ui, 14 * ui, i === shopTab ? '#fff' : '#5a4636', 'center', 900, null)
    buttons.push({ x, y: box.y + 10 * ui, w: tw, h: 34 * ui, enabled: true, action: () => (shopTab = i) })
  })
  const x = box.x + 16 * ui
  const w = box.w - 32 * ui
  let y = box.y + 56 * ui
  const rowH = Math.min(78 * ui, (box.h - 66 * ui) / 4)
  if (shopTab === 0) {
    for (const zone of ZONES) {
      shopRow(x, y, w, rowH, () => {
        ctx.save()
        roundRect(ctx, x + 8 * ui, y + 6 * ui, rowH - 20 * ui, rowH - 20 * ui, 10 * ui)
        ctx.clip()
        ctx.translate(x + 8 * ui, y + 6 * ui)
        ctx.scale((rowH - 20 * ui) / 160, (rowH - 20 * ui) / 160)
        drawForest(ctx, 0, 0, 160, 160, clock)
        ctx.restore()
      }, t.zones[zone.id], t.zoneHelp, zone.level, farm.owns(zone.id) ? null : zone.price, () => bought(farm.buyZone(zone), (zone.x + zone.w / 2) * TILE, (zone.y + zone.h / 2) * TILE))
      y += rowH
    }
  } else if (shopTab === 1) {
    const machines: MachineId[] = ['truck', 'tractor']
    for (const id of machines) {
      const iy = y
      shopRow(x, y, w, rowH, () => {
        if (id === 'tractor') drawTractor(ctx, x + rowH * 0.45, iy + rowH * 0.66, rowH * 0.6, 1, clock, false)
        else drawTruck(ctx, x + rowH * 0.45, iy + rowH * 0.62, rowH * 0.62, 1, clock, false, true)
      }, t.machines[id], t.machineHelp[id], MACHINES[id].level, farm.s.machines[id] ? null : MACHINES[id].price, () => bought(farm.buyMachine(id)))
      y += rowH
    }
    const sy = y
    shopRow(x, y, w, rowH, () => drawSprinkler(ctx, x + rowH * 0.45, sy + rowH * 0.6, clock), `${t.machines.sprinkler} ${farm.s.sprinkler}/${SPRINKLER_PRICES.length}`, t.machineHelp.sprinkler, SPRINKLER_LEVEL, farm.s.sprinkler >= SPRINKLER_PRICES.length ? null : SPRINKLER_PRICES[farm.s.sprinkler], () => bought(farm.buySprinkler(SPRINKLER_LEVEL)))
    y += rowH
    const iy = y
    shopRow(x, y, w, rowH, () => drawSilo(ctx, x + rowH * 0.3, iy + rowH * 0.1, rowH * 0.32, rowH * 0.6, 0), `${t.machines.silo} ${farm.s.silo}/${SILO_PRICES.length}`, t.machineHelp.silo, SILO_LEVEL, farm.s.silo >= SILO_PRICES.length ? null : SILO_PRICES[farm.s.silo], () => bought(farm.buySilo(SILO_LEVEL)))
  } else {
    const kinds = Object.keys(DECORS) as DecorKind[]
    const cols = 3
    const cw = w / cols
    const ch = Math.min(130 * ui, (box.h - 70 * ui) / 2)
    kinds.forEach((kind, i) => {
      const cx = x + (i % cols) * cw
      const cy = y + Math.floor(i / cols) * ch
      ctx.fillStyle = '#f3ead9'
      roundRect(ctx, cx + 5 * ui, cy, cw - 10 * ui, ch - 10 * ui, 14 * ui)
      ctx.fill()
      ctx.save()
      ctx.translate(cx + cw / 2, cy + ch * 0.42)
      ctx.scale(ui * 0.85, ui * 0.85)
      drawDecor(ctx, kind, 0, 0, clock)
      ctx.restore()
      text(t.decors[kind], cx + cw / 2, cy + ch * 0.58, 12 * ui, '#5a4636', 'center', 800, null)
      const info = DECORS[kind]
      const bw = cw * 0.64
      const bh = 28 * ui
      if (farm.level < info.level) text('🔒 ' + t.levelNeeded + ' ' + info.level, cx + cw / 2, cy + ch * 0.78, 12 * ui, '#8a7a6a', 'center', 800, null)
      else {
        button('    ' + info.price, cx + (cw - bw) / 2, cy + ch * 0.7, bw, bh, '#ffb627', farm.s.coins >= info.price, () => {
          placing = kind
          panel = null
          hover = toWorld(width / 2, height / 2)
        })
        drawCoin(ctx, cx + (cw - bw) / 2 + 18 * ui, cy + ch * 0.7 + bh / 2, 8 * ui)
      }
    })
  }
  buttons.push(box.close)
}

function swatch(color: string, x: number, y: number, r: number) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(90, 70, 54, 0.3)'
  ctx.lineWidth = 2
  ctx.stroke()
}

function drawAvatarPanel() {
  const box = panelFrame(t.avatarTitle, 560, 440)
  const left = box.x + box.w * 0.25
  // Big farmer preview.
  drawFarmer(ctx, look(), left, box.y + box.h * 0.66, Math.min(box.h * 0.5, 160 * ui), clock, 1, false)
  if (player && player.name) {
    text(t.connected, left, box.y + box.h * 0.76, 11 * ui, '#8a7a6a', 'center', 700, null)
    text(player.name, left, box.y + box.h * 0.83, 15 * ui, '#5a4636', 'center', 900, null)
  }
  const x = box.x + box.w * 0.48
  const w = box.w * 0.48
  const rows: [string, number, (i: number) => void, (i: number, cx: number, cy: number, r: number) => void, number][] = [
    [t.looks[0], SKINS.length, (i) => (farm.s.avatar.skin = i), (i, cx, cy, r) => swatch(SKINS[i], cx, cy, r), farm.s.avatar.skin],
    [t.looks[1], HATS.length, (i) => (farm.s.avatar.hat = i), (i, cx, cy, r) => drawFarmerFace(ctx, { ...look(), hat: HATS[i] }, cx, cy + r * 0.2, r * 1.6), farm.s.avatar.hat],
    [t.looks[2], SHIRTS.length, (i) => (farm.s.avatar.shirt = i), (i, cx, cy, r) => swatch(SHIRTS[i], cx, cy, r), farm.s.avatar.shirt],
    [t.looks[3], PANTS.length, (i) => (farm.s.avatar.pants = i), (i, cx, cy, r) => swatch(PANTS[i], cx, cy, r), farm.s.avatar.pants],
  ]
  const rowH = (box.h - 20 * ui) / rows.length
  rows.forEach(([label, count, set, drawOption, current], k) => {
    const y = box.y + 10 * ui + k * rowH
    text(label, x, y + 12 * ui, 13 * ui, '#5a4636', 'left', 900, null)
    const r = Math.min(15 * ui, w / count / 2 - 3 * ui)
    for (let i = 0; i < count; i++) {
      const cx = x + r + 2 * ui + i * (r * 2 + 6 * ui)
      const cy = y + rowH * 0.6
      if (i === current) {
        ctx.strokeStyle = '#ffb627'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.arc(cx, cy, r + 4, 0, Math.PI * 2)
        ctx.stroke()
      }
      drawOption(i, cx, cy, r)
      buttons.push({
        x: cx - r - 3,
        y: cy - r - 3,
        w: r * 2 + 6,
        h: r * 2 + 6,
        enabled: true,
        action: () => {
          set(i)
          sound.plant()
          changed()
        },
      })
    }
  })
  buttons.push(box.close)
}

function drawZonePanel(zone: Zone) {
  const box = panelFrame(t.zones[zone.id], 380, 260)
  const cx = box.x + box.w / 2
  ctx.save()
  roundRect(ctx, cx - 60 * ui, box.y + 14 * ui, 120 * ui, 80 * ui, 12 * ui)
  ctx.clip()
  drawForest(ctx, cx - 60 * ui, box.y + 14 * ui, 120 * ui, 80 * ui, clock)
  ctx.restore()
  text(t.zoneHelp, cx, box.y + 116 * ui, 14 * ui, '#8a7a6a', 'center', 700, null)
  const bw = box.w * 0.6
  const bh = 44 * ui
  if (farm.level >= zone.level) {
    button(t.buy + ' · ' + zone.price, cx - bw / 2, box.y + box.h - bh - 18 * ui, bw, bh, '#5cbf3a', farm.s.coins >= zone.price, () => bought(farm.buyZone(zone), (zone.x + zone.w / 2) * TILE, (zone.y + zone.h / 2) * TILE))
  } else text('🔒 ' + t.levelNeeded + ' ' + zone.level, cx, box.y + box.h - 40 * ui, 18 * ui, '#8a7a6a', 'center', 900, null)
  buttons.push(box.close)
}

function drawPlacingBanner() {
  const w = Math.min(width - 40, 440 * ui)
  const x = (width - w) / 2
  const y = 70 * ui
  ctx.fillStyle = '#fffaf0'
  roundRect(ctx, x, y, w, 48 * ui, 24 * ui)
  ctx.fill()
  text(t.placeHere, x + 20 * ui, y + 24 * ui, 14 * ui, '#5a4636', 'left', 800, null)
  button(t.cancel, x + w - 100 * ui, y + 8 * ui, 90 * ui, 32 * ui, '#e8735a', true, () => (placing = null))
}

function drawOverlays() {
  if (toast) {
    ctx.globalAlpha = Math.min(1, toast.life)
    const w = Math.min(width - 40, 420 * ui)
    const x = (width - w) / 2
    const y = 64 * ui
    ctx.fillStyle = '#fffaf0'
    roundRect(ctx, x, y, w, 64 * ui, 18 * ui)
    ctx.fill()
    text(toast.title, width / 2, y + 22 * ui, 18 * ui, '#5a4636', 'center', 900, null)
    text(toast.text, width / 2, y + 45 * ui, Math.min(13 * ui, (w / toast.text.length) * 1.8), '#8a7a6a', 'center', 700, null)
    ctx.globalAlpha = 1
  }
  if (levelBanner) {
    const k = Math.min(1, (3.5 - levelBanner.life) * 4, levelBanner.life * 2)
    ctx.globalAlpha = k
    const s = 1 + (1 - k) * 0.3
    text(`${t.levelUp} ${levelBanner.level} !`, width / 2, height * 0.32, 44 * ui * s, '#ffe08a', 'center', 900, 'rgba(150, 80, 20, 0.9)')
    if (levelBanner.news.length) text(`${t.unlocked} : ${levelBanner.news.join(', ')}`, width / 2, height * 0.32 + 42 * ui, 17 * ui, '#fff', 'center', 800)
    ctx.globalAlpha = 1
  }
  for (const f of flyers) {
    if (f.t < 0) continue
    const k = Math.max(0, f.t / f.duration)
    const e = k * k * (3 - 2 * k)
    const mx = (f.x0 + f.x1) / 2
    const my = Math.min(f.y0, f.y1) - 80
    const x = (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * mx + e * e * f.x1
    const y = (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * my + e * e * f.y1
    if (f.item === 'coin') drawCoin(ctx, x, y, 9 * ui)
    else drawItem(ctx, f.item, x, y, 30 * ui * (1 - e * 0.4))
  }
  for (const p of particles) {
    if (!p.screen) continue
    ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5)
    ctx.fillStyle = p.color
    if (p.star) star4(ctx, p.x, p.y, p.size)
    else {
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * 1.3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

function drawTitle() {
  ctx.fillStyle = 'rgba(40, 70, 30, 0.25)'
  ctx.fillRect(0, 0, width, height)
  const s = Math.min(width, height * 1.4) / 520
  text('CLOUD', width / 2, height * 0.3, 72 * s, '#fff', 'center', 900, 'rgba(70, 120, 40, 0.95)')
  text('ACRES', width / 2, height * 0.3 + 70 * s, 72 * s, '#ffe08a', 'center', 900, 'rgba(150, 80, 20, 0.95)')
  text(t.tagline, width / 2, height * 0.3 + 124 * s, 22 * s, '#fff', 'center', 800)
  ctx.globalAlpha = 0.6 + 0.4 * Math.sin(clock * 4)
  text(keyboard ? t.pressToStart : t.tapToStart, width / 2, height * 0.78, 30 * s, '#fff', 'center', 900)
  ctx.globalAlpha = 1
  const help = keyboard ? t.howToKeys : t.howTo
  text(help, width / 2, height * 0.78 + 40 * s, Math.min(15 * s, (width / help.length) * 1.7), '#fff', 'center', 700)
}

function draw() {
  buttons = []
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  drawWorld()
  if (!started) {
    drawTitle()
    return
  }
  drawHud()
  drawSeedBar()
  drawMenuButtons()
  drawOverlays()
  if (placing) drawPlacingBanner()
  if (panel === 'barn') drawBarnPanel()
  else if (panel === 'orders') drawOrdersPanel()
  else if (panel === 'shop') drawShopPanel()
  else if (panel === 'avatar') drawAvatarPanel()
  else if (panel && 'zone' in panel) drawZonePanel(panel.zone)
  else if (panel) drawBuyPanel(panel.buy)
  if (paused) {
    ctx.fillStyle = 'rgba(30, 20, 40, 0.5)'
    ctx.fillRect(0, 0, width, height)
    text(t.paused, width / 2, height / 2, 32 * ui, '#fff')
  }
}

// --- input -----------------------------------------------------------------------------------

type Gesture = { mode: 'pending' | 'pan' | 'farm'; startX: number; startY: number; lastX: number; lastY: number; place?: Place }
const pointers = new Map<number, { x: number; y: number }>()
let gesture: Gesture | null = null
let pinch: { distance: number; zoom: number } | null = null

function position(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function swipeFarm(x0: number, y0: number, x1: number, y1: number) {
  const a = toWorld(x0, y0)
  const b = toWorld(x1, y1)
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (TILE * 0.25)))
  for (let i = 1; i <= steps; i++) touchPlot(plotAt(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps))
}

function startGame() {
  started = true
  const ready = farm.readyThings()
  if (farm.away > 60) toast = { title: t.welcomeBack, text: `${t.whileAway}${ready ? ` · ${ready} ${t.ready.toLowerCase()}` : ''}`, life: 4 }
}

canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  sound.unlock()
  canvas.focus()
  canvas.setPointerCapture(event.pointerId)
  const p = position(event)
  pointers.set(event.pointerId, p)
  if (pointers.size === 2) {
    // Pinch to zoom (cancels the current gesture).
    const [a, b] = [...pointers.values()]
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom }
    if (gesture && gesture.mode === 'farm') endSwipe(toWorld(p.x, p.y).x, toWorld(p.x, p.y).y)
    gesture = null
    return
  }
  if (!started) {
    startGame()
    return
  }
  if (paused) return
  for (let i = buttons.length - 1; i >= 0; i--) {
    const b = buttons[i]
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
      if (b.enabled) b.action()
      else sound.denied()
      return
    }
  }
  const w = toWorld(p.x, p.y)
  if (placing) {
    hover = w
    gesture = { mode: 'pending', startX: p.x, startY: p.y, lastX: p.x, lastY: p.y }
    return
  }
  const hit = plotAt(w.x, w.y)
  if (hit && tool === 'tractor') {
    sendTractor(hit.place)
    gesture = null
  } else if (hit) {
    gesture = { mode: 'farm', startX: p.x, startY: p.y, lastX: p.x, lastY: p.y }
    touchedPlots.clear()
    touchPlot(hit)
    goTo((hit.place.x + hit.place.w / 2) * TILE, (hit.place.y + hit.place.h) * TILE + 14)
  } else {
    gesture = { mode: 'pending', startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, place: placeAt(w.x, w.y) }
  }
})

canvas.addEventListener('pointermove', (event) => {
  if (placing) {
    const q = position(event)
    hover = toWorld(q.x, q.y)
  }
  if (!pointers.has(event.pointerId)) return
  const p = position(event)
  pointers.set(event.pointerId, p)
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    cam.zoom = pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance)
    clampCamera()
    return
  }
  if (!gesture) return
  if (gesture.mode === 'pending' && Math.hypot(p.x - gesture.startX, p.y - gesture.startY) > 8 * ui) gesture.mode = 'pan'
  if (gesture.mode === 'pan') {
    followCamera = false
    cam.x -= (p.x - gesture.lastX) / cam.zoom
    cam.y -= (p.y - gesture.lastY) / cam.zoom
    clampCamera()
  } else if (gesture.mode === 'farm') {
    swipeFarm(gesture.lastX, gesture.lastY, p.x, p.y)
  }
  gesture.lastX = p.x
  gesture.lastY = p.y
})

function pointerEnd(event: PointerEvent) {
  pointers.delete(event.pointerId)
  if (pointers.size < 2) pinch = null
  if (!gesture) return
  const p = position(event)
  const w = toWorld(p.x, p.y)
  if (gesture.mode === 'farm') endSwipe(w.x, w.y)
  else if (gesture.mode === 'pending' && placing) placeDecorAt(w.x, w.y)
  else if (gesture.mode === 'pending' && gesture.place) tapPlace(gesture.place)
  else if (gesture.mode === 'pending') {
    const zone = zoneAt(w.x, w.y)
    if (zone) panel = { zone }
    else goTo(w.x, w.y)
  }
  gesture = null
}
canvas.addEventListener('pointerup', pointerEnd)
canvas.addEventListener('pointercancel', pointerEnd)
canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    const p = { x: event.offsetX, y: event.offsetY }
    const before = toWorld(p.x, p.y)
    cam.zoom *= Math.exp(-event.deltaY * 0.0015)
    clampCamera()
    const after = toWorld(p.x, p.y)
    cam.x += before.x - after.x
    cam.y += before.y - after.y
    clampCamera()
  },
  { passive: false },
)
window.addEventListener('keydown', (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (KEYS[key] || key === ' ') event.preventDefault() // no page scrolling
  keyboard = true
  sound.unlock()
  if (!started) {
    if (key === ' ' || key === 'Enter') startGame()
    return
  }
  if (paused) return
  if (KEYS[key]) held.add(key)
  const n = Number(key)
  const crops = farm.crops()
  if (n >= 1 && n <= crops.length) {
    selected = crops[n - 1].id
    tool = 'seed'
  }
  if (key === 'Escape') {
    panel = null
    placing = null
  }
  if (event.repeat) return
  if ((key === ' ' || key === 'Enter' || key === 'e') && !panel) {
    if (placing) placeDecorAt(farmer.x, farmer.y + 30)
    else useNearby()
  }
  if (key === 't' && farm.s.machines.tractor && !panel) {
    const hit = plotAt(farmer.x, farmer.y - 6)
    if (hit) sendTractor(hit.place)
  }
})
window.addEventListener('keyup', (event) => {
  held.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key)
})
window.addEventListener('blur', () => held.clear())

// --- loop and noru play ----------------------------------------------------------------------

let last = performance.now()
let firstFrame = true
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 1 / 20)
  last = now
  update(paused ? 0 : dt)
  draw()
  if (firstFrame) {
    firstFrame = false
    play.firstFrameReady()
  }
  requestAnimationFrame(frame)
}

play.onPause(() => {
  paused = true
  sound.suspend()
  if (dirty) persist()
})
play.onResume(() => {
  paused = false
  sound.resume()
})
play.onAudioChange((on) => sound.setEnabled(on))
sound.setEnabled(play.isAudioEnabled)
window.addEventListener('pagehide', () => persist())

paintGround()
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
play
  .load<Save>()
  .then((saved) => {
    farm = new Farm(saved)
  })
  .catch((error) => play.logWarning(error))
  .finally(() => {
    farm.onLevelUp = levelUp
    if (!farm.crops().some((c) => c.id === selected)) selected = 'wheat'
    play.gameReady()
  })

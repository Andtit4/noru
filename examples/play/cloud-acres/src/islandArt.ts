// Cloud Acres: drawings of the other islands — the ways there (pier, cloud ferry, balloon), the
// orchard, the market and the celestial ruins. Same style as the farm: flat colors, ink outline.

import type { CrystalId, FruitId } from './data'
import { C, ellipse, leaf, paint, roundRect, shadow, star4, wind } from './draw'

type Ctx = CanvasRenderingContext2D

// --- the ways to the islands ----------------------------------------------------------------------

/** A wooden pier going out over the clouds (x, y: where it starts on the island, going down). */
export function drawPier(ctx: Ctx, x: number, y: number, length: number, t: number) {
  const w = 52
  for (let i = 0; i < 4; i++) {
    const py = y + (i / 3) * length
    roundRect(ctx, x - w / 2 - 4, py, 8, 26, 3)
    paint(ctx, C.woodDark, 1.5)
    roundRect(ctx, x + w / 2 - 4, py, 8, 26, 3)
    paint(ctx, C.woodDark, 1.5)
  }
  roundRect(ctx, x - w / 2, y, w, length, 6)
  paint(ctx, C.wood, 2)
  ctx.strokeStyle = 'rgba(80, 45, 20, 0.35)'
  ctx.lineWidth = 1.5
  for (let py = y + 12; py < y + length; py += 12) {
    ctx.beginPath()
    ctx.moveTo(x - w / 2 + 3, py)
    ctx.lineTo(x + w / 2 - 3, py)
    ctx.stroke()
  }
  // Lanterns at the end.
  for (const side of [-1, 1]) {
    const lx = x + side * (w / 2 + 2)
    const ly = y + length - 30
    roundRect(ctx, lx - 2, ly - 30, 4, 32, 2)
    paint(ctx, C.woodDark, 1.2)
    const sway = Math.sin(t * 2 + side) * 0.15
    ctx.save()
    ctx.translate(lx, ly - 30)
    ctx.rotate(sway)
    roundRect(ctx, -6, 0, 12, 14, 4)
    paint(ctx, '#ffd98a', 1.5)
    ctx.restore()
  }
}

/** The cloud ferry: a little boat sitting on a cloud, with a kente-striped sail. */
export function drawFerry(ctx: Ctx, x: number, y: number, s: number, t: number) {
  const bob = Math.sin(t * 1.6) * s * 0.03
  ctx.save()
  ctx.translate(x, y + bob)
  // The cloud under it.
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.beginPath()
  for (const [dx, dy, r] of [
    [-0.45, 0.12, 0.2],
    [-0.15, 0.18, 0.24],
    [0.2, 0.17, 0.22],
    [0.48, 0.12, 0.18],
  ]) {
    ctx.moveTo(dx * s + r * s, dy * s)
    ctx.arc(dx * s, dy * s, r * s, 0, Math.PI * 2)
  }
  ctx.fill()
  // Hull.
  ctx.beginPath()
  ctx.moveTo(-s * 0.5, -s * 0.06)
  ctx.lineTo(s * 0.55, -s * 0.06)
  ctx.quadraticCurveTo(s * 0.45, s * 0.14, s * 0.3, s * 0.14)
  ctx.lineTo(-s * 0.35, s * 0.14)
  ctx.quadraticCurveTo(-s * 0.48, s * 0.12, -s * 0.5, -s * 0.06)
  ctx.closePath()
  paint(ctx, C.coral, Math.max(1.5, s * 0.02))
  ctx.fillStyle = C.cream
  ctx.fillRect(-s * 0.45, -s * 0.02, s * 0.95, s * 0.04)
  // Mast and sail.
  roundRect(ctx, -s * 0.02, -s * 0.62, s * 0.04, s * 0.58, s * 0.02)
  paint(ctx, C.woodDark, Math.max(1, s * 0.015))
  const flap = Math.sin(t * 3) * s * 0.02
  ctx.beginPath()
  ctx.moveTo(s * 0.03, -s * 0.58)
  ctx.quadraticCurveTo(s * 0.32 + flap, -s * 0.36, s * 0.04, -s * 0.12)
  ctx.closePath()
  ctx.save()
  ctx.clip()
  const stripes = [C.gold, '#2f9e5b', C.coral, '#2b2235', C.gold]
  stripes.forEach((c, i) => {
    ctx.fillStyle = c
    ctx.fillRect(0, -s * 0.6 + i * s * 0.1, s * 0.4, s * 0.1)
  })
  ctx.restore()
  ctx.strokeStyle = C.ink
  ctx.lineWidth = Math.max(1, s * 0.015)
  ctx.beginPath()
  ctx.moveTo(s * 0.03, -s * 0.58)
  ctx.quadraticCurveTo(s * 0.32 + flap, -s * 0.36, s * 0.04, -s * 0.12)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

/** The hot-air balloon (x, y: the basket's bottom). `lift`: 0 on the ground, up to 1 flying away. */
export function drawBalloon(ctx: Ctx, x: number, y: number, s: number, t: number, lift = 0) {
  const ink = Math.max(1.5, s * 0.02)
  const bob = Math.sin(t * 1.2) * s * 0.02 - lift * s * 3
  shadow(ctx, x, y, s * 0.28 * (1 - lift * 0.6), s * 0.07 * (1 - lift * 0.6), 1 - lift * 0.7)
  ctx.save()
  ctx.translate(x, y + bob)
  // Ropes.
  ctx.strokeStyle = C.woodDark
  ctx.lineWidth = Math.max(1, s * 0.01)
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(side * s * 0.12, -s * 0.18)
    ctx.lineTo(side * s * 0.2, -s * 0.48)
    ctx.stroke()
  }
  // Basket.
  roundRect(ctx, -s * 0.15, -s * 0.2, s * 0.3, s * 0.2, s * 0.03)
  paint(ctx, '#c4894f', ink)
  ctx.strokeStyle = 'rgba(80,45,20,0.4)'
  for (let i = 1; i < 4; i++) {
    ctx.beginPath()
    ctx.moveTo(-s * 0.15 + i * s * 0.075, -s * 0.19)
    ctx.lineTo(-s * 0.15 + i * s * 0.075, -s * 0.01)
    ctx.stroke()
  }
  // Burner flame.
  const flame = 0.7 + 0.3 * Math.sin(t * 18)
  ellipse(ctx, 0, -s * 0.5, s * 0.035, s * 0.06 * flame, '#ffb347')
  ellipse(ctx, 0, -s * 0.49, s * 0.018, s * 0.035 * flame, '#fff3b0')
  // Envelope: gores in the island's colors.
  const top = -s * 1.25
  ctx.beginPath()
  ctx.moveTo(-s * 0.16, -s * 0.52)
  ctx.bezierCurveTo(-s * 0.62, -s * 0.8, -s * 0.5, top, 0, top)
  ctx.bezierCurveTo(s * 0.5, top, s * 0.62, -s * 0.8, s * 0.16, -s * 0.52)
  ctx.closePath()
  ctx.save()
  ctx.clip()
  const colors = [C.teal, C.gold, C.coral, C.plum, C.teal, C.gold]
  colors.forEach((c, i) => {
    ctx.fillStyle = c
    ctx.fillRect(-s * 0.6 + i * s * 0.2, top, s * 0.2, s)
  })
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  ctx.fillRect(-s * 0.6, top + s * 0.25, s * 1.2, s * 0.06)
  ellipse(ctx, -s * 0.18, top + s * 0.22, s * 0.08, s * 0.16, 'rgba(255,255,255,0.3)', -0.3)
  ctx.restore()
  ctx.beginPath()
  ctx.moveTo(-s * 0.16, -s * 0.52)
  ctx.bezierCurveTo(-s * 0.62, -s * 0.8, -s * 0.5, top, 0, top)
  ctx.bezierCurveTo(s * 0.5, top, s * 0.62, -s * 0.8, s * 0.16, -s * 0.52)
  ctx.closePath()
  ctx.strokeStyle = C.ink
  ctx.lineWidth = ink
  ctx.stroke()
  ctx.restore()
}

// --- the orchard --------------------------------------------------------------------------------

const FRUIT_COLORS: Record<FruitId, [string, string]> = {
  orange: ['#ff9a2e', '#e9781c'],
  mango: ['#ffc23d', '#ff8a3c'],
  cacao: ['#c7783a', '#8e4f25'],
  shea: ['#b8c47a', '#8f9c52'],
}

/** A fruit, for the barn and the trees. */
export function drawFruit(ctx: Ctx, fruit: FruitId, x: number, y: number, s: number) {
  const ink = Math.max(1, s * 0.05)
  const [c, dark] = FRUIT_COLORS[fruit]
  if (fruit === 'cacao') {
    // A ribbed cacao pod.
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-0.4)
    ellipse(ctx, 0, 0, s * 0.22, s * 0.4, c, 0, ink)
    ctx.strokeStyle = dark
    ctx.lineWidth = Math.max(1, s * 0.03)
    for (const k of [-0.1, 0, 0.1]) {
      ctx.beginPath()
      ctx.moveTo(k * s, -s * 0.34)
      ctx.quadraticCurveTo(k * s * 1.6, 0, k * s, s * 0.34)
      ctx.stroke()
    }
    ellipse(ctx, -s * 0.07, -s * 0.15, s * 0.04, s * 0.1, 'rgba(255,255,255,0.35)')
    ctx.restore()
    return
  }
  if (fruit === 'shea') {
    ellipse(ctx, x, y + s * 0.05, s * 0.3, s * 0.34, c, 0, ink)
    ellipse(ctx, x + s * 0.06, y + s * 0.1, s * 0.16, s * 0.18, '#d8c99a')
    ellipse(ctx, x - s * 0.1, y - s * 0.1, s * 0.06, s * 0.08, 'rgba(255,255,255,0.4)')
    leaf(ctx, x, y - s * 0.26, s * 0.24, 0.6, C.leaf, ink * 0.8)
    return
  }
  if (fruit === 'mango') {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(0.35)
    ellipse(ctx, 0, 0, s * 0.3, s * 0.38, c, 0, ink)
    ctx.beginPath()
    ctx.ellipse(s * 0.06, s * 0.06, s * 0.22, s * 0.3, 0, -0.4, 1.8)
    ctx.strokeStyle = dark
    ctx.lineWidth = s * 0.12
    ctx.globalAlpha = 0.5
    ctx.stroke()
    ctx.globalAlpha = 1
    ellipse(ctx, -s * 0.1, -s * 0.14, s * 0.06, s * 0.1, 'rgba(255,255,255,0.45)')
    ctx.restore()
    leaf(ctx, x - s * 0.06, y - s * 0.3, s * 0.26, -0.7, C.leaf, ink * 0.8)
    return
  }
  ellipse(ctx, x, y + s * 0.04, s * 0.34, s * 0.34, c, 0, ink)
  for (let i = 0; i < 6; i++) ellipse(ctx, x + Math.cos(i) * s * 0.18, y + s * 0.04 + Math.sin(i * 1.7) * s * 0.16, s * 0.02, s * 0.02, dark)
  ellipse(ctx, x - s * 0.12, y - s * 0.08, s * 0.07, s * 0.06, 'rgba(255,255,255,0.5)')
  leaf(ctx, x + s * 0.04, y - s * 0.28, s * 0.22, 0.7, C.leaf, ink * 0.8)
}

/** A fruit tree on its spot: a sapling that grows, then hangs with fruit when ready. */
export function drawFruitTree(ctx: Ctx, fruit: FruitId, x: number, y: number, s: number, growth: number, ready: boolean, t: number) {
  const ink = Math.max(1.5, s * 0.025)
  const sway = wind(x, t) * s * 0.03
  ellipse(ctx, x, y + s * 0.04, s * 0.36, s * 0.12, '#9e6a3e', 0, ink)
  ellipse(ctx, x, y + s * 0.02, s * 0.3, s * 0.08, '#b97f4c')
  if (growth < 0.35) {
    const k = growth / 0.35
    roundRect(ctx, x - s * 0.02, y - s * (0.1 + 0.2 * k), s * 0.04, s * (0.1 + 0.2 * k), s * 0.02)
    paint(ctx, C.woodDark, ink * 0.6)
    leaf(ctx, x + sway, y - s * (0.1 + 0.2 * k), s * 0.18, -0.6, C.leaf, ink * 0.7)
    leaf(ctx, x + sway, y - s * (0.1 + 0.2 * k), s * 0.18, 0.6, C.leaf, ink * 0.7)
    return
  }
  const k = Math.min(1, (growth - 0.35) / 0.65)
  const size = s * (0.55 + 0.45 * k)
  shadow(ctx, x, y + s * 0.06, size * 0.5, size * 0.12, 1.1)
  roundRect(ctx, x - size * 0.07, y - size * 0.55, size * 0.14, size * 0.56, size * 0.05)
  paint(ctx, fruit === 'cacao' ? '#6e4430' : C.woodDark, ink)
  const [dark, mid, light] =
    fruit === 'mango' ? ['#2f7a3a', '#3f9446', '#5fb04f'] : fruit === 'shea' ? ['#5a8f3a', '#71a648', '#94c063'] : fruit === 'cacao' ? ['#3b7d47', '#4f9a55', '#72b86a'] : ['#4f9e43', '#64b851', '#86cf63']
  const cy = y - size * 0.72
  ctx.beginPath()
  ctx.arc(x + sway, cy, size * 0.42, 0, Math.PI * 2)
  ctx.moveTo(x - size * 0.04 + sway, cy + size * 0.12)
  ctx.arc(x - size * 0.3 + sway, cy + size * 0.12, size * 0.26, 0, Math.PI * 2)
  ctx.moveTo(x + size * 0.56 + sway, cy + size * 0.1)
  ctx.arc(x + size * 0.3 + sway, cy + size * 0.1, size * 0.26, 0, Math.PI * 2)
  paint(ctx, dark, ink)
  ellipse(ctx, x - size * 0.04 + sway, cy - size * 0.04, size * 0.34, size * 0.3, mid)
  ellipse(ctx, x - size * 0.12 + sway, cy - size * 0.16, size * 0.18, size * 0.13, light)
  if (growth < 1) return
  // Fruit: many when ready, a few small green ones while they grow.
  const spots = [
    [-0.22, 0.05],
    [0.18, -0.1],
    [0.05, 0.18],
    [-0.05, -0.22],
    [0.28, 0.14],
    [-0.3, -0.06],
  ]
  if (fruit === 'cacao') {
    // Cacao pods grow on the trunk.
    for (const [dx, dy] of [
      [-0.08, -0.35],
      [0.08, -0.25],
      [-0.07, -0.15],
    ]) {
      if (ready) drawFruit(ctx, fruit, x + dx * size, y + dy * size, size * 0.2)
      else ellipse(ctx, x + dx * size, y + dy * size, size * 0.03, size * 0.05, '#8fc06a')
    }
  }
  for (const [dx, dy] of spots) {
    const fx = x + dx * size + sway
    const fy = cy + dy * size
    if (fruit === 'cacao') continue
    if (ready) drawFruit(ctx, fruit, fx, fy + Math.sin(t * 3 + dx * 9) * 1, size * 0.16)
    else ellipse(ctx, fx, fy, size * 0.03, size * 0.03, '#b8e08a')
  }
}

/** The orchard keeper's round hut, with a cone of thatch. */
export function drawHut(ctx: Ctx, x: number, y: number, w: number, h: number, t: number) {
  const ink = Math.max(1.5, w * 0.02)
  shadow(ctx, x + w / 2, y + h * 0.95, w * 0.5, h * 0.12)
  ctx.beginPath()
  ctx.moveTo(x + w * 0.12, y + h * 0.5)
  ctx.lineTo(x + w * 0.12, y + h * 0.92)
  ctx.quadraticCurveTo(x + w * 0.5, y + h * 1.02, x + w * 0.88, y + h * 0.92)
  ctx.lineTo(x + w * 0.88, y + h * 0.5)
  ctx.closePath()
  paint(ctx, '#d79a62', ink)
  // Painted patterns on the wall.
  ctx.strokeStyle = '#8e4f25'
  ctx.lineWidth = Math.max(1, w * 0.012)
  ctx.beginPath()
  for (let i = 0; i < 9; i++) {
    const px = x + w * (0.16 + i * 0.085)
    ctx.moveTo(px, y + h * 0.62)
    ctx.lineTo(px + w * 0.04, y + h * 0.68)
    ctx.lineTo(px + w * 0.08, y + h * 0.62)
  }
  ctx.stroke()
  // Door.
  ctx.beginPath()
  ctx.moveTo(x + w * 0.42, y + h * 0.95)
  ctx.lineTo(x + w * 0.42, y + h * 0.74)
  ctx.arc(x + w * 0.5, y + h * 0.74, w * 0.08, Math.PI, 0)
  ctx.lineTo(x + w * 0.58, y + h * 0.95)
  paint(ctx, '#5e3d27', ink * 0.8)
  // Thatched cone.
  ctx.beginPath()
  ctx.moveTo(x - w * 0.02, y + h * 0.56)
  ctx.lineTo(x + w * 0.5, y - h * 0.05)
  ctx.lineTo(x + w * 1.02, y + h * 0.56)
  ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.66, x - w * 0.02, y + h * 0.56)
  ctx.closePath()
  paint(ctx, '#e3b65e', ink)
  ctx.strokeStyle = 'rgba(140, 90, 30, 0.45)'
  ctx.lineWidth = Math.max(1, w * 0.01)
  for (let i = 1; i < 8; i++) {
    const k = i / 8
    ctx.beginPath()
    ctx.moveTo(x + w * 0.5, y)
    ctx.lineTo(x - w * 0.02 + k * w * 1.04, y + h * 0.58 + Math.sin(k * Math.PI) * h * 0.05)
    ctx.stroke()
  }
  ellipse(ctx, x + w * 0.5, y - h * 0.04, w * 0.05, h * 0.04, '#c99a4a', 0, ink * 0.7)
  // Smoke from inside, in the morning and evening.
  for (let i = 0; i < 3; i++) {
    const k = (t * 0.3 + i / 3) % 1
    ellipse(ctx, x + w * 0.5 + Math.sin(k * 5 + i) * 4, y - h * 0.08 - k * h * 0.4, 3 + k * 7, 3 + k * 7, `rgba(255,255,255,${0.45 * (1 - k)})`)
  }
}

export function drawPalm(ctx: Ctx, x: number, y: number, s: number, t: number) {
  const ink = Math.max(1.5, s * 0.025)
  const sway = wind(x, t) * s * 0.05
  shadow(ctx, x + s * 0.1, y, s * 0.3, s * 0.08)
  ctx.beginPath()
  ctx.moveTo(x - s * 0.05, y)
  ctx.quadraticCurveTo(x - s * 0.02, y - s * 0.5, x + s * 0.08 + sway, y - s * 0.95)
  ctx.lineTo(x + s * 0.14 + sway, y - s * 0.93)
  ctx.quadraticCurveTo(x + s * 0.06, y - s * 0.5, x + s * 0.05, y)
  ctx.closePath()
  paint(ctx, '#b07a4a', ink)
  const cx = x + s * 0.11 + sway
  const cy = y - s * 0.96
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i - 2.5) * 0.55 + Math.sin(t * 1.5 + i) * 0.05
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(a + Math.PI / 2)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(s * 0.2, -s * 0.12, s * 0.48, s * 0.1)
    ctx.quadraticCurveTo(s * 0.22, s * 0.02, 0, 0)
    paint(ctx, i % 2 ? '#4f9e43' : '#64b851', ink * 0.8)
    ctx.restore()
  }
  for (let i = 0; i < 3; i++) ellipse(ctx, cx - s * 0.05 + i * s * 0.05, cy + s * 0.04, s * 0.04, s * 0.04, '#7a5236', 0, ink * 0.5)
}

export function drawHammock(ctx: Ctx, x1: number, y: number, x2: number, t: number) {
  const sag = 18 + Math.sin(t * 1.2) * 3
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x1, y - 30)
  ctx.quadraticCurveTo((x1 + x2) / 2, y - 30 + sag * 2, x2, y - 30)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x1 + 10, y - 26)
  ctx.quadraticCurveTo((x1 + x2) / 2, y - 26 + sag * 2.2, x2 - 10, y - 26)
  ctx.quadraticCurveTo((x1 + x2) / 2, y - 26 + sag * 1.6, x1 + 10, y - 26)
  ctx.closePath()
  ctx.save()
  ctx.clip()
  const colors = [C.coral, C.gold, '#2f9e5b', C.cream]
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = colors[i % colors.length]
    ctx.fillRect(x1 + i * ((x2 - x1) / 12), y - 40, (x2 - x1) / 12, 60)
  }
  ctx.restore()
}

/** Water falling off the edge of the island into the clouds. */
export function drawWaterfall(ctx: Ctx, x: number, y: number, w: number, h: number, t: number) {
  ctx.fillStyle = 'rgba(120, 210, 230, 0.85)'
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + w, y)
  ctx.lineTo(x + w * 1.3, y + h)
  ctx.lineTo(x - w * 0.3, y + h)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.lineWidth = 2
  for (let i = 0; i < 4; i++) {
    const k = (t * 1.2 + i / 4) % 1
    const px = x + (i / 3) * w
    ctx.beginPath()
    ctx.moveTo(px, y + k * h * 0.8)
    ctx.lineTo(px + (px - x - w / 2) * 0.2, y + k * h * 0.8 + 16)
    ctx.stroke()
  }
  for (let i = 0; i < 5; i++) {
    const k = (t * 0.8 + i / 5) % 1
    ellipse(ctx, x + w / 2 + Math.sin(i * 2.3) * w, y + h, 10 + k * 16, 6 + k * 8, `rgba(255,255,255,${0.7 * (1 - k)})`)
  }
}

export function drawBasket(ctx: Ctx, fruit: FruitId, x: number, y: number, s: number) {
  ellipse(ctx, x, y, s * 0.4, s * 0.12, '#a87148', 0, Math.max(1.2, s * 0.03))
  for (let i = 0; i < 5; i++) drawFruit(ctx, fruit, x + (i - 2) * s * 0.14, y - s * 0.08 - (i % 2) * s * 0.06, s * 0.2)
  ctx.beginPath()
  ctx.moveTo(x - s * 0.4, y)
  ctx.lineTo(x - s * 0.32, y + s * 0.22)
  ctx.lineTo(x + s * 0.32, y + s * 0.22)
  ctx.lineTo(x + s * 0.4, y)
  ctx.closePath()
  paint(ctx, '#c4894f', Math.max(1.2, s * 0.03))
}

// --- the market -----------------------------------------------------------------------------------

const KENTE = [C.gold, '#2f9e5b', C.coral, '#2b2235']

/** A market stall with a kente-patterned awning. */
export function drawStall(ctx: Ctx, x: number, y: number, w: number, h: number, t: number, goods: ((gx: number, gy: number) => void) | null) {
  const ink = Math.max(1.5, w * 0.018)
  shadow(ctx, x + w / 2, y + h, w * 0.5, h * 0.1)
  for (const px of [0.06, 0.88]) {
    roundRect(ctx, x + w * px, y + h * 0.2, w * 0.06, h * 0.8, 3)
    paint(ctx, C.woodDark, ink)
  }
  roundRect(ctx, x + w * 0.02, y + h * 0.58, w * 0.96, h * 0.28, 6)
  paint(ctx, C.wood, ink)
  if (goods) goods(x + w / 2, y + h * 0.56)
  // Awning: kente blocks, waving a little.
  const wave = Math.sin(t * 2) * 2
  ctx.beginPath()
  ctx.moveTo(x - w * 0.04, y + h * 0.1)
  ctx.lineTo(x + w * 1.04, y + h * 0.1)
  ctx.lineTo(x + w * 1.04, y + h * 0.34 + wave)
  for (let i = 8; i >= 0; i--) ctx.lineTo(x - w * 0.04 + (i / 8) * w * 1.08, y + h * (i % 2 ? 0.3 : 0.36) + wave)
  ctx.closePath()
  ctx.save()
  ctx.clip()
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 3; j++) {
      ctx.fillStyle = KENTE[(i + j * 2) % KENTE.length]
      ctx.fillRect(x - w * 0.04 + i * (w * 0.108), y + h * 0.1 + j * h * 0.09, w * 0.108, h * 0.09)
    }
  }
  ctx.restore()
  ctx.beginPath()
  ctx.moveTo(x - w * 0.04, y + h * 0.1)
  ctx.lineTo(x + w * 1.04, y + h * 0.1)
  ctx.lineTo(x + w * 1.04, y + h * 0.34 + wave)
  for (let i = 8; i >= 0; i--) ctx.lineTo(x - w * 0.04 + (i / 8) * w * 1.08, y + h * (i % 2 ? 0.3 : 0.36) + wave)
  ctx.closePath()
  ctx.strokeStyle = C.ink
  ctx.lineWidth = ink
  ctx.stroke()
}

/** A string of little flags between two poles. */
export function drawBunting(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, t: number) {
  const n = Math.max(4, Math.round(Math.hypot(x2 - x1, y2 - y1) / 26))
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 + 24, x2, y2)
  ctx.stroke()
  for (let i = 1; i < n; i++) {
    const k = i / n
    const px = (1 - k) * (1 - k) * x1 + 2 * (1 - k) * k * ((x1 + x2) / 2) + k * k * x2
    const py = (1 - k) * (1 - k) * y1 + 2 * (1 - k) * k * ((y1 + y2) / 2 + 24) + k * k * y2
    const flap = Math.sin(t * 4 + i) * 3
    ctx.beginPath()
    ctx.moveTo(px - 7, py)
    ctx.lineTo(px + 7, py)
    ctx.lineTo(px + flap, py + 15)
    ctx.closePath()
    paint(ctx, KENTE[i % KENTE.length], 1)
  }
}

/** The wind merchant: a tall figure in a cloak that flutters, a kite above. */
export function drawMerchant(ctx: Ctx, x: number, y: number, s: number, t: number) {
  const ink = Math.max(1.5, s * 0.03)
  const float = Math.sin(t * 1.6) * s * 0.03
  shadow(ctx, x, y, s * 0.25, s * 0.07)
  ctx.save()
  ctx.translate(x, y - float)
  // Cloak, blown by the wind.
  const blow = Math.sin(t * 2.5) * s * 0.06
  ctx.beginPath()
  ctx.moveTo(-s * 0.14, -s * 0.7)
  ctx.quadraticCurveTo(-s * 0.3, -s * 0.3, -s * 0.24 - blow, -s * 0.02)
  ctx.lineTo(s * 0.26 - blow * 0.5, -s * 0.02)
  ctx.quadraticCurveTo(s * 0.3, -s * 0.3, s * 0.14, -s * 0.7)
  ctx.closePath()
  paint(ctx, C.sky, ink)
  ctx.save()
  ctx.clip()
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = KENTE[i % KENTE.length]
    ctx.fillRect(-s * 0.4, -s * 0.2 + (i % 2) * s * 0.06, s * 0.8, s * 0.04)
  }
  ctx.restore()
  // Head with a tall wrapped hat.
  ellipse(ctx, 0, -s * 0.8, s * 0.13, s * 0.14, '#8a5a3b', 0, ink)
  roundRect(ctx, -s * 0.13, -s * 1.06, s * 0.26, s * 0.2, s * 0.08)
  paint(ctx, C.gold, ink)
  ellipse(ctx, -s * 0.04, -s * 0.8, s * 0.018, s * 0.024, C.ink)
  ellipse(ctx, s * 0.05, -s * 0.8, s * 0.018, s * 0.024, C.ink)
  ctx.strokeStyle = C.ink
  ctx.lineWidth = ink * 0.8
  ctx.beginPath()
  ctx.arc(0, -s * 0.76, s * 0.05, 0.2, Math.PI - 0.2)
  ctx.stroke()
  // The kite on a string.
  const kx = s * 0.55 + Math.sin(t * 1.3) * s * 0.08
  const ky = -s * 1.5 + Math.cos(t * 1.7) * s * 0.06
  ctx.beginPath()
  ctx.moveTo(s * 0.14, -s * 0.55)
  ctx.quadraticCurveTo(s * 0.4, -s * 0.9, kx, ky + s * 0.12)
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(kx, ky - s * 0.12)
  ctx.lineTo(kx + s * 0.09, ky)
  ctx.lineTo(kx, ky + s * 0.12)
  ctx.lineTo(kx - s * 0.09, ky)
  ctx.closePath()
  paint(ctx, C.coral, ink * 0.8)
  ctx.restore()
}

// --- the celestial ruins --------------------------------------------------------------------------

const CRYSTAL_COLORS: Record<CrystalId, [string, string, string]> = {
  crystalBlue: ['#7fd3ff', '#3f9be0', '#d8f3ff'],
  crystalPink: ['#ff9ed8', '#d65aa8', '#ffe0f3'],
  crystalGold: ['#ffd95a', '#d99a1c', '#fff4c2'],
}

/** A crystal (barn item, or growing in the garden). */
export function drawCrystal(ctx: Ctx, kind: CrystalId, x: number, y: number, s: number, t = 0, growth = 1) {
  const [c, dark, light] = CRYSTAL_COLORS[kind]
  const ink = Math.max(1, s * 0.05)
  const k = Math.max(0.2, growth)
  const shards: [number, number, number][] = [
    [0, 0.5, 0],
    [-0.22, 0.32, -0.35],
    [0.22, 0.36, 0.3],
  ]
  for (const [dx, hgt, rot] of shards) {
    ctx.save()
    ctx.translate(x + dx * s, y + s * 0.3)
    ctx.rotate(rot)
    const hh = hgt * s * 1.4 * k
    ctx.beginPath()
    ctx.moveTo(-s * 0.1, 0)
    ctx.lineTo(-s * 0.1, -hh * 0.75)
    ctx.lineTo(0, -hh)
    ctx.lineTo(s * 0.1, -hh * 0.75)
    ctx.lineTo(s * 0.1, 0)
    ctx.closePath()
    paint(ctx, c, ink)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(0, -hh)
    ctx.lineTo(s * 0.1, -hh * 0.75)
    ctx.lineTo(s * 0.1, 0)
    ctx.closePath()
    paint(ctx, dark)
    ellipse(ctx, -s * 0.04, -hh * 0.5, s * 0.02, hh * 0.18, light)
    ctx.restore()
  }
  if (growth >= 1) {
    ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * Math.sin(t * 4 + x)})`
    star4(ctx, x + s * 0.2, y - s * 0.3, s * 0.06)
  }
}

/** A crystal plot of the garden: a ring of stones, the crystal growing in it. */
export function drawCrystalPlot(ctx: Ctx, x: number, y: number, s: number, kind: CrystalId | null, growth: number, ready: boolean, t: number) {
  ellipse(ctx, x, y, s * 0.42, s * 0.2, '#3b2f5a', 0, 2)
  ellipse(ctx, x, y - 2, s * 0.34, s * 0.14, '#4c3d73')
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2
    ellipse(ctx, x + Math.cos(a) * s * 0.4, y + Math.sin(a) * s * 0.18, s * 0.06, s * 0.045, '#8b80a8', 0, 1.2)
  }
  if (!kind) return
  if (ready) {
    ellipse(ctx, x, y - s * 0.2, s * 0.5, s * 0.5, `rgba(200, 160, 255, ${0.15 + 0.08 * Math.sin(t * 3)})`)
  }
  drawCrystal(ctx, kind, x, y - s * 0.38, s * 0.6, t, growth)
}

/** The masked keeper of the ruins: a hooded robe that floats, a white mask, eyes of violet light. */
export function drawKeeper(ctx: Ctx, x: number, y: number, s: number, t: number) {
  const ink = Math.max(1.5, s * 0.03)
  const float = Math.sin(t * 1.4) * s * 0.05
  ellipse(ctx, x, y, s * 0.22, s * 0.06, 'rgba(160, 120, 255, 0.25)')
  ctx.save()
  ctx.translate(x, y - s * 0.12 - float)
  // Robe, its hem waving like smoke.
  ctx.beginPath()
  ctx.moveTo(-s * 0.16, -s * 0.72)
  ctx.quadraticCurveTo(-s * 0.3, -s * 0.3, -s * 0.26, 0)
  for (let i = 0; i <= 6; i++) ctx.lineTo(-s * 0.26 + (i / 6) * s * 0.52, (i % 2 ? -s * 0.06 : 0) + Math.sin(t * 3 + i) * s * 0.02)
  ctx.quadraticCurveTo(s * 0.3, -s * 0.3, s * 0.16, -s * 0.72)
  ctx.closePath()
  paint(ctx, '#3a2c6b', ink)
  ctx.fillStyle = '#c9a4ff'
  for (let i = 0; i < 4; i++) star4(ctx, -s * 0.12 + i * s * 0.08, -s * 0.3 + (i % 2) * s * 0.1, s * 0.02)
  // Hood and mask.
  ellipse(ctx, 0, -s * 0.84, s * 0.2, s * 0.22, '#2c2155', 0, ink)
  ellipse(ctx, 0, -s * 0.8, s * 0.13, s * 0.16, '#f4f0ff', 0, ink * 0.8)
  const glow = 0.6 + 0.4 * Math.sin(t * 2.2)
  ellipse(ctx, -s * 0.05, -s * 0.83, s * 0.03, s * 0.02, `rgba(180, 120, 255, ${glow})`)
  ellipse(ctx, s * 0.05, -s * 0.83, s * 0.03, s * 0.02, `rgba(180, 120, 255, ${glow})`)
  ctx.strokeStyle = '#b9a6d9'
  ctx.lineWidth = Math.max(1, s * 0.012)
  ctx.beginPath()
  ctx.moveTo(-s * 0.06, -s * 0.72)
  ctx.lineTo(s * 0.06, -s * 0.72)
  ctx.stroke()
  // Staff with a crystal.
  roundRect(ctx, s * 0.22, -s * 0.95, s * 0.035, s * 0.95, s * 0.015)
  paint(ctx, '#6e5a94', ink * 0.7)
  drawCrystal(ctx, 'crystalPink', s * 0.24, -s * 1.02, s * 0.22, t)
  ctx.restore()
}

/** A lantern on a stone pedestal: dark, or with a floating flame of light. */
export function drawLantern(ctx: Ctx, x: number, y: number, s: number, lit: boolean, t: number) {
  const ink = Math.max(1.5, s * 0.03)
  shadow(ctx, x, y, s * 0.24, s * 0.07)
  roundRect(ctx, x - s * 0.16, y - s * 0.5, s * 0.32, s * 0.5, s * 0.05)
  paint(ctx, '#8b80a8', ink)
  roundRect(ctx, x - s * 0.2, y - s * 0.56, s * 0.4, s * 0.1, s * 0.04)
  paint(ctx, '#a79cc4', ink)
  ctx.strokeStyle = 'rgba(60, 40, 90, 0.4)'
  ctx.beginPath()
  ctx.moveTo(x - s * 0.1, y - s * 0.35)
  ctx.lineTo(x + s * 0.1, y - s * 0.2)
  ctx.stroke()
  if (lit) {
    const f = Math.sin(t * 5) * s * 0.02
    ellipse(ctx, x, y - s * 0.75, s * 0.3, s * 0.3, 'rgba(255, 210, 140, 0.18)')
    ellipse(ctx, x, y - s * 0.72 + f, s * 0.09, s * 0.14, '#ffb35a')
    ellipse(ctx, x, y - s * 0.7 + f, s * 0.05, s * 0.08, '#fff2c4')
  } else ellipse(ctx, x, y - s * 0.64, s * 0.05, s * 0.03, '#4c3d73')
}

/** The glyph of a rune (0 to 3): moon, eye, wave, spiral. */
export function drawGlyph(ctx: Ctx, glyph: number, x: number, y: number, s: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.5, s * 0.12)
  ctx.lineCap = 'round'
  ctx.beginPath()
  if (glyph === 0) {
    ctx.arc(x, y, s * 0.4, Math.PI * 0.3, Math.PI * 1.7)
    ctx.arc(x + s * 0.18, y, s * 0.3, Math.PI * 1.6, Math.PI * 0.4, true)
  } else if (glyph === 1) {
    ctx.ellipse(x, y, s * 0.45, s * 0.25, 0, 0, Math.PI * 2)
    ctx.moveTo(x + s * 0.12, y)
    ctx.arc(x, y, s * 0.12, 0, Math.PI * 2)
  } else if (glyph === 2) {
    ctx.moveTo(x - s * 0.45, y)
    for (let i = 0; i <= 8; i++) ctx.lineTo(x - s * 0.45 + (i / 8) * s * 0.9, y + Math.sin(i * 1.6) * s * 0.2)
    ctx.moveTo(x - s * 0.35, y + s * 0.35)
    ctx.lineTo(x + s * 0.35, y + s * 0.35)
  } else {
    for (let i = 0; i <= 30; i++) {
      const a = i * 0.45
      const r = s * 0.04 + i * s * 0.014
      const px = x + Math.cos(a) * r
      const py = y + Math.sin(a) * r
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
  }
  ctx.stroke()
}

/** A standing rune stone. `active`: touched in the right order (glows). */
export function drawRune(ctx: Ctx, glyph: number, x: number, y: number, s: number, active: boolean, t: number) {
  const ink = Math.max(1.5, s * 0.03)
  shadow(ctx, x, y, s * 0.24, s * 0.07)
  ctx.beginPath()
  ctx.moveTo(x - s * 0.2, y)
  ctx.lineTo(x - s * 0.24, y - s * 0.6)
  ctx.quadraticCurveTo(x, y - s * 0.86, x + s * 0.22, y - s * 0.62)
  ctx.lineTo(x + s * 0.2, y)
  ctx.closePath()
  paint(ctx, '#7b6f9a', ink)
  ellipse(ctx, x - s * 0.1, y - s * 0.55, s * 0.05, s * 0.12, 'rgba(255,255,255,0.15)')
  if (active) ellipse(ctx, x, y - s * 0.38, s * 0.3, s * 0.3, `rgba(170, 120, 255, ${0.25 + 0.1 * Math.sin(t * 4)})`)
  drawGlyph(ctx, glyph, x, y - s * 0.38, s * 0.28, active ? '#e3d0ff' : '#4c3d73')
}

/** The mural of the north: four glyphs carved in the order to follow. */
export function drawMural(ctx: Ctx, x: number, y: number, w: number, h: number, order: number[], t: number) {
  const ink = Math.max(1.5, w * 0.012)
  shadow(ctx, x + w / 2, y + h, w * 0.5, h * 0.1)
  roundRect(ctx, x, y, w, h, 8)
  paint(ctx, '#6d6290', ink)
  roundRect(ctx, x + w * 0.04, y + h * 0.12, w * 0.92, h * 0.76, 6)
  paint(ctx, '#5a4f7d')
  // Cracks and moss.
  ctx.strokeStyle = 'rgba(30, 20, 50, 0.4)'
  ctx.beginPath()
  ctx.moveTo(x + w * 0.2, y)
  ctx.lineTo(x + w * 0.24, y + h * 0.3)
  ctx.lineTo(x + w * 0.18, y + h * 0.5)
  ctx.stroke()
  ellipse(ctx, x + w * 0.85, y + h * 0.95, w * 0.12, h * 0.1, '#5a9a6a')
  order.forEach((glyph, i) => {
    const gx = x + w * (0.16 + i * 0.226)
    const pulse = 0.6 + 0.4 * Math.sin(t * 2 - i * 0.8)
    drawGlyph(ctx, glyph, gx, y + h * 0.5, h * 0.36, `rgba(220, 200, 255, ${pulse})`)
    ctx.fillStyle = 'rgba(220,200,255,0.5)'
    ctx.font = `700 ${Math.round(h * 0.16)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText('·'.repeat(i + 1), gx, y + h * 0.86)
  })
}

/** The star altar of the sanctuary; `dust`: grains of star dust laid on it. */
export function drawAltar(ctx: Ctx, x: number, y: number, s: number, dust: number, glow: boolean, t: number) {
  const ink = Math.max(1.5, s * 0.025)
  shadow(ctx, x, y, s * 0.5, s * 0.12)
  roundRect(ctx, x - s * 0.45, y - s * 0.3, s * 0.9, s * 0.3, s * 0.06)
  paint(ctx, '#8b80a8', ink)
  roundRect(ctx, x - s * 0.36, y - s * 0.5, s * 0.72, s * 0.22, s * 0.05)
  paint(ctx, '#a79cc4', ink)
  // A star carved on top.
  ctx.fillStyle = glow ? '#fff4c2' : '#5a4f7d'
  star4(ctx, x, y - s * 0.6, s * 0.08)
  if (glow) {
    ellipse(ctx, x, y - s * 0.7, s * 0.6, s * 0.6, `rgba(255, 240, 180, ${0.15 + 0.08 * Math.sin(t * 2)})`)
    for (let i = 0; i < 8; i++) {
      const a = t * 0.8 + (i / 8) * Math.PI * 2
      ctx.fillStyle = 'rgba(255, 245, 200, 0.8)'
      star4(ctx, x + Math.cos(a) * s * 0.5, y - s * 0.7 + Math.sin(a) * s * 0.2, s * 0.025)
    }
  }
  for (let i = 0; i < dust; i++) {
    const a = t + (i / 5) * Math.PI * 2
    ctx.fillStyle = '#fff6c8'
    star4(ctx, x + Math.cos(a) * s * 0.18, y - s * 0.75 + Math.sin(a * 1.3) * s * 0.06, s * 0.03)
  }
}

/** A fallen statue of the old keepers. */
export function drawStatue(ctx: Ctx, x: number, y: number, s: number, broken: boolean) {
  const ink = Math.max(1.5, s * 0.03)
  shadow(ctx, x, y, s * 0.3, s * 0.08)
  roundRect(ctx, x - s * 0.22, y - s * 0.18, s * 0.44, s * 0.18, s * 0.04)
  paint(ctx, '#8b80a8', ink)
  ctx.beginPath()
  ctx.moveTo(x - s * 0.14, y - s * 0.18)
  ctx.lineTo(x - s * 0.16, y - s * 0.7)
  ctx.quadraticCurveTo(x, y - s * 0.78, x + s * 0.16, y - s * 0.7)
  ctx.lineTo(x + s * 0.14, y - s * 0.18)
  ctx.closePath()
  paint(ctx, '#a79cc4', ink)
  if (!broken) {
    ellipse(ctx, x, y - s * 0.86, s * 0.14, s * 0.16, '#a79cc4', 0, ink)
    ellipse(ctx, x, y - s * 0.84, s * 0.08, s * 0.1, '#e6e0f5', 0, ink * 0.7)
  } else {
    ctx.beginPath()
    ctx.moveTo(x - s * 0.16, y - s * 0.7)
    ctx.lineTo(x - s * 0.05, y - s * 0.76)
    ctx.lineTo(x + s * 0.04, y - s * 0.68)
    ctx.lineTo(x + s * 0.16, y - s * 0.74)
    ctx.strokeStyle = 'rgba(40,30,60,0.5)'
    ctx.stroke()
    ellipse(ctx, x + s * 0.32, y - s * 0.06, s * 0.12, s * 0.1, '#a79cc4', 0.4, ink)
  }
  ellipse(ctx, x - s * 0.1, y - s * 0.05, s * 0.1, s * 0.05, '#5a9a6a')
}

/** A lantern spirit: a little wisp of light that drifts and follows the farmer around. */
export function drawSpirit(ctx: Ctx, x: number, y: number, s: number, t: number, hue: string) {
  ellipse(ctx, x, y, s * 1.8, s * 1.8, hue.replace('A', '0.12'))
  ellipse(ctx, x, y, s, s * 1.1, hue.replace('A', '0.8'), 0, 1.2)
  ctx.beginPath()
  ctx.moveTo(x - s * 0.7, y + s * 0.5)
  ctx.quadraticCurveTo(x - s * 0.2 + Math.sin(t * 6) * s * 0.3, y + s * 1.6, x, y + s * 2)
  ctx.quadraticCurveTo(x + s * 0.2, y + s * 1.2, x + s * 0.7, y + s * 0.5)
  ctx.fillStyle = hue.replace('A', '0.6')
  ctx.fill()
  ellipse(ctx, x - s * 0.3, y - s * 0.1, s * 0.14, s * 0.2, '#2b2235')
  ellipse(ctx, x + s * 0.3, y - s * 0.1, s * 0.14, s * 0.2, '#2b2235')
}

/** A grain of star dust, fallen at night. */
export function drawStardust(ctx: Ctx, x: number, y: number, t: number) {
  const pulse = 0.6 + 0.4 * Math.sin(t * 5 + x)
  ellipse(ctx, x, y, 14, 14, `rgba(255, 245, 190, ${0.18 * pulse})`)
  ctx.fillStyle = `rgba(255, 250, 220, ${pulse})`
  star4(ctx, x, y - Math.sin(t * 3 + x) * 3, 4)
}

/** A bridge of light between two points (the secret path of the ruins). `k`: 0 to 1 as it appears. */
export function drawLightBridge(ctx: Ctx, x1: number, y: number, x2: number, h: number, k: number, t: number) {
  if (k <= 0) return
  const len = (x2 - x1) * k
  const g = ctx.createLinearGradient(x1, y, x1, y + h)
  g.addColorStop(0, 'rgba(220, 200, 255, 0.85)')
  g.addColorStop(1, 'rgba(160, 120, 255, 0.55)')
  roundRect(ctx, x1, y, len, h, h / 2)
  ctx.fillStyle = g
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
  ctx.lineWidth = 2
  ctx.stroke()
  for (let i = 0; i < 6; i++) {
    const px = x1 + (((t * 60 + i * 50) % Math.max(1, len)) || 0)
    ctx.fillStyle = 'rgba(255, 250, 230, 0.9)'
    star4(ctx, px, y + h / 2, 2.5)
  }
}

/** Crystal spires floating far away (background of the ruins). */
export function drawSpire(ctx: Ctx, x: number, y: number, s: number, t: number) {
  const bob = Math.sin(t * 0.6 + x) * s * 0.05
  ctx.globalAlpha = 0.55
  ctx.beginPath()
  ctx.moveTo(x, y - s + bob)
  ctx.lineTo(x + s * 0.18, y - s * 0.3 + bob)
  ctx.lineTo(x, y + bob)
  ctx.lineTo(x - s * 0.18, y - s * 0.3 + bob)
  ctx.closePath()
  ctx.fillStyle = '#b9a6ff'
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x, y - s + bob)
  ctx.lineTo(x + s * 0.18, y - s * 0.3 + bob)
  ctx.lineTo(x, y + bob)
  ctx.closePath()
  ctx.fillStyle = '#8f7ce0'
  ctx.fill()
  ctx.globalAlpha = 1
}

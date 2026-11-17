// Drawing of Cloud Acres: everything is drawn with the canvas API (no image to download).
// The look: an island farm floating above a sea of clouds at golden hour, in a storybook style:
// flat colors, a warm ink outline, one light and one shade, soft shadows cast to the bottom right.

import type { CropId } from './data'

export type VillagerId = 'bunny' | 'hedgehog' | 'frog' | 'fox' | 'bear'

/** The villagers who send orders (original characters). */
export const VILLAGERS: { id: VillagerId; body: string; accent: string }[] = [
  { id: 'bunny', body: '#f7efe6', accent: '#ffb8c6' },
  { id: 'hedgehog', body: '#b07a52', accent: '#f4dcbc' },
  { id: 'frog', body: '#86d37a', accent: '#eafbd0' },
  { id: 'fox', body: '#f58f45', accent: '#fff3e2' },
  { id: 'bear', body: '#94694b', accent: '#e0bc95' },
]

/** The colors of the game. */
export const C = {
  ink: '#3d2a45',
  shadow: 'rgba(61, 42, 69, 0.2)',
  grass: '#a3d36b',
  grassDeep: '#86bd57',
  grassLight: '#bfe385',
  sand: '#f4dfae',
  sandEdge: '#dcbd84',
  soil: '#c98855',
  soilDark: '#9d6239',
  soilWet: '#8a5434',
  water: '#58cfd3',
  waterLight: '#b4f3ea',
  waterDeep: '#3aa6b6',
  wood: '#c08752',
  woodDark: '#8b5a36',
  woodLight: '#dfae74',
  cream: '#fff4e0',
  paper: '#fffaf1',
  paper2: '#f6ead6',
  teal: '#2fb39d',
  tealDark: '#1d8676',
  coral: '#ff7d63',
  coralDark: '#d65a42',
  gold: '#ffc540',
  goldDark: '#d99a1c',
  plum: '#8d6be0',
  plumDark: '#6a4cb8',
  sky: '#5aa9ff',
  skyDark: '#3b80d4',
  rose: '#ff9db0',
  mint: '#a6ecd0',
  leaf: '#5fb848',
  leafDark: '#3f8f3a',
  text: '#3d2a45',
  muted: '#8f7d8a',
}

type Ctx = CanvasRenderingContext2D

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Fills the current path, and draws its ink outline when `ink` > 0 (line width). */
export function paint(ctx: Ctx, color: string, ink = 0) {
  ctx.fillStyle = color
  ctx.fill()
  if (ink > 0) {
    ctx.strokeStyle = C.ink
    ctx.lineWidth = ink
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()
  }
}

export function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, color: string, rotation = 0, ink = 0) {
  ctx.beginPath()
  ctx.ellipse(x, y, Math.max(rx, 0.1), Math.max(ry, 0.1), rotation, 0, Math.PI * 2)
  paint(ctx, color, ink)
}

/** A soft shadow on the ground, cast to the bottom right by the low sun. */
export function shadow(ctx: Ctx, x: number, y: number, rx: number, ry: number, strength = 1) {
  ctx.fillStyle = `rgba(61, 42, 69, ${0.18 * strength})`
  ctx.beginPath()
  ctx.ellipse(x + rx * 0.18, y + ry * 0.25, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, Math.PI * 2)
  ctx.fill()
}

export function leaf(ctx: Ctx, x: number, y: number, length: number, angle: number, color: string, ink = 0) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(length * 0.5, -length * 0.35, 0, -length)
  ctx.quadraticCurveTo(-length * 0.5, -length * 0.35, 0, 0)
  paint(ctx, color, ink)
  ctx.restore()
}

/** The wind over the island: a gust that crosses the map from west to east (-1..1). */
export function wind(x: number, t: number) {
  const gust = 0.55 + 0.45 * Math.sin(t * 0.23)
  return (Math.sin(t * 1.9 - x * 0.012) * 0.6 + Math.sin(t * 3.7 - x * 0.03) * 0.25) * gust
}

const GOLD = '#ffd54a'

/** A harvested crop (for orders, the seed bar and flying items). `s` is about its height. */
export function drawProduce(ctx: Ctx, id: CropId, x: number, y: number, s: number, golden = false, gray = false) {
  ctx.save()
  const ink = Math.max(1, s * 0.05)
  const tint = (color: string) => (gray ? '#a59a8c' : golden ? GOLD : color)
  const green = gray ? '#90876e' : golden ? '#f6c945' : C.leaf
  const darkGreen = gray ? '#756c58' : golden ? '#e0a92e' : C.leafDark
  switch (id) {
    case 'carrot': {
      leaf(ctx, x - s * 0.06, y - s * 0.26, s * 0.34, -0.45, green, ink)
      leaf(ctx, x + s * 0.06, y - s * 0.26, s * 0.34, 0.45, green, ink)
      leaf(ctx, x, y - s * 0.26, s * 0.42, 0, darkGreen, ink)
      ctx.beginPath()
      ctx.moveTo(x - s * 0.22, y - s * 0.28)
      ctx.quadraticCurveTo(x, y - s * 0.38, x + s * 0.22, y - s * 0.28)
      ctx.quadraticCurveTo(x + s * 0.12, y + s * 0.18, x + s * 0.01, y + s * 0.44)
      ctx.quadraticCurveTo(x - s * 0.12, y + s * 0.18, x - s * 0.22, y - s * 0.28)
      paint(ctx, tint('#ff8f3a'), ink)
      ctx.strokeStyle = 'rgba(140, 60, 10, 0.4)'
      ctx.lineWidth = Math.max(1, s * 0.035)
      for (const k of [-0.12, 0.04, 0.18]) {
        ctx.beginPath()
        ctx.moveTo(x - s * 0.12 + k * s * 0.3, y + s * k)
        ctx.lineTo(x + s * 0.02, y + s * (k + 0.03))
        ctx.stroke()
      }
      ellipse(ctx, x - s * 0.1, y - s * 0.18, s * 0.04, s * 0.1, 'rgba(255,255,255,0.45)', 0.3)
      break
    }
    case 'wheat': {
      // A sheaf tied with a ribbon.
      for (const dx of [-0.2, 0.2, 0]) {
        const top = y - s * 0.46 + Math.abs(dx) * s * 0.3
        ctx.strokeStyle = C.ink
        ctx.lineWidth = Math.max(1.6, s * 0.08)
        ctx.beginPath()
        ctx.moveTo(x + dx * s * 0.3, y + s * 0.44)
        ctx.quadraticCurveTo(x + dx * s * 0.6, y, x + dx * s * 1.2, top + s * 0.24)
        ctx.stroke()
        ctx.strokeStyle = tint('#e0b44a')
        ctx.lineWidth = Math.max(1, s * 0.04)
        ctx.stroke()
        ctx.beginPath()
        ctx.ellipse(x + dx * s * 1.2, top + s * 0.08, s * 0.085, s * 0.2, dx * 1.5, 0, Math.PI * 2)
        paint(ctx, tint('#f7cd57'), ink)
        ctx.strokeStyle = 'rgba(160, 110, 20, 0.5)'
        ctx.lineWidth = Math.max(0.8, s * 0.025)
        for (let i = 0; i < 3; i++) {
          ctx.beginPath()
          ctx.moveTo(x + dx * s * 1.2 - s * 0.06, top + s * (0.0 + i * 0.07))
          ctx.lineTo(x + dx * s * 1.2 + s * 0.06, top + s * (0.03 + i * 0.07))
          ctx.stroke()
        }
      }
      roundRect(ctx, x - s * 0.13, y + s * 0.08, s * 0.26, s * 0.1, s * 0.04)
      paint(ctx, gray ? '#8f8577' : C.coral, ink)
      break
    }
    case 'tomato': {
      ellipse(ctx, x, y + s * 0.06, s * 0.36, s * 0.32, tint('#ff5a4f'), 0, ink)
      ctx.strokeStyle = 'rgba(150, 30, 20, 0.3)'
      ctx.lineWidth = Math.max(1, s * 0.03)
      ctx.beginPath()
      ctx.moveTo(x - s * 0.12, y - s * 0.18)
      ctx.quadraticCurveTo(x - s * 0.2, y + s * 0.1, x - s * 0.08, y + s * 0.34)
      ctx.moveTo(x + s * 0.12, y - s * 0.18)
      ctx.quadraticCurveTo(x + s * 0.2, y + s * 0.1, x + s * 0.08, y + s * 0.34)
      ctx.stroke()
      ellipse(ctx, x - s * 0.15, y - s * 0.06, s * 0.08, s * 0.05, 'rgba(255,255,255,0.6)', -0.5)
      for (let i = 0; i < 5; i++) leaf(ctx, x, y - s * 0.22, s * 0.17, (i / 5) * Math.PI * 2, green, ink * 0.7)
      ellipse(ctx, x, y - s * 0.25, s * 0.04, s * 0.06, darkGreen, 0, ink * 0.7)
      break
    }
    case 'corn': {
      leaf(ctx, x - s * 0.02, y + s * 0.44, s * 0.72, -0.36, green, ink)
      leaf(ctx, x + s * 0.02, y + s * 0.44, s * 0.72, 0.36, darkGreen, ink)
      ellipse(ctx, x, y - s * 0.02, s * 0.17, s * 0.38, tint('#ffd94a'), 0, ink)
      ctx.fillStyle = gray ? 'rgba(80,70,50,0.25)' : 'rgba(200, 130, 0, 0.35)'
      for (let row = -3; row <= 3; row++) {
        for (const col of [-1, 0, 1]) {
          ctx.beginPath()
          ctx.arc(x + col * s * 0.07, y + row * s * 0.09, s * 0.024, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      leaf(ctx, x, y + s * 0.42, s * 0.42, -0.12, green, ink)
      break
    }
    case 'pumpkin': {
      const c = tint('#ff9a2e')
      const shade = gray ? '#857a6c' : golden ? '#e8b730' : '#e9781c'
      ellipse(ctx, x - s * 0.2, y + s * 0.1, s * 0.22, s * 0.28, shade, 0, ink)
      ellipse(ctx, x + s * 0.2, y + s * 0.1, s * 0.22, s * 0.28, shade, 0, ink)
      ellipse(ctx, x, y + s * 0.1, s * 0.24, s * 0.31, c, 0, ink)
      ellipse(ctx, x - s * 0.07, y - s * 0.02, s * 0.05, s * 0.11, 'rgba(255,255,255,0.4)', 0.2)
      roundRect(ctx, x - s * 0.04, y - s * 0.34, s * 0.08, s * 0.16, s * 0.03)
      paint(ctx, gray ? '#5d5141' : '#6d4c2f', ink * 0.8)
      leaf(ctx, x + s * 0.04, y - s * 0.26, s * 0.22, 1.1, green, ink * 0.8)
      break
    }
  }
  if (golden && !gray) {
    ctx.fillStyle = '#fffbe0'
    for (const [dx, dy, r] of [
      [-0.32, -0.3, 0.06],
      [0.3, -0.12, 0.05],
      [0.18, 0.32, 0.04],
    ]) {
      star4(ctx, x + dx * s, y + dy * s, r * s)
    }
  }
  ctx.restore()
}

function star4(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x, y - r * 2)
  ctx.quadraticCurveTo(x, y, x + r * 2, y)
  ctx.quadraticCurveTo(x, y, x, y + r * 2)
  ctx.quadraticCurveTo(x, y, x - r * 2, y)
  ctx.quadraticCurveTo(x, y, x, y - r * 2)
  ctx.fill()
}

/**
 * A crop on its plot. `growth` goes from 0 (seed) to 1 (ripe). `x, y` is the center of the plot,
 * `s` its size. `pop` (0..1, decreasing) makes it bounce, right after being planted.
 */
export function drawPlant(ctx: Ctx, id: CropId, x: number, y: number, s: number, growth: number, ripe: boolean, wilted: boolean, golden: boolean, t: number, pop = 0) {
  const sway = wind(x, t) * 0.12
  const ink = Math.max(1, s * 0.025)
  ctx.save()
  ctx.translate(x, y + s * 0.2)
  if (pop > 0) {
    // Squash and stretch, settling down.
    const k = Math.sin(pop * Math.PI * 3) * pop
    ctx.scale(1 - k * 0.25, 1 + k * 0.35)
  }
  ctx.translate(-x, -(y + s * 0.2))
  if (wilted) {
    leaf(ctx, x - s * 0.05, y + s * 0.18, s * 0.28, -1.2, '#8b7a55', ink)
    leaf(ctx, x + s * 0.05, y + s * 0.18, s * 0.28, 1.25, '#7a6a48', ink)
    drawProduce(ctx, id, x, y + s * 0.06, s * 0.42, false, true)
  } else if (growth < 0.12) {
    // A seed in its little hole.
    ellipse(ctx, x, y + s * 0.15, s * 0.09, s * 0.05, C.soilDark)
    ellipse(ctx, x, y + s * 0.13, s * 0.045, s * 0.04, '#f2d8a0', 0, ink * 0.8)
  } else if (!ripe) {
    const g = Math.min(1, (growth - 0.12) / 0.88)
    if (g < 0.35) {
      // A sprout with two round leaves.
      ctx.strokeStyle = C.leafDark
      ctx.lineWidth = Math.max(1.5, s * 0.03)
      ctx.beginPath()
      ctx.moveTo(x, y + s * 0.2)
      ctx.lineTo(x + sway * s * 0.3, y + s * 0.06)
      ctx.stroke()
      ellipse(ctx, x - s * 0.07 + sway * s * 0.3, y + s * 0.05, s * 0.07, s * 0.045, '#8fd468', -0.4, ink)
      ellipse(ctx, x + s * 0.07 + sway * s * 0.3, y + s * 0.05, s * 0.07, s * 0.045, '#8fd468', 0.4, ink)
    } else {
      const length = s * (0.16 + 0.26 * g)
      const color = growth > 0.6 ? C.leaf : '#7ccd5c'
      leaf(ctx, x, y + s * 0.2, length, -0.6 + sway, color, ink)
      leaf(ctx, x, y + s * 0.2, length, 0.6 + sway, color, ink)
      if (g > 0.55) leaf(ctx, x, y + s * 0.2, length * 1.15, sway, C.leafDark, ink)
      if (g > 0.75) {
        ctx.globalAlpha = (g - 0.75) / 0.25
        drawProduce(ctx, id, x + sway * s * 0.2, y - s * 0.02, s * 0.3 * g, golden)
        ctx.globalAlpha = 1
      }
    }
  } else {
    const bob = Math.sin(t * 5 + x) * s * 0.02
    leaf(ctx, x, y + s * 0.22, s * 0.36, -0.85 + sway, C.leaf, ink)
    leaf(ctx, x, y + s * 0.22, s * 0.36, 0.85 + sway, C.leafDark, ink)
    drawProduce(ctx, id, x + sway * s * 0.25, y - s * 0.02 + bob, s * 0.52, golden)
  }
  ctx.restore()
}

/** A villager's face, for order cards. */
export function drawVillager(ctx: Ctx, id: VillagerId, x: number, y: number, s: number, mood: 'happy' | 'neutral' | 'sad', t: number) {
  const v = VILLAGERS.find((item) => item.id === id) ?? VILLAGERS[0]
  const blink = Math.sin(t * 1.3 + x) > 0.985
  const ink = Math.max(1.2, s * 0.035)
  const tilt = Math.sin(t * 1.6 + x) * 0.05
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(tilt)
  ctx.translate(-x, -y)
  if (id === 'bunny') {
    for (const side of [-1, 1]) {
      ellipse(ctx, x + side * s * 0.17, y - s * 0.42, s * 0.1, s * 0.28, v.body, side * 0.15, ink)
      ellipse(ctx, x + side * s * 0.17, y - s * 0.42, s * 0.045, s * 0.19, v.accent, side * 0.15)
    }
  } else if (id === 'hedgehog') {
    ctx.beginPath()
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.95 + (i / 10) * Math.PI * 1.1
      const r = i % 2 ? s * 0.5 : s * 0.36
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.95)
    }
    ctx.closePath()
    paint(ctx, '#7a5236', ink)
  } else if (id === 'fox') {
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(x + side * s * 0.1, y - s * 0.26)
      ctx.lineTo(x + side * s * 0.34, y - s * 0.52)
      ctx.lineTo(x + side * s * 0.36, y - s * 0.12)
      ctx.closePath()
      paint(ctx, v.body, ink)
    }
  } else if (id === 'bear') {
    for (const side of [-1, 1]) {
      ellipse(ctx, x + side * s * 0.26, y - s * 0.26, s * 0.12, s * 0.12, v.body, 0, ink)
      ellipse(ctx, x + side * s * 0.26, y - s * 0.26, s * 0.06, s * 0.06, v.accent)
    }
  }
  if (id === 'frog') {
    ellipse(ctx, x - s * 0.17, y - s * 0.24, s * 0.13, s * 0.13, v.body, 0, ink)
    ellipse(ctx, x + s * 0.17, y - s * 0.24, s * 0.13, s * 0.13, v.body, 0, ink)
  }
  ellipse(ctx, x, y, s * 0.36, s * 0.32, v.body, 0, ink)
  ellipse(ctx, x, y + s * 0.1, s * 0.22, s * 0.15, v.accent)
  const eyeY = id === 'frog' ? y - s * 0.24 : y - s * 0.05
  for (const side of [-1, 1]) {
    if (id === 'frog') ellipse(ctx, x + side * s * 0.17, eyeY, s * 0.08, s * 0.08, '#fff')
    if (blink) {
      ctx.strokeStyle = C.ink
      ctx.lineWidth = ink
      ctx.beginPath()
      ctx.moveTo(x + side * s * 0.17 - s * 0.04, eyeY)
      ctx.lineTo(x + side * s * 0.17 + s * 0.04, eyeY)
      ctx.stroke()
    } else {
      ellipse(ctx, x + side * s * 0.15, eyeY, s * 0.05, s * 0.06, C.ink)
      ellipse(ctx, x + side * s * 0.15 + s * 0.017, eyeY - s * 0.022, s * 0.017, s * 0.017, '#fff')
    }
  }
  ellipse(ctx, x - s * 0.24, y + s * 0.07, s * 0.06, s * 0.035, 'rgba(255, 110, 130, 0.45)')
  ellipse(ctx, x + s * 0.24, y + s * 0.07, s * 0.06, s * 0.035, 'rgba(255, 110, 130, 0.45)')
  if (id !== 'frog') ellipse(ctx, x, y + s * 0.04, s * 0.05, s * 0.035, C.ink)
  ctx.strokeStyle = C.ink
  ctx.lineWidth = ink
  ctx.lineCap = 'round'
  ctx.beginPath()
  const my = y + s * 0.13
  if (mood === 'happy') ctx.arc(x, my - s * 0.03, s * 0.07, 0.2, Math.PI - 0.2)
  else if (mood === 'sad') ctx.arc(x, my + s * 0.05, s * 0.06, Math.PI + 0.3, -0.3)
  else {
    ctx.moveTo(x - s * 0.04, my)
    ctx.lineTo(x + s * 0.04, my)
  }
  ctx.stroke()
  ctx.restore()
}

/** A coin of the island: gold, with a little cloud stamped on it. */
export function drawCoin(ctx: Ctx, x: number, y: number, r: number, spin = 0) {
  const w = r * Math.max(0.15, Math.abs(Math.cos(spin)))
  const ink = Math.max(1, r * 0.14)
  ellipse(ctx, x, y + r * 0.14, w, r, C.goldDark, 0, ink)
  ellipse(ctx, x, y, w, r, C.gold, 0, ink)
  if (w > r * 0.5) {
    ctx.fillStyle = '#ffe48a'
    ctx.beginPath()
    ctx.ellipse(x, y, w * 0.68, r * 0.68, 0, 0, Math.PI * 2)
    ctx.fill()
    // The cloud.
    const k = (w / r) * 0.9
    ctx.fillStyle = C.goldDark
    ctx.beginPath()
    ctx.arc(x - r * 0.18 * k, y + r * 0.06, r * 0.17, 0, Math.PI * 2)
    ctx.arc(x + r * 0.05 * k, y - r * 0.06, r * 0.22, 0, Math.PI * 2)
    ctx.arc(x + r * 0.26 * k, y + r * 0.08, r * 0.15, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(x - r * 0.18 * k, y + r * 0.06, r * 0.44 * k, r * 0.17)
  }
  ellipse(ctx, x - w * 0.42, y - r * 0.42, w * 0.16, r * 0.1, 'rgba(255,255,255,0.7)', -0.6)
}

/** A puffy cloud with a flat bottom, `s` about its height. */
export function drawCloud(ctx: Ctx, x: number, y: number, s: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, s * 0.5, 0, Math.PI * 2)
  ctx.arc(x + s * 0.55, y + s * 0.1, s * 0.38, 0, Math.PI * 2)
  ctx.arc(x - s * 0.55, y + s * 0.12, s * 0.34, 0, Math.PI * 2)
  ctx.arc(x + s * 0.2, y - s * 0.25, s * 0.36, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillRect(x - s * 0.55, y + s * 0.05, s * 1.1, s * 0.41)
}

/** A plot: a soft mound of soil with furrows. `wet` darkens it, `highlight` circles it. */
export function drawPlot(ctx: Ctx, x: number, y: number, s: number, highlight: number, wet: boolean) {
  const r = s * 0.3
  const ink = Math.max(1, s * 0.03)
  // Its side (the mound is a bit raised), then its top.
  roundRect(ctx, x - s / 2, y - s / 2 + s * 0.08, s, s * 0.94, r)
  paint(ctx, wet ? '#6e4129' : C.soilDark, ink)
  roundRect(ctx, x - s / 2, y - s / 2, s, s * 0.9, r)
  paint(ctx, wet ? C.soilWet : C.soil)
  ctx.strokeStyle = wet ? 'rgba(40, 20, 8, 0.3)' : 'rgba(110, 60, 25, 0.35)'
  ctx.lineWidth = Math.max(1.2, s * 0.045)
  ctx.lineCap = 'round'
  for (const k of [-0.2, 0.02, 0.24]) {
    ctx.beginPath()
    ctx.moveTo(x - s * 0.3, y + k * s - s * 0.04)
    ctx.quadraticCurveTo(x, y + k * s, x + s * 0.3, y + k * s - s * 0.04)
    ctx.stroke()
  }
  ellipse(ctx, x - s * 0.22, y - s * 0.3, s * 0.12, s * 0.05, 'rgba(255, 230, 190, 0.25)', -0.2)
  if (highlight > 0) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.8 * highlight})`
    ctx.lineWidth = 3
    roundRect(ctx, x - s / 2 - 2, y - s / 2 - 2, s + 4, s + 4, r)
    ctx.stroke()
  }
}

export { star4 }

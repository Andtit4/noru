// Cloud Acres: the farmer, the machines, decorations and the forest of land plots not bought yet.

import { drawTree } from './art'
import { C, ellipse, leaf, paint, roundRect, shadow, wind } from './draw'

type Ctx = CanvasRenderingContext2D

export interface Look {
  skin: string
  shirt: string
  pants: string
  hat: string
}

function hat(ctx: Ctx, kind: string, x: number, y: number, s: number, ink: number) {
  if (kind === 'straw') {
    ellipse(ctx, x, y + s * 0.04, s * 0.4, s * 0.11, '#efcf74', 0, ink)
    ctx.beginPath()
    ctx.ellipse(x, y + s * 0.02, s * 0.22, s * 0.18, 0, Math.PI, 0)
    ctx.closePath()
    paint(ctx, '#f6dc8a', ink)
    ctx.fillStyle = C.coral
    ctx.fillRect(x - s * 0.22, y - s * 0.02, s * 0.44, s * 0.05)
  } else if (kind === 'cap') {
    ctx.beginPath()
    ctx.ellipse(x, y + s * 0.04, s * 0.25, s * 0.2, 0, Math.PI, 0)
    ctx.closePath()
    paint(ctx, C.sky, ink)
    ellipse(ctx, x + s * 0.2, y + s * 0.04, s * 0.17, s * 0.055, C.skyDark, 0, ink)
    ellipse(ctx, x, y - s * 0.16, s * 0.04, s * 0.03, '#fff')
  } else if (kind === 'bandana') {
    ctx.beginPath()
    ctx.ellipse(x, y + s * 0.05, s * 0.25, s * 0.17, 0, Math.PI, 0)
    ctx.closePath()
    paint(ctx, C.coral, ink)
    for (let i = -1; i <= 1; i++) ellipse(ctx, x + i * s * 0.09, y - s * 0.04, s * 0.022, s * 0.022, '#fff')
    leaf(ctx, x - s * 0.24, y + s * 0.04, s * 0.14, -2.2, C.coral, ink * 0.8)
  }
}

/** The farmer's head (profile badge, avatar editor); blinks now and then. */
export function drawFarmerFace(ctx: Ctx, look: Look, x: number, y: number, s: number, t = 0) {
  const ink = Math.max(1.2, s * 0.04)
  const blink = Math.sin(t * 1.1 + x * 0.01) > 0.985
  // Hair behind.
  if (look.hat === 'none') ellipse(ctx, x, y - s * 0.06, s * 0.31, s * 0.27, '#5a3b2a', 0, ink)
  ellipse(ctx, x, y + s * 0.05, s * 0.3, s * 0.29, look.skin, 0, ink)
  if (look.hat === 'none') {
    ctx.beginPath()
    ctx.ellipse(x, y - s * 0.07, s * 0.28, s * 0.16, 0, Math.PI, 0)
    ctx.closePath()
    paint(ctx, '#5a3b2a')
  }
  for (const side of [-1, 1]) {
    if (blink) {
      ctx.strokeStyle = C.ink
      ctx.lineWidth = ink
      ctx.beginPath()
      ctx.moveTo(x + side * s * 0.1 - s * 0.04, y + s * 0.03)
      ctx.lineTo(x + side * s * 0.1 + s * 0.04, y + s * 0.03)
      ctx.stroke()
    } else {
      ellipse(ctx, x + side * s * 0.1, y + s * 0.03, s * 0.042, s * 0.055, C.ink)
      ellipse(ctx, x + side * s * 0.1 + s * 0.014, y + s * 0.01, s * 0.015, s * 0.015, '#fff')
    }
    ellipse(ctx, x + side * s * 0.18, y + s * 0.14, s * 0.055, s * 0.032, 'rgba(255, 110, 120, 0.45)')
  }
  ctx.strokeStyle = C.ink
  ctx.lineWidth = ink
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(x, y + s * 0.11, s * 0.07, 0.25, Math.PI - 0.25)
  ctx.stroke()
  hat(ctx, look.hat, x, y - s * 0.16, s * 1.1, ink)
}

/** The farmer walking on the map; `s` is about their height, x, y their feet. */
export function drawFarmer(ctx: Ctx, look: Look, x: number, y: number, s: number, t: number, facing: number, walking: boolean) {
  const ink = Math.max(1.2, s * 0.035)
  const step = walking ? Math.sin(t * 12) : 0
  const bob = walking ? Math.abs(Math.sin(t * 12)) * s * 0.05 : Math.sin(t * 2.2) * s * 0.008
  // Squash when the foot lands, stretch in the air.
  const squash = walking ? 1 + (Math.abs(Math.sin(t * 12)) - 0.5) * 0.08 : 1 + Math.sin(t * 2.2) * 0.012
  ctx.save()
  ctx.translate(x, y)
  shadow(ctx, 0, 0, s * 0.22, s * 0.065, 1.2)
  ctx.translate(0, -bob)
  ctx.scale(facing / squash, squash)
  // Legs and boots.
  for (const side of [-1, 1]) {
    const k = side * step * s * 0.05
    roundRect(ctx, side * s * 0.065 - s * 0.045 + k, -s * 0.3, s * 0.09, s * 0.26, s * 0.04)
    paint(ctx, look.pants, ink)
    ellipse(ctx, side * s * 0.065 + k + s * 0.01, -s * 0.035, s * 0.065, s * 0.04, '#6b4430', 0, ink)
  }
  // Body: shirt and overalls.
  roundRect(ctx, -s * 0.17, -s * 0.62, s * 0.34, s * 0.36, s * 0.13)
  paint(ctx, look.shirt, ink)
  roundRect(ctx, -s * 0.13, -s * 0.47, s * 0.26, s * 0.21, s * 0.06)
  paint(ctx, look.pants, ink * 0.8)
  ellipse(ctx, -s * 0.07, -s * 0.44, s * 0.022, s * 0.022, C.gold)
  ellipse(ctx, s * 0.07, -s * 0.44, s * 0.022, s * 0.022, C.gold)
  // Scarf, its end flapping.
  roundRect(ctx, -s * 0.15, -s * 0.66, s * 0.3, s * 0.08, s * 0.04)
  paint(ctx, C.gold, ink * 0.8)
  const flap = Math.sin(t * (walking ? 14 : 3)) * 0.25
  leaf(ctx, -s * 0.12, -s * 0.6, s * 0.16, -2.3 + flap, C.gold, ink * 0.8)
  // Arms swinging.
  for (const side of [-1, 1]) {
    ctx.save()
    ctx.translate(side * s * 0.16, -s * 0.56)
    ctx.rotate(side * -0.25 + side * step * 0.55)
    roundRect(ctx, -s * 0.045, 0, s * 0.09, s * 0.24, s * 0.045)
    paint(ctx, look.shirt, ink)
    ellipse(ctx, 0, s * 0.25, s * 0.05, s * 0.05, look.skin, 0, ink * 0.8)
    ctx.restore()
  }
  drawFarmerFace(ctx, look, s * 0.02, -s * 0.8, s * 0.6, t)
  ctx.restore()
}

export function drawTractor(ctx: Ctx, x: number, y: number, s: number, facing: number, t: number, moving: boolean) {
  const ink = Math.max(1.2, s * 0.03)
  const shake = moving ? Math.sin(t * 40) * s * 0.012 : Math.sin(t * 18) * s * 0.004
  ctx.save()
  ctx.translate(x, y)
  shadow(ctx, 0, s * 0.02, s * 0.5, s * 0.1, 1.2)
  ctx.scale(facing, 1)
  ctx.translate(0, shake)
  // A round little tractor, mint green.
  roundRect(ctx, -s * 0.44, -s * 0.44, s * 0.74, s * 0.28, s * 0.1)
  paint(ctx, '#4cc9a6', ink)
  roundRect(ctx, s * 0.04, -s * 0.4, s * 0.36, s * 0.22, s * 0.08)
  paint(ctx, '#37ad8c', ink)
  for (let i = 0; i < 3; i++) ctx.fillRect(s * (0.12 + i * 0.08), -s * 0.36, s * 0.03, s * 0.14)
  roundRect(ctx, -s * 0.38, -s * 0.8, s * 0.36, s * 0.4, s * 0.08)
  paint(ctx, C.cream, ink)
  roundRect(ctx, -s * 0.33, -s * 0.75, s * 0.26, s * 0.22, s * 0.05)
  paint(ctx, '#bfe6ff', ink * 0.7)
  roundRect(ctx, -s * 0.42, -s * 0.85, s * 0.44, s * 0.08, s * 0.04)
  paint(ctx, C.coral, ink)
  roundRect(ctx, s * 0.25, -s * 0.66, s * 0.05, s * 0.24, 2)
  paint(ctx, '#6d6a75', ink * 0.7)
  // Puffs of smoke, little clouds.
  for (let i = 0; i < 3; i++) {
    const k = (t * (moving ? 1.6 : 0.6) + i / 3) % 1
    ellipse(ctx, s * 0.27 - k * s * 0.25, -s * 0.7 - k * s * 0.45, s * (0.04 + k * 0.08), s * (0.04 + k * 0.08), `rgba(255,255,255,${0.75 * (1 - k)})`)
  }
  const spin = moving ? t * 8 : 0
  for (const [wx, r] of [
    [-0.24, 0.22],
    [0.3, 0.14],
  ]) {
    ellipse(ctx, wx * s, -r * s, r * s, r * s, '#3d3346', 0, ink)
    ellipse(ctx, wx * s, -r * s, r * s * 0.5, r * s * 0.5, C.gold, 0, ink * 0.6)
    ctx.strokeStyle = C.ink
    ctx.lineWidth = ink * 0.7
    ctx.beginPath()
    ctx.moveTo(wx * s + Math.cos(spin) * r * s * 0.45, -r * s + Math.sin(spin) * r * s * 0.45)
    ctx.lineTo(wx * s - Math.cos(spin) * r * s * 0.45, -r * s - Math.sin(spin) * r * s * 0.45)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawTruck(ctx: Ctx, x: number, y: number, s: number, facing: number, t: number, moving: boolean, loaded: boolean) {
  const ink = Math.max(1.2, s * 0.03)
  ctx.save()
  ctx.translate(x, y)
  shadow(ctx, 0, s * 0.02, s * 0.56, s * 0.1, 1.2)
  ctx.scale(facing, 1)
  if (moving) ctx.translate(0, Math.sin(t * 30) * s * 0.01)
  roundRect(ctx, -s * 0.52, -s * 0.38, s * 0.62, s * 0.24, s * 0.06)
  paint(ctx, C.plum, ink)
  if (loaded) {
    const crates: [number, number, string][] = [
      [-0.44, -0.54, '#d9a066'],
      [-0.24, -0.54, '#c98b52'],
      [-0.34, -0.68, '#e6b47a'],
    ]
    for (const [cx, cy, c] of crates) {
      roundRect(ctx, cx * s, cy * s, s * 0.18, s * 0.16, s * 0.02)
      paint(ctx, c, ink * 0.7)
    }
  }
  roundRect(ctx, s * 0.06, -s * 0.64, s * 0.44, s * 0.5, s * 0.12)
  paint(ctx, '#a68bf0', ink)
  roundRect(ctx, s * 0.2, -s * 0.57, s * 0.24, s * 0.18, s * 0.05)
  paint(ctx, '#bfe6ff', ink * 0.7)
  ellipse(ctx, s * 0.5, -s * 0.26, s * 0.035, s * 0.045, C.gold, 0, ink * 0.6)
  for (const wx of [-0.34, 0.3]) {
    ellipse(ctx, wx * s, -s * 0.12, s * 0.12, s * 0.12, '#3d3346', 0, ink)
    ellipse(ctx, wx * s, -s * 0.12, s * 0.05, s * 0.05, '#dfe2ea')
  }
  ctx.restore()
}

export function drawSilo(ctx: Ctx, x: number, y: number, w: number, h: number, level: number) {
  const ink = Math.max(1.5, w * 0.03)
  shadow(ctx, x + w / 2, y + h, w * 0.55, h * 0.07, 1.2)
  roundRect(ctx, x, y + h * 0.2, w, h * 0.8, w * 0.12)
  paint(ctx, '#e9e2f2', ink)
  ctx.fillStyle = 'rgba(120, 100, 150, 0.18)'
  ctx.fillRect(x + w * 0.68, y + h * 0.22, w * 0.26, h * 0.76)
  ctx.beginPath()
  ctx.ellipse(x + w / 2, y + h * 0.22, w * 0.56, h * 0.2, 0, Math.PI, 0)
  ctx.closePath()
  paint(ctx, C.teal, ink)
  ellipse(ctx, x + w * 0.38, y + h * 0.12, w * 0.12, h * 0.04, 'rgba(255,255,255,0.4)')
  ctx.strokeStyle = 'rgba(61,42,69,0.3)'
  ctx.lineWidth = Math.max(1, w * 0.02)
  for (let i = 0; i < 2 + level; i++) {
    ctx.beginPath()
    ctx.moveTo(x + 2, y + h * (0.36 + i * 0.15))
    ctx.lineTo(x + w - 2, y + h * (0.36 + i * 0.15))
    ctx.stroke()
  }
  roundRect(ctx, x + w * 0.34, y + h * 0.78, w * 0.32, h * 0.22, w * 0.12)
  paint(ctx, C.wood, ink * 0.8)
}

/** A sprinkler at a field corner, with water drops turning around it. */
export function drawSprinkler(ctx: Ctx, x: number, y: number, t: number) {
  roundRect(ctx, x - 2.5, y - 11, 5, 11, 2)
  paint(ctx, '#7d8590', 1.2)
  ellipse(ctx, x, y - 12, 4.5, 3.5, C.sky, 0, 1.2)
  for (let i = 0; i < 6; i++) {
    const a = t * 3 + (i / 6) * Math.PI * 2
    const r = 10 + ((t * 30 + i * 7) % 20)
    ellipse(ctx, x + Math.cos(a) * r, y - 10 + Math.sin(a) * r * 0.45, 1.8, 1.8, 'rgba(150, 215, 255, 0.85)')
  }
}

/** A decoration, x, y at its base. */
export function drawDecor(ctx: Ctx, kind: string, x: number, y: number, t: number) {
  if (kind === 'flowers') {
    ellipse(ctx, x, y, 24, 11, C.soil, 0, 1.5)
    for (let i = 0; i < 7; i++) {
      const fx = x - 16 + (i % 4) * 11
      const fy = y - 4 + Math.floor(i / 4) * 6
      const sway = wind(fx, t) * 0.3
      leaf(ctx, fx, fy, 9, 0.3 + sway, C.leaf, 1)
      const px = fx + Math.sin(0.3 + sway) * 8
      const py = fy - 8
      const color = [C.rose, C.gold, '#ffffff', '#b99cff'][i % 4]
      for (let k = 0; k < 5; k++) ellipse(ctx, px + Math.cos(k * 1.26 + t * 0.2) * 3, py + Math.sin(k * 1.26 + t * 0.2) * 3, 2.4, 2.4, color)
      ellipse(ctx, px, py, 1.8, 1.8, '#ffb300')
    }
  } else if (kind === 'haystack') {
    shadow(ctx, x, y + 2, 24, 7)
    ctx.beginPath()
    ctx.ellipse(x, y - 8, 23, 18, 0, Math.PI * 1.05, Math.PI * 1.95)
    ctx.lineTo(x + 23, y + 2)
    ctx.lineTo(x - 23, y + 2)
    ctx.closePath()
    paint(ctx, '#f0cf6e', 1.8)
    ellipse(ctx, x - 6, y - 16, 9, 5, '#f8e19a')
    ctx.strokeStyle = 'rgba(170, 120, 40, 0.55)'
    ctx.lineWidth = 1.5
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath()
      ctx.moveTo(x + i * 6, y - 20)
      ctx.lineTo(x + i * 8, y + 1)
      ctx.stroke()
    }
    roundRect(ctx, x - 23, y - 8, 46, 4, 2)
    paint(ctx, C.coral)
  } else if (kind === 'bench') {
    shadow(ctx, x, y + 2, 26, 6)
    for (const px of [-20, 18]) {
      roundRect(ctx, x + px, y - 12, 4, 14, 2)
      paint(ctx, C.woodDark, 1.2)
    }
    roundRect(ctx, x - 26, y - 15, 52, 7, 3)
    paint(ctx, C.teal, 1.5)
    roundRect(ctx, x - 26, y - 29, 52, 7, 3)
    paint(ctx, C.teal, 1.5)
    for (const px of [-20, 18]) {
      roundRect(ctx, x + px, y - 27, 3, 12, 1.5)
      paint(ctx, C.woodDark)
    }
  } else if (kind === 'lamp') {
    shadow(ctx, x, y + 2, 10, 4)
    roundRect(ctx, x - 2, y - 44, 4, 46, 2)
    paint(ctx, '#4a4258', 1.2)
    roundRect(ctx, x - 8, y - 58, 16, 16, 5)
    paint(ctx, '#4a4258', 1.2)
    const glow = 0.6 + 0.2 * Math.sin(t * 3)
    ellipse(ctx, x, y - 50, 5, 5, `rgba(255, 228, 140, ${glow + 0.3})`)
    ellipse(ctx, x, y - 50, 16, 16, `rgba(255, 228, 140, ${glow * 0.3})`)
  } else if (kind === 'scarecrow') {
    shadow(ctx, x, y + 2, 14, 5)
    roundRect(ctx, x - 2, y - 46, 4, 48, 2)
    paint(ctx, C.woodDark, 1.2)
    const sway = wind(x, t) * 0.15
    ctx.save()
    ctx.translate(x, y - 36)
    ctx.rotate(sway)
    roundRect(ctx, -22, -2, 44, 4, 2)
    paint(ctx, C.woodDark, 1.2)
    roundRect(ctx, -12, -4, 24, 22, 6)
    paint(ctx, C.plum, 1.5)
    ellipse(ctx, 0, -11, 9, 9, '#f6dc8a', 0, 1.5)
    ellipse(ctx, 0, -19, 15, 4, '#c98b52', 0, 1.5)
    ellipse(ctx, 0, -23, 8, 6, '#c98b52', 0, 1.5)
    ellipse(ctx, -3, -12, 1.5, 1.5, C.ink)
    ellipse(ctx, 3, -12, 1.5, 1.5, C.ink)
    ctx.restore()
  } else if (kind === 'fountain') {
    ellipse(ctx, x, y, 34, 14, '#d8d2e4', 0, 2)
    ellipse(ctx, x, y - 2, 29, 10, C.water)
    roundRect(ctx, x - 5, y - 30, 10, 28, 4)
    paint(ctx, '#e9e2f2', 1.5)
    ellipse(ctx, x, y - 30, 14, 5, '#e9e2f2', 0, 1.5)
    for (let i = 0; i < 10; i++) {
      const k = (t * 1.2 + i / 10) % 1
      const a = (i / 10) * Math.PI * 2
      ellipse(ctx, x + Math.cos(a) * k * 22, y - 34 + (k * k * 40 - k * 24), 2, 2, `rgba(180, 235, 255, ${1 - k})`)
    }
  }
}

/** Forest, rocks and mist covering a land plot not bought yet (same layout every time). */
export function drawForest(ctx: Ctx, x: number, y: number, w: number, h: number, t: number) {
  ctx.fillStyle = '#6aa44c'
  ctx.fillRect(x, y, w, h)
  for (let i = 0; i < 40; i++) {
    const rx = x + (((i * 97) % 100) / 100) * w
    const ry = y + (((i * 61) % 100) / 100) * h
    ellipse(ctx, rx, ry, 18, 10, 'rgba(40, 80, 30, 0.25)')
  }
  const items: [number, number, number, boolean][] = []
  const cols = Math.max(2, Math.round(w / 70))
  const rows = Math.max(2, Math.round(h / 66))
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = Math.sin((c + 1) * 12.9898 + (r + 1) * 78.233) * 43758.5453
      const v = n - Math.floor(n)
      items.push([x + ((c + 0.5 + (v - 0.5) * 0.6) * w) / cols, y + ((r + 0.6 + (v - 0.5) * 0.4) * h) / rows, 0.75 + v * 0.45, v < 0.16])
    }
  }
  items.sort((a, b) => a[1] - b[1])
  for (const [ix, iy, s, rock] of items) {
    if (rock) {
      shadow(ctx, ix, iy + 6, 20 * s, 7 * s)
      ellipse(ctx, ix, iy - 2, 18 * s, 13 * s, '#a7a2b8', 0, 1.5)
      ellipse(ctx, ix - 5 * s, iy - 7 * s, 7 * s, 4 * s, '#cdc8db')
    } else drawTree(ctx, ix, iy, 66 * s, t)
  }
  // Drifting mist.
  for (let i = 0; i < 3; i++) {
    const mx = x + ((t * 10 + i * 140) % (w + 160)) - 80
    const my = y + h * (0.25 + i * 0.25)
    ellipse(ctx, mx, my, 70, 16, 'rgba(255, 255, 255, 0.18)')
  }
}

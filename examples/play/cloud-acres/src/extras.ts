// Cloud Acres: the farmer, the machines, decorations and the forest of land plots not bought yet.

import { drawTree } from './art'
import { ellipse, leaf, roundRect } from './draw'

type Ctx = CanvasRenderingContext2D

export interface Look {
  skin: string
  shirt: string
  pants: string
  hat: string
}

function hat(ctx: Ctx, kind: string, x: number, y: number, s: number) {
  if (kind === 'straw') {
    ellipse(ctx, x, y + s * 0.02, s * 0.36, s * 0.1, '#e9c46a')
    ellipse(ctx, x, y - s * 0.06, s * 0.2, s * 0.13, '#f2d27c')
    ctx.fillStyle = '#c8553d'
    ctx.fillRect(x - s * 0.2, y - s * 0.04, s * 0.4, s * 0.04)
  } else if (kind === 'cap') {
    ellipse(ctx, x, y - s * 0.04, s * 0.22, s * 0.14, '#3d6fb6')
    ellipse(ctx, x + s * 0.16, y + s * 0.03, s * 0.16, s * 0.05, '#2f5a99')
  } else if (kind === 'bandana') {
    ellipse(ctx, x, y - s * 0.02, s * 0.22, s * 0.12, '#e63946')
    for (let i = -1; i <= 1; i++) ellipse(ctx, x + i * s * 0.09, y - s * 0.04, s * 0.02, s * 0.02, '#fff')
  }
}

/** The farmer's head (profile badge, avatar editor). */
export function drawFarmerFace(ctx: Ctx, look: Look, x: number, y: number, s: number) {
  ellipse(ctx, x, y + s * 0.05, s * 0.3, s * 0.3, look.skin)
  ellipse(ctx, x - s * 0.1, y + s * 0.02, s * 0.035, s * 0.045, '#2b2118')
  ellipse(ctx, x + s * 0.1, y + s * 0.02, s * 0.035, s * 0.045, '#2b2118')
  ellipse(ctx, x - s * 0.17, y + s * 0.13, s * 0.05, s * 0.03, 'rgba(255, 120, 120, 0.4)')
  ellipse(ctx, x + s * 0.17, y + s * 0.13, s * 0.05, s * 0.03, 'rgba(255, 120, 120, 0.4)')
  ctx.strokeStyle = '#3a2a20'
  ctx.lineWidth = Math.max(1, s * 0.03)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(x, y + s * 0.1, s * 0.08, 0.2, Math.PI - 0.2)
  ctx.stroke()
  hat(ctx, look.hat, x, y - s * 0.18, s * 1.1)
}

/** The farmer walking on the map; `s` is about their height, x, y their feet. */
export function drawFarmer(ctx: Ctx, look: Look, x: number, y: number, s: number, t: number, facing: number, walking: boolean) {
  const step = walking ? Math.sin(t * 12) : 0
  const bob = walking ? Math.abs(Math.sin(t * 12)) * s * 0.03 : 0
  ctx.save()
  ctx.translate(x, y)
  ellipse(ctx, 0, 0, s * 0.22, s * 0.07, 'rgba(30, 60, 20, 0.25)')
  ctx.translate(0, -bob)
  ctx.scale(facing, 1)
  // Legs and boots.
  ctx.fillStyle = look.pants
  ctx.fillRect(-s * 0.1 + step * s * 0.04, -s * 0.3, s * 0.08, s * 0.26)
  ctx.fillRect(s * 0.02 - step * s * 0.04, -s * 0.3, s * 0.08, s * 0.26)
  ellipse(ctx, -s * 0.06 + step * s * 0.04, -s * 0.03, s * 0.06, s * 0.035, '#5e3d27')
  ellipse(ctx, s * 0.06 - step * s * 0.04, -s * 0.03, s * 0.06, s * 0.035, '#5e3d27')
  // Body: shirt and overalls.
  ctx.fillStyle = look.shirt
  roundRect(ctx, -s * 0.16, -s * 0.62, s * 0.32, s * 0.36, s * 0.1)
  ctx.fill()
  ctx.fillStyle = look.pants
  roundRect(ctx, -s * 0.13, -s * 0.46, s * 0.26, s * 0.2, s * 0.05)
  ctx.fill()
  ctx.fillRect(-s * 0.11, -s * 0.6, s * 0.04, s * 0.16)
  ctx.fillRect(s * 0.07, -s * 0.6, s * 0.04, s * 0.16)
  // Arms swinging.
  for (const side of [-1, 1]) {
    ctx.save()
    ctx.translate(side * s * 0.16, -s * 0.56)
    ctx.rotate(side * -0.2 + side * step * 0.5)
    ctx.fillStyle = look.shirt
    roundRect(ctx, -s * 0.04, 0, s * 0.08, s * 0.24, s * 0.04)
    ctx.fill()
    ellipse(ctx, 0, s * 0.25, s * 0.045, s * 0.045, look.skin)
    ctx.restore()
  }
  drawFarmerFace(ctx, look, s * 0.02, -s * 0.78, s * 0.56)
  ctx.restore()
}

export function drawTractor(ctx: Ctx, x: number, y: number, s: number, facing: number, t: number, moving: boolean) {
  const shake = moving ? Math.sin(t * 40) * s * 0.01 : 0
  ctx.save()
  ctx.translate(x, y)
  ellipse(ctx, 0, s * 0.02, s * 0.5, s * 0.1, 'rgba(30, 60, 20, 0.28)')
  ctx.scale(facing, 1)
  ctx.translate(0, shake)
  ctx.fillStyle = '#d93a32'
  roundRect(ctx, -s * 0.42, -s * 0.42, s * 0.7, s * 0.26, s * 0.05)
  ctx.fill()
  ctx.fillStyle = '#b52d26'
  roundRect(ctx, s * 0.06, -s * 0.36, s * 0.34, s * 0.2, s * 0.04)
  ctx.fill()
  ctx.fillStyle = '#2f3a4a'
  roundRect(ctx, -s * 0.36, -s * 0.78, s * 0.34, s * 0.38, s * 0.04)
  ctx.fill()
  ctx.fillStyle = '#bfe3ff'
  roundRect(ctx, -s * 0.31, -s * 0.73, s * 0.24, s * 0.22, s * 0.03)
  ctx.fill()
  ctx.fillStyle = '#d93a32'
  roundRect(ctx, -s * 0.4, -s * 0.82, s * 0.42, s * 0.07, s * 0.03)
  ctx.fill()
  ctx.fillStyle = '#4a4a4a'
  ctx.fillRect(s * 0.26, -s * 0.62, s * 0.04, s * 0.22)
  if (moving) {
    for (let i = 0; i < 3; i++) {
      const k = (t * 1.6 + i / 3) % 1
      ellipse(ctx, s * 0.28 - k * s * 0.3, -s * 0.66 - k * s * 0.4, s * (0.04 + k * 0.08), s * (0.04 + k * 0.08), 'rgba(120,120,120,' + 0.5 * (1 - k) + ')')
    }
  }
  const spin = moving ? t * 8 : 0
  for (const [wx, r] of [
    [-0.24, 0.22],
    [0.3, 0.13],
  ]) {
    ellipse(ctx, wx * s, -r * s, r * s, r * s, '#2b2b2b')
    ellipse(ctx, wx * s, -r * s, r * s * 0.5, r * s * 0.5, '#f2c14e')
    ctx.strokeStyle = '#2b2b2b'
    ctx.lineWidth = Math.max(1, s * 0.02)
    ctx.beginPath()
    ctx.moveTo(wx * s + Math.cos(spin) * r * s * 0.45, -r * s + Math.sin(spin) * r * s * 0.45)
    ctx.lineTo(wx * s - Math.cos(spin) * r * s * 0.45, -r * s - Math.sin(spin) * r * s * 0.45)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawTruck(ctx: Ctx, x: number, y: number, s: number, facing: number, t: number, moving: boolean, loaded: boolean) {
  ctx.save()
  ctx.translate(x, y)
  ellipse(ctx, 0, s * 0.02, s * 0.55, s * 0.1, 'rgba(30, 60, 20, 0.28)')
  ctx.scale(facing, 1)
  if (moving) ctx.translate(0, Math.sin(t * 30) * s * 0.008)
  ctx.fillStyle = '#3f7fd9'
  roundRect(ctx, -s * 0.5, -s * 0.36, s * 0.6, s * 0.22, s * 0.04)
  ctx.fill()
  if (loaded) {
    const crates: [number, number, string][] = [
      [-0.42, -0.52, '#c98b52'],
      [-0.22, -0.52, '#b47a45'],
      [-0.32, -0.66, '#d9a066'],
    ]
    for (const [cx, cy, c] of crates) {
      ctx.fillStyle = c
      ctx.fillRect(cx * s, cy * s, s * 0.18, s * 0.16)
      ctx.strokeStyle = 'rgba(90, 60, 30, 0.5)'
      ctx.strokeRect(cx * s, cy * s, s * 0.18, s * 0.16)
    }
  }
  ctx.fillStyle = '#4f8ff7'
  roundRect(ctx, s * 0.08, -s * 0.62, s * 0.42, s * 0.48, s * 0.08)
  ctx.fill()
  ctx.fillStyle = '#bfe3ff'
  roundRect(ctx, s * 0.22, -s * 0.56, s * 0.22, s * 0.18, s * 0.04)
  ctx.fill()
  ellipse(ctx, s * 0.5, -s * 0.24, s * 0.03, s * 0.04, '#ffe08a')
  for (const wx of [-0.32, 0.3]) {
    ellipse(ctx, wx * s, -s * 0.12, s * 0.12, s * 0.12, '#2b2b2b')
    ellipse(ctx, wx * s, -s * 0.12, s * 0.05, s * 0.05, '#cfd4dc')
  }
  ctx.restore()
}

export function drawSilo(ctx: Ctx, x: number, y: number, w: number, h: number, level: number) {
  ellipse(ctx, x + w / 2, y + h, w * 0.5, h * 0.07, 'rgba(30, 60, 20, 0.25)')
  ctx.fillStyle = '#c9ced6'
  ctx.fillRect(x, y + h * 0.2, w, h * 0.8)
  ctx.fillStyle = '#b3b9c3'
  ctx.fillRect(x + w * 0.7, y + h * 0.2, w * 0.3, h * 0.8)
  ellipse(ctx, x + w / 2, y + h * 0.2, w / 2, h * 0.18, '#d93a32')
  ellipse(ctx, x + w / 2 - w * 0.12, y + h * 0.14, w * 0.12, h * 0.05, 'rgba(255,255,255,0.35)')
  ctx.fillStyle = '#8d949e'
  for (let i = 0; i < 2 + level; i++) ctx.fillRect(x, y + h * (0.35 + i * 0.16), w, 2)
  ctx.fillStyle = '#5e3d27'
  roundRect(ctx, x + w * 0.35, y + h * 0.78, w * 0.3, h * 0.22, 3)
  ctx.fill()
}

/** A sprinkler at a field corner, with water drops turning around it. */
export function drawSprinkler(ctx: Ctx, x: number, y: number, t: number) {
  ctx.fillStyle = '#7d8590'
  ctx.fillRect(x - 2, y - 10, 4, 10)
  ellipse(ctx, x, y - 11, 4, 3, '#4f8ff7')
  for (let i = 0; i < 6; i++) {
    const a = t * 3 + (i / 6) * Math.PI * 2
    const r = 10 + ((t * 30 + i * 7) % 20)
    ellipse(ctx, x + Math.cos(a) * r, y - 10 + Math.sin(a) * r * 0.45, 1.6, 1.6, 'rgba(120, 190, 255, 0.75)')
  }
}

/** A decoration, x, y at its base. */
export function drawDecor(ctx: Ctx, kind: string, x: number, y: number, t: number) {
  if (kind === 'flowers') {
    ellipse(ctx, x, y, 22, 10, '#6b4428')
    for (let i = 0; i < 7; i++) {
      const fx = x - 16 + (i % 4) * 11
      const fy = y - 4 + Math.floor(i / 4) * 6
      leaf(ctx, fx, fy, 8, 0.3, '#4caf50')
      ellipse(ctx, fx, fy - 8, 4, 4, ['#ff6b8a', '#ffd93d', '#ffffff', '#b98cff'][i % 4])
      ellipse(ctx, fx, fy - 8, 1.6, 1.6, '#ffb300')
    }
  } else if (kind === 'haystack') {
    ellipse(ctx, x, y + 2, 24, 7, 'rgba(30, 60, 20, 0.25)')
    ellipse(ctx, x, y - 10, 22, 16, '#e9c46a')
    ellipse(ctx, x - 6, y - 16, 10, 6, '#f2d27c')
    ctx.strokeStyle = 'rgba(160, 120, 40, 0.6)'
    ctx.lineWidth = 1.5
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath()
      ctx.moveTo(x + i * 7, y - 22)
      ctx.lineTo(x + i * 8, y + 2)
      ctx.stroke()
    }
  } else if (kind === 'bench') {
    ellipse(ctx, x, y + 2, 26, 6, 'rgba(30, 60, 20, 0.25)')
    ctx.fillStyle = '#7a5236'
    ctx.fillRect(x - 22, y - 12, 4, 14)
    ctx.fillRect(x + 18, y - 12, 4, 14)
    ctx.fillStyle = '#a8754b'
    roundRect(ctx, x - 26, y - 14, 52, 7, 3)
    ctx.fill()
    roundRect(ctx, x - 26, y - 28, 52, 6, 3)
    ctx.fill()
    ctx.fillStyle = '#7a5236'
    ctx.fillRect(x - 22, y - 26, 3, 12)
    ctx.fillRect(x + 19, y - 26, 3, 12)
  } else if (kind === 'lamp') {
    ellipse(ctx, x, y + 2, 10, 4, 'rgba(30, 60, 20, 0.25)')
    ctx.fillStyle = '#3a3f4a'
    ctx.fillRect(x - 2, y - 44, 4, 46)
    roundRect(ctx, x - 8, y - 56, 16, 14, 4)
    ctx.fill()
    const glow = 0.6 + 0.2 * Math.sin(t * 3)
    ellipse(ctx, x, y - 49, 5, 5, 'rgba(255, 230, 140, ' + glow + ')')
    ellipse(ctx, x, y - 49, 14, 14, 'rgba(255, 230, 140, ' + glow * 0.25 + ')')
  } else if (kind === 'scarecrow') {
    ellipse(ctx, x, y + 2, 14, 5, 'rgba(30, 60, 20, 0.25)')
    ctx.fillStyle = '#7a5236'
    ctx.fillRect(x - 2, y - 46, 4, 48)
    ctx.fillRect(x - 22, y - 36, 44, 4)
    ctx.fillStyle = '#5c8fd6'
    roundRect(ctx, x - 12, y - 38, 24, 22, 4)
    ctx.fill()
    ellipse(ctx, x, y - 46, 9, 9, '#f2d27c')
    ellipse(ctx, x, y - 54, 15, 4, '#c98b52')
    ellipse(ctx, x, y - 58, 8, 6, '#c98b52')
    ellipse(ctx, x - 3, y - 47, 1.5, 1.5, '#3a2a20')
    ellipse(ctx, x + 3, y - 47, 1.5, 1.5, '#3a2a20')
  } else if (kind === 'fountain') {
    ellipse(ctx, x, y, 34, 14, '#a8adb6')
    ellipse(ctx, x, y - 2, 30, 11, '#6ec6ff')
    ctx.fillStyle = '#c9ced6'
    ctx.fillRect(x - 5, y - 30, 10, 28)
    ellipse(ctx, x, y - 30, 14, 5, '#c9ced6')
    for (let i = 0; i < 8; i++) {
      const k = (t * 1.2 + i / 8) % 1
      const a = (i / 8) * Math.PI * 2
      ellipse(ctx, x + Math.cos(a) * k * 22, y - 34 + (k * k * 40 - k * 24), 1.8, 1.8, 'rgba(170, 220, 255, ' + (1 - k) + ')')
    }
  }
}

/** Forest and rocks covering a land plot not bought yet (same layout every time). */
export function drawForest(ctx: Ctx, x: number, y: number, w: number, h: number, t: number) {
  ctx.fillStyle = '#4f8f3a'
  ctx.fillRect(x, y, w, h)
  for (let i = 0; i < 40; i++) {
    const rx = x + (((i * 97) % 100) / 100) * w
    const ry = y + (((i * 61) % 100) / 100) * h
    ellipse(ctx, rx, ry, 18, 10, 'rgba(30, 70, 25, 0.3)')
  }
  const items: [number, number, number, boolean][] = []
  const cols = Math.max(2, Math.round(w / 70))
  const rows = Math.max(2, Math.round(h / 66))
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = Math.sin((c + 1) * 12.9898 + (r + 1) * 78.233) * 43758.5453
      const v = n - Math.floor(n)
      items.push([x + ((c + 0.5 + (v - 0.5) * 0.6) * w) / cols, y + ((r + 0.6 + (v - 0.5) * 0.4) * h) / rows, 0.75 + v * 0.45, v < 0.18])
    }
  }
  items.sort((a, b) => a[1] - b[1])
  for (const [ix, iy, s, rock] of items) {
    if (rock) {
      ellipse(ctx, ix, iy + 6, 20 * s, 7 * s, 'rgba(20, 40, 15, 0.3)')
      ellipse(ctx, ix, iy - 2, 18 * s, 13 * s, '#8d949e')
      ellipse(ctx, ix - 5 * s, iy - 7 * s, 7 * s, 4 * s, '#b3b9c3')
    } else drawTree(ctx, ix, iy, 66 * s, t)
  }
}

// Cloud Acres: farm products, buildings, animals and decoration, drawn with the canvas API.
// Buildings are seen from above with their front visible (3/4 view).

import type { AnimalKind, ItemId, WorkshopKind } from './data'
import { drawProduce, ellipse, leaf, roundRect } from './draw'

type Ctx = CanvasRenderingContext2D

const CROP_ITEMS = ['wheat', 'carrot', 'corn', 'tomato', 'pumpkin']

/** Any item of the barn, about `s` tall, centered on x, y. */
export function drawItem(ctx: Ctx, id: ItemId, x: number, y: number, s: number) {
  if (CROP_ITEMS.includes(id)) {
    drawProduce(ctx, id as 'wheat', x, y, s)
    return
  }
  ctx.save()
  switch (id) {
    case 'egg':
      ellipse(ctx, x, y + s * 0.04, s * 0.27, s * 0.35, '#fff4dd')
      ellipse(ctx, x - s * 0.08, y - s * 0.1, s * 0.07, s * 0.1, 'rgba(255,255,255,0.9)', -0.3)
      ctx.strokeStyle = 'rgba(160, 120, 70, 0.35)'
      ctx.lineWidth = Math.max(1, s * 0.03)
      ctx.beginPath()
      ctx.ellipse(x, y + s * 0.04, s * 0.27, s * 0.35, 0, 0, Math.PI * 2)
      ctx.stroke()
      break
    case 'milk':
      ctx.fillStyle = '#ffffff'
      roundRect(ctx, x - s * 0.2, y - s * 0.12, s * 0.4, s * 0.52, s * 0.08)
      ctx.fill()
      ctx.fillStyle = '#e8f1ff'
      roundRect(ctx, x - s * 0.12, y - s * 0.38, s * 0.24, s * 0.3, s * 0.04)
      ctx.fill()
      ctx.fillStyle = '#4f8ff7'
      roundRect(ctx, x - s * 0.14, y - s * 0.44, s * 0.28, s * 0.09, s * 0.03)
      ctx.fill()
      roundRect(ctx, x - s * 0.2, y + s * 0.06, s * 0.4, s * 0.14, s * 0.02)
      ctx.fill()
      ctx.strokeStyle = 'rgba(80, 110, 160, 0.4)'
      ctx.lineWidth = Math.max(1, s * 0.03)
      roundRect(ctx, x - s * 0.2, y - s * 0.12, s * 0.4, s * 0.52, s * 0.08)
      ctx.stroke()
      break
    case 'truffle':
      for (const [dx, dy, r] of [
        [-0.12, 0.06, 0.2],
        [0.1, 0.02, 0.22],
        [0, -0.12, 0.18],
      ]) {
        ellipse(ctx, x + dx * s, y + dy * s, r * s, r * s * 0.9, '#5b3d2e')
      }
      ellipse(ctx, x - s * 0.06, y - s * 0.12, s * 0.06, s * 0.04, 'rgba(255,255,255,0.25)')
      ctx.fillStyle = 'rgba(30, 15, 8, 0.4)'
      for (let i = 0; i < 6; i++) ellipse(ctx, x + Math.cos(i * 2.1) * s * 0.15, y + Math.sin(i * 1.7) * s * 0.12, s * 0.025, s * 0.025, 'rgba(30,15,8,0.45)')
      break
    case 'wool':
      ellipse(ctx, x, y + s * 0.04, s * 0.34, s * 0.32, '#f6f1ff')
      ctx.strokeStyle = '#cfc4ea'
      ctx.lineWidth = Math.max(1, s * 0.04)
      for (const k of [-0.18, 0, 0.18]) {
        ctx.beginPath()
        ctx.ellipse(x + k * s * 0.4, y + s * 0.04, s * 0.18, s * 0.3, k * 3, 0, Math.PI * 2)
        ctx.stroke()
      }
      break
    case 'flour':
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#b08850'
      ctx.lineWidth = Math.max(1.5, s * 0.05)
      ctx.beginPath()
      ctx.moveTo(x - s * 0.24, y - s * 0.22)
      ctx.quadraticCurveTo(x, y - s * 0.32, x + s * 0.24, y - s * 0.22)
      ctx.quadraticCurveTo(x + s * 0.36, y + s * 0.38, x, y + s * 0.42)
      ctx.quadraticCurveTo(x - s * 0.36, y + s * 0.38, x - s * 0.24, y - s * 0.22)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#c99a5b'
      roundRect(ctx, x - s * 0.2, y - s * 0.3, s * 0.4, s * 0.08, s * 0.03)
      ctx.fill()
      drawProduce(ctx, 'wheat', x, y + s * 0.1, s * 0.34)
      break
    case 'cheese':
      ctx.fillStyle = '#ffcf4a'
      ctx.beginPath()
      ctx.moveTo(x - s * 0.36, y + s * 0.26)
      ctx.lineTo(x + s * 0.36, y + s * 0.26)
      ctx.lineTo(x + s * 0.36, y - s * 0.02)
      ctx.lineTo(x - s * 0.3, y - s * 0.2)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#ffe17a'
      ctx.beginPath()
      ctx.moveTo(x - s * 0.36, y + s * 0.26)
      ctx.lineTo(x - s * 0.3, y - s * 0.2)
      ctx.lineTo(x - s * 0.36, y - s * 0.02)
      ctx.closePath()
      ctx.fill()
      for (const [dx, dy, r] of [
        [-0.05, 0.08, 0.06],
        [0.18, 0.12, 0.05],
        [0.12, -0.02, 0.04],
      ]) {
        ellipse(ctx, x + dx * s, y + dy * s, r * s, r * s, '#e5a91f')
      }
      break
    case 'sweater': {
      const c = '#e2556b'
      ctx.fillStyle = c
      ctx.beginPath()
      ctx.moveTo(x - s * 0.18, y - s * 0.32)
      ctx.lineTo(x + s * 0.18, y - s * 0.32)
      ctx.lineTo(x + s * 0.42, y - s * 0.1)
      ctx.lineTo(x + s * 0.32, y + s * 0.04)
      ctx.lineTo(x + s * 0.24, y - s * 0.02)
      ctx.lineTo(x + s * 0.24, y + s * 0.36)
      ctx.lineTo(x - s * 0.24, y + s * 0.36)
      ctx.lineTo(x - s * 0.24, y - s * 0.02)
      ctx.lineTo(x - s * 0.32, y + s * 0.04)
      ctx.lineTo(x - s * 0.42, y - s * 0.1)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#fff'
      for (let i = -2; i <= 2; i++) ctx.fillRect(x + i * s * 0.09 - s * 0.025, y + s * 0.08, s * 0.05, s * 0.05)
      ellipse(ctx, x, y - s * 0.3, s * 0.1, s * 0.05, '#b8384f')
      break
    }
    case 'cake':
      ellipse(ctx, x, y + s * 0.28, s * 0.38, s * 0.1, '#d9d9e8')
      ctx.fillStyle = '#c47a45'
      roundRect(ctx, x - s * 0.3, y - s * 0.06, s * 0.6, s * 0.32, s * 0.06)
      ctx.fill()
      ctx.fillStyle = '#fff3f7'
      roundRect(ctx, x - s * 0.32, y - s * 0.12, s * 0.64, s * 0.14, s * 0.07)
      ctx.fill()
      for (let i = -2; i <= 2; i++) ellipse(ctx, x + i * s * 0.12, y + s * 0.02, s * 0.04, s * 0.06, '#fff3f7')
      ellipse(ctx, x, y - s * 0.2, s * 0.07, s * 0.07, '#e63946')
      break
  }
  ctx.restore()
}

function shadow(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ellipse(ctx, x, y, w, h, 'rgba(30, 60, 20, 0.22)')
}

function house(ctx: Ctx, x: number, y: number, w: number, h: number, wall: string, roof: string, roofDark: string) {
  // x, y, w, h: footprint. Walls on the lower part, roof on top.
  shadow(ctx, x + w / 2, y + h * 0.95, w * 0.55, h * 0.12)
  ctx.fillStyle = wall
  roundRect(ctx, x + w * 0.08, y + h * 0.42, w * 0.84, h * 0.54, w * 0.04)
  ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.08)'
  ctx.fillRect(x + w * 0.08, y + h * 0.9, w * 0.84, h * 0.06)
  ctx.fillStyle = roofDark
  ctx.beginPath()
  ctx.moveTo(x, y + h * 0.48)
  ctx.lineTo(x + w * 0.2, y + h * 0.02)
  ctx.lineTo(x + w * 0.8, y + h * 0.02)
  ctx.lineTo(x + w, y + h * 0.48)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = roof
  ctx.beginPath()
  ctx.moveTo(x + w * 0.04, y + h * 0.44)
  ctx.lineTo(x + w * 0.22, y + h * 0.05)
  ctx.lineTo(x + w * 0.78, y + h * 0.05)
  ctx.lineTo(x + w * 0.96, y + h * 0.44)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 2
  for (let i = 1; i < 4; i++) {
    const k = i / 4
    ctx.beginPath()
    ctx.moveTo(x + w * (0.04 + 0.18 * k), y + h * (0.44 - 0.39 * k))
    ctx.lineTo(x + w * (0.96 - 0.18 * k), y + h * (0.44 - 0.39 * k))
    ctx.stroke()
  }
}

function door(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color
  roundRect(ctx, x - w / 2, y - h, w, h, w * 0.2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 220, 120, 0.9)'
  ellipse(ctx, x + w * 0.28, y - h * 0.45, w * 0.06, w * 0.06, '#ffd27a')
}

function sign(ctx: Ctx, x: number, y: number, s: number, draw: () => void) {
  ctx.fillStyle = '#fffaf0'
  ellipse(ctx, x, y, s, s, '#fffaf0')
  ctx.strokeStyle = 'rgba(90, 60, 40, 0.5)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, y, s, 0, Math.PI * 2)
  ctx.stroke()
  draw()
}

export function drawBarn(ctx: Ctx, x: number, y: number, w: number, h: number) {
  shadow(ctx, x + w / 2, y + h * 0.95, w * 0.55, h * 0.12)
  // Walls with white trim, big door with an X.
  ctx.fillStyle = '#c8473b'
  roundRect(ctx, x + w * 0.06, y + h * 0.38, w * 0.88, h * 0.58, w * 0.03)
  ctx.fill()
  ctx.fillStyle = '#a63a30'
  for (let i = 1; i < 7; i++) ctx.fillRect(x + w * (0.06 + i * 0.125), y + h * 0.4, 2, h * 0.54)
  ctx.fillStyle = '#7a2a22'
  ctx.beginPath()
  ctx.moveTo(x - w * 0.02, y + h * 0.42)
  ctx.lineTo(x + w * 0.5, y - h * 0.06)
  ctx.lineTo(x + w * 1.02, y + h * 0.42)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#8d3329'
  ctx.beginPath()
  ctx.moveTo(x + w * 0.04, y + h * 0.4)
  ctx.lineTo(x + w * 0.5, y - h * 0.01)
  ctx.lineTo(x + w * 0.96, y + h * 0.4)
  ctx.closePath()
  ctx.fill()
  // Hay loft window.
  ctx.fillStyle = '#fff6e0'
  roundRect(ctx, x + w * 0.42, y + h * 0.16, w * 0.16, h * 0.13, 3)
  ctx.fill()
  ctx.fillStyle = '#f2c14e'
  ctx.fillRect(x + w * 0.44, y + h * 0.22, w * 0.12, h * 0.06)
  // Door.
  const dx = x + w * 0.32
  const dy = y + h * 0.54
  const dw = w * 0.36
  const dh = h * 0.42
  ctx.fillStyle = '#fff6e0'
  ctx.fillRect(dx - 3, dy - 3, dw + 6, dh + 3)
  ctx.fillStyle = '#b13f34'
  ctx.fillRect(dx, dy, dw, dh)
  ctx.strokeStyle = '#fff6e0'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(dx, dy)
  ctx.lineTo(dx + dw, dy + dh)
  ctx.moveTo(dx + dw, dy)
  ctx.lineTo(dx, dy + dh)
  ctx.moveTo(dx + dw / 2, dy)
  ctx.lineTo(dx + dw / 2, dy + dh)
  ctx.stroke()
}

export function drawBoard(ctx: Ctx, x: number, y: number, w: number, h: number, notes: number) {
  shadow(ctx, x + w / 2, y + h * 0.92, w * 0.45, h * 0.1)
  ctx.fillStyle = '#7a5236'
  ctx.fillRect(x + w * 0.18, y + h * 0.35, w * 0.07, h * 0.58)
  ctx.fillRect(x + w * 0.75, y + h * 0.35, w * 0.07, h * 0.58)
  ctx.fillStyle = '#a8754b'
  roundRect(ctx, x + w * 0.06, y + h * 0.12, w * 0.88, h * 0.55, 6)
  ctx.fill()
  ctx.fillStyle = '#c49464'
  roundRect(ctx, x + w * 0.1, y + h * 0.16, w * 0.8, h * 0.47, 4)
  ctx.fill()
  ctx.fillStyle = '#7a5236'
  roundRect(ctx, x + w * 0.02, y + h * 0.06, w * 0.96, h * 0.1, 4)
  ctx.fill()
  for (let i = 0; i < Math.min(notes, 3); i++) {
    const nx = x + w * (0.18 + i * 0.24)
    const ny = y + h * (0.22 + (i % 2) * 0.06)
    ctx.save()
    ctx.translate(nx + w * 0.09, ny + h * 0.13)
    ctx.rotate((i - 1) * 0.12)
    ctx.fillStyle = '#fffaf0'
    ctx.fillRect(-w * 0.09, -h * 0.13, w * 0.18, h * 0.26)
    ctx.fillStyle = 'rgba(90, 70, 54, 0.4)'
    for (let l = 0; l < 3; l++) ctx.fillRect(-w * 0.06, -h * 0.07 + l * h * 0.06, w * 0.12, 2)
    ellipse(ctx, 0, -h * 0.12, 3, 3, '#e63946')
    ctx.restore()
  }
}

export function drawWorkshop(ctx: Ctx, kind: WorkshopKind, x: number, y: number, w: number, h: number, t: number, busy: boolean) {
  if (kind === 'mill') {
    shadow(ctx, x + w / 2, y + h * 0.95, w * 0.42, h * 0.12)
    ctx.fillStyle = '#d9cbb2'
    ctx.beginPath()
    ctx.moveTo(x + w * 0.24, y + h * 0.96)
    ctx.lineTo(x + w * 0.34, y + h * 0.2)
    ctx.lineTo(x + w * 0.66, y + h * 0.2)
    ctx.lineTo(x + w * 0.76, y + h * 0.96)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#c4b393'
    for (let i = 0; i < 5; i++) ctx.fillRect(x + w * (0.3 + (i % 2) * 0.2), y + h * (0.35 + i * 0.12), w * 0.14, h * 0.04)
    ctx.fillStyle = '#6e4b33'
    ctx.beginPath()
    ctx.moveTo(x + w * 0.28, y + h * 0.24)
    ctx.lineTo(x + w * 0.5, y + h * 0.02)
    ctx.lineTo(x + w * 0.72, y + h * 0.24)
    ctx.closePath()
    ctx.fill()
    door(ctx, x + w * 0.5, y + h * 0.96, w * 0.16, h * 0.22, '#7a5236')
    // Sails turn while it works.
    const cx = x + w * 0.5
    const cy = y + h * 0.26
    const angle = t * (busy ? 2.5 : 0.25)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angle)
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2)
      ctx.fillStyle = '#7a5236'
      ctx.fillRect(-2, 0, 4, h * 0.42)
      ctx.fillStyle = 'rgba(255, 250, 235, 0.95)'
      ctx.fillRect(3, h * 0.08, w * 0.11, h * 0.32)
      ctx.strokeStyle = 'rgba(122, 82, 54, 0.6)'
      ctx.lineWidth = 1
      ctx.strokeRect(3, h * 0.08, w * 0.11, h * 0.32)
    }
    ctx.restore()
    ellipse(ctx, cx, cy, w * 0.04, w * 0.04, '#4a3122')
    return
  }
  const colors: Record<Exclude<WorkshopKind, 'mill'>, [string, string, string]> = {
    dairy: ['#f7f7fb', '#5b8def', '#4775d1'],
    loom: ['#f4e8d8', '#9b6bd1', '#7d50b3'],
    bakery: ['#fbe7cf', '#e8743b', '#c95c28'],
  }
  const [wall, roof, roofDark] = colors[kind]
  house(ctx, x, y, w, h, wall, roof, roofDark)
  door(ctx, x + w * 0.5, y + h * 0.96, w * 0.2, h * 0.3, '#8d6346')
  ctx.fillStyle = '#bfe3ff'
  roundRect(ctx, x + w * 0.16, y + h * 0.56, w * 0.16, h * 0.14, 3)
  ctx.fill()
  roundRect(ctx, x + w * 0.68, y + h * 0.56, w * 0.16, h * 0.14, 3)
  ctx.fill()
  if (kind === 'bakery') {
    ctx.fillStyle = '#8d6346'
    ctx.fillRect(x + w * 0.7, y - h * 0.02, w * 0.1, h * 0.2)
    if (busy) {
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.6 + i / 3) % 1
        ellipse(ctx, x + w * 0.75 + Math.sin(k * 6) * 4, y - h * 0.05 - k * h * 0.4, 4 + k * 8, 4 + k * 8, `rgba(255,255,255,${0.6 * (1 - k)})`)
      }
    }
  }
  const icon: Record<string, ItemId> = { dairy: 'cheese', loom: 'sweater', bakery: 'cake' }
  sign(ctx, x + w * 0.5, y + h * 0.3, w * 0.13, () => drawItem(ctx, icon[kind], x + w * 0.5, y + h * 0.3, w * 0.18))
}

export function drawFence(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = 'rgba(120, 170, 70, 0.55)'
  roundRect(ctx, x, y, w, h, 10)
  ctx.fill()
  ctx.strokeStyle = '#a8754b'
  ctx.lineWidth = 4
  roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 8)
  ctx.stroke()
  ctx.strokeStyle = '#c89366'
  ctx.lineWidth = 2
  roundRect(ctx, x + 2, y + 9, w - 4, h - 11, 8)
  ctx.stroke()
  ctx.fillStyle = '#7a5236'
  const step = 30
  for (let px = x + 4; px <= x + w - 4; px += step) {
    ctx.fillRect(px - 2.5, y - 2, 5, 12)
    ctx.fillRect(px - 2.5, y + h - 10, 5, 12)
  }
  for (let py = y + 4; py <= y + h - 4; py += step) {
    ctx.fillRect(x - 2, py - 2.5, 7, 5)
    ctx.fillRect(x + w - 5, py - 2.5, 7, 5)
  }
}

export function drawTrough(ctx: Ctx, x: number, y: number, w: number, full: boolean, food: string) {
  ctx.fillStyle = '#8d6346'
  roundRect(ctx, x - w / 2, y - w * 0.12, w, w * 0.26, 5)
  ctx.fill()
  ctx.fillStyle = full ? food : '#5e3d27'
  roundRect(ctx, x - w * 0.44, y - w * 0.08, w * 0.88, w * 0.14, 4)
  ctx.fill()
}

/** An animal seen from above / the front, `s` about its length. */
export function drawAnimal(ctx: Ctx, kind: AnimalKind, x: number, y: number, s: number, t: number, facing: number, moving: boolean) {
  const bob = moving ? Math.abs(Math.sin(t * 10)) * s * 0.05 : Math.sin(t * 2) * s * 0.01
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(facing, 1)
  ellipse(ctx, 0, s * 0.28, s * 0.36, s * 0.1, 'rgba(30, 60, 20, 0.22)')
  ctx.translate(0, -bob)
  if (kind === 'chicken') {
    ellipse(ctx, 0, 0, s * 0.3, s * 0.24, '#fffaf2')
    ellipse(ctx, -s * 0.24, -s * 0.08, s * 0.12, s * 0.14, '#f1e6d6')
    ellipse(ctx, s * 0.22, -s * 0.2, s * 0.14, s * 0.14, '#fffaf2')
    ellipse(ctx, s * 0.22, -s * 0.36, s * 0.06, s * 0.06, '#e63946')
    ellipse(ctx, s * 0.29, -s * 0.33, s * 0.05, s * 0.05, '#e63946')
    ctx.fillStyle = '#ffb300'
    ctx.beginPath()
    ctx.moveTo(s * 0.34, -s * 0.22)
    ctx.lineTo(s * 0.46, -s * 0.18)
    ctx.lineTo(s * 0.34, -s * 0.14)
    ctx.fill()
    ellipse(ctx, s * 0.26, -s * 0.23, s * 0.025, s * 0.03, '#222')
    ctx.strokeStyle = '#ffb300'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-s * 0.05, s * 0.2)
    ctx.lineTo(-s * 0.05, s * 0.3)
    ctx.moveTo(s * 0.08, s * 0.2)
    ctx.lineTo(s * 0.08, s * 0.3)
    ctx.stroke()
  } else if (kind === 'cow') {
    for (const lx of [-0.24, -0.1, 0.12, 0.26]) {
      ctx.fillStyle = '#4a4a4a'
      ctx.fillRect(lx * s - 2, s * 0.08, 5, s * 0.2)
    }
    ellipse(ctx, 0, 0, s * 0.4, s * 0.24, '#ffffff')
    ellipse(ctx, -s * 0.12, -s * 0.06, s * 0.12, s * 0.09, '#2f2f2f', 0.4)
    ellipse(ctx, s * 0.12, s * 0.06, s * 0.09, s * 0.07, '#2f2f2f', -0.3)
    ellipse(ctx, s * 0.4, -s * 0.12, s * 0.15, s * 0.14, '#ffffff')
    ellipse(ctx, s * 0.5, -s * 0.06, s * 0.1, s * 0.07, '#ffc2cf')
    ellipse(ctx, s * 0.38, -s * 0.18, s * 0.025, s * 0.03, '#222')
    ellipse(ctx, s * 0.32, -s * 0.28, s * 0.05, s * 0.03, '#f5e6c8', -0.5)
    ellipse(ctx, s * 0.46, -s * 0.28, s * 0.05, s * 0.03, '#f5e6c8', 0.5)
    ctx.strokeStyle = '#2f2f2f'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-s * 0.4, -s * 0.02)
    ctx.quadraticCurveTo(-s * 0.5, s * 0.05 + Math.sin(t * 3) * 4, -s * 0.46, s * 0.16)
    ctx.stroke()
  } else if (kind === 'pig') {
    for (const lx of [-0.2, 0.18]) {
      ctx.fillStyle = '#e88aa0'
      ctx.fillRect(lx * s - 3, s * 0.1, 6, s * 0.16)
    }
    ellipse(ctx, 0, 0, s * 0.34, s * 0.24, '#ffadc0')
    ellipse(ctx, s * 0.3, -s * 0.06, s * 0.17, s * 0.16, '#ffadc0')
    ellipse(ctx, s * 0.44, -s * 0.03, s * 0.07, s * 0.06, '#ff8fab')
    ellipse(ctx, s * 0.42, -s * 0.03, s * 0.015, s * 0.02, '#8a3a4a')
    ellipse(ctx, s * 0.46, -s * 0.03, s * 0.015, s * 0.02, '#8a3a4a')
    ellipse(ctx, s * 0.32, -s * 0.14, s * 0.025, s * 0.03, '#222')
    leaf(ctx, s * 0.24, -s * 0.18, s * 0.12, -0.6, '#ff8fab')
    ctx.strokeStyle = '#ff8fab'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(-s * 0.36, -s * 0.04, s * 0.05, 0, Math.PI * 1.6)
    ctx.stroke()
  } else {
    for (const lx of [-0.18, 0.16]) {
      ctx.fillStyle = '#3d3540'
      ctx.fillRect(lx * s - 2, s * 0.1, 5, s * 0.18)
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2
      ellipse(ctx, Math.cos(a) * s * 0.22, Math.sin(a) * s * 0.13 - s * 0.02, s * 0.14, s * 0.13, '#f7f5f0')
    }
    ellipse(ctx, 0, -s * 0.02, s * 0.26, s * 0.18, '#ffffff')
    ellipse(ctx, s * 0.32, -s * 0.1, s * 0.12, s * 0.13, '#3d3540')
    ellipse(ctx, s * 0.3, -s * 0.2, s * 0.08, s * 0.05, '#f7f5f0')
    ellipse(ctx, s * 0.36, -s * 0.12, s * 0.025, s * 0.03, '#fff')
  }
  ctx.restore()
}

export function drawTree(ctx: Ctx, x: number, y: number, s: number, t: number) {
  ellipse(ctx, x, y + s * 0.42, s * 0.42, s * 0.12, 'rgba(30, 60, 20, 0.25)')
  ctx.fillStyle = '#7a5236'
  roundRect(ctx, x - s * 0.07, y + s * 0.05, s * 0.14, s * 0.38, s * 0.04)
  ctx.fill()
  const sway = Math.sin(t * 0.8 + x) * s * 0.015
  ellipse(ctx, x + sway, y - s * 0.12, s * 0.42, s * 0.36, '#3f8f3a')
  ellipse(ctx, x - s * 0.18 + sway, y - s * 0.04, s * 0.26, s * 0.24, '#4aa443')
  ellipse(ctx, x + s * 0.16 + sway, y - s * 0.26, s * 0.24, s * 0.22, '#5bb84f')
  ellipse(ctx, x - s * 0.06 + sway, y - s * 0.3, s * 0.12, s * 0.08, 'rgba(255,255,255,0.18)')
}

export function drawPond(ctx: Ctx, x: number, y: number, w: number, h: number, t: number) {
  ellipse(ctx, x + w / 2, y + h / 2, w / 2 + 6, h / 2 + 6, '#c9b48a')
  ellipse(ctx, x + w / 2, y + h / 2, w / 2, h / 2, '#5fb7e8')
  ellipse(ctx, x + w / 2, y + h / 2 + 3, w / 2 - 6, h / 2 - 8, '#76c6f0')
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.lineWidth = 2
  for (let i = 0; i < 3; i++) {
    const k = (t * 0.3 + i / 3) % 1
    ctx.globalAlpha = 1 - k
    ctx.beginPath()
    ctx.ellipse(x + w * (0.3 + i * 0.2), y + h * (0.4 + (i % 2) * 0.2), 6 + k * 18, 3 + k * 8, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  // A duck going around.
  const a = t * 0.3
  const dx = x + w / 2 + Math.cos(a) * w * 0.25
  const dy = y + h / 2 + Math.sin(a) * h * 0.22
  ctx.save()
  ctx.translate(dx, dy)
  ctx.scale(Math.sin(a) > 0 ? -1 : 1, 1)
  ellipse(ctx, 0, 0, 11, 7, '#fffaf0')
  ellipse(ctx, 8, -6, 5, 5, '#3c8d4a')
  ctx.fillStyle = '#ffb300'
  ctx.fillRect(12, -6, 5, 3)
  ctx.restore()
}

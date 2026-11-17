// Cloud Acres: farm products, buildings, animals and decoration, drawn with the canvas API.
// Buildings are seen from above with their front visible (3/4 view), with an ink outline.

import type { AnimalKind, ItemId, WorkshopKind } from './data'
import { C, drawProduce, ellipse, leaf, paint, roundRect, shadow, wind } from './draw'

type Ctx = CanvasRenderingContext2D

const CROP_ITEMS = ['wheat', 'carrot', 'corn', 'tomato', 'pumpkin']

/** Any item of the barn, about `s` tall, centered on x, y. */
export function drawItem(ctx: Ctx, id: ItemId, x: number, y: number, s: number) {
  if (CROP_ITEMS.includes(id)) {
    drawProduce(ctx, id as 'wheat', x, y, s)
    return
  }
  const ink = Math.max(1, s * 0.05)
  ctx.save()
  switch (id) {
    case 'egg':
      ellipse(ctx, x + s * 0.12, y + s * 0.1, s * 0.22, s * 0.28, '#f2e2c4', 0.2, ink)
      ellipse(ctx, x - s * 0.06, y + s * 0.02, s * 0.25, s * 0.33, '#fff8ea', -0.1, ink)
      ellipse(ctx, x - s * 0.13, y - s * 0.1, s * 0.06, s * 0.1, 'rgba(255,255,255,0.95)', -0.3)
      break
    case 'milk':
      roundRect(ctx, x - s * 0.22, y - s * 0.14, s * 0.44, s * 0.56, s * 0.12)
      paint(ctx, '#ffffff', ink)
      roundRect(ctx, x - s * 0.12, y - s * 0.4, s * 0.24, s * 0.3, s * 0.05)
      paint(ctx, '#eef6ff', ink)
      roundRect(ctx, x - s * 0.15, y - s * 0.46, s * 0.3, s * 0.1, s * 0.04)
      paint(ctx, C.sky, ink)
      roundRect(ctx, x - s * 0.22, y + s * 0.06, s * 0.44, s * 0.15, s * 0.02)
      paint(ctx, C.sky)
      ellipse(ctx, x - s * 0.11, y + s * 0.1, s * 0.035, s * 0.035, '#fff')
      break
    case 'truffle':
      for (const [dx, dy, r] of [
        [-0.12, 0.06, 0.2],
        [0.1, 0.02, 0.22],
        [0, -0.12, 0.18],
      ]) {
        ellipse(ctx, x + dx * s, y + dy * s, r * s, r * s * 0.9, '#5e4032', 0, ink)
      }
      ellipse(ctx, x - s * 0.06, y - s * 0.14, s * 0.07, s * 0.04, 'rgba(255,255,255,0.3)')
      for (let i = 0; i < 6; i++) ellipse(ctx, x + Math.cos(i * 2.1) * s * 0.15, y + Math.sin(i * 1.7) * s * 0.12, s * 0.025, s * 0.025, 'rgba(30,15,8,0.5)')
      break
    case 'wool':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        ellipse(ctx, x + Math.cos(a) * s * 0.18, y + Math.sin(a) * s * 0.15, s * 0.16, s * 0.15, '#f7f1ff', 0, ink)
      }
      ellipse(ctx, x, y, s * 0.24, s * 0.21, '#fdfaff')
      ctx.strokeStyle = '#cbbfe8'
      ctx.lineWidth = Math.max(1, s * 0.04)
      ctx.beginPath()
      ctx.arc(x, y, s * 0.12, 0.5, 5)
      ctx.stroke()
      break
    case 'flour':
      ctx.beginPath()
      ctx.moveTo(x - s * 0.24, y - s * 0.24)
      ctx.quadraticCurveTo(x, y - s * 0.34, x + s * 0.24, y - s * 0.24)
      ctx.quadraticCurveTo(x + s * 0.4, y + s * 0.4, x, y + s * 0.44)
      ctx.quadraticCurveTo(x - s * 0.4, y + s * 0.4, x - s * 0.24, y - s * 0.24)
      paint(ctx, '#fffaf0', ink)
      roundRect(ctx, x - s * 0.2, y - s * 0.32, s * 0.4, s * 0.09, s * 0.04)
      paint(ctx, C.coral, ink * 0.8)
      drawProduce(ctx, 'wheat', x, y + s * 0.12, s * 0.34)
      break
    case 'cheese':
      ctx.beginPath()
      ctx.moveTo(x - s * 0.38, y + s * 0.26)
      ctx.lineTo(x + s * 0.36, y + s * 0.26)
      ctx.lineTo(x + s * 0.36, y - s * 0.04)
      ctx.lineTo(x - s * 0.3, y - s * 0.24)
      ctx.closePath()
      paint(ctx, '#ffd04f', ink)
      ctx.beginPath()
      ctx.moveTo(x - s * 0.38, y + s * 0.26)
      ctx.lineTo(x - s * 0.3, y - s * 0.24)
      ctx.lineTo(x - s * 0.38, y - s * 0.04)
      ctx.closePath()
      paint(ctx, '#ffe48a', ink)
      for (const [dx, dy, r] of [
        [-0.04, 0.1, 0.06],
        [0.18, 0.12, 0.05],
        [0.14, -0.02, 0.04],
      ]) {
        ellipse(ctx, x + dx * s, y + dy * s, r * s, r * s, '#e5a91f')
      }
      break
    case 'sweater':
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
      paint(ctx, C.teal, ink)
      ctx.fillStyle = '#fff'
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath()
        ctx.moveTo(x + i * s * 0.09, y + s * 0.06)
        ctx.lineTo(x + i * s * 0.09 + s * 0.04, y + s * 0.12)
        ctx.lineTo(x + i * s * 0.09, y + s * 0.18)
        ctx.lineTo(x + i * s * 0.09 - s * 0.04, y + s * 0.12)
        ctx.fill()
      }
      ellipse(ctx, x, y - s * 0.3, s * 0.1, s * 0.05, C.tealDark)
      break
    case 'cake':
      ellipse(ctx, x, y + s * 0.3, s * 0.4, s * 0.1, '#e4e0f0', 0, ink)
      roundRect(ctx, x - s * 0.3, y - s * 0.08, s * 0.6, s * 0.36, s * 0.08)
      paint(ctx, '#c9824d', ink)
      roundRect(ctx, x - s * 0.32, y - s * 0.14, s * 0.64, s * 0.15, s * 0.07)
      paint(ctx, '#fff1f6', ink)
      for (let i = -2; i <= 2; i++) ellipse(ctx, x + i * s * 0.12, y + s * 0.02, s * 0.04, s * 0.06, '#fff1f6')
      ellipse(ctx, x, y - s * 0.22, s * 0.075, s * 0.075, '#ff4f5e', 0, ink)
      break
  }
  ctx.restore()
}

/** A building's walls and roof (footprint x, y, w, h), in the island's style. */
function house(ctx: Ctx, x: number, y: number, w: number, h: number, wall: string, roof: string, roofDark: string) {
  const ink = Math.max(1.5, w * 0.022)
  shadow(ctx, x + w / 2, y + h * 0.95, w * 0.55, h * 0.12)
  roundRect(ctx, x + w * 0.08, y + h * 0.42, w * 0.84, h * 0.54, w * 0.06)
  paint(ctx, wall, ink)
  ctx.fillStyle = 'rgba(61,42,69,0.08)'
  ctx.fillRect(x + w * 0.1, y + h * 0.86, w * 0.8, h * 0.08)
  ctx.beginPath()
  ctx.moveTo(x - w * 0.02, y + h * 0.5)
  ctx.quadraticCurveTo(x + w * 0.5, y - h * 0.12, x + w * 1.02, y + h * 0.5)
  ctx.closePath()
  paint(ctx, roofDark, ink)
  ctx.beginPath()
  ctx.moveTo(x + w * 0.05, y + h * 0.44)
  ctx.quadraticCurveTo(x + w * 0.5, y - h * 0.06, x + w * 0.95, y + h * 0.44)
  ctx.closePath()
  paint(ctx, roof)
  // Shingles.
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = Math.max(1, w * 0.012)
  for (let i = 1; i < 4; i++) {
    const k = i / 4
    ctx.beginPath()
    ctx.moveTo(x + w * (0.05 + 0.22 * k), y + h * (0.44 - 0.3 * k))
    ctx.quadraticCurveTo(x + w * 0.5, y + h * (0.3 - 0.36 * k), x + w * (0.95 - 0.22 * k), y + h * (0.44 - 0.3 * k))
    ctx.stroke()
  }
}

function door(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.beginPath()
  ctx.moveTo(x - w / 2, y)
  ctx.lineTo(x - w / 2, y - h + w / 2)
  ctx.arc(x, y - h + w / 2, w / 2, Math.PI, 0)
  ctx.lineTo(x + w / 2, y)
  ctx.closePath()
  paint(ctx, color, Math.max(1.2, w * 0.08))
  ellipse(ctx, x + w * 0.26, y - h * 0.42, w * 0.07, w * 0.07, C.gold)
}

function sign(ctx: Ctx, x: number, y: number, s: number, draw: () => void) {
  ellipse(ctx, x, y, s, s, C.paper, 0, Math.max(1.2, s * 0.12))
  draw()
}

/** The barn: a round-roofed wooden barn with a cloud weathervane turning in the wind. */
export function drawBarn(ctx: Ctx, x: number, y: number, w: number, h: number, t = 0) {
  const ink = Math.max(1.5, w * 0.02)
  shadow(ctx, x + w / 2, y + h * 0.95, w * 0.58, h * 0.12)
  // Walls: cream planks.
  roundRect(ctx, x + w * 0.06, y + h * 0.4, w * 0.88, h * 0.56, w * 0.05)
  paint(ctx, '#fbe9cc', ink)
  ctx.strokeStyle = 'rgba(160, 110, 60, 0.25)'
  ctx.lineWidth = Math.max(1, w * 0.008)
  for (let i = 1; i < 9; i++) {
    ctx.beginPath()
    ctx.moveTo(x + w * (0.06 + i * 0.098), y + h * 0.44)
    ctx.lineTo(x + w * (0.06 + i * 0.098), y + h * 0.93)
    ctx.stroke()
  }
  // The round roof, with a scalloped edge like a cloud.
  ctx.beginPath()
  ctx.moveTo(x - w * 0.02, y + h * 0.46)
  ctx.bezierCurveTo(x - w * 0.02, y - h * 0.1, x + w * 1.02, y - h * 0.1, x + w * 1.02, y + h * 0.46)
  ctx.closePath()
  paint(ctx, C.tealDark, ink)
  ctx.beginPath()
  ctx.moveTo(x + w * 0.04, y + h * 0.42)
  ctx.bezierCurveTo(x + w * 0.04, y - h * 0.03, x + w * 0.96, y - h * 0.03, x + w * 0.96, y + h * 0.42)
  ctx.closePath()
  paint(ctx, C.teal)
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = Math.max(1, w * 0.012)
  for (const k of [0.3, 0.5, 0.7]) {
    ctx.beginPath()
    ctx.moveTo(x + w * k, y + h * 0.42)
    ctx.quadraticCurveTo(x + w * (k + (k - 0.5) * 0.3), y + h * 0.1, x + w * 0.5 + (k - 0.5) * w * 0.4, y + h * 0.04)
    ctx.stroke()
  }
  const scallops = 7
  for (let i = 0; i < scallops; i++) {
    const sx = x + w * (0.02 + (i + 0.5) * (0.96 / scallops))
    ctx.beginPath()
    ctx.arc(sx, y + h * 0.44, w * 0.07, 0, Math.PI)
    paint(ctx, C.cream, ink * 0.8)
  }
  // Round window, warm light.
  ellipse(ctx, x + w * 0.5, y + h * 0.24, w * 0.09, w * 0.09, '#ffe7a6', 0, ink)
  ctx.strokeStyle = C.woodDark
  ctx.lineWidth = ink * 0.8
  ctx.beginPath()
  ctx.moveTo(x + w * 0.41, y + h * 0.24)
  ctx.lineTo(x + w * 0.59, y + h * 0.24)
  ctx.moveTo(x + w * 0.5, y + h * 0.24 - w * 0.09)
  ctx.lineTo(x + w * 0.5, y + h * 0.24 + w * 0.09)
  ctx.stroke()
  // Big arched door, with hay showing.
  door(ctx, x + w * 0.5, y + h * 0.96, w * 0.36, h * 0.42, C.wood)
  ctx.strokeStyle = 'rgba(80, 45, 20, 0.45)'
  ctx.lineWidth = Math.max(1, w * 0.01)
  ctx.beginPath()
  ctx.moveTo(x + w * 0.5, y + h * 0.6)
  ctx.lineTo(x + w * 0.5, y + h * 0.95)
  ctx.stroke()
  for (const dx of [-0.13, 0.13]) {
    ctx.beginPath()
    ctx.moveTo(x + w * (0.5 + dx), y + h * 0.68)
    ctx.lineTo(x + w * (0.5 + dx), y + h * 0.95)
    ctx.stroke()
  }
  // The weathervane: a little cloud that turns with the wind.
  const vx = x + w * 0.5
  const vy = y - h * 0.02
  ctx.strokeStyle = C.ink
  ctx.lineWidth = ink
  ctx.beginPath()
  ctx.moveTo(vx, vy)
  ctx.lineTo(vx, vy - h * 0.16)
  ctx.stroke()
  const turn = Math.cos(t * 0.7) * 0.9 + wind(x, t) * 0.3
  const cw = w * 0.13 * Math.max(0.2, Math.abs(Math.cos(turn)))
  ctx.save()
  ctx.translate(vx, vy - h * 0.2)
  ctx.scale(Math.cos(turn) >= 0 ? 1 : -1, 1)
  ctx.beginPath()
  ctx.arc(-cw * 0.4, 0, w * 0.035, 0, Math.PI * 2)
  ctx.arc(0, -w * 0.02, w * 0.045, 0, Math.PI * 2)
  ctx.arc(cw * 0.45, 0, w * 0.035, 0, Math.PI * 2)
  paint(ctx, '#ffffff', ink * 0.8)
  ctx.restore()
}

/** The orders kiosk: a striped awning over a cork board; its flag waves when orders wait. */
export function drawBoard(ctx: Ctx, x: number, y: number, w: number, h: number, notes: number, t = 0) {
  const ink = Math.max(1.5, w * 0.025)
  shadow(ctx, x + w / 2, y + h * 0.92, w * 0.46, h * 0.1)
  for (const px of [0.14, 0.8]) {
    roundRect(ctx, x + w * px, y + h * 0.2, w * 0.07, h * 0.74, w * 0.03)
    paint(ctx, C.woodDark, ink)
  }
  roundRect(ctx, x + w * 0.08, y + h * 0.3, w * 0.84, h * 0.42, w * 0.05)
  paint(ctx, '#d9a46c', ink)
  roundRect(ctx, x + w * 0.13, y + h * 0.34, w * 0.74, h * 0.34, w * 0.03)
  paint(ctx, '#e8bf8a')
  // Awning: coral and cream stripes, with a wavy edge.
  const stripes = 5
  for (let i = 0; i < stripes; i++) {
    const sx = x + w * (0.02 + (i * 0.96) / stripes)
    const sw = (w * 0.96) / stripes
    ctx.beginPath()
    ctx.moveTo(sx, y + h * 0.1)
    ctx.lineTo(sx + sw, y + h * 0.1)
    ctx.lineTo(sx + sw, y + h * 0.24)
    ctx.arc(sx + sw / 2, y + h * 0.24, sw / 2, 0, Math.PI)
    ctx.closePath()
    paint(ctx, i % 2 ? C.cream : C.coral, ink)
  }
  for (let i = 0; i < Math.min(notes, 3); i++) {
    const nx = x + w * (0.27 + i * 0.23)
    const ny = y + h * (0.5 + (i % 2) * 0.03)
    ctx.save()
    ctx.translate(nx, ny)
    ctx.rotate((i - 1) * 0.14 + Math.sin(t * 2 + i) * 0.03)
    roundRect(ctx, -w * 0.08, -h * 0.12, w * 0.16, h * 0.22, 2)
    paint(ctx, C.paper, ink * 0.6)
    ctx.fillStyle = 'rgba(61, 42, 69, 0.35)'
    for (let l = 0; l < 3; l++) ctx.fillRect(-w * 0.05, -h * 0.05 + l * h * 0.045, w * 0.1, Math.max(1, h * 0.015))
    ellipse(ctx, 0, -h * 0.11, w * 0.02, w * 0.02, C.coral)
    ctx.restore()
  }
  // Flag up when there are orders.
  const fx = x + w * 0.88
  const fy = y + h * 0.12
  ctx.strokeStyle = C.ink
  ctx.lineWidth = ink * 0.8
  ctx.beginPath()
  ctx.moveTo(fx, fy + h * 0.1)
  ctx.lineTo(fx, fy - h * 0.12)
  ctx.stroke()
  if (notes > 0) {
    const wave = Math.sin(t * 6) * h * 0.02
    ctx.beginPath()
    ctx.moveTo(fx, fy - h * 0.12)
    ctx.quadraticCurveTo(fx + w * 0.1, fy - h * 0.12 + wave, fx + w * 0.16, fy - h * 0.08)
    ctx.lineTo(fx, fy - h * 0.02)
    ctx.closePath()
    paint(ctx, C.gold, ink * 0.6)
  }
}

export function drawWorkshop(ctx: Ctx, kind: WorkshopKind, x: number, y: number, w: number, h: number, t: number, busy: boolean) {
  const ink = Math.max(1.5, w * 0.022)
  if (kind === 'mill') {
    // A slender windmill with a plum cap and cloth sails.
    shadow(ctx, x + w / 2, y + h * 0.95, w * 0.42, h * 0.12)
    ctx.beginPath()
    ctx.moveTo(x + w * 0.26, y + h * 0.96)
    ctx.lineTo(x + w * 0.36, y + h * 0.24)
    ctx.lineTo(x + w * 0.64, y + h * 0.24)
    ctx.lineTo(x + w * 0.74, y + h * 0.96)
    ctx.closePath()
    paint(ctx, '#fbecd2', ink)
    ctx.fillStyle = 'rgba(160, 110, 60, 0.18)'
    for (let i = 0; i < 4; i++) ctx.fillRect(x + w * (0.33 + (i % 2) * 0.18), y + h * (0.4 + i * 0.13), w * 0.15, h * 0.035)
    ctx.beginPath()
    ctx.moveTo(x + w * 0.28, y + h * 0.28)
    ctx.quadraticCurveTo(x + w * 0.5, y - h * 0.08, x + w * 0.72, y + h * 0.28)
    ctx.closePath()
    paint(ctx, C.plum, ink)
    door(ctx, x + w * 0.5, y + h * 0.96, w * 0.17, h * 0.24, C.wood)
    const cx = x + w * 0.5
    const cy = y + h * 0.27
    const angle = t * (busy ? 2.6 : 0.3)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angle)
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2)
      roundRect(ctx, -w * 0.015, 0, w * 0.03, h * 0.44, 2)
      paint(ctx, C.woodDark, ink * 0.6)
      ctx.beginPath()
      ctx.moveTo(w * 0.02, h * 0.1)
      ctx.lineTo(w * 0.14, h * 0.12)
      ctx.lineTo(w * 0.13, h * 0.42)
      ctx.lineTo(w * 0.02, h * 0.42)
      ctx.closePath()
      paint(ctx, i % 2 ? '#fff6e6' : '#ffe1d6', ink * 0.6)
    }
    ctx.restore()
    ellipse(ctx, cx, cy, w * 0.045, w * 0.045, C.woodDark, 0, ink * 0.8)
    return
  }
  if (kind === 'dairy') {
    // A round dome, sky blue, with a milk bottle sign.
    shadow(ctx, x + w / 2, y + h * 0.95, w * 0.52, h * 0.12)
    roundRect(ctx, x + w * 0.1, y + h * 0.5, w * 0.8, h * 0.46, w * 0.06)
    paint(ctx, '#ffffff', ink)
    ctx.beginPath()
    ctx.ellipse(x + w * 0.5, y + h * 0.52, w * 0.46, h * 0.44, 0, Math.PI, 0)
    ctx.closePath()
    paint(ctx, '#7cc4ff', ink)
    for (const [dx, dy, r] of [
      [0.3, 0.32, 0.06],
      [0.58, 0.2, 0.05],
      [0.7, 0.4, 0.045],
    ]) {
      ellipse(ctx, x + w * dx, y + h * dy, w * r, w * r * 0.8, '#ffffff', 0.3)
    }
    door(ctx, x + w * 0.5, y + h * 0.96, w * 0.22, h * 0.32, '#9c6b45')
    ellipse(ctx, x + w * 0.22, y + h * 0.7, w * 0.07, w * 0.07, '#d6efff', 0, ink * 0.7)
    ellipse(ctx, x + w * 0.78, y + h * 0.7, w * 0.07, w * 0.07, '#d6efff', 0, ink * 0.7)
    sign(ctx, x + w * 0.5, y + h * 0.26, w * 0.12, () => drawItem(ctx, 'cheese', x + w * 0.5, y + h * 0.26, w * 0.16))
    return
  }
  if (kind === 'loom') {
    // An A-frame cabin with a mustard roof, its spinning wheel turning by the door.
    house(ctx, x, y, w, h, '#f4e3cc', C.gold, C.goldDark)
    door(ctx, x + w * 0.42, y + h * 0.96, w * 0.2, h * 0.3, '#8d6346')
    const wx = x + w * 0.76
    const wy = y + h * 0.76
    const r = w * 0.12
    ellipse(ctx, wx, wy, r, r, 'rgba(0,0,0,0)', 0, ink)
    ctx.save()
    ctx.translate(wx, wy)
    ctx.rotate(t * (busy ? 4 : 0.2))
    ctx.strokeStyle = C.woodDark
    ctx.lineWidth = ink * 0.7
    for (let i = 0; i < 3; i++) {
      ctx.rotate(Math.PI / 3)
      ctx.beginPath()
      ctx.moveTo(-r, 0)
      ctx.lineTo(r, 0)
      ctx.stroke()
    }
    ctx.restore()
    ellipse(ctx, wx, wy, r * 0.25, r * 0.25, C.plum, 0, ink * 0.6)
    sign(ctx, x + w * 0.5, y + h * 0.28, w * 0.12, () => drawItem(ctx, 'sweater', x + w * 0.5, y + h * 0.28, w * 0.16))
    return
  }
  // Bakery: a brick oven house with a coral roof, smoking while it bakes.
  roundRect(ctx, x + w * 0.66, y - h * 0.04, w * 0.12, h * 0.26, 3)
  paint(ctx, '#b0624a', ink)
  house(ctx, x, y, w, h, '#ffd9b5', C.coral, C.coralDark)
  ctx.fillStyle = 'rgba(180, 80, 50, 0.25)'
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) ctx.fillRect(x + w * (0.14 + col * 0.19 + (row % 2) * 0.09), y + h * (0.56 + row * 0.1), w * 0.12, h * 0.04)
  door(ctx, x + w * 0.5, y + h * 0.96, w * 0.24, h * 0.3, '#8d6346')
  ellipse(ctx, x + w * 0.5, y + h * 0.78, w * 0.06, w * 0.04, busy ? '#ffb347' : '#5e3d27')
  if (busy) {
    for (let i = 0; i < 4; i++) {
      const k = (t * 0.5 + i / 4) % 1
      ellipse(ctx, x + w * 0.72 + Math.sin(k * 6 + i) * 5, y - h * 0.08 - k * h * 0.5, 4 + k * 9, 4 + k * 9, `rgba(255,255,255,${0.7 * (1 - k)})`)
    }
  }
  sign(ctx, x + w * 0.5, y + h * 0.3, w * 0.12, () => drawItem(ctx, 'cake', x + w * 0.5, y + h * 0.3, w * 0.17))
}

/** A pen: clover grass, round wooden posts and a rope. */
export function drawFence(ctx: Ctx, x: number, y: number, w: number, h: number) {
  roundRect(ctx, x, y, w, h, 18)
  paint(ctx, 'rgba(190, 230, 130, 0.55)')
  ctx.fillStyle = 'rgba(120, 180, 70, 0.35)'
  for (let i = 0; i < 18; i++) {
    const cx = x + 14 + ((i * 53) % Math.max(1, w - 28))
    const cy = y + 14 + ((i * 37) % Math.max(1, h - 28))
    for (let k = 0; k < 3; k++) {
      ctx.beginPath()
      ctx.arc(cx + Math.cos(k * 2.1) * 3, cy + Math.sin(k * 2.1) * 3, 2.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // Rope.
  ctx.strokeStyle = '#e7c48c'
  ctx.lineWidth = 3
  roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 16)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(61,42,69,0.45)'
  ctx.lineWidth = 1
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 17)
  ctx.stroke()
  const post = (px: number, py: number) => {
    roundRect(ctx, px - 4, py - 9, 8, 14, 4)
    paint(ctx, C.wood, 1.5)
    ellipse(ctx, px, py - 9, 4, 2, C.woodLight)
  }
  const step = 34
  for (let px = x + 10; px <= x + w - 8; px += step) {
    post(px, y + 4)
    post(px, y + h - 2)
  }
  for (let py = y + 10 + step; py <= y + h - step; py += step) {
    post(x + 2, py)
    post(x + w - 2, py)
  }
}

export function drawTrough(ctx: Ctx, x: number, y: number, w: number, full: boolean, food: string) {
  const ink = Math.max(1.2, w * 0.03)
  roundRect(ctx, x - w / 2, y - w * 0.12, w, w * 0.28, w * 0.1)
  paint(ctx, C.wood, ink)
  roundRect(ctx, x - w * 0.42, y - w * 0.08, w * 0.84, w * 0.14, w * 0.06)
  paint(ctx, full ? food : '#6e4a30')
  if (full) for (let i = -3; i <= 3; i++) ellipse(ctx, x + i * w * 0.1, y - w * 0.04, w * 0.04, w * 0.025, 'rgba(255,255,255,0.4)')
}

/** An animal, `s` about its length. They peck, chew, wiggle and hop by themselves. */
export function drawAnimal(ctx: Ctx, kind: AnimalKind, x: number, y: number, s: number, t: number, facing: number, moving: boolean) {
  const ink = Math.max(1.2, s * 0.045)
  const hop = moving ? Math.abs(Math.sin(t * 10)) * s * (kind === 'sheep' ? 0.12 : 0.06) : Math.sin(t * 2) * s * 0.01
  const blink = Math.sin(t * 1.7) > 0.97
  ctx.save()
  ctx.translate(x, y)
  shadow(ctx, 0, s * 0.28, s * 0.36, s * 0.09, 1.1)
  ctx.scale(facing, 1)
  // Breathing / landing squash.
  const squash = moving ? 1 + Math.sin(t * 20) * 0.04 : 1 + Math.sin(t * 2.4) * 0.02
  ctx.translate(0, -hop)
  ctx.scale(1 / squash, squash)
  const eye = (ex: number, ey: number, r: number) => {
    if (blink) {
      ctx.strokeStyle = C.ink
      ctx.lineWidth = ink * 0.8
      ctx.beginPath()
      ctx.moveTo(ex - r, ey)
      ctx.lineTo(ex + r, ey)
      ctx.stroke()
    } else {
      ellipse(ctx, ex, ey, r * 0.8, r, C.ink)
      ellipse(ctx, ex + r * 0.25, ey - r * 0.35, r * 0.3, r * 0.3, '#fff')
    }
  }
  if (kind === 'chicken') {
    // Pecks the ground now and then.
    const peck = !moving && Math.sin(t * 1.3) > 0.6 ? Math.min(1, (Math.sin(t * 1.3) - 0.6) * 5) : 0
    ctx.strokeStyle = '#f59b1b'
    ctx.lineWidth = Math.max(1.5, s * 0.06)
    ctx.beginPath()
    ctx.moveTo(-s * 0.05, s * 0.16)
    ctx.lineTo(-s * 0.05, s * 0.3)
    ctx.moveTo(s * 0.08, s * 0.16)
    ctx.lineTo(s * 0.08, s * 0.3)
    ctx.stroke()
    ellipse(ctx, -s * 0.26, -s * 0.12, s * 0.12, s * 0.16, '#f4e6d4', -0.4, ink)
    ellipse(ctx, 0, 0, s * 0.3, s * 0.25, '#fffaf2', 0, ink)
    leaf(ctx, -s * 0.02, s * 0.02, s * 0.2, -1.9, '#f1e1cc', ink * 0.6)
    ctx.save()
    ctx.translate(s * 0.2, -s * 0.12)
    ctx.rotate(peck * 1.1)
    ellipse(ctx, s * 0.04, -s * 0.08, s * 0.15, s * 0.15, '#fffaf2', 0, ink)
    ellipse(ctx, s * 0.03, -s * 0.24, s * 0.06, s * 0.06, '#ff5a5f', 0, ink * 0.6)
    ellipse(ctx, s * 0.1, -s * 0.21, s * 0.05, s * 0.05, '#ff5a5f', 0, ink * 0.6)
    ctx.beginPath()
    ctx.moveTo(s * 0.16, -s * 0.1)
    ctx.lineTo(s * 0.29, -s * 0.06)
    ctx.lineTo(s * 0.16, -s * 0.02)
    ctx.closePath()
    paint(ctx, '#ffb300', ink * 0.6)
    eye(s * 0.08, -s * 0.1, s * 0.03)
    ctx.restore()
  } else if (kind === 'cow') {
    // Chews, swishes its tail.
    const chew = Math.sin(t * 5) * s * 0.01
    for (const lx of [-0.24, -0.1, 0.12, 0.26]) {
      roundRect(ctx, lx * s - s * 0.04, s * 0.06, s * 0.08, s * 0.22, s * 0.03)
      paint(ctx, '#ffffff', ink)
      ellipse(ctx, lx * s, s * 0.27, s * 0.045, s * 0.025, '#5e4a42')
    }
    ctx.strokeStyle = C.ink
    ctx.lineWidth = ink
    ctx.beginPath()
    ctx.moveTo(-s * 0.38, -s * 0.04)
    ctx.quadraticCurveTo(-s * 0.52, s * 0.04 + Math.sin(t * 3) * s * 0.08, -s * 0.48 + Math.sin(t * 3) * s * 0.04, s * 0.16)
    ctx.stroke()
    ellipse(ctx, -s * 0.48 + Math.sin(t * 3) * s * 0.04, s * 0.17, s * 0.035, s * 0.05, '#7a5a4e')
    ellipse(ctx, 0, 0, s * 0.4, s * 0.25, '#ffffff', 0, ink)
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(0, 0, s * 0.4, s * 0.25, 0, 0, Math.PI * 2)
    ctx.clip()
    ellipse(ctx, -s * 0.14, -s * 0.08, s * 0.13, s * 0.1, '#7a5a4e', 0.4)
    ellipse(ctx, s * 0.14, s * 0.1, s * 0.1, s * 0.08, '#7a5a4e', -0.3)
    ctx.restore()
    ellipse(ctx, s * 0.32, -s * 0.28, s * 0.06, s * 0.035, '#f5e6c8', -0.6, ink * 0.7)
    ellipse(ctx, s * 0.48, -s * 0.28, s * 0.06, s * 0.035, '#f5e6c8', 0.6, ink * 0.7)
    ellipse(ctx, s * 0.4, -s * 0.13, s * 0.15, s * 0.14, '#ffffff', 0, ink)
    ellipse(ctx, s * 0.5, -s * 0.05 + chew, s * 0.1, s * 0.07, '#ffc8d3', 0, ink * 0.8)
    ellipse(ctx, s * 0.47, -s * 0.05 + chew, s * 0.015, s * 0.015, C.ink)
    ellipse(ctx, s * 0.53, -s * 0.05 + chew, s * 0.015, s * 0.015, C.ink)
    eye(s * 0.37, -s * 0.18, s * 0.028)
  } else if (kind === 'pig') {
    const wiggle = Math.sin(t * 8) * 0.4
    for (const lx of [-0.2, 0.18]) {
      roundRect(ctx, lx * s - s * 0.05, s * 0.08, s * 0.1, s * 0.18, s * 0.04)
      paint(ctx, '#f497ad', ink)
    }
    ellipse(ctx, 0, 0, s * 0.35, s * 0.25, '#ffb3c4', 0, ink)
    ctx.strokeStyle = C.ink
    ctx.lineWidth = ink
    ctx.beginPath()
    ctx.arc(-s * 0.38, -s * 0.04, s * 0.05, wiggle, Math.PI * 1.6 + wiggle)
    ctx.stroke()
    ellipse(ctx, s * 0.3, -s * 0.06, s * 0.17, s * 0.16, '#ffb3c4', 0, ink)
    leaf(ctx, s * 0.22, -s * 0.17, s * 0.13, -0.6 + Math.sin(t * 2) * 0.1, '#ff94ad', ink * 0.6)
    ellipse(ctx, s * 0.45, -s * 0.03, s * 0.075, s * 0.065, '#ff94ad', 0, ink * 0.8)
    ellipse(ctx, s * 0.43, -s * 0.03, s * 0.015, s * 0.022, '#8a3a4a')
    ellipse(ctx, s * 0.47, -s * 0.03, s * 0.015, s * 0.022, '#8a3a4a')
    eye(s * 0.32, -s * 0.13, s * 0.028)
  } else {
    for (const lx of [-0.18, 0.16]) {
      roundRect(ctx, lx * s - s * 0.04, s * 0.08, s * 0.08, s * 0.2, s * 0.03)
      paint(ctx, '#4a3f52', ink)
    }
    ctx.beginPath()
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2
      ctx.moveTo(Math.cos(a) * s * 0.24 + s * 0.14, Math.sin(a) * s * 0.15 - s * 0.02)
      ctx.arc(Math.cos(a) * s * 0.24, Math.sin(a) * s * 0.15 - s * 0.02, s * 0.14, 0, Math.PI * 2)
    }
    paint(ctx, '#f8f5ee', ink)
    ellipse(ctx, 0, -s * 0.02, s * 0.27, s * 0.18, '#ffffff')
    ellipse(ctx, s * 0.33, -s * 0.1, s * 0.12, s * 0.14, '#4a3f52', 0, ink)
    ellipse(ctx, s * 0.3, -s * 0.21, s * 0.09, s * 0.06, '#f8f5ee', 0, ink * 0.7)
    leaf(ctx, s * 0.26, -s * 0.12, s * 0.1, -2, '#4a3f52', ink * 0.6)
    ellipse(ctx, s * 0.37, -s * 0.12, s * 0.025, s * 0.03, '#fff')
  }
  ctx.restore()
}

/** A tree: a round canopy in three greens (some are in blossom), swaying in the wind. */
export function drawTree(ctx: Ctx, x: number, y: number, s: number, t: number) {
  const ink = Math.max(1.5, s * 0.025)
  const blossom = Math.abs(Math.sin(x * 7.3 + y * 3.1)) > 0.78
  shadow(ctx, x, y + s * 0.42, s * 0.44, s * 0.12, 1.2)
  roundRect(ctx, x - s * 0.06, y + s * 0.02, s * 0.12, s * 0.42, s * 0.05)
  paint(ctx, C.woodDark, ink)
  const sway = wind(x, t) * s * 0.03
  const [dark, mid, light] = blossom ? ['#e98aa6', '#f7a8be', '#ffd0dc'] : ['#4f9e43', '#64b851', '#86cf63']
  ctx.beginPath()
  ctx.arc(x + sway, y - s * 0.14, s * 0.4, 0, Math.PI * 2)
  ctx.arc(x - s * 0.26 + sway * 0.8, y - s * 0.02, s * 0.24, 0, Math.PI * 2)
  ctx.arc(x + s * 0.27 + sway * 0.8, y - s * 0.04, s * 0.22, 0, Math.PI * 2)
  paint(ctx, dark, ink)
  ellipse(ctx, x - s * 0.04 + sway, y - s * 0.18, s * 0.33, s * 0.28, mid)
  ellipse(ctx, x - s * 0.1 + sway * 1.2, y - s * 0.28, s * 0.18, s * 0.13, light)
  if (blossom) for (let i = 0; i < 5; i++) ellipse(ctx, x + Math.cos(i * 2.4) * s * 0.24 + sway, y - s * 0.16 + Math.sin(i * 1.9) * s * 0.18, s * 0.035, s * 0.035, '#fff')
  else for (let i = 0; i < 3; i++) ellipse(ctx, x + Math.cos(i * 2.1 + 1) * s * 0.22 + sway, y - s * 0.1 + Math.sin(i * 1.7) * s * 0.16, s * 0.04, s * 0.04, '#ff7a6b', 0, ink * 0.5)
}

/** The pond: turquoise water, lily pads, a duck going around and a fish jumping now and then. */
export function drawPond(ctx: Ctx, x: number, y: number, w: number, h: number, t: number) {
  const cx = x + w / 2
  const cy = y + h / 2
  ellipse(ctx, cx, cy + 4, w / 2 + 8, h / 2 + 8, '#e4cf9c', 0, 2)
  ellipse(ctx, cx, cy, w / 2, h / 2, C.waterDeep, 0, 2)
  ellipse(ctx, cx - 4, cy - 4, w / 2 - 8, h / 2 - 10, C.water)
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 2
  for (let i = 0; i < 3; i++) {
    const k = (t * 0.3 + i / 3) % 1
    ctx.globalAlpha = 1 - k
    ctx.beginPath()
    ctx.ellipse(x + w * (0.3 + i * 0.2), y + h * (0.4 + (i % 2) * 0.2), 6 + k * 18, 3 + k * 8, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  for (const [px, py, r] of [
    [0.25, 0.3, 9],
    [0.7, 0.7, 11],
    [0.32, 0.72, 7],
  ]) {
    ctx.beginPath()
    ctx.moveTo(x + w * px, y + h * py)
    ctx.arc(x + w * px, y + h * py, r, 0.4, Math.PI * 2 - 0.1)
    ctx.closePath()
    paint(ctx, '#6cc25a', 1.5)
  }
  ellipse(ctx, x + w * 0.7 + 3, y + h * 0.7 - 3, 3, 3, C.rose)
  // A fish jumps every few seconds.
  const jump = (t * 0.25) % 1
  if (jump < 0.12) {
    const k = jump / 0.12
    const fx = x + w * (0.45 + k * 0.2)
    const fy = y + h * 0.5 - Math.sin(k * Math.PI) * 26
    ctx.save()
    ctx.translate(fx, fy)
    ctx.rotate(-1 + k * 2)
    ellipse(ctx, 0, 0, 7, 4, '#ff9f5a', 0, 1.2)
    ctx.beginPath()
    ctx.moveTo(-6, 0)
    ctx.lineTo(-11, -4)
    ctx.lineTo(-11, 4)
    ctx.closePath()
    paint(ctx, '#ff9f5a', 1.2)
    ctx.restore()
  } else if (jump < 0.2) {
    const k = (jump - 0.12) / 0.08
    ctx.strokeStyle = `rgba(255,255,255,${1 - k})`
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(x + w * 0.65, y + h * 0.5, 4 + k * 14, 2 + k * 6, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  const a = t * 0.3
  const dx = cx + Math.cos(a) * w * 0.26
  const dy = cy + Math.sin(a) * h * 0.22
  ctx.save()
  ctx.translate(dx, dy + Math.sin(t * 3) * 1)
  ctx.scale(Math.sin(a) > 0 ? -1 : 1, 1)
  ellipse(ctx, 0, 0, 11, 7, '#fffaf0', 0, 1.5)
  ellipse(ctx, 8, -7, 5, 5, '#fffaf0', 0, 1.5)
  ctx.beginPath()
  ctx.moveTo(12, -7)
  ctx.lineTo(17, -6)
  ctx.lineTo(12, -4)
  ctx.closePath()
  paint(ctx, '#ffb300', 1)
  ellipse(ctx, 9, -8, 1, 1, C.ink)
  ctx.restore()
}

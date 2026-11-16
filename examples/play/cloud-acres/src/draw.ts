// Drawing of Cloud Acres: everything is drawn with the canvas API (no image to download).

import type { CropId } from './data'

export type VillagerId = 'bunny' | 'hedgehog' | 'frog' | 'fox' | 'bear'

/** The villagers who send orders (original characters). */
export const VILLAGERS: { id: VillagerId; body: string; accent: string }[] = [
  { id: 'bunny', body: '#f4ece4', accent: '#ffb3c1' },
  { id: 'hedgehog', body: '#a47551', accent: '#f1d7b6' },
  { id: 'frog', body: '#7bc96f', accent: '#e8f7c8' },
  { id: 'fox', body: '#f08a3c', accent: '#fff4e6' },
  { id: 'bear', body: '#8d6346', accent: '#d9b48f' },
]

type Ctx = CanvasRenderingContext2D

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

export function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, color: string, rotation = 0) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.ellipse(x, y, Math.max(rx, 0.1), Math.max(ry, 0.1), rotation, 0, Math.PI * 2)
  ctx.fill()
}

export function leaf(ctx: Ctx, x: number, y: number, length: number, angle: number, color: string) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(length * 0.45, -length * 0.35, 0, -length)
  ctx.quadraticCurveTo(-length * 0.45, -length * 0.35, 0, 0)
  ctx.fill()
  ctx.restore()
}

const GOLD = '#ffd54a'

/** A harvested crop (for orders, the seed bar and flying items). `s` is about its height. */
export function drawProduce(ctx: Ctx, id: CropId, x: number, y: number, s: number, golden = false, gray = false) {
  ctx.save()
  const tint = (color: string) => (gray ? '#9b8f80' : golden ? GOLD : color)
  const green = gray ? '#8a7f62' : golden ? '#f6c945' : '#4caf50'
  const darkGreen = gray ? '#6e6450' : golden ? '#e0a92e' : '#2e7d32'
  switch (id) {
    case 'carrot': {
      leaf(ctx, x - s * 0.08, y - s * 0.28, s * 0.36, -0.4, green)
      leaf(ctx, x + s * 0.08, y - s * 0.28, s * 0.36, 0.4, green)
      leaf(ctx, x, y - s * 0.28, s * 0.42, 0, darkGreen)
      ctx.fillStyle = tint('#ff8a2b')
      ctx.beginPath()
      ctx.moveTo(x - s * 0.2, y - s * 0.3)
      ctx.quadraticCurveTo(x, y - s * 0.36, x + s * 0.2, y - s * 0.3)
      ctx.quadraticCurveTo(x + s * 0.06, y + s * 0.2, x, y + s * 0.42)
      ctx.quadraticCurveTo(x - s * 0.06, y + s * 0.2, x - s * 0.2, y - s * 0.3)
      ctx.fill()
      ctx.strokeStyle = 'rgba(120, 50, 0, 0.35)'
      ctx.lineWidth = Math.max(1, s * 0.03)
      for (const k of [-0.1, 0.06, 0.2]) {
        ctx.beginPath()
        ctx.moveTo(x - s * 0.1, y + s * k)
        ctx.lineTo(x + s * 0.03, y + s * (k + 0.02))
        ctx.stroke()
      }
      break
    }
    case 'wheat': {
      ctx.strokeStyle = tint('#d4a937')
      ctx.lineWidth = Math.max(1.2, s * 0.05)
      for (const dx of [-0.16, 0, 0.16]) {
        const top = y - s * 0.45 + Math.abs(dx) * s * 0.4
        ctx.beginPath()
        ctx.moveTo(x + dx * s * 0.4, y + s * 0.42)
        ctx.quadraticCurveTo(x + dx * s, y, x + dx * s * 1.3, top + s * 0.25)
        ctx.stroke()
        for (let i = 0; i < 4; i++) {
          const gy = top + i * s * 0.09
          ellipse(ctx, x + dx * s * 1.3 - s * 0.05, gy, s * 0.045, s * 0.08, tint('#f2c14e'), -0.5)
          ellipse(ctx, x + dx * s * 1.3 + s * 0.05, gy, s * 0.045, s * 0.08, tint('#f2c14e'), 0.5)
        }
      }
      break
    }
    case 'tomato': {
      ellipse(ctx, x, y + s * 0.05, s * 0.36, s * 0.32, tint('#ff4d4d'))
      ellipse(ctx, x - s * 0.13, y - s * 0.06, s * 0.08, s * 0.06, 'rgba(255,255,255,0.55)', -0.5)
      ctx.fillStyle = green
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2
        leaf(ctx, x, y - s * 0.22, s * 0.16, a, green)
      }
      ellipse(ctx, x, y - s * 0.24, s * 0.04, s * 0.06, darkGreen)
      break
    }
    case 'corn': {
      leaf(ctx, x - s * 0.04, y + s * 0.42, s * 0.75, -0.32, green)
      leaf(ctx, x + s * 0.04, y + s * 0.42, s * 0.75, 0.32, darkGreen)
      ellipse(ctx, x, y - s * 0.02, s * 0.17, s * 0.38, tint('#ffd93d'))
      ctx.fillStyle = gray ? 'rgba(80,70,50,0.25)' : 'rgba(200, 140, 0, 0.35)'
      for (let row = -3; row <= 3; row++) {
        for (const col of [-1, 0, 1]) {
          ctx.beginPath()
          ctx.arc(x + col * s * 0.07, y + row * s * 0.09, s * 0.022, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      break
    }
    case 'pumpkin': {
      const c = tint('#ff9f1c')
      const shade = gray ? '#7d7366' : golden ? '#e8b730' : '#e07b00'
      ellipse(ctx, x - s * 0.2, y + s * 0.08, s * 0.24, s * 0.3, shade)
      ellipse(ctx, x + s * 0.2, y + s * 0.08, s * 0.24, s * 0.3, shade)
      ellipse(ctx, x, y + s * 0.08, s * 0.26, s * 0.32, c)
      ellipse(ctx, x - s * 0.08, y - s * 0.04, s * 0.06, s * 0.1, 'rgba(255,255,255,0.35)', 0.3)
      ctx.fillStyle = gray ? '#5d5141' : '#6d4c2f'
      roundRect(ctx, x - s * 0.04, y - s * 0.34, s * 0.08, s * 0.16, s * 0.03)
      ctx.fill()
      leaf(ctx, x + s * 0.04, y - s * 0.26, s * 0.22, 1.1, green)
      break
    }
  }
  if (golden && !gray) {
    // Sparkles.
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
 * `s` its size.
 */
export function drawPlant(ctx: Ctx, id: CropId, x: number, y: number, s: number, growth: number, ripe: boolean, wilted: boolean, golden: boolean, t: number) {
  const sway = Math.sin(t * 2.2 + x * 0.05) * 0.06
  if (wilted) {
    leaf(ctx, x - s * 0.05, y + s * 0.18, s * 0.28, -1.2, '#8b7a55')
    leaf(ctx, x + s * 0.05, y + s * 0.18, s * 0.28, 1.25, '#7a6a48')
    drawProduce(ctx, id, x, y + s * 0.06, s * 0.42, false, true)
    return
  }
  if (growth < 0.12) {
    // Seed in the ground.
    ellipse(ctx, x, y + s * 0.14, s * 0.06, s * 0.035, '#5a3a22')
    return
  }
  if (!ripe) {
    const g = Math.min(1, (growth - 0.12) / 0.88)
    const length = s * (0.12 + 0.28 * g)
    const color = growth > 0.6 ? '#43a047' : '#66bb6a'
    leaf(ctx, x, y + s * 0.2, length, -0.55 + sway, color)
    leaf(ctx, x, y + s * 0.2, length, 0.55 + sway, color)
    if (g > 0.45) leaf(ctx, x, y + s * 0.2, length * 1.15, sway, '#2e7d32')
    if (g > 0.7) {
      // The crop starts to show.
      ctx.globalAlpha = (g - 0.7) / 0.3
      drawProduce(ctx, id, x, y - s * 0.02, s * 0.3 * g, golden)
      ctx.globalAlpha = 1
    }
    return
  }
  const bob = Math.sin(t * 5 + x) * s * 0.02
  leaf(ctx, x, y + s * 0.22, s * 0.36, -0.8 + sway, '#43a047')
  leaf(ctx, x, y + s * 0.22, s * 0.36, 0.8 + sway, '#388e3c')
  drawProduce(ctx, id, x, y - s * 0.02 + bob, s * 0.5, golden)
}

/** A villager's face, for order cards. */
export function drawVillager(ctx: Ctx, id: VillagerId, x: number, y: number, s: number, mood: 'happy' | 'neutral' | 'sad', t: number) {
  const v = VILLAGERS.find((item) => item.id === id) ?? VILLAGERS[0]
  const blink = Math.sin(t * 1.3 + x) > 0.985
  ctx.save()
  // Ears / spikes.
  if (id === 'bunny') {
    ellipse(ctx, x - s * 0.18, y - s * 0.42, s * 0.1, s * 0.28, v.body, -0.15)
    ellipse(ctx, x + s * 0.18, y - s * 0.42, s * 0.1, s * 0.28, v.body, 0.15)
    ellipse(ctx, x - s * 0.18, y - s * 0.42, s * 0.05, s * 0.2, v.accent, -0.15)
    ellipse(ctx, x + s * 0.18, y - s * 0.42, s * 0.05, s * 0.2, v.accent, 0.15)
  } else if (id === 'hedgehog') {
    ctx.fillStyle = '#6b4a32'
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (i / 8) * Math.PI
      ctx.beginPath()
      ctx.moveTo(x + Math.cos(a) * s * 0.3, y + Math.sin(a) * s * 0.3)
      ctx.lineTo(x + Math.cos(a) * s * 0.52, y + Math.sin(a) * s * 0.52)
      ctx.lineTo(x + Math.cos(a + 0.25) * s * 0.3, y + Math.sin(a + 0.25) * s * 0.3)
      ctx.fill()
    }
  } else if (id === 'fox') {
    for (const side of [-1, 1]) {
      ctx.fillStyle = v.body
      ctx.beginPath()
      ctx.moveTo(x + side * s * 0.12, y - s * 0.28)
      ctx.lineTo(x + side * s * 0.34, y - s * 0.5)
      ctx.lineTo(x + side * s * 0.36, y - s * 0.14)
      ctx.fill()
    }
  } else if (id === 'bear') {
    ellipse(ctx, x - s * 0.26, y - s * 0.26, s * 0.12, s * 0.12, v.body)
    ellipse(ctx, x + s * 0.26, y - s * 0.26, s * 0.12, s * 0.12, v.body)
    ellipse(ctx, x - s * 0.26, y - s * 0.26, s * 0.06, s * 0.06, v.accent)
    ellipse(ctx, x + s * 0.26, y - s * 0.26, s * 0.06, s * 0.06, v.accent)
  }
  // Head.
  if (id === 'frog') {
    ellipse(ctx, x - s * 0.17, y - s * 0.24, s * 0.13, s * 0.13, v.body)
    ellipse(ctx, x + s * 0.17, y - s * 0.24, s * 0.13, s * 0.13, v.body)
  }
  ellipse(ctx, x, y, s * 0.36, s * 0.32, v.body)
  ellipse(ctx, x, y + s * 0.1, s * 0.22, s * 0.15, v.accent)
  // Eyes.
  const eyeY = id === 'frog' ? y - s * 0.24 : y - s * 0.05
  for (const side of [-1, 1]) {
    if (id === 'frog') ellipse(ctx, x + side * s * 0.17, eyeY, s * 0.08, s * 0.08, '#fff')
    if (blink) {
      ctx.strokeStyle = '#2b2118'
      ctx.lineWidth = Math.max(1, s * 0.03)
      ctx.beginPath()
      ctx.moveTo(x + side * s * 0.17 - s * 0.04, eyeY)
      ctx.lineTo(x + side * s * 0.17 + s * 0.04, eyeY)
      ctx.stroke()
    } else {
      ellipse(ctx, x + side * s * 0.15, eyeY, s * 0.045, s * 0.055, '#2b2118')
      ellipse(ctx, x + side * s * 0.15 + s * 0.015, eyeY - s * 0.02, s * 0.015, s * 0.015, '#fff')
    }
  }
  // Cheeks and nose.
  ellipse(ctx, x - s * 0.24, y + s * 0.06, s * 0.05, s * 0.03, 'rgba(255, 120, 140, 0.45)')
  ellipse(ctx, x + s * 0.24, y + s * 0.06, s * 0.05, s * 0.03, 'rgba(255, 120, 140, 0.45)')
  if (id !== 'frog') ellipse(ctx, x, y + s * 0.04, s * 0.045, s * 0.032, '#3a2a20')
  // Mouth.
  ctx.strokeStyle = '#3a2a20'
  ctx.lineWidth = Math.max(1, s * 0.03)
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

export function drawCoin(ctx: Ctx, x: number, y: number, r: number) {
  ellipse(ctx, x, y + r * 0.12, r, r, '#c98a0b')
  ellipse(ctx, x, y, r, r, '#ffc93c')
  ellipse(ctx, x, y, r * 0.68, r * 0.68, '#ffdf6e')
  ctx.fillStyle = '#c98a0b'
  ctx.font = `900 ${Math.round(r * 1.1)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('¢', x, y + r * 0.05)
}

export function drawCloud(ctx: Ctx, x: number, y: number, s: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, s * 0.5, 0, Math.PI * 2)
  ctx.arc(x + s * 0.55, y + s * 0.1, s * 0.38, 0, Math.PI * 2)
  ctx.arc(x - s * 0.55, y + s * 0.12, s * 0.34, 0, Math.PI * 2)
  ctx.arc(x + s * 0.2, y - s * 0.25, s * 0.36, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillRect(x - s * 0.55, y + s * 0.05, s * 1.1, s * 0.4)
}

/** A tilled plot. `wet` darkens the soil (rain, sprinklers). */
export function drawPlot(ctx: Ctx, x: number, y: number, s: number, highlight: number, wet: boolean) {
  const r = s * 0.16
  ctx.fillStyle = 'rgba(40, 70, 20, 0.35)'
  roundRect(ctx, x - s / 2, y - s / 2 + 3, s, s, r)
  ctx.fill()
  ctx.fillStyle = wet ? '#6b4428' : '#8a5a36'
  roundRect(ctx, x - s / 2, y - s / 2, s, s, r)
  ctx.fill()
  ctx.strokeStyle = wet ? 'rgba(40, 20, 8, 0.35)' : 'rgba(80, 45, 20, 0.35)'
  ctx.lineWidth = Math.max(1, s * 0.03)
  for (const k of [-0.22, 0, 0.22]) {
    ctx.beginPath()
    ctx.moveTo(x - s * 0.36, y + k * s)
    ctx.quadraticCurveTo(x, y + k * s + s * 0.04, x + s * 0.36, y + k * s)
    ctx.stroke()
  }
  if (highlight > 0) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 * highlight})`
    ctx.lineWidth = 3
    roundRect(ctx, x - s / 2, y - s / 2, s, s, r)
    ctx.stroke()
  }
}

export { star4 }

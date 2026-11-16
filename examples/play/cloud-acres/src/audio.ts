// Sounds made with the Web Audio API: nothing to download.

const MAJOR = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26]

export class Sound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private rainNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null
  private enabled = true

  /** Browsers allow sound only after a tap: called on the first one. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      this.ctx = new Ctx()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.enabled ? 0.45 : 0
      this.master.connect(this.ctx.destination)
      const length = this.ctx.sampleRate
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
      const data = this.noise.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.45 : 0, this.ctx.currentTime, 0.02)
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend()
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume()
  }

  private tone(type: OscillatorType, from: number, to: number, duration: number, volume: number, delay = 0) {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(from, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + duration)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    osc.connect(gain).connect(this.master)
    osc.start(t)
    osc.stop(t + duration + 0.02)
  }

  private burst(duration: number, volume: number, type: BiquadFilterType, from: number, to: number) {
    if (!this.ctx || !this.master || !this.noise) return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const filter = this.ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.setValueAtTime(from, t)
    filter.frequency.exponentialRampToValueAtTime(to, t + duration)
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(volume, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    src.connect(filter).connect(gain).connect(this.master)
    src.start(t)
    src.stop(t + duration)
  }

  plant() {
    this.tone('sine', 240, 140, 0.09, 0.2)
    this.burst(0.06, 0.08, 'lowpass', 1200, 300)
  }

  /** A pluck that goes up the scale with each crop of a swipe. */
  harvest(chain: number) {
    const f = 392 * Math.pow(2, MAJOR[Math.min(chain, MAJOR.length - 1)] / 12)
    this.tone('triangle', f, f, 0.14, 0.2)
    this.tone('sine', f * 2, f * 2, 0.06, 0.05)
  }

  coin() {
    this.tone('square', 1318, 1318, 0.06, 0.05)
    this.tone('square', 1760, 1760, 0.12, 0.05, 0.06)
  }

  golden() {
    ;[0, 4, 7, 12, 16].forEach((s, i) => this.tone('triangle', 784 * Math.pow(2, s / 12), 784 * Math.pow(2, s / 12), 0.2, 0.12, i * 0.05))
  }

  order() {
    ;[0, 4, 7, 12].forEach((s, i) => this.tone('triangle', 523 * Math.pow(2, s / 12), 523 * Math.pow(2, s / 12), 0.22, 0.16, i * 0.08))
  }

  orderFailed() {
    this.tone('sine', 330, 220, 0.3, 0.12)
  }

  crow() {
    this.tone('sawtooth', 700, 420, 0.12, 0.08)
    this.tone('sawtooth', 650, 380, 0.14, 0.08, 0.16)
  }

  shoo() {
    this.burst(0.18, 0.18, 'highpass', 2000, 6000)
  }

  wilt() {
    this.tone('sine', 200, 120, 0.25, 0.08)
  }

  buy() {
    this.coin()
    this.tone('triangle', 659, 988, 0.25, 0.12, 0.1)
  }

  denied() {
    this.tone('square', 180, 160, 0.15, 0.06)
  }

  dayEnd() {
    ;[0, 7, 4, 12].forEach((s, i) => this.tone('sine', 440 * Math.pow(2, s / 12), 440 * Math.pow(2, s / 12), 0.35, 0.12, i * 0.14))
  }

  rain(on: boolean) {
    if (!this.ctx || !this.master || !this.noise) return
    if (on && !this.rainNode) {
      const src = this.ctx.createBufferSource()
      src.buffer = this.noise
      src.loop = true
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 3000
      filter.Q.value = 0.6
      const gain = this.ctx.createGain()
      gain.gain.setValueAtTime(0.0001, this.ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.06, this.ctx.currentTime + 0.8)
      src.connect(filter).connect(gain).connect(this.master)
      src.start()
      this.rainNode = { src, gain }
    } else if (!on && this.rainNode) {
      const { src, gain } = this.rainNode
      gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.3)
      src.stop(this.ctx.currentTime + 1.5)
      this.rainNode = null
    }
  }
}

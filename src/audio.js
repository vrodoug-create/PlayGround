// Tiny procedural soundscape — no external assets, unlocked from the start gesture.
export class AudioEngine {
  constructor() {
    this.ctx = null
    this.master = null
    this.oceanGain = null
    this.oceanFilter = null
    this.windGain = null
    this.windFilter = null
    this.muted = false
    this.noise = null
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
      return
    }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    try {
      const ctx = new AC()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 0.85
      this.master.connect(ctx.destination)

      const len = Math.floor(ctx.sampleRate * 4)
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      let last = 0
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1
        last = (last + 0.018 * white) / 1.018
        data[i] = last * 3.4
      }
      this.noise = buffer

      // Deep rolling ocean.
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.loop = true
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 420
      filter.Q.value = 0.7
      const gain = ctx.createGain()
      gain.gain.value = 0.0001
      src.connect(filter)
      filter.connect(gain)
      gain.connect(this.master)
      src.start()
      this.oceanGain = gain
      this.oceanFilter = filter
      gain.gain.setTargetAtTime(0.24, ctx.currentTime, 2.0)

      // Wind / spray hiss.
      const src2 = ctx.createBufferSource()
      src2.buffer = buffer
      src2.loop = true
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1150
      bp.Q.value = 0.45
      const wg = ctx.createGain()
      wg.gain.value = 0.0001
      src2.connect(bp)
      bp.connect(wg)
      wg.connect(this.master)
      src2.start()
      this.windGain = wg
      this.windFilter = bp
      wg.gain.setTargetAtTime(0.035, ctx.currentTime, 2.5)
    } catch {
      this.ctx = null
    }
  }

  setMotion(speed, flow) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const s = Math.min(1, Math.max(0, (speed - 10) / 24))
    this.oceanGain.gain.setTargetAtTime(0.18 + s * 0.2 + flow * 0.05, t, 0.25)
    this.oceanFilter.frequency.setTargetAtTime(330 + s * 480, t, 0.3)
    this.windGain.gain.setTargetAtTime(0.02 + s * 0.075, t, 0.4)
    this.windFilter.frequency.setTargetAtTime(850 + s * 900, t, 0.4)
  }

  setMuted(muted) {
    this.muted = muted
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.12)
  }

  chime(step = 0) {
    if (!this.ctx || this.muted) return
    const t = this.ctx.currentTime
    const base = 660 * Math.pow(2, (step % 5) / 12)
    for (const [mult, vol] of [[1, 0.09], [1.5, 0.04], [2, 0.02]]) {
      const osc = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(base * mult, t)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75)
      osc.connect(g)
      g.connect(this.master)
      osc.start(t)
      osc.stop(t + 0.8)
    }
  }

  whoosh(power = 1) {
    if (!this.ctx || this.muted) return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.8
    bp.frequency.setValueAtTime(360, t)
    bp.frequency.exponentialRampToValueAtTime(1500, t + 0.32)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.11 * power, t + 0.05)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
    src.connect(bp)
    bp.connect(g)
    g.connect(this.master)
    src.start(t)
    src.stop(t + 0.5)
  }

  splash(power = 1) {
    if (!this.ctx || this.muted) return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(1800, t)
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.5)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.16 * power, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)
    src.connect(lp)
    lp.connect(g)
    g.connect(this.master)
    src.start(t)
    src.stop(t + 0.6)

    const osc = this.ctx.createOscillator()
    const og = this.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(105, t)
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.25)
    og.gain.setValueAtTime(0.0001, t)
    og.gain.exponentialRampToValueAtTime(0.1 * power, t + 0.01)
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    osc.connect(og)
    og.connect(this.master)
    osc.start(t)
    osc.stop(t + 0.4)
  }

  dawnChord() {
    if (!this.ctx || this.muted) return
    const notes = [392, 494, 587, 784]
    notes.forEach((f, i) => {
      const t = this.ctx.currentTime + i * 0.16
      const osc = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      osc.type = i === 3 ? 'triangle' : 'sine'
      osc.frequency.value = f
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.06)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2)
      osc.connect(g)
      g.connect(this.master)
      osc.start(t)
      osc.stop(t + 2.3)
    })
  }
}

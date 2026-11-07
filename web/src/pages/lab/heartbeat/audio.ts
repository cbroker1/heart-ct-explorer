/**
 * Synthesised heart sounds (no samples): S1 "lub" when the AV valves shut just after the QRS,
 * S2 "dub" when the aortic/pulmonary valves shut at the end of ejection, plus a soft CT "whirr"
 * while the X-ray is on. Created lazily on a user gesture (browser autoplay rules).
 */
export class HeartAudio {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private noise: AudioBuffer | null = null

  /** must be called from a user gesture */
  async enable(): Promise<boolean> {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return false
        this.ctx = new AC()
        const comp = this.ctx.createDynamicsCompressor()
        comp.threshold.value = -18
        comp.ratio.value = 4
        this.out = this.ctx.createGain()
        this.out.gain.value = 0.9
        this.out.connect(comp).connect(this.ctx.destination)
        const len = Math.floor(this.ctx.sampleRate * 0.4)
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
        const d = this.noise.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      }
      if (this.ctx.state !== 'running') await this.ctx.resume()
      return this.ctx.state === 'running'
    } catch {
      return false
    }
  }

  async disable() {
    try { await this.ctx?.suspend() } catch { /* ignore */ }
  }

  dispose() {
    try { void this.ctx?.close() } catch { /* ignore */ }
    this.ctx = null
  }

  private thump(f0: number, f1: number, dur: number, gain: number, delay = 0) {
    const ctx = this.ctx, out = this.out
    if (!ctx || !out || ctx.state !== 'running') return
    const t0 = ctx.currentTime + Math.max(0, delay)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(f0, t0)
    osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(out)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
    // a little low-passed noise gives it a "valve" texture
    if (this.noise) {
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 180
      const ng = ctx.createGain()
      ng.gain.setValueAtTime(0.0001, t0)
      ng.gain.exponentialRampToValueAtTime(gain * 0.55, t0 + 0.008)
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.7)
      src.connect(lp).connect(ng).connect(out)
      src.start(t0)
      src.stop(t0 + dur)
    }
  }

  lub(delay = 0) { this.thump(72, 38, 0.15, 0.9, delay) }
  dub(delay = 0) { this.thump(96, 52, 0.1, 0.6, delay) }

  /** soft electrical whirr for the X-ray exposure; `wallDur` in real seconds */
  xray(wallDur: number) {
    const ctx = this.ctx, out = this.out
    if (!ctx || !out || ctx.state !== 'running') return
    const t0 = ctx.currentTime
    const dur = Math.min(3, Math.max(0.12, wallDur))
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.03)
    g.gain.setValueAtTime(0.05, t0 + dur - 0.05)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 900
    bp.Q.value = 0.8
    for (const f of [118, 236, 472]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = f
      o.connect(bp)
      o.start(t0)
      o.stop(t0 + dur + 0.02)
    }
    bp.connect(g).connect(out)
  }
}

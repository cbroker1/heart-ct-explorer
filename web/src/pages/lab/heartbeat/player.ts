/**
 * The single playback clock. Everything (oscilloscope, timeline, HUD, 3D heart, sounds) reads
 * `player.t` (recording time, seconds) once per animation frame.
 *
 * Looping restarts at `model.loopStart` (just before the first beat) so the splice from the end of
 * the recording back to the start keeps a natural-looking R-R gap.
 */
import { clamp, type Cardio } from './ecg'

export type FrameFn = (t: number) => void

/** A visible piece of the recording inside a scrolling window (offsets relative to now). */
export interface Piece { o0: number; o1: number; r0: number }

export class Player {
  t = 0
  /** monotonic "virtual" time: grows with playback, never wraps (anchors the scrolling grid) */
  vt = 0
  playing = false
  speed = 1
  loop = true
  slowmo = true
  /** true once playback has wrapped at least once (the past before loopStart is then the tail) */
  looped = false
  private last = -1

  constructor(public readonly model: Cardio) {}

  get duration() { return this.model.duration }
  get loopStart() { return this.model.loopStart }
  /** effective speed right now (includes the slow-motion around X-ray shots) */
  rate(): number { return this.speed * (this.slowmo ? this.model.slowFactor(this.t) : 1) }

  /** Advance the clock. Returns the previous and new time and whether it wrapped. */
  tick(nowMs: number): { prev: number; t: number; wrapped: boolean } {
    const prev = this.t
    if (!this.playing) { this.last = nowMs; return { prev, t: prev, wrapped: false } }
    const dt = this.last < 0 ? 0 : clamp((nowMs - this.last) / 1000, 0, 0.1)
    this.last = nowMs
    const step = dt * this.rate()
    let t = this.t + step
    let wrapped = false
    if (t >= this.duration) {
      if (this.loop) { t = this.loopStart + (t - this.duration); wrapped = true; this.looped = true }
      else { t = this.duration; this.playing = false }
    }
    this.vt += step
    this.t = t
    return { prev, t, wrapped }
  }

  /** forget the last frame time (after a pause in rendering) so the clock doesn't jump */
  resetClock() { this.last = -1 }

  seek(t: number) {
    const nt = clamp(t, 0, this.duration)
    this.vt += nt - this.t
    this.t = nt
    this.looped = false
    this.last = -1
  }

  /**
   * Split the window [now+o0, now+o1] (seconds relative to the playhead) into pieces of the
   * recording: the current pass, the previous loop's tail and the next loop's start.
   */
  pieces(o0: number, o1: number): Piece[] {
    const D = this.duration, L = this.loopStart, t = this.t
    const out: Piece[] = []
    const add = (oStart: number, r0: number, len: number) => {
      const a = Math.max(o0, oStart), b = Math.min(o1, oStart + len)
      if (b > a) out.push({ o0: a, o1: b, r0: r0 + (a - oStart) })
    }
    const cur0 = this.looped ? L : 0
    add(cur0 - t, cur0, D - cur0)
    if (this.looped) add(L - t - (D - L), L, D - L)
    if (this.loop) add(D - t, L, D - L)
    return out
  }

  /** Recording times in (prev, t] crossed this frame, as one or two half-open ranges. */
  crossed(prev: number, t: number, wrapped: boolean): [number, number][] {
    if (wrapped) return [[prev, this.duration], [this.loopStart, t]]
    return t > prev ? [[prev, t]] : []
  }
}

/**
 * Floating labels: plain DOM pills positioned every frame from the 3D anchors (no extra React roots,
 * so mounting/unmounting is cheap and warning-free).
 *
 * Each labelled structure has a spread of candidate anchor points on its surface (meshes.ts). A few
 * times a second the projector ray-tests them against the opaque structures in front, and the pill
 * sits on the visible candidate nearest the middle of the visible part. So "Right atrium" never
 * floats over the right ventricle, and a structure hidden behind others gets no label at all.
 * Labels also hide when clipped away, off screen, or overlapping a higher-priority label.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { MeshNode } from '../../lib/data'
import { clipCtx } from './Clip'
import { currentBox, type Structure } from './meshes'
import { LABELLED, SHORT_NAME } from './meta'
import { useAnat } from './state'

const els = new Map<string, HTMLDivElement>()

/** DOM side: one pill per labelled structure, hidden until the projector shows it. */
export function LabelLayer({ nodes }: { nodes: Map<string, MeshNode> }) {
  const list = LABELLED.map((n) => nodes.get(n)).filter(Boolean) as MeshNode[]
  return (
    <div className="ana-labels" aria-hidden>
      {list.map((n) => (
        <div
          key={n.name}
          className="ana-lbl"
          ref={(el) => {
            if (el) {
              els.set(n.name, el)
              el.dataset.w = String(el.offsetWidth)
            } else els.delete(n.name)
          }}
        >
          <i style={{ background: n.color }} />
          {SHORT_NAME[n.name] ?? n.display}
        </div>
      ))}
    </div>
  )
}

/** Structures that wrap a labelled one and should not hide its label (the LV muscle is the LV). */
const SEE_THROUGH: Record<string, string[]> = { heart_ventricle_left: ['heart_myocardium'] }

interface LabelState {
  /** Blend from → to (local to the centroid) while the label moves to a better candidate. */
  from: THREE.Vector3
  to: THREE.Vector3
  idx: number
  t: number
  /** Enough candidates are visible to label the structure. */
  seen: boolean
  /** Visible candidates, most central first (fallback spots when the best one collides with another pill). */
  alts: number[]
  /** The current spot was taken to dodge another pill: keep it while it stays visible (no flicker). */
  dodged: boolean
}
interface Occluder { s: Structure; box: THREE.Box3 }

const ease = (t: number) => t * t * (3 - 2 * t)
/** Visible anchor candidates (of ~18) needed before a structure gets a label (1 = a glimpse through a gap). */
const MIN_VISIBLE = 2

/** Canvas side: picks visible anchors, projects them and writes transforms directly to the pills. */
export function LabelProjector({ structures }: { structures: Structure[] }) {
  const byName = useMemo(() => new Map(structures.map((s) => [s.name, s])), [structures])
  const k = useMemo(() => ({
    v: new THREE.Vector3(), w: new THREE.Vector3(), dir: new THREE.Vector3(), hitP: new THREE.Vector3(),
    ray: new THREE.Raycaster(), hits: [] as THREE.Intersection[], states: new Map<string, LabelState>(),
    rr: 0, wasOn: false, occ: [] as Occluder[], boxes: [] as THREE.Box3[],
  }), [])

  /** Is the straight line from the camera to `w` blocked by an opaque structure? */
  const blocked = (cam: THREE.Vector3, w: THREE.Vector3, skip: string[] | undefined) => {
    const dist = k.dir.copy(w).sub(cam).length()
    if (dist < 1e-3) return false
    k.ray.ray.set(cam, k.dir.divideScalar(dist))
    k.ray.near = 0
    k.ray.far = dist - 1.2
    for (const o of k.occ) {
      if (skip?.includes(o.s.name)) continue
      // Cheap box test first; only boxes entered before the point can hide it.
      if (!k.ray.ray.intersectBox(o.box, k.hitP) || k.hitP.distanceTo(cam) > k.ray.far) continue
      k.hits.length = 0
      o.s.mesh.raycast(k.ray, k.hits)
      if (k.hits.length) return true
    }
    return false
  }

  /** Re-choose the anchor of one structure for the current camera. */
  const refresh = (s: Structure, camera: THREE.Camera, w2: number, h2: number) => {
    let ls = k.states.get(s.name)
    if (!ls) {
      ls = { from: s.anchor.clone(), to: s.anchor.clone(), idx: 0, t: 1, seen: false, alts: [], dodged: false }
      k.states.set(s.name, ls)
    }
    const cam = camera.position
    const skip = SEE_THROUGH[s.name]
    const vis: { i: number; x: number; y: number }[] = []
    s.labelPts.forEach((c, i) => {
      const w = k.w.copy(c).add(s.centroid).add(s.offset)
      if (clipCtx.active && clipCtx.plane.distanceToPoint(w) < 0) return
      const p = k.v.copy(w).project(camera)
      if (p.z > 1 || Math.abs(p.x) > 0.94 || Math.abs(p.y) > 0.94) return
      const x = p.x * w2, y = p.y * h2
      if (k.occ.length && blocked(cam, w, skip)) return
      vis.push({ i, x, y })
    })
    // A single point seen through a gap is not worth a label: it would seem to point at whatever is in front.
    const el = els.get(s.name)
    if (el) el.dataset.vis = String(vis.length)
    if (vis.length < MIN_VISIBLE) { ls.seen = false; ls.alts = []; return }
    let mx = 0, my = 0
    for (const p of vis) { mx += p.x; my += p.y }
    mx /= vis.length
    my /= vis.length
    const ranked = vis.map((p) => ({ i: p.i, d: (p.x - mx) ** 2 + (p.y - my) ** 2 })).sort((a, b) => a.d - b.d)
    ls.alts = ranked.map((p) => p.i)
    const best = ranked[0], bd = best.d
    const curD = ranked.find((p) => p.i === ls.idx)?.d ?? Infinity
    // Stay put unless the current point is hidden or clearly off-centre (avoids jitter while orbiting).
    if (ls.seen && curD < Infinity && (ls.dodged || Math.sqrt(curD) < Math.sqrt(bd) + 28)) return
    if (!ls.seen) {
      ls.from.copy(s.labelPts[best.i])
      ls.t = 1
    } else {
      ls.from.lerp(ls.to, ease(ls.t))
      ls.t = 0
    }
    ls.to.copy(s.labelPts[best.i])
    ls.idx = best.i
    ls.seen = true
    ls.dodged = false
  }

  useFrame(({ camera, size }, dt) => {
    const st = useAnat.getState()
    const on = st.labels
    if (!on) {
      if (k.wasOn) for (const el of els.values()) el.style.opacity = '0'
      k.wasOn = false
      return
    }
    const w2 = size.width / 2, h2 = size.height / 2
    // Opaque structures hide what is behind them (in X-ray everything is see-through).
    k.occ.length = 0
    if (st.mode !== 'xray') {
      let b = 0
      for (const s of structures) {
        if (!s.mesh.visible || s.anim.opacity < 0.6) continue
        const box = k.boxes[b] ?? (k.boxes[b] = new THREE.Box3())
        b++
        k.occ.push({ s, box: currentBox(s, box) })
      }
    }
    // All labels when switched on, then a couple per frame (round robin).
    const names = LABELLED.filter((n) => byName.has(n))
    const todo = k.wasOn ? 2 : names.length
    for (let j = 0; j < todo && names.length; j++) {
      const s = byName.get(names[k.rr++ % names.length])!
      if (s.mesh.visible && s.anim.fade > 0.6) refresh(s, camera, w2, h2)
    }
    k.wasOn = true

    const placed: [number, number, number, number][] = []
    for (const name of LABELLED) {
      const el = els.get(name)
      if (!el) continue
      const s = byName.get(name)
      const ls = k.states.get(name)
      let show = !!s && !!ls && ls.seen && s.mesh.visible && s.anim.fade > 0.6
      let x = 0, y = 0
      if (show && s && ls) {
        ls.t = Math.min(1, ls.t + dt / 0.35)
        const v = k.v.copy(ls.from).lerp(ls.to, ease(ls.t)).add(s.centroid).add(s.offset)
        if (clipCtx.active && clipCtx.plane.distanceToPoint(v) < 0) show = false
        else {
          v.project(camera)
          if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) show = false
          x = (v.x + 1) * w2
          y = (1 - v.y) * h2
        }
      }
      if (show && s && ls) {
        const w = Number(el.dataset.w) || el.offsetWidth || 90
        const boxAt = (bx: number, by: number): [number, number, number, number] => [bx - w / 2 - 3, bx + w / 2 + 3, by - 46, by - 18]
        const collides = (b: [number, number, number, number]) => placed.some((p) => b[0] < p[1] && b[1] > p[0] && b[2] < p[3] && b[3] > p[2])
        let box = boxAt(x, y)
        if (collides(box)) {
          // A higher-priority pill is there: try the structure's other visible points, most central first.
          show = false
          for (const i of ls.alts) {
            if (i === ls.idx) continue
            const v = k.v.copy(s.labelPts[i]).add(s.centroid).add(s.offset)
            if (clipCtx.active && clipCtx.plane.distanceToPoint(v) < 0) continue
            v.project(camera)
            if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue
            const ax = (v.x + 1) * w2, ay = (1 - v.y) * h2
            const b = boxAt(ax, ay)
            if (collides(b)) continue
            x = ax
            y = ay
            box = b
            ls.idx = i
            ls.from.copy(s.labelPts[i])
            ls.to.copy(s.labelPts[i])
            ls.t = 1
            ls.dodged = true
            show = true
            break
          }
        }
        if (show) placed.push(box)
      }
      if (show) el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      const o = show ? '1' : '0'
      if (el.style.opacity !== o) el.style.opacity = o
    }
  })
  return null
}

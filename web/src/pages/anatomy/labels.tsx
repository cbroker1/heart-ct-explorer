/**
 * Floating labels: plain DOM pills positioned every frame from the 3D anchors (no extra React roots,
 * so mounting/unmounting is cheap and warning-free). Labels hide when their anchor is clipped away,
 * behind the camera, or would overlap a higher-priority label.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { MeshNode } from '../../lib/data'
import { clipCtx } from './Clip'
import type { Structure } from './meshes'
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

/** Canvas side: projects anchors and writes transforms directly to the pills. */
export function LabelProjector({ structures }: { structures: Structure[] }) {
  const byName = useMemo(() => new Map(structures.map((s) => [s.name, s])), [structures])
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    const on = useAnat.getState().labels
    const placed: [number, number, number, number][] = []
    for (const name of LABELLED) {
      const el = els.get(name)
      if (!el) continue
      const s = byName.get(name)
      let show = on && !!s && s.mesh.visible && s.anim.fade > 0.6
      let x = 0, y = 0
      if (show && s) {
        v.copy(s.anchor).add(s.centroid).add(s.offset)
        if (clipCtx.active && clipCtx.plane.distanceToPoint(v) < 0) show = false
        else {
          v.project(camera)
          if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) show = false
          x = ((v.x + 1) / 2) * size.width
          y = ((1 - v.y) / 2) * size.height
        }
      }
      if (show) {
        const w = Number(el.dataset.w) || el.offsetWidth || 90
        const box: [number, number, number, number] = [x - w / 2 - 3, x + w / 2 + 3, y - 46, y - 18]
        if (placed.some((p) => box[0] < p[1] && box[1] > p[0] && box[2] < p[3] && box[3] > p[2])) show = false
        else placed.push(box)
      }
      if (show) el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      const o = show ? '1' : '0'
      if (el.style.opacity !== o) el.style.opacity = o
    }
  })
  return null
}

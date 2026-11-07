/** Calcium-candidate markers: small glowing spheres at calcium.json centerLPS, coloured by final class. */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Vec3 } from '../../lib/data'
import type { CalciumReport } from '../../lib/reports'
import { lpsToWorld } from '../../lib/coords'
import { CAND_COLORS } from './meta'
import type { Structure } from './meshes'
import { useAnat } from './state'

const noRaycast = () => {}
const sphere = new THREE.Sphere()
const tmp = new THREE.Vector3()

/** Generous pick sphere so the tiny markers are easy to hover; only active while the layer is on. */
function candRaycast(this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
  if (!useAnat.getState().calcium) return
  this.getWorldPosition(sphere.center)
  sphere.radius = Math.max(3.2, this.scale.x * 2.4)
  const p = raycaster.ray.intersectSphere(sphere, tmp)
  if (!p) return
  intersects.push({ distance: raycaster.ray.origin.distanceTo(p), point: p.clone(), object: this } as THREE.Intersection)
}

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.18, 'rgba(255,255,255,0.75)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.18)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function CalciumLayer({ report, structures, center }: { report: CalciumReport; structures: Structure[]; center: Vec3 }) {
  const show = useAnat((s) => s.calcium)
  const tex = useMemo(() => glowTexture(), [])
  const geo = useMemo(() => new THREE.SphereGeometry(1, 20, 14), [])
  useEffect(() => () => { tex.dispose(); geo.dispose() }, [tex, geo])
  const items = useMemo(
    () => report.candidates.map((c) => {
      const w = lpsToWorld(c.centerLPS, center)
      const r = Math.max(1.15, Math.cbrt((3 * c.volume_mm3) / (4 * Math.PI)) * 1.3)
      return {
        c, r, base: new THREE.Vector3(...w), color: CAND_COLORS[c.finalClass] ?? CAND_COLORS.other,
        host: structures.find((s) => s.name === c.chamber) ?? null,
      }
    }),
    [report, center, structures],
  )
  const groups = useRef<(THREE.Group | null)[]>([])
  const halos = useRef<(THREE.Sprite | null)[]>([])
  useFrame((state) => {
    if (!show) return
    const t = state.clock.elapsedTime
    const st = useAnat.getState()
    items.forEach((it, k) => {
      const g = groups.current[k]
      if (!g) return
      g.position.copy(it.base)
      if (it.host) g.position.add(it.host.offset)
      const h = halos.current[k]
      if (h) {
        const hot = (st.hover?.kind === 'candidate' && st.hover.id === it.c.id) || (st.selection?.kind === 'candidate' && st.selection.id === it.c.id)
        const s = it.r * (hot ? 11 : 6.5) * (1 + 0.12 * Math.sin(t * 2.4 + k))
        h.scale.set(s, s, s)
      }
    })
  })
  return (
    <group visible={show}>
      {items.map((it, k) => (
        <group key={it.c.id} ref={(g) => { groups.current[k] = g }} position={it.base}>
          <mesh geometry={geo} scale={it.r} raycast={candRaycast} userData={{ candidate: it.c.id }} renderOrder={58}>
            <meshBasicMaterial color={it.color} toneMapped={false} />
          </mesh>
          {/* see-through pass so markers inside the heart stay visible */}
          <mesh geometry={geo} scale={it.r} raycast={noRaycast} renderOrder={59}>
            <meshBasicMaterial color={it.color} transparent opacity={0.5} depthTest={false} depthWrite={false} toneMapped={false} />
          </mesh>
          <sprite ref={(s) => { halos.current[k] = s }} scale={it.r * 6.5} raycast={noRaycast} renderOrder={61}>
            <spriteMaterial map={tex} color={it.color} transparent opacity={0.8} depthTest={false} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </sprite>
        </group>
      ))}
    </group>
  )
}

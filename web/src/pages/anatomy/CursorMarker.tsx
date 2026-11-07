/** "You are here": the shared slice-explorer cursor (store.cursor, LPS) as a small crosshair in 3D. */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Vec3 } from '../../lib/data'
import { lpsToWorld } from '../../lib/coords'
import { useApp } from '../../lib/store'

const noRaycast = () => {}

export function CursorMarker({ center }: { center: Vec3 }) {
  const cursor = useApp((s) => s.cursor)
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const L = 14, gap = 3
    const v: number[] = []
    for (const a of [0, 1, 2]) for (const sgn of [-1, 1]) {
      const p0 = [0, 0, 0], p1 = [0, 0, 0]
      p0[a] = sgn * gap
      p1[a] = sgn * L
      v.push(...p0, ...p1)
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
    return g
  }, [])
  const ring = useMemo(() => new THREE.RingGeometry(3.2, 4.2, 40), [])
  useEffect(() => () => { geo.dispose(); ring.dispose() }, [geo, ring])
  const ringRef = useRef<THREE.Mesh>(null)
  useFrame(({ camera, clock }) => {
    const r = ringRef.current
    if (!r) return
    r.quaternion.copy(camera.quaternion)
    const s = 1 + 0.25 * Math.sin(clock.elapsedTime * 3)
    r.scale.set(s, s, s)
  })
  // The default cursor is the heart centre itself: only show a cursor someone actually placed.
  const placed = !!cursor && Math.hypot(cursor[0] - center[0], cursor[1] - center[1], cursor[2] - center[2]) > 0.5
  if (!placed || !cursor) return null
  const p = lpsToWorld(cursor, center)
  return (
    <group position={p}>
      <lineSegments geometry={geo} raycast={noRaycast} renderOrder={70}>
        <lineBasicMaterial color="#8be7ff" transparent opacity={0.95} depthTest={false} depthWrite={false} toneMapped={false} fog={false} />
      </lineSegments>
      <mesh ref={ringRef} geometry={ring} raycast={noRaycast} renderOrder={70}>
        <meshBasicMaterial color="#38d6ff" transparent opacity={0.85} depthTest={false} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} fog={false} />
      </mesh>
    </group>
  )
}

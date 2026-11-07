/** Orientation gizmo labelled in anatomical terms: L/R, S/I (superior/inferior), A/P. Click a head to look from there. */
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { GizmoHelper } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { CameraView } from './meta'
import { setView } from './rig'

interface Head { p: [number, number, number]; label: string; color: string; view: CameraView; neg: boolean; title: string }
const HEADS: Head[] = [
  { p: [1, 0, 0], label: 'L', color: '#ff6b7a', view: 'left', neg: false, title: 'Left' },
  { p: [-1, 0, 0], label: 'R', color: '#ff6b7a', view: 'right', neg: true, title: 'Right' },
  { p: [0, 1, 0], label: 'S', color: '#3ee08f', view: 'top', neg: false, title: 'Superior (head)' },
  { p: [0, -1, 0], label: 'I', color: '#3ee08f', view: 'bottom', neg: true, title: 'Inferior (feet)' },
  { p: [0, 0, 1], label: 'A', color: '#38d6ff', view: 'front', neg: false, title: 'Anterior (front)' },
  { p: [0, 0, -1], label: 'P', color: '#38d6ff', view: 'back', neg: true, title: 'Posterior (back)' },
]

function headTexture(h: Head, hot: boolean) {
  const c = document.createElement('canvas')
  c.width = c.height = 96
  const g = c.getContext('2d')!
  g.beginPath()
  g.arc(48, 48, 40, 0, Math.PI * 2)
  g.fillStyle = h.neg ? 'rgba(10,14,20,0.92)' : h.color
  g.fill()
  g.lineWidth = 6
  g.strokeStyle = hot ? '#ffffff' : h.color
  g.stroke()
  g.font = '700 46px Inter, system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = h.neg ? h.color : '#07090d'
  g.fillText(h.label, 48, 51)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function HeadSprite({ h }: { h: Head }) {
  const [hot, setHot] = useState(false)
  const tex = useMemo(() => headTexture(h, hot), [h, hot])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <sprite
      position={h.p}
      scale={hot ? 0.62 : 0.5}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHot(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { setHot(false); document.body.style.cursor = '' }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => e.stopPropagation()}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => e.stopPropagation()}
      onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); setView(h.view) }}
    >
      <spriteMaterial map={tex} toneMapped={false} depthTest={false} />
    </sprite>
  )
}

function Axis({ dir, color }: { dir: [number, number, number]; color: string }) {
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir)), [dir])
  return (
    <mesh quaternion={q}>
      <cylinderGeometry args={[0.035, 0.035, 1.6, 8]} />
      <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.7} />
    </mesh>
  )
}

export function Gizmo({ compact }: { compact: boolean }) {
  const s = compact ? 24 : 32
  const m = compact ? 44 : 60
  return (
    <GizmoHelper alignment="bottom-right" margin={[m, m]} renderPriority={1}>
      <group scale={s}>
        <Axis dir={[1, 0, 0]} color="#ff6b7a" />
        <Axis dir={[0, 1, 0]} color="#3ee08f" />
        <Axis dir={[0, 0, 1]} color="#38d6ff" />
        {HEADS.map((h) => <HeadSprite key={h.label} h={h} />)}
      </group>
    </GizmoHelper>
  )
}

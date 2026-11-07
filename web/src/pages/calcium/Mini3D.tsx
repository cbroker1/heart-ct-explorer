/**
 * Mini 3D map: the heart's chambers as a translucent "hologram" (fresnel rim shader, additive),
 * the pericardial search region as a faint shell, and every calcium candidate as a sphere at its
 * centre (lpsToWorld), coloured by verdict. Auto-rotates; hover for a tooltip, click to open.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { dataUrl, type Manifest, type Vec3 } from '../../lib/data'
import { lpsToWorld } from '../../lib/coords'
import type { CalciumCandidate } from '../../lib/reports'
import { useVisible, usePrefersReducedMotion } from './hooks'
import { chamberLabel, fmtNum, verdict } from './model'
import type { CalciumVM } from './useCalciumData'

const PARTS: { name: string; strength: number; label?: string }[] = [
  { name: 'heart_myocardium', strength: 0.75 },
  { name: 'heart_ventricle_left', strength: 0.55, label: 'LV' },
  { name: 'heart_ventricle_right', strength: 0.7, label: 'RV' },
  { name: 'heart_atrium_left', strength: 0.6, label: 'LA' },
  { name: 'heart_atrium_right', strength: 0.6, label: 'RA' },
  { name: 'atrial_appendage_left', strength: 0.5 },
  { name: 'aorta', strength: 0.55 },
  { name: 'pulmonary_artery', strength: 0.5, label: 'PA' },
  { name: 'pericardium', strength: 0.32 },
]
const SEARCH_COLOR = '#ffd27a'

const holoVert = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`
const holoFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float a = (0.05 + pow(f, 2.4) * 0.95) * uStrength;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`

function makeHolo(color: string, strength: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: holoVert,
    fragmentShader: holoFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

interface Part { name: string; geo: THREE.BufferGeometry; mat: THREE.ShaderMaterial; pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3; label?: string; center: THREE.Vector3 }

function Anatomy({ manifest, onBounds, onLabels }: { manifest: Manifest; onBounds: (c: THREE.Vector3, r: number) => void; onLabels: (l: { text: string; pos: THREE.Vector3 }[]) => void }) {
  const gltf = useGLTF(dataUrl(manifest.meshes.file), false, true)
  const parts = useMemo<Part[]>(() => {
    const out: Part[] = []
    gltf.scene.updateMatrixWorld(true)
    for (const p of PARTS) {
      const node = gltf.scene.getObjectByName(p.name)
      let mesh: THREE.Mesh | null = null
      node?.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh })
      if (!mesh) continue
      const m = mesh as THREE.Mesh
      const geo = m.geometry.clone()
      if (!geo.getAttribute('normal')) geo.computeVertexNormals()
      geo.computeBoundingBox()
      const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3()
      m.matrixWorld.decompose(pos, quat, scale)
      const center = geo.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld)
      const meta = manifest.meshes.nodes.find((n) => n.name === p.name)
      const color = p.name === 'pericardium' ? SEARCH_COLOR : meta?.color ?? '#ff6b7a'
      out.push({ name: p.name, geo, mat: makeHolo(color, p.strength), pos, quat, scale, label: p.label, center })
    }
    // push chamber labels outward from the heart's centre so they don't sit on top of the candidates
    const hb = new THREE.Box3()
    for (const p of out) if (p.name.startsWith('heart_')) hb.union(p.geo.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().compose(p.pos, p.quat, p.scale)))
    if (!hb.isEmpty()) {
      const hc = hb.getCenter(new THREE.Vector3())
      for (const p of out) if (p.label) p.center = hc.clone().add(p.center.clone().sub(hc).multiplyScalar(1.45))
    }
    return out
  }, [gltf, manifest])

  useEffect(() => () => { for (const p of parts) { p.geo.dispose(); p.mat.dispose() } }, [parts])

  useEffect(() => {
    // frame the heart (chambers only, not the long aorta)
    const box = new THREE.Box3()
    for (const p of parts) {
      if (!p.name.startsWith('heart_')) continue
      const b = p.geo.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().compose(p.pos, p.quat, p.scale))
      box.union(b)
    }
    if (!box.isEmpty()) onBounds(box.getCenter(new THREE.Vector3()), box.getBoundingSphere(new THREE.Sphere()).radius)
    onLabels(parts.filter((p) => p.label).map((p) => ({ text: p.label!, pos: p.center.clone() })))
  }, [parts, onBounds, onLabels])

  return (
    <group>
      {parts.map((p) => (
        <mesh key={p.name} geometry={p.geo} material={p.mat} position={p.pos} quaternion={p.quat} scale={p.scale} renderOrder={p.name === 'pericardium' ? 0 : 1} raycast={() => null} />
      ))}
    </group>
  )
}

let haloTex: THREE.Texture | null = null
function getHalo(): THREE.Texture {
  if (haloTex) return haloTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  haloTex = new THREE.CanvasTexture(c)
  haloTex.colorSpace = THREE.SRGBColorSpace
  return haloTex
}

function CandDot({ c, pos, hot, motion, onHover, onOpen }: {
  c: CalciumCandidate; pos: Vec3; hot: boolean; motion: boolean
  onHover: (id: number | null) => void; onOpen: (id: number) => void
}) {
  const v = verdict(c.finalClass)
  const important = v.key !== 'noise' && v.key !== 'noise-artifact'
  const r = (important ? 2.4 : 1.6) + 0.55 * Math.cbrt(Math.max(c.volume_mm3, 0.1))
  const halo = useRef<THREE.Sprite>(null)
  const core = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    const pulse = important && motion ? 1 + 0.18 * Math.sin(t * 3 + c.id) : 1
    const k = hot ? 1.55 : 1
    if (halo.current) halo.current.scale.setScalar(r * (important ? 5.2 : 3.2) * pulse * k)
    if (core.current) core.current.scale.setScalar(k)
  })
  const over = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(c.id); document.body.style.cursor = 'pointer' }
  const out = () => { onHover(null); document.body.style.cursor = '' }
  return (
    <group position={pos}>
      <sprite ref={halo} raycast={() => null}>
        <spriteMaterial map={getHalo()} color={v.color} transparent opacity={important ? 0.75 : 0.35} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <mesh ref={core} raycast={() => null}>
        <sphereGeometry args={[r, 20, 14]} />
        <meshStandardMaterial color={v.color} emissive={v.color} emissiveIntensity={hot ? 1.1 : important ? 0.6 : 0.25} roughness={0.35} metalness={0.1}
          transparent opacity={important || hot ? 1 : 0.8} />
      </mesh>
      {/* generous invisible hit target */}
      <mesh onPointerOver={over} onPointerOut={out} onClick={(e) => { e.stopPropagation(); onOpen(c.id) }}>
        <sphereGeometry args={[important ? Math.max(r * 2, 5.5) : Math.max(r * 1.25, 2.8), 10, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  )
}

function Rig({ target, radius, controls }: { target: THREE.Vector3 | null; radius: number; controls: RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree()
  useEffect(() => {
    if (!target) return
    const cam = camera as THREE.PerspectiveCamera
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * 0.92
    cam.position.set(target.x + dist * 0.25, target.y + dist * 0.18, target.z + dist * 0.95)
    cam.near = 1
    cam.far = dist * 6
    cam.updateProjectionMatrix()
    const c = controls.current
    if (c) {
      c.target.copy(target)
      c.minDistance = dist * 0.45
      c.maxDistance = dist * 2.2
      c.update()
      c.saveState()
    }
  }, [target, radius, camera, controls])
  return null
}

interface OverlayState {
  labels: { pos: THREE.Vector3; el: HTMLDivElement | null }[]
  tip: { pos: THREE.Vector3 | null; el: HTMLDivElement | null }
}

/** Positions plain DOM overlays (labels, tooltip) over the canvas by projecting their 3D anchors each frame. */
function Projector({ overlay }: { overlay: MutableRefObject<OverlayState> }) {
  const { camera, size } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const place = (el: HTMLDivElement | null, p: THREE.Vector3 | null) => {
      if (!el) return
      if (!p) { el.style.opacity = '0'; return }
      v.copy(p).project(camera)
      const x = (v.x * 0.5 + 0.5) * size.width
      const y = (-v.y * 0.5 + 0.5) * size.height
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      el.style.opacity = v.z > 1 ? '0' : '1'
    }
    for (const l of overlay.current.labels) place(l.el, l.pos)
    place(overlay.current.tip.el, overlay.current.tip.pos)
  })
  return null
}

function webgl2(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!c.getContext('webgl2')
  } catch {
    return false
  }
}

export default function Mini3D({ vm, hoverId, onHover, onOpen }: {
  vm: CalciumVM; hoverId: number | null; onHover: (id: number | null) => void; onOpen: (id: number) => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const visible = useVisible(wrap, '80px')
  const reduced = usePrefersReducedMotion()
  const [hasGL] = useState(webgl2)
  const [auto, setAuto] = useState(!reduced)
  const [bounds, setBounds] = useState<{ c: THREE.Vector3; r: number } | null>(null)
  const [ready, setReady] = useState(false)
  const controls = useRef<OrbitControlsImpl | null>(null)
  const idle = useRef<number | undefined>(undefined)
  const overlay = useRef<OverlayState>({ labels: [], tip: { pos: null, el: null } })
  const [labels, setLabels] = useState<{ text: string; pos: THREE.Vector3 }[]>([])
  const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
  const center = vm.manifest.worldCenterLPS
  const blobs = useMemo(() => vm.candidates.map((c) => ({ c, pos: lpsToWorld(c.centerLPS, center) })), [vm.candidates, center])
  const onBounds = useMemo(() => (c: THREE.Vector3, r: number) => { setBounds({ c, r }); setReady(true) }, [])
  const onLabels = useMemo(() => (l: { text: string; pos: THREE.Vector3 }[]) => {
    overlay.current.labels = l.map((x) => ({ pos: x.pos, el: null }))
    setLabels(l)
  }, [])
  const hovered = hoverId !== null ? blobs.find((b) => b.c.id === hoverId) ?? null : null
  useLayoutEffect(() => { overlay.current.tip.pos = hovered ? new THREE.Vector3(...hovered.pos) : null }, [hovered])
  useEffect(() => { if (reduced) setAuto(false) }, [reduced])
  useEffect(() => () => { window.clearTimeout(idle.current); document.body.style.cursor = '' }, [])

  const counts = vm.finalCounts
  const zoom = (f: number) => {
    const c = controls.current
    if (!c) return
    const cam = c.object as THREE.PerspectiveCamera
    const dir = cam.position.clone().sub(c.target)
    const len = THREE.MathUtils.clamp(dir.length() * f, c.minDistance, c.maxDistance)
    cam.position.copy(c.target).add(dir.setLength(len))
    c.update()
  }

  if (!hasGL) {
    return (
      <div className="cal-3d cal-3d-fallback" ref={wrap}>
        <p><b>3D view unavailable.</b> This browser doesn't offer WebGL2, so the heart map can't be drawn. Everything else on this page still works.</p>
      </div>
    )
  }
  return (
    <div className="cal-3d" ref={wrap} onPointerLeave={() => onHover(null)}>
      <Canvas
        frameloop={visible ? 'always' : 'never'}
        dpr={[1, 2]}
        camera={{ fov: 32, position: [0, 0, 400], near: 1, far: 3000 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => onHover(null)}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[120, 200, 260]} intensity={1.6} />
        <directionalLight position={[-200, -80, -150]} intensity={0.5} color="#8bd8ff" />
        <Suspense fallback={null}>
          <Anatomy manifest={vm.manifest} onBounds={onBounds} onLabels={onLabels} />
        </Suspense>
        {blobs.map(({ c, pos }) => (
          <CandDot key={c.id} c={c} pos={pos} hot={hoverId === c.id} motion={!reduced} onHover={onHover} onOpen={onOpen} />
        ))}
        <OrbitControls
          ref={controls}
          makeDefault
          enablePan={false}
          enableZoom={coarse}
          enableDamping
          dampingFactor={0.08}
          autoRotate={auto && ready}
          autoRotateSpeed={0.9}
          onStart={() => { window.clearTimeout(idle.current); setAuto(false) }}
          onEnd={() => { window.clearTimeout(idle.current); if (!reduced) idle.current = window.setTimeout(() => setAuto(true), 5000) }}
        />
        <Rig target={bounds?.c ?? null} radius={bounds?.r ?? 80} controls={controls} />
        <Projector overlay={overlay} />
      </Canvas>
      <div className="cal-3d-overlay" aria-hidden>
        {labels.map((l, i) => (
          <div key={l.text} className="cal-3d-anchor" ref={(el) => { if (overlay.current.labels[i]) overlay.current.labels[i].el = el }} style={{ opacity: 0 }}>
            <span className="cal-3d-label">{l.text}</span>
          </div>
        ))}
        <div className="cal-3d-anchor" ref={(el) => { overlay.current.tip.el = el }} style={{ opacity: 0 }}>
          {hovered && (() => {
            const v = verdict(hovered.c.finalClass)
            return (
              <div className="cal-3d-tip" style={{ ['--v' as string]: v.color }}>
                <b className="mono">#{hovered.c.id}</b> <span style={{ color: v.color }}>{v.short}</span>
                <div className="mono">{fmtNum(hovered.c.peakHU, 0)} HU · {fmtNum(hovered.c.areaSum_mm2, 1)} mm²</div>
              </div>
            )
          })()}
        </div>
      </div>
      {!ready && (
        <div className="cal-3d-loading">
          <div className="spinner" />
          <span>Loading the 3D heart ({(vm.manifest.meshes.bytes / 1048576).toFixed(1)} MB)…</span>
        </div>
      )}
      <div className="cal-3d-legend">
        {[...counts.keys()].sort((a, b) => verdict(a).order - verdict(b).order).map((k) => (
          <span key={k}><i style={{ background: verdict(k).color }} />{verdict(k).short} {counts.get(k)}</span>
        ))}
        <span><i className="ring" style={{ borderColor: SEARCH_COLOR }} />search region</span>
      </div>
      <div className="cal-3d-tools">
        <button className="btn small" onClick={() => setAuto((a) => !a)} aria-pressed={auto} title="Toggle auto-rotation">{auto ? '❚❚' : '▶'}</button>
        {!coarse && <button className="btn small" onClick={() => zoom(0.8)} aria-label="Zoom in">+</button>}
        {!coarse && <button className="btn small" onClick={() => zoom(1.25)} aria-label="Zoom out">−</button>}
        <button className="btn small" onClick={() => controls.current?.reset()} title="Reset view">⟲</button>
      </div>
      <div className="cal-3d-hint muted">{coarse ? 'Drag to rotate · pinch to zoom · tap a dot' : 'Drag to rotate · hover a dot · click to open'}</div>
      {hoverId !== null && (() => {
        const c = vm.candidates.find((x) => x.id === hoverId)
        return c ? <div className="cal-3d-where muted">#{c.id} · {chamberLabel(c.chamber, vm.manifest)}</div> : null
      })()}
    </div>
  )
}

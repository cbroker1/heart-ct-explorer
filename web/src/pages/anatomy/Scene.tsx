/** The R3F scene for the 3D anatomy page. Everything inside <Canvas>. */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { CameraControls, Environment, Lightformer, useGLTF } from '@react-three/drei'
import { dataUrl, type Manifest } from '../../lib/data'
import type { CalciumReport } from '../../lib/reports'
import { ClipView, clipCtx } from './Clip'
import { CalciumLayer } from './CalciumLayer'
import { CursorMarker } from './CursorMarker'
import type { CTVolume } from './ct'
import { Gizmo } from './Gizmo'
import { isGlassy, makeFresnelMaterial } from './materials'
import { disposeStructures, getStructures, makeHelper, type Structure } from './meshes'
import { shellOrder } from './meta'
import { LabelProjector } from './labels'
import { flyTo, flyToStructure, framedStructures, rig, setView, viewDir } from './rig'
import { effectiveOpacity, useAnat, type HoverInfo } from './state'

const damp = (a: number, b: number, rate: number, dt: number) => {
  const v = a + (b - a) * (1 - Math.exp(-rate * dt))
  return Math.abs(v - b) < 1e-3 ? b : v
}

// ------------------------------------------------------------------ lighting
function Lighting() {
  return (
    <>
      <ambientLight intensity={0.1} />
      <Headlight />
      <directionalLight position={[260, 420, 560]} intensity={1.35} color="#fff3ea" />
      <directionalLight position={[-520, 180, -380]} intensity={1.0} color="#86d8ff" />
      <directionalLight position={[320, -320, 160]} intensity={0.35} color="#ff9aa5" />
      {/* A local studio made of light panels (no network HDRI). Rendered once into the environment map. */}
      <Environment resolution={256} frames={1} environmentIntensity={0.9}>
        <Lightformer form="rect" intensity={2.6} position={[0, 5, 6]} scale={[10, 5, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.6} color="#8fd8ff" position={[-8, 2, -4]} scale={[3, 9, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.2} color="#ffd8c8" position={[8, 1, 3]} scale={[3, 7, 1]} target={[0, 0, 0]} />
        <Lightformer form="ring" intensity={1.4} color="#ff5d6c" position={[0, -6, -5]} scale={4} target={[0, 0, 0]} />
        <Lightformer form="circle" intensity={0.9} position={[0, 9, 0]} scale={6} target={[0, 0, 0]} />
      </Environment>
    </>
  )
}

/** A soft light that rides with the camera (slightly above it), so every view angle is readable. */
function Headlight() {
  const ref = useRef<THREE.DirectionalLight>(null)
  const tgt = useMemo(() => new THREE.Vector3(), [])
  const up = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    const l = ref.current
    const c = rig.controls
    if (!l || !c) return
    c.getTarget(tgt)
    const d = camera.position.distanceTo(tgt)
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    l.position.copy(camera.position).addScaledVector(up, d * 0.35)
    l.target.position.copy(tgt)
    l.target.updateMatrixWorld()
  })
  return <directionalLight ref={ref} intensity={0.75} color="#ffffff" />
}

// ------------------------------------------------------------------ camera
/** Distance fog that follows the orbit radius: the far side of the chest falls off into the dark. */
function DepthFog() {
  const fog = useMemo(() => new THREE.Fog('#0a0e15', 400, 1400), [])
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    scene.fog = fog
    return () => { if (scene.fog === fog) scene.fog = null }
  }, [scene, fog])
  const tgt = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    const c = rig.controls
    if (!c) return
    c.getTarget(tgt)
    const d = camera.position.distanceTo(tgt)
    fog.near = d * 0.92
    fog.far = d * 2.6
  })
  return null
}

function CameraRig() {
  const ref = useRef<CameraControls>(null)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const user = useRef({ dragging: false, last: 0 })
  useEffect(() => {
    rig.controls = ref.current
    rig.camera = camera
    rig.gl = gl
    rig.scene = scene
    return () => {
      rig.controls = null
      rig.camera = null
      rig.gl = null
      rig.scene = null
    }
  }, [camera, gl, scene])
  useFrame((_, dt) => {
    const c = ref.current
    if (!c || !useAnat.getState().autoRotate || user.current.dragging) return
    if (performance.now() - Math.max(user.current.last, rig.lastFly) < 1400) return
    c.rotate(dt * 0.24, 0, false)
  })
  return (
    <CameraControls
      ref={ref}
      makeDefault
      smoothTime={0.4}
      draggingSmoothTime={0.1}
      minDistance={30}
      maxDistance={2600}
      dollyToCursor
      onControlStart={() => { user.current.dragging = true }}
      onControlEnd={() => { user.current.dragging = false; user.current.last = performance.now() }}
    />
  )
}

// ------------------------------------------------------------------ structures
const hoverRimMat = makeFresnelMaterial(new THREE.Color('#38d6ff'), { pow: 2.4, gain: 0.42, base: 0.015 })
const selRimMat = makeFresnelMaterial(new THREE.Color('#7fe3ff'), { pow: 2.4, gain: 0.7, base: 0.02 })
const INTRO_ORDER: Record<string, number> = { bones: 0, lungs: 1, airways: 2, vessels: 3, heart: 4, abdomen: 2, muscle: 1, body: 0 }

function StructuresView({ structures }: { structures: Structure[] }) {
  const rims = useMemo(() => structures.map((s) => ({ hover: makeHelper(s, hoverRimMat, 40), sel: makeHelper(s, selRimMat, 41) })), [structures])
  useEffect(() => {
    structures.forEach((s, i) => s.mesh.add(rims[i].hover, rims[i].sel))
    clipCtx.extra.add(hoverRimMat)
    clipCtx.extra.add(selRimMat)
    return () => rims.forEach((r) => { r.hover.removeFromParent(); r.sel.removeFromParent() })
  }, [structures, rims])
  const t0 = useRef(-1)
  const explode = useRef(rig.reducedMotion ? 0 : 0.55)

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    const st = useAnat.getState()
    const t = state.clock.elapsedTime
    if (t0.current < 0) t0.current = t
    const since = t - t0.current
    explode.current = since < 0.35 && !rig.reducedMotion ? explode.current : damp(explode.current, st.explode, 3.2, dt)
    const xray = st.mode === 'xray'
    structures.forEach((s, i) => {
      const delay = rig.reducedMotion ? 0 : 0.1 + (INTRO_ORDER[s.node.group] ?? 2) * 0.16
      const want = st.visible[s.name] && since > delay ? 1 : 0
      s.anim.fade = damp(s.anim.fade, want, want ? 5.5 : 9, dt)
      const eff = effectiveOpacity(s.node, st)
      const op = s.anim.fade * eff
      s.anim.opacity = op
      s.offset.copy(s.explodeDir).multiplyScalar(explode.current)
      s.mesh.position.copy(s.centroid).add(s.offset)
      const shown = op > 0.003
      s.mesh.visible = shown
      const r = rims[i]
      if (!shown) return
      const hov = st.hover?.kind === 'structure' && st.hover.name === s.name
      const sel = st.selection?.kind === 'structure' && st.selection.name === s.name
      r.hover.visible = hov && !sel
      r.sel.visible = sel
      if (xray) {
        if (s.mesh.material !== s.xray) s.mesh.material = s.xray
        // X-ray brightness follows the visibility fade and the group slider (relative to its default).
        const rel = Math.min(1.6, eff / Math.max(0.01, s.node.defaultOpacity))
        s.xray.uniforms.uOpacity.value = s.anim.fade * rel * (hov || sel ? 1.8 : 1)
        s.mesh.renderOrder = 0
        return
      }
      if (s.mesh.material !== s.organ) s.mesh.material = s.organ
      const m = s.organ
      const transparent = op < 0.995
      if (m.transparent !== transparent) {
        m.transparent = transparent
        m.depthWrite = !transparent
        m.needsUpdate = true
      }
      m.opacity = op
      s.mesh.renderOrder = transparent ? shellOrder(s.node) : 0
      const u = m.userData.u
      const glassy = isGlassy(s.node)
      const body = s.node.group === 'body'
      u.uRim.value = transparent ? (body ? 0.5 : glassy ? 0.36 : 0.28) * Math.min(1, (1 - op) * 1.6) * s.anim.fade : 0
      u.uRimGlow.value = transparent ? (body ? 0.55 : glassy ? 0.3 : 0.18) * s.anim.fade : 0
      s.anim.glow = damp(s.anim.glow, sel ? 0.1 + 0.05 * Math.sin(t * 3.4) : hov ? 0.2 : 0, 12, dt)
      m.emissiveIntensity = s.anim.glow
    })
    selRimMat.uniforms.uGain.value = 0.62 + 0.22 * Math.sin(t * 3.4)
  })

  return (
    <>
      {structures.map((s) => <primitive key={s.name} object={s.mesh} />)}
    </>
  )
}

// ------------------------------------------------------------------ picking
type Hit = THREE.Intersection
interface Resolved { hover: HoverInfo; point: THREE.Vector3; s?: Structure; viaCT?: boolean; hu?: number | null }

function resolveHit(e: ThreeEvent<MouseEvent | PointerEvent>, byName: Map<string, Structure>): Resolved | null {
  const st = useAnat.getState()
  const list = e.intersections as Hit[]
  if (st.calcium) {
    const c = list.find((h) => h.object.userData.candidate != null)
    if (c) return { hover: { kind: 'candidate', id: c.object.userData.candidate as number }, point: c.point.clone() }
  }
  const structOf = (h: Hit) => h.object.userData.structure as Structure | undefined
  const sHits = list.filter((h) => structOf(h))
  const slice = list.find((h) => h.object.userData.slicePlane)
  const ctHover = (p: THREE.Vector3): Resolved => {
    const hu = clipCtx.vol?.huAt(p) ?? null
    const lbl = clipCtx.vol?.labelAt(p) ?? undefined
    const s = lbl ? byName.get(lbl) : undefined
    return { hover: { kind: 'ct', hu, name: s?.name }, point: p.clone(), s, viaCT: true, hu }
  }
  if (clipCtx.active && clipCtx.cameraRemoved) {
    const p = e.ray.intersectPlane(clipCtx.plane, new THREE.Vector3())
    if (p) {
      const first = sHits[0]
      const s0 = first ? structOf(first) : undefined
      const back = first?.face ? first.face.normal.dot(e.ray.direction) > 0 : false
      if (clipCtx.caps && s0 && back && s0.anim.opacity >= 0.6) {
        // Pointer is on this structure's cut face (its CT cap).
        const local = p.clone().sub(s0.offset)
        const hu = clipCtx.vol?.huAt(local) ?? null
        return { hover: { kind: 'structure', name: s0.name, hu, src: '3d' }, point: local, s: s0, viaCT: true, hu }
      }
      if (slice) return ctHover(p)
    }
  } else if (slice && (!sHits[0] || slice.distance < sHits[0].distance)) return ctHover(slice.point)
  const pick = sHits.find((h) => (structOf(h)?.anim.opacity ?? 0) >= 0.6) ?? sHits[0]
  if (!pick) return null
  const s = structOf(pick)!
  return { hover: { kind: 'structure', name: s.name, src: '3d' }, point: pick.point.clone().sub(s.offset), s }
}

// ------------------------------------------------------------------ intro + ready
function Intro({ structures }: { structures: Structure[] }) {
  useEffect(() => {
    let raf = 0
    let timer = 0
    let tries = 0
    const go = () => {
      // Wait for the controls and for the canvas to have its real size (the fit depends on the aspect).
      const el = rig.gl?.domElement
      const aspectOk = !!el && el.clientHeight > 0 && !!rig.camera && Math.abs(rig.camera.aspect - el.clientWidth / el.clientHeight) < 0.01
      if ((!rig.controls || !rig.camera || !aspectOk) && tries++ < 120) { raf = requestAnimationFrame(go); return }
      if (!rig.controls || !rig.camera) return
      if (rig.reducedMotion) setView('home', false)
      else {
        const dir = viewDir('home').applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.95)
        dir.y += 0.35
        flyTo(framedStructures(), dir.normalize(), false, 2.1)
        rig.controls.smoothTime = 0.95
        setView('home', true)
        timer = window.setTimeout(() => { if (rig.controls) rig.controls.smoothTime = 0.4 }, 2600)
      }
      useAnat.getState().set({ ready: true })
    }
    raf = requestAnimationFrame(go)
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [structures])
  return null
}

// ------------------------------------------------------------------ root
export default function Scene({ manifest, vol, calcium, compact }: { manifest: Manifest; vol: CTVolume | null; calcium: CalciumReport | null; compact: boolean }) {
  const gltf = useGLTF(dataUrl(manifest.meshes.file))
  const structures = useMemo(() => getStructures(gltf.scene, manifest.meshes.nodes), [gltf, manifest])
  const byName = useMemo(() => new Map(structures.map((s) => [s.name, s])), [structures])
  useEffect(() => {
    rig.structures = structures
    const b = new THREE.Box3()
    for (const s of structures) b.union(s.box)
    useAnat.setState({ bounds: { min: b.min.toArray(), max: b.max.toArray() } })
    return () => {
      rig.structures = []
      disposeStructures(structures)
      document.body.style.cursor = ''
    }
  }, [structures])

  const setHover = useAnat((s) => s.setHover)
  const select = useAnat((s) => s.select)

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    const r = resolveHit(e, byName)
    setHover(r ? r.hover : null)
    document.body.style.cursor = r ? 'pointer' : ''
  }
  const onOut = () => {
    const h = useAnat.getState().hover
    if (h && !(h.kind === 'structure' && h.src === 'list')) setHover(null)
    document.body.style.cursor = ''
  }
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 6) return
    const r = resolveHit(e, byName)
    if (!r) return
    if (r.hover.kind === 'candidate') {
      select({ kind: 'candidate', id: r.hover.id })
      return
    }
    if (!r.s) return
    select({ kind: 'structure', name: r.s.name, point: r.point.toArray(), viaCT: r.viaCT, hu: r.hu })
    if (!r.viaCT) flyToStructure(r.s)
  }

  return (
    <>
      <Lighting />
      <DepthFog />
      <CameraRig />
      <group onPointerMove={onMove} onPointerOut={onOut} onClick={onClick}>
        <StructuresView structures={structures} />
        <ClipView structures={structures} manifest={manifest} vol={vol} />
        {calcium && <CalciumLayer report={calcium} structures={structures} center={manifest.worldCenterLPS} />}
      </group>
      <CursorMarker center={manifest.worldCenterLPS} />
      <LabelProjector structures={structures} />
      <Gizmo compact={compact} />
      <Intro structures={structures} />
    </>
  )
}


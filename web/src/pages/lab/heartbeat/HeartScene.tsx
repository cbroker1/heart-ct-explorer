/**
 * The beating 3D heart (lazy-loaded chunk). Heart nodes of the anatomy GLB only, baked into
 * "heart space" (the GLB world frame, mm), animated by heartMaterial.ts from the shared clock.
 * Also draws the scanner: a beam ring that steps slab to slab and a rotating X-ray fan.
 */
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { dataUrl, type Manifest } from '../../../lib/data'
import type { Cardio } from './ecg'
import type { Player } from './player'
import { makeHeartMaterial, makeSharedUniforms, ROLE, type SharedUniforms } from './heartMaterial'

export interface SceneInfo {
  /** per exposure: heart structures inside that slab, most-covered first */
  coverage: string[][]
  parts: number
}

interface Spec { name: string; short: string; role: number; kR: number; kRin?: number; opacity?: number; centerOf?: string; rim: string }

const SPECS: Spec[] = [
  { name: 'heart_ventricle_left', short: 'left ventricle', role: ROLE.ventricle, kR: 0.13, rim: '#ff8a95' },
  { name: 'heart_ventricle_right', short: 'right ventricle', role: ROLE.ventricle, kR: 0.1, rim: '#9db8ff' },
  { name: 'heart_myocardium', short: 'heart muscle', role: ROLE.ventricle, kR: 0.055, kRin: 0.13, opacity: 0.5, rim: '#ff7d8a' },
  { name: 'heart_atrium_left', short: 'left atrium', role: ROLE.atrium, kR: 0, centerOf: 'heart_atrium_left', rim: '#ffbdb2' },
  { name: 'heart_atrium_right', short: 'right atrium', role: ROLE.atrium, kR: 0, centerOf: 'heart_atrium_right', rim: '#bccdff' },
  { name: 'atrial_appendage_left', short: 'left atrial appendage', role: ROLE.atrium, kR: 0, centerOf: 'heart_atrium_left', rim: '#ffc9b6' },
  { name: 'aorta', short: 'aorta', role: ROLE.artery, kR: 0, rim: '#ff8893' },
  { name: 'pulmonary_artery', short: 'pulmonary artery', role: ROLE.artery, kR: 0, rim: '#93aaff' },
  { name: 'pulmonary_vein', short: 'pulmonary veins', role: ROLE.vein, kR: 0, centerOf: 'heart_atrium_left', rim: '#ffb09e' },
  { name: 'superior_vena_cava', short: 'superior vena cava', role: ROLE.vein, kR: 0, centerOf: 'heart_atrium_right', rim: '#9fb3ff' },
  { name: 'inferior_vena_cava', short: 'inferior vena cava', role: ROLE.vein, kR: 0, centerOf: 'heart_atrium_right', rim: '#9fb3ff' },
]

const XRAY_COLOR = new THREE.Color('#5dffb0')

interface Built {
  parts: { spec: Spec; geom: THREE.BufferGeometry; mat: THREE.MeshPhysicalMaterial }[]
  shared: SharedUniforms
  center: THREE.Vector3
  radius: number
  gantryR: number
  info: SceneInfo
}

/** Copy a node's triangles into heart space (float positions, own index, smooth normals). */
function bakeGeometry(obj: THREE.Object3D, rootInv: THREE.Matrix4): THREE.BufferGeometry | null {
  const chunks: { pos: Float32Array; idx: ArrayLike<number> | null }[] = []
  obj.updateWorldMatrix(true, true)
  const v = new THREE.Vector3()
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.geometry) return
    const pa = m.geometry.getAttribute('position')
    if (!pa) return
    const rel = new THREE.Matrix4().multiplyMatrices(rootInv, m.matrixWorld)
    const pos = new Float32Array(pa.count * 3)
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(rel)
      pos[3 * i] = v.x; pos[3 * i + 1] = v.y; pos[3 * i + 2] = v.z
    }
    chunks.push({ pos, idx: m.geometry.index ? m.geometry.index.array : null })
  })
  if (!chunks.length) return null
  const nV = chunks.reduce((s, c) => s + c.pos.length / 3, 0)
  const nI = chunks.reduce((s, c) => s + (c.idx ? c.idx.length : c.pos.length / 3), 0)
  const pos = new Float32Array(nV * 3)
  const idx = nV > 65535 ? new Uint32Array(nI) : new Uint16Array(nI)
  let vo = 0, io = 0
  for (const c of chunks) {
    pos.set(c.pos, vo * 3)
    const n = c.pos.length / 3
    if (c.idx) for (let i = 0; i < c.idx.length; i++) idx[io++] = c.idx[i] + vo
    else for (let i = 0; i < n; i++) idx[io++] = i + vo
    vo += n
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeVertexNormals()
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

function centroid(gs: THREE.BufferGeometry[]): THREE.Vector3 | null {
  const c = new THREE.Vector3()
  let n = 0
  for (const g of gs) {
    const p = g.getAttribute('position').array as Float32Array
    for (let i = 0; i < p.length; i += 3) { c.x += p[i]; c.y += p[i + 1]; c.z += p[i + 2] }
    n += p.length / 3
  }
  return n ? c.divideScalar(n) : null
}

function projections(gs: THREE.BufferGeometry[], origin: THREE.Vector3, axis: THREE.Vector3): Float32Array {
  const n = gs.reduce((s, g) => s + g.getAttribute('position').count, 0)
  const out = new Float32Array(n)
  let k = 0
  for (const g of gs) {
    const p = g.getAttribute('position').array as Float32Array
    for (let i = 0; i < p.length; i += 3) out[k++] = (p[i] - origin.x) * axis.x + (p[i + 1] - origin.y) * axis.y + (p[i + 2] - origin.z) * axis.z
  }
  return out.sort()
}
const pctl = (a: Float32Array, q: number) => (a.length ? a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))] : 0)

function build(scene: THREE.Object3D, model: Cardio, colors: Record<string, string>): Built {
  scene.updateWorldMatrix(true, true)
  const rootInv = new THREE.Matrix4().copy(scene.matrixWorld).invert()
  const geoms = new Map<string, THREE.BufferGeometry>()
  for (const s of SPECS) {
    const obj = scene.getObjectByName(s.name)
    const g = obj ? bakeGeometry(obj, rootInv) : null
    if (g) geoms.set(s.name, g)
  }
  const pick = (...names: string[]) => names.map((n) => geoms.get(n)).filter((g): g is THREE.BufferGeometry => !!g)

  // ---- the heart's long axis (ventricles -> atria), apex, valve plane, sinus node
  const vent = pick('heart_ventricle_left', 'heart_ventricle_right')
  const atria = pick('heart_atrium_left', 'heart_atrium_right')
  const all = [...geoms.values()]
  const cAll = centroid(all) ?? new THREE.Vector3()
  const cV = centroid(vent.length ? vent : pick('heart_myocardium')) ?? cAll
  const cA = centroid(atria) ?? cAll.clone().add(new THREE.Vector3(0, 40, 0))
  const axis = cA.clone().sub(cV)
  if (axis.lengthSq() < 1) axis.set(0, 1, 0)
  axis.normalize()
  const pV = projections([...vent, ...pick('heart_myocardium')], cV, axis)
  const pVc = projections(vent, cV, axis)
  const pA = projections(atria, cV, axis)
  const apexS = pctl(pV, 0.004)
  const baseS = atria.length && vent.length ? 0.5 * (pctl(pVc, 0.97) + pctl(pA, 0.05)) : apexS + 70
  const hb = Math.max(30, baseS - apexS)
  const ha = Math.max(25, (atria.length ? pctl(pA, 0.97) : baseS + 45) - baseS)
  const apex = cV.clone().addScaledVector(axis, apexS)
  const av = cV.clone().addScaledVector(axis, baseS)
  // sinus node: the right-atrial point nearest the SVC
  const sa = (() => {
    const ra = geoms.get('heart_atrium_right'), svc = geoms.get('superior_vena_cava')
    if (!ra) return av.clone()
    const target = (svc && centroid([svc])) ?? av
    const p = ra.getAttribute('position').array as Float32Array
    let best = Infinity, bi = 0
    for (let i = 0; i < p.length; i += 3) {
      const d = (p[i] - target.x) ** 2 + (p[i + 1] - target.y) ** 2 + (p[i + 2] - target.z) ** 2
      if (d < best) { best = d; bi = i }
    }
    return new THREE.Vector3(p[bi], p[bi + 1], p[bi + 2])
  })()

  const shared = makeSharedUniforms()
  shared.uApex.value.copy(apex)
  shared.uAxis.value.copy(axis)
  shared.uHb.value = hb
  shared.uHa.value = ha
  shared.uAV.value.copy(av)
  shared.uSA.value.copy(sa)

  const parts: Built['parts'] = []
  const centers = new Map<string, { c: THREE.Vector3; r: number }>()
  for (const name of ['heart_atrium_left', 'heart_atrium_right']) {
    const g = geoms.get(name)
    if (g) centers.set(name, { c: centroid([g])!, r: g.boundingSphere ? g.boundingSphere.radius * 0.6 : 25 })
  }
  for (const s of SPECS) {
    const geom = geoms.get(s.name)
    if (!geom) continue
    const cc = s.centerOf ? centers.get(s.centerOf) : undefined
    const node = s.name
    const mat = makeHeartMaterial(shared, {
      color: colors[node] ?? '#d8434f', role: s.role, kR: s.kR, kRin: s.kRin, opacity: s.opacity,
      center: cc?.c, centerR: cc?.r, rim: s.rim,
    })
    parts.push({ spec: s, geom, mat })
  }

  // ---- framing
  const box = new THREE.Box3()
  for (const g of all) if (g.boundingBox) box.union(g.boundingBox)
  const center = box.getCenter(new THREE.Vector3())
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  let gantryR = 0
  for (const g of all) {
    const p = g.getAttribute('position').array as Float32Array
    for (let i = 0; i < p.length; i += 3) gantryR = Math.max(gantryR, Math.hypot(p[i] - center.x, p[i + 2] - center.z))
  }
  gantryR = gantryR * 1.06 + 6

  // ---- which structures each X-ray slab covered
  const coverage = model.slabY.map(([ya, yb]) => {
    const y0 = Math.min(ya, yb), y1 = Math.max(ya, yb)
    const rows: { name: string; f: number }[] = []
    for (const s of SPECS) {
      const g = geoms.get(s.name)
      if (!g) continue
      const p = g.getAttribute('position').array as Float32Array
      let inn = 0
      for (let i = 1; i < p.length; i += 3) if (p[i] >= y0 && p[i] <= y1) inn++
      const f = inn / (p.length / 3)
      if (f >= 0.18) rows.push({ name: s.short, f })
    }
    return rows.sort((a, b) => b.f - a.f).slice(0, 5).map((r) => r.name)
  })
  return { parts, shared, center, radius: sphere.radius, gantryR, info: { coverage, parts: parts.length } }
}

/** the bits of drei's OrbitControls this scene touches */
interface Controls extends THREE.EventDispatcher<{ start: object; end: object; change: object }> {
  target: THREE.Vector3
  minDistance: number
  maxDistance: number
  autoRotate: boolean
  autoRotateSpeed: number
  update(): void
}

// ------------------------------------------------------------------------------------- scanner
function makeFanGeometry(R: number, halfAngle: number): THREE.BufferGeometry {
  // three stacked flat fans (y = -0.5, 0, 0.5) from the tube (angle 0) to the detector arc (angle pi)
  const seg = 24
  const pos: number[] = [], col: number[] = [], idx: number[] = []
  for (const [y, k] of [[-0.5, 0.55], [0, 1], [0.5, 0.55]] as const) {
    const base = pos.length / 3
    pos.push(R, y, 0); col.push(0.5 * k, 1 * k, 0.72 * k)
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI - halfAngle + (2 * halfAngle * i) / seg
      const edge = 1 - Math.abs(i / seg - 0.5) * 1.6
      pos.push(R * Math.cos(a), y, R * Math.sin(a)); col.push(0.04 * k * edge, 0.38 * k * edge, 0.22 * k * edge)
    }
    for (let i = 0; i < seg; i++) idx.push(base, base + 1 + i, base + 2 + i)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  return g
}

function makeHaloTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  gr.addColorStop(0, 'rgba(255,77,94,0.55)')
  gr.addColorStop(0.35, 'rgba(255,77,94,0.18)')
  gr.addColorStop(1, 'rgba(255,77,94,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

interface HeartProps {
  model: Cardio
  player: Player
  manifest: Manifest
  autoRotate: boolean
  onReady: (info: SceneInfo) => void
}

function Heart({ model, player, manifest, autoRotate, onReady }: HeartProps) {
  const gltf = useGLTF(dataUrl(manifest.meshes.heartFile ?? manifest.meshes.file))
  const built = useMemo(
    () => build(gltf.scene, model, Object.fromEntries(manifest.meshes.nodes.map((n) => [n.name, n.color]))),
    [gltf, model, manifest],
  )
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as unknown as Controls | null
  const userTook = useRef(false)

  const ring = useRef<THREE.Mesh>(null)
  const edges = useRef<THREE.Group>(null)
  const fan = useRef<THREE.Mesh>(null)
  const curtain = useRef<THREE.Mesh>(null)
  const halo = useRef<THREE.Sprite>(null)

  const scanner = useMemo(() => {
    const R = built.gantryR
    return {
      ring: new THREE.TorusGeometry(R, 0.85, 10, 200),
      edge: new THREE.TorusGeometry(R, 0.4, 6, 200),
      fan: makeFanGeometry(R, 0.42),
      curtain: new THREE.CylinderGeometry(R, R, 1, 128, 1, true),
      ringMat: new THREE.MeshBasicMaterial({ color: XRAY_COLOR, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      edgeMat: new THREE.MeshBasicMaterial({ color: XRAY_COLOR, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      fanMat: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      curtainMat: new THREE.MeshBasicMaterial({ color: XRAY_COLOR, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      haloTex: makeHaloTexture(),
    }
  }, [built.gantryR])

  // free GPU resources on unmount
  useEffect(() => () => {
    for (const p of built.parts) { p.geom.dispose(); p.mat.dispose() }
  }, [built])
  useEffect(() => () => {
    scanner.ring.dispose(); scanner.edge.dispose(); scanner.fan.dispose(); scanner.curtain.dispose()
    scanner.ringMat.dispose(); scanner.edgeMat.dispose(); scanner.fanMat.dispose(); scanner.curtainMat.dispose(); scanner.haloTex.dispose()
  }, [scanner])

  useEffect(() => { onReady(built.info) }, [built, onReady])

  // frame the heart for the current viewport (narrow phones need more distance)
  useLayoutEffect(() => {
    const vfov = THREE.MathUtils.degToRad(camera.fov)
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (size.width / Math.max(1, size.height)))
    const d = (built.radius * 0.8) / Math.sin(Math.min(vfov, hfov) / 2)
    const dir = new THREE.Vector3(0.48, 0.4, 1).normalize()
    camera.position.copy(dir.multiplyScalar(d))
    camera.near = d / 20
    camera.far = d * 6
    // on wide screens the HUD covers the right edge: centre the heart in the space left of it
    const shift = size.width > 700 ? Math.min(140, size.width * 0.11) : 0
    if (shift) camera.setViewOffset(size.width, size.height, shift, 0, size.width, size.height)
    else camera.clearViewOffset()
    camera.updateProjectionMatrix()
    camera.lookAt(0, 0, 0)
    if (controls) {
      controls.target.set(0, 0, 0)
      controls.minDistance = d * 0.55
      controls.maxDistance = d * 1.6
      controls.update()
    }
  }, [built, camera, size.width, size.height, controls])

  useEffect(() => {
    if (!controls) return
    controls.autoRotate = autoRotate && !userTook.current
    controls.autoRotateSpeed = 0.55
    // once someone grabs the heart, stop the slow auto-rotation
    const onStart = () => { userTook.current = true; controls.autoRotate = false }
    controls.addEventListener('start', onStart)
    return () => controls.removeEventListener('start', onStart)
  }, [controls, autoRotate])

  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame((state) => {
    const U = built.shared
    const t = player.t
    const s = model.state(t)
    U.uV.value = s.v
    U.uA.value = s.a
    U.uTau.value = s.tau
    U.uTs.value = s.ts
    U.uWaveA.value = s.waveA
    U.uWaveV.value = s.waveV
    U.uGlow.value = 0.55 * s.v + 0.4 * s.a + (s.waveV >= 0 ? 0.35 * (1 - s.waveV) : 0)
    U.uTime.value = state.clock.elapsedTime
    const xr = model.xray(t)
    const slab = xr.i >= 0 ? model.slabY[xr.i] : model.slabY[0]
    const y0 = slab ? Math.min(slab[0], slab[1]) : 0, y1 = slab ? Math.max(slab[0], slab[1]) : 0
    U.uSlab.value.set(y0, y1)
    U.uSlabOn.value = xr.on
    const cy = 0.5 * (y0 + y1), th = Math.max(1, y1 - y0)
    if (ring.current) {
      ring.current.position.y = model.ringY(t)
      scanner.ringMat.opacity = 0.2 + 0.8 * xr.on
    }
    if (edges.current) {
      edges.current.position.y = cy
      edges.current.children[0].position.y = -th / 2
      edges.current.children[1].position.y = th / 2
      scanner.edgeMat.opacity = 0.9 * xr.on
    }
    const inShot = xr.i >= 0 && t >= model.x[xr.i].xray[0] - 0.01 && t <= model.x[xr.i].xray[1] + 0.03
    if (fan.current) {
      fan.current.visible = inShot
      fan.current.position.y = cy
      fan.current.scale.set(1, th, 1)
      fan.current.rotation.y = -xr.angle
      scanner.fanMat.opacity = 0.6 * xr.on
    }
    if (curtain.current) {
      curtain.current.visible = xr.on > 0.01
      curtain.current.position.y = cy
      curtain.current.scale.set(1, th, 1)
      scanner.curtainMat.opacity = 0.075 * xr.on
    }
    if (halo.current) {
      // keep the glow behind the heart from wherever the camera is
      tmp.copy(state.camera.position).normalize().multiplyScalar(-built.radius * 0.9)
      halo.current.position.copy(tmp)
      const k = 0.55 + 0.45 * s.v + 0.25 * xr.on
      halo.current.scale.setScalar(built.radius * (3.0 + 0.25 * s.v))
      ;(halo.current.material as THREE.SpriteMaterial).opacity = k
    }
  })

  const c = built.center
  return (
    <>
      <sprite ref={halo} renderOrder={-10}>
        <spriteMaterial map={scanner.haloTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <group position={[-c.x, -c.y, -c.z]}>
        {built.parts.map((p) => (
          <mesh key={p.spec.name} geometry={p.geom} material={p.mat} renderOrder={p.spec.opacity ? 2 : 0} />
        ))}
        <mesh ref={ring} geometry={scanner.ring} material={scanner.ringMat} rotation={[Math.PI / 2, 0, 0]} position={[c.x, 0, c.z]} />
        <group ref={edges} position={[c.x, 0, c.z]}>
          <mesh geometry={scanner.edge} material={scanner.edgeMat} rotation={[Math.PI / 2, 0, 0]} />
          <mesh geometry={scanner.edge} material={scanner.edgeMat} rotation={[Math.PI / 2, 0, 0]} />
        </group>
        <mesh ref={fan} geometry={scanner.fan} material={scanner.fanMat} position={[c.x, 0, c.z]} visible={false} />
        <mesh ref={curtain} geometry={scanner.curtain} material={scanner.curtainMat} position={[c.x, 0, c.z]} visible={false} />
      </group>
    </>
  )
}

class SceneBoundary extends Component<{ children: ReactNode; onError: (e: string) => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: unknown) { this.props.onError(String((e as Error)?.message ?? e)) }
  render() { return this.state.failed ? null : this.props.children }
}

export interface HeartSceneProps extends HeartProps {
  active: boolean
  onError: (e: string) => void
}

export default function HeartScene(props: HeartSceneProps) {
  const { active, onError, ...rest } = props
  return (
    <Canvas
      className="hb-canvas"
      dpr={[1, 1.75]}
      frameloop={active ? 'always' : 'never'}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 30, near: 5, far: 4000, position: [0, 0, 420] }}
      onCreated={({ gl }) => { gl.setClearColor(0x000000, 0) }}
    >
      <ambientLight intensity={0.22} />
      <hemisphereLight args={['#c9dcff', '#2b0a10', 0.6]} />
      <directionalLight position={[-160, 230, 260]} intensity={1.7} color="#fff3ec" />
      <directionalLight position={[240, -40, -220]} intensity={1.1} color="#38d6ff" />
      <directionalLight position={[60, -220, 160]} intensity={0.45} color="#ff4d5e" />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.4} position={[0, 260, 160]} scale={[320, 120, 1]} color="#ffffff" />
        <Lightformer form="ring" intensity={1.8} position={[-260, 40, 60]} scale={130} color="#38d6ff" />
        <Lightformer form="rect" intensity={1.3} position={[260, -60, 110]} scale={[160, 220, 1]} color="#ff8a95" />
      </Environment>
      <SceneBoundary onError={onError}>
        <Suspense fallback={null}>
          <Heart {...rest} />
        </Suspense>
      </SceneBoundary>
      <OrbitControls makeDefault enablePan={false} enableZoom={false} enableDamping dampingFactor={0.08} minPolarAngle={0.35} maxPolarAngle={2.65} />
    </Canvas>
  )
}

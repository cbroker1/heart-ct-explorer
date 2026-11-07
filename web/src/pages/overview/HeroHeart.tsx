/**
 * The landing-page heart: heart-only nodes of the shared anatomy GLB, re-lit with a local
 * Lightformer studio, slowly turning, beating at the scan's real average heart rate.
 *
 * The GLB is cached by useGLTF and shared with the Anatomy page, so nothing in the cached scene is
 * mutated: each structure gets its own BufferGeometry (sharing the cached index/position buffers,
 * plus its own smooth normals) and its own material.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bvh, Environment, Lightformer, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { beatClock, mechanics } from './beat'
import { AUTO_SPIN } from './heartParts'
import type { SpinState } from './types'

export type PartKind = 'ventricle' | 'muscle' | 'atrium' | 'artery' | 'vein'
export interface HeartPartSpec { name: string; color: string; kind: PartKind }

export interface HeroHeartProps {
  url: string
  parts: HeartPartSpec[]
  bpm: number | null
  running: boolean
  reducedMotion: boolean
  spin: RefObject<SpinState>
  /** Receives a `--ovw-beat` CSS variable (0..1) every frame, to sync CSS glows with the beat. */
  beatTarget?: RefObject<HTMLElement | null>
  /** Filled with the canvas' invalidate(), so DOM drag handlers can request frames in on-demand mode. */
  invalidateRef?: RefObject<(() => void) | null>
  onReady?: () => void
  /** Hovered (mouse) or tapped (touch) structure name, or null. */
  onPick?: (name: string | null, pointerType: string) => void
  /** Structure to highlight (owned by the parent so it can time out tap labels). */
  picked?: string | null
}

// ---------------------------------------------------------------- materials
interface SharedUniforms {
  uScanY: { value: number }
  uScanAmp: { value: number }
  uScanColor: { value: THREE.Color }
  uRimColor: { value: THREE.Color }
}

const WHITE = new THREE.Color('#ffffff')

/**
 * Neighbouring AI segmentations share walls, so their surfaces nearly coincide and would z-fight
 * (speckles). Each structure is inflated along its normals by a small, structure-specific amount
 * (mm), so near-ties always resolve the same way. RV wins over the LV muscle shell it sits on, etc.
 */
const INFLATE_MM: Record<string, number> = {
  heart_ventricle_right: 1.2,
  heart_atrium_right: 0.8,
  pulmonary_artery: 0.6,
  heart_atrium_left: 0.5,
  aorta: 0.4,
  atrial_appendage_left: 0.4,
  superior_vena_cava: 0.3,
  inferior_vena_cava: 0.3,
  pulmonary_vein: 0.2,
}

function makeMaterial(color: string, shared: SharedUniforms, kind: PartKind, inflateLocal: number, hi: { value: number }) {
  // The manifest colours are UI colours; pull them back a touch so the shading carries the form.
  const base = new THREE.Color(color).offsetHSL(0, -0.06, 0)
  const mat = new THREE.MeshPhysicalMaterial({
    color: base,
    roughness: kind === 'muscle' ? 0.44 : 0.32,
    metalness: 0.0,
    clearcoat: 0.75,
    clearcoatRoughness: 0.14,
    sheen: 0.15,
    sheenRoughness: 0.45,
    sheenColor: base.clone().lerp(WHITE, 0.35),
    envMapIntensity: 1.05,
  })
  const rim = { value: kind === 'vein' || kind === 'artery' ? 0.72 : 0.55 }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uScanY = shared.uScanY
    shader.uniforms.uScanAmp = shared.uScanAmp
    shader.uniforms.uScanColor = shared.uScanColor
    shader.uniforms.uRimColor = shared.uRimColor
    shader.uniforms.uRim = rim
    shader.uniforms.uHi = hi
    shader.uniforms.uInflate = { value: inflateLocal }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOvwWorld;\nuniform float uInflate;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(objectNormal) * uInflate;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvOvwWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vOvwWorld;\nuniform float uScanY;\nuniform float uScanAmp;\nuniform vec3 uScanColor;\nuniform vec3 uRimColor;\nuniform float uRim;\nuniform float uHi;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // holographic fresnel rim
          float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += uRimColor * pow(1.0 - ndv, 2.6) * uRim;
          // hover highlight
          totalEmissiveRadiance += (diffuseColor.rgb * 0.22 + uRimColor * pow(1.0 - ndv, 1.6) * 0.9) * uHi;
          // CT scan line (world-space Y) with a short glowing trail above it
          float d = vOvwWorld.y - uScanY;
          float line = exp(-d * d / 1.6);
          float trail = d > 0.0 ? exp(-d / 9.0) * 0.28 : 0.0;
          totalEmissiveRadiance += uScanColor * (line + trail) * uScanAmp;
        }`,
      )
  }
  return mat
}

// ---------------------------------------------------------------- geometry
interface BuiltPart {
  spec: HeartPartSpec
  geometry: THREE.BufferGeometry
  material: THREE.MeshPhysicalMaterial
  /** hover highlight amount (0..1), eased every frame */
  hi: { value: number }
  /** render-time inflation (mm), mirrored in picking so the label names what you actually see */
  inflateMM: number
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
  /** unit direction from the heart centre to this structure's centre (for the assemble-in intro) */
  out: THREE.Vector3
}

interface Built {
  parts: BuiltPart[]
  halfHeight: number
  radiusXZ: number
  minY: number
  maxY: number
  uniforms: SharedUniforms
  dispose: () => void
}

function findMesh(root: THREE.Object3D, name: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null
  root.traverse((o) => {
    if (found) return
    const m = o as THREE.Mesh
    if (m.isMesh && (m.name === name || m.parent?.name === name)) found = m
  })
  return found
}

function buildParts(root: THREE.Object3D, specs: HeartPartSpec[]): Built {
  root.updateMatrixWorld(true)
  const uniforms: SharedUniforms = {
    uScanY: { value: 0 },
    uScanAmp: { value: 0 },
    uScanColor: { value: new THREE.Color('#5fe1ff') },
    uRimColor: { value: new THREE.Color('#8be7ff') },
  }
  const raw: { spec: HeartPartSpec; geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; box: THREE.Box3 }[] = []
  for (const spec of specs) {
    const src = findMesh(root, spec.name)
    if (!src) continue
    const g = new THREE.BufferGeometry()
    // Own copy of the (small) index: the picking BVH reorders triangles in place, and the cached
    // GLTF geometry is shared with the Anatomy page.
    if (src.geometry.index) g.setIndex(src.geometry.index.clone())
    g.setAttribute('position', src.geometry.getAttribute('position'))
    g.computeVertexNormals()
    g.computeBoundingBox()
    g.computeBoundingSphere()
    const matrix = src.matrixWorld.clone()
    const box = g.boundingBox!.clone().applyMatrix4(matrix)
    raw.push({ spec, geometry: g, matrix, box })
  }
  const all = new THREE.Box3()
  raw.forEach((r) => all.union(r.box))
  const empty = all.isEmpty()
  const center = empty ? new THREE.Vector3() : all.getCenter(new THREE.Vector3())

  const parts: BuiltPart[] = raw.map((r) => {
    const local = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z).multiply(r.matrix)
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3()
    local.decompose(position, quaternion, scale)
    // inflation is specified in mm; the mesh's local units are scaled by the (uniform) node scale
    const inflateMM = INFLATE_MM[r.spec.name] ?? 0
    const inflate = inflateMM / Math.max(1e-6, scale.x)
    const out = r.box.getCenter(new THREE.Vector3()).sub(center)
    if (out.lengthSq() < 1) out.set(0, 1, 0)
    out.normalize()
    const hi = { value: 0 }
    return { spec: r.spec, geometry: r.geometry, material: makeMaterial(r.spec.color, uniforms, r.spec.kind, inflate, hi), hi, inflateMM, position, quaternion, scale, out }
  })

  return {
    parts,
    halfHeight: empty ? 1 : (all.max.y - all.min.y) / 2,
    radiusXZ: spinRadius(raw, center),
    minY: empty ? -1 : all.min.y - center.y,
    maxY: empty ? 1 : all.max.y - center.y,
    uniforms,
    dispose: () => parts.forEach((p) => { p.geometry.dispose(); p.material.dispose() }),
  }
}

/** Max horizontal distance of any vertex from the vertical spin axis (subsampled for speed). */
function spinRadius(raw: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[], center: THREE.Vector3): number {
  let r = 0
  const v = new THREE.Vector3()
  for (const { geometry, matrix } of raw) {
    const pos = geometry.getAttribute('position')
    const step = Math.max(1, Math.floor(pos.count / 4000))
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix)
      r = Math.max(r, Math.hypot(v.x - center.x, v.z - center.z))
    }
  }
  return r > 0 ? r * 1.02 : 1
}

// ---------------------------------------------------------------- scene
const Studio = memo(function Studio() {
  return (
    <Environment resolution={256} frames={1}>
      <Lightformer form="rect" intensity={2.6} color="#fff6f0" position={[0, 6, 3]} scale={[12, 3, 1]} />
      <Lightformer form="rect" intensity={1.5} color="#8be7ff" position={[7, 1, 2]} scale={[3, 9, 1]} />
      <Lightformer form="rect" intensity={2.2} color="#ff5d6c" position={[-7, 2, -3]} scale={[3, 9, 1]} />
      <Lightformer form="ring" intensity={2.4} color="#ffffff" position={[1.5, 1.5, 8]} scale={2.6} />
      <Lightformer form="rect" intensity={0.5} color="#2a3a52" position={[0, -6, 0]} scale={[14, 14, 1]} />
    </Environment>
  )
})

function Framing({ built }: { built: Built }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height)
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    // Fit the heart at every turntable angle: its height vertically, its spin radius horizontally.
    const dV = built.halfHeight / tanV + built.radiusXZ * 0.55
    const dH = built.radiusXZ / (tanV * aspect) + built.radiusXZ * 0.55
    const d = Math.max(dV, dH) * 1.04
    const elev = THREE.MathUtils.degToRad(9)
    camera.position.set(0, Math.sin(elev) * d, Math.cos(elev) * d)
    camera.near = Math.max(1, d - built.radiusXZ * 2.5)
    camera.far = d + built.radiusXZ * 2.5
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera, size.width, size.height, built])
  return null
}

const INTRO_S = 1.5
const INTRO_STAGGER = 0.07
const INTRO_MM = 34
const SCAN_PERIOD = 7.5 // s: one top-to-bottom sweep, then a pause
const SCAN_SWEEP = 3.4
/** Peak shrink of the whole heart in systole (and a smaller atrial "kick" just before it). */
const SYSTOLE_SHRINK = 0.03
const ATRIAL_SHRINK = 0.011

function HeartModel(props: HeroHeartProps) {
  const { url, parts, bpm, reducedMotion, spin, beatTarget, onReady, onPick, picked } = props
  const gltf = useGLTF(url, false) as unknown as { scene: THREE.Group }
  const built = useMemo(() => buildParts(gltf.scene, parts), [gltf, parts])
  useEffect(() => () => built.dispose(), [built])
  useEffect(() => { onReady?.() }, [built, onReady])

  const turntable = useRef<THREE.Group>(null)
  const meshes = useRef<(THREE.Mesh | null)[]>([])
  const introStart = useRef<number | null>(null)
  const invalidate = useThree((s) => s.invalidate)
  // drei <Bvh> (a child, so its effect runs first) swaps in BVH-accelerated raycasting. On top of it,
  // bias hit distances by each structure's render inflation so picking names what is actually drawn
  // where neighbouring surfaces nearly coincide.
  useEffect(() => {
    const restore: (() => void)[] = []
    meshes.current.forEach((m, i) => {
      const part = built.parts[i]
      if (!m || !part) return
      const inner = m.raycast
      const bias = part.inflateMM * 1.5
      const wrapped = function (this: THREE.Mesh, rc: THREE.Raycaster, hits: THREE.Intersection[]) {
        const n0 = hits.length
        inner.call(this, rc, hits)
        for (let k = n0; k < hits.length; k++) hits[k].distance -= bias
      }
      m.raycast = wrapped
      restore.push(() => { if (m.raycast === wrapped) m.raycast = inner })
    })
    return () => restore.forEach((f) => f())
  }, [built])

  // On-demand mode (reduced motion) needs a frame whenever the highlighted structure changes.
  useEffect(() => { invalidate() }, [picked, invalidate])

  // Positions are owned here (not by props) so re-renders never undo the intro animation.
  const skipIntro = reducedMotion
  useLayoutEffect(() => {
    built.parts.forEach((p, i) => {
      const m = meshes.current[i]
      if (!m) return
      m.position.copy(p.position)
      if (!skipIntro && introStart.current !== -1) m.position.addScaledVector(p.out, INTRO_MM)
    })
    if (skipIntro) introStart.current = -1
  }, [built, skipIntro])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    const sp = spin.current
    if (sp && !sp.dragging) {
      // slow down while a structure is being looked at, so its label stays put
      const target = reducedMotion ? 0 : picked ? AUTO_SPIN * 0.15 : AUTO_SPIN
      sp.vel += (target - sp.vel) * (1 - Math.exp(-dt * 1.2))
      sp.angle += sp.vel * dt
    }
    const tt = turntable.current
    if (tt && sp) tt.rotation.y = sp.angle

    // Intro: the AI-segmented structures glide in from a slightly exploded layout, one after another.
    if (!skipIntro && introStart.current !== -1) {
      const now = performance.now() / 1000
      if (introStart.current === null) introStart.current = now
      const el = now - introStart.current
      if (el < INTRO_S + INTRO_STAGGER * built.parts.length) {
        built.parts.forEach((p, i) => {
          const m = meshes.current[i]
          if (!m) return
          const k = Math.min(1, Math.max(0, (el - i * INTRO_STAGGER) / INTRO_S))
          const e = 1 - Math.pow(1 - k, 3)
          m.position.copy(p.position).addScaledVector(p.out, (1 - e) * INTRO_MM)
        })
      } else {
        built.parts.forEach((p, i) => meshes.current[i]?.position.copy(p.position))
        introStart.current = -1
      }
    }

    const t = beatClock()
    // One uniform scale for the whole heart: chambers share walls, so moving them independently
    // would make neighbouring surfaces cut through each other.
    if (tt && bpm && bpm > 20 && !reducedMotion) {
      const m = mechanics(t, 60 / bpm)
      tt.scale.setScalar(1 - SYSTOLE_SHRINK * m.ventricles - ATRIAL_SHRINK * m.atria)
      beatTarget?.current?.style.setProperty('--ovw-beat', m.ventricles.toFixed(3))
    } else if (tt) {
      tt.scale.setScalar(1)
    }

    // Ease the hover highlight in and out (instant with reduced motion).
    const hk = reducedMotion ? 1 : 1 - Math.exp(-dt * 10)
    built.parts.forEach((p) => {
      const target = picked === p.spec.name ? 1 : 0
      p.hi.value += (target - p.hi.value) * hk
    })

    // CT "scan line" sweeping down through the heart now and then.
    const u = built.uniforms
    if (!reducedMotion) {
      const ph = t % SCAN_PERIOD
      if (ph < SCAN_SWEEP) {
        const k = ph / SCAN_SWEEP
        const e = k * k * (3 - 2 * k)
        u.uScanY.value = THREE.MathUtils.lerp(built.maxY + 6, built.minY - 6, e)
        u.uScanAmp.value = 1.5 * Math.sin(Math.PI * k)
      } else u.uScanAmp.value = 0
    } else u.uScanAmp.value = 0
    // Reduced motion renders on demand: keep frames coming only while a drag (or its inertia) moves the heart.
    if (reducedMotion && sp && (sp.dragging || Math.abs(sp.vel) > 1e-3)) invalidate()
  })

  return (
    <>
      <Framing built={built} />
      <Bvh firstHitOnly strategy={0}>
      <group ref={turntable}>
        {built.parts.map((p, i) => (
          <mesh
            key={p.spec.name}
            ref={(m) => { meshes.current[i] = m }}
            geometry={p.geometry}
            material={p.material}
            quaternion={p.quaternion}
            scale={p.scale}
            onPointerOver={(e) => {
              e.stopPropagation()
              if (e.pointerType === 'mouse') onPick?.(p.spec.name, 'mouse')
            }}
            onPointerOut={(e) => {
              if (e.pointerType === 'mouse') onPick?.(null, 'mouse')
            }}
            onClick={(e) => {
              e.stopPropagation()
              const pt = 'pointerType' in e.nativeEvent ? (e.nativeEvent as PointerEvent).pointerType : 'mouse'
              if (pt !== 'mouse') onPick?.(p.spec.name, pt)
            }}
          />
        ))}
      </group>
      </Bvh>
    </>
  )
}

const GL = { antialias: true, alpha: true, powerPreference: 'high-performance' as const, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }

export default function HeroHeart(props: HeroHeartProps) {
  return (
    <Canvas
      className="ovw-canvas"
      dpr={[1, 2]}
      gl={GL}
      camera={{ fov: 30, near: 10, far: 4000, position: [0, 60, 520] }}
      frameloop={!props.running ? 'never' : props.reducedMotion ? 'demand' : 'always'}
      onCreated={({ gl, invalidate }) => {
        gl.setClearColor(0x000000, 0)
        if (props.invalidateRef) props.invalidateRef.current = () => invalidate()
      }}
    >
      <ambientLight intensity={0.14} />
      <directionalLight position={[260, 420, 380]} intensity={2.5} color="#fff1ea" />
      <directionalLight position={[-420, 160, -320]} intensity={2.1} color="#ff6070" />
      <directionalLight position={[420, -120, -160]} intensity={0.9} color="#5fd8ff" />
      <Studio />
      <HeartModel {...props} />
    </Canvas>
  )
}

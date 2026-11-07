/**
 * Cut-away: one clipping plane shared by every structure material, the real CT slice drawn on that
 * plane, and stencil "caps" that fill each cut solid structure with its own CT cross-section.
 *
 * Caps use the classic stencil trick (three.js webgl_clipping_stencil): for every cut structure we
 * draw its back faces (+1) and front faces (−1) into the stencil buffer with the clip plane applied,
 * then a quad on the plane where stencil ≠ 0, which is exactly the inside of the cut. The quad
 * samples the CT, so the 3D model and the real image meet at the cut.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { Manifest } from '../../lib/data'
import { bindCT, gridWorldBox, hexToSRGBVec, huToTex, makeCapMaterial, makeCTUniforms, makeSliceMaterial, windowToTex, type CTVolume } from './ct'
import { currentBox, makeHelper, pickState, type Structure } from './meshes'
import { WINDOWS, type ClipAxis } from './meta'
import { useAnat } from './state'

/** Shared clip context, read by the picker. */
export const clipCtx = {
  plane: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
  active: false,
  cameraRemoved: false,
  caps: false,
  slice: false,
  vol: null as CTVolume | null,
  volBox: new THREE.Box3(),
  /** Extra materials that must follow the clip (highlight shells). */
  extra: new Set<THREE.Material>(),
}

const AXIS_UNIT: Record<ClipAxis, THREE.Vector3> = {
  axial: new THREE.Vector3(0, 1, 0),
  coronal: new THREE.Vector3(0, 0, 1),
  sagittal: new THREE.Vector3(1, 0, 0),
}

/** Default kept half: inferior (axial), posterior (coronal), patient-right (sagittal). */
export function clipNormal(axis: ClipAxis, flip: boolean, out = new THREE.Vector3()) {
  return out.copy(AXIS_UNIT[axis]).multiplyScalar(flip ? 1 : -1)
}

function orientQuad(m: THREE.Object3D, axis: ClipAxis, pos: number, box: THREE.Box3, margin: number) {
  const c = box.getCenter(new THREE.Vector3())
  const s = box.getSize(new THREE.Vector3()).addScalar(margin * 2)
  if (axis === 'axial') {
    m.rotation.set(-Math.PI / 2, 0, 0)
    m.position.set(c.x, pos, c.z)
    m.scale.set(s.x, s.z, 1)
  } else if (axis === 'coronal') {
    m.rotation.set(0, 0, 0)
    m.position.set(c.x, c.y, pos)
    m.scale.set(s.x, s.y, 1)
  } else {
    m.rotation.set(0, Math.PI / 2, 0)
    m.position.set(pos, c.y, c.z)
    m.scale.set(s.z, s.y, 1)
  }
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const tmpP = new THREE.Vector3()
/** The slice is only "solid" (pickable) where the CT shows tissue. */
function sliceRaycast(this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
  const vol = clipCtx.vol
  if (!this.visible || !vol || !clipCtx.slice) return
  const p = raycaster.ray.intersectPlane(clipCtx.plane, tmpP)
  if (!p || !clipCtx.volBox.containsPoint(p)) return
  const hu = vol.huAt(p)
  if (hu === null) return
  const w = WINDOWS[useAnat.getState().clip.window]
  if (smooth(w.alphaHU[0], w.alphaHU[1], hu) < 0.5) return
  intersects.push({ distance: raycaster.ray.origin.distanceTo(p), point: p.clone(), object: this } as THREE.Intersection)
}
const noRaycast = () => {}
const TREES = ['lung_arteries', 'lung_veins', 'lung_airways']

interface Cap { s: Structure; back: THREE.Mesh; front: THREE.Mesh; quad: THREE.Mesh; mat: THREE.ShaderMaterial }

export function ClipView({ structures, manifest, vol }: { structures: Structure[]; manifest: Manifest; vol: CTVolume | null }) {
  const enabled = useAnat((s) => s.clip.enabled)
  const camera = useThree((s) => s.camera)
  const ctU = useMemo(() => makeCTUniforms(), [])
  const volBox = useMemo(() => gridWorldBox(manifest.render, manifest.worldCenterLPS), [manifest])
  const planeGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
  const sliceMat = useMemo(() => makeSliceMaterial(ctU), [ctU])
  const slice = useMemo(() => {
    const m = new THREE.Mesh(planeGeo, sliceMat)
    m.raycast = sliceRaycast
    m.userData.slicePlane = true
    m.frustumCulled = false
    m.visible = false
    return m
  }, [planeGeo, sliceMat])

  const caps = useMemo<Cap[]>(() => {
    const common = {
      colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true,
      stencilFunc: THREE.AlwaysStencilFunc, clippingPlanes: [clipCtx.plane],
    }
    const back = new THREE.MeshBasicMaterial({
      ...common, side: THREE.BackSide,
      stencilFail: THREE.IncrementWrapStencilOp, stencilZFail: THREE.IncrementWrapStencilOp, stencilZPass: THREE.IncrementWrapStencilOp,
    })
    const front = new THREE.MeshBasicMaterial({
      ...common, side: THREE.FrontSide,
      stencilFail: THREE.DecrementWrapStencilOp, stencilZFail: THREE.DecrementWrapStencilOp, stencilZPass: THREE.DecrementWrapStencilOp,
    })
    return structures.map((s, i) => {
      const mat = makeCapMaterial(ctU, hexToSRGBVec(s.node.color))
      const quad = new THREE.Mesh(planeGeo, mat)
      quad.raycast = noRaycast
      quad.renderOrder = 102 + 3 * i
      quad.visible = false
      quad.frustumCulled = false
      return { s, back: makeHelper(s, back, 100 + 3 * i), front: makeHelper(s, front, 101 + 3 * i), quad, mat }
    })
  }, [structures, ctU, planeGeo])

  useEffect(() => {
    for (const c of caps) c.s.mesh.add(c.back, c.front)
    return () => {
      for (const c of caps) {
        c.back.removeFromParent()
        c.front.removeFromParent()
        c.mat.dispose()
      }
      ;(caps[0]?.back.material as THREE.Material | undefined)?.dispose()
      ;(caps[0]?.front.material as THREE.Material | undefined)?.dispose()
    }
  }, [caps])
  useEffect(() => () => { sliceMat.dispose(); planeGeo.dispose() }, [sliceMat, planeGeo])

  useEffect(() => {
    bindCT(ctU, vol)
    clipCtx.vol = vol
  }, [vol, ctU])
  useEffect(() => { clipCtx.volBox.copy(volBox) }, [volBox])

  // Turn clipping on/off for every material (changes the shader variant, so only on toggle).
  useEffect(() => {
    const planes = enabled ? [clipCtx.plane] : []
    const mats: THREE.Material[] = [...clipCtx.extra]
    for (const s of structures) mats.push(s.organ, s.xray)
    for (const m of mats) {
      m.clippingPlanes = planes
      m.needsUpdate = true
    }
    clipCtx.active = enabled
    pickState.plane = enabled ? clipCtx.plane : null
    return () => {
      clipCtx.active = false
      pickState.plane = null
    }
  }, [enabled, structures])

  const state = useMemo(() => ({ pos: 0, axis: 'axial' as ClipAxis, n: new THREE.Vector3(), box: new THREE.Box3(), dir: 1 }), [])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    let st = useAnat.getState()
    if (st.sweep && enabled && st.bounds) {
      // Glide the cut back and forth through the body.
      const ai = st.clip.axis === 'axial' ? 1 : st.clip.axis === 'coronal' ? 2 : 0
      const lo = st.bounds.min[ai] + 4, hi = st.bounds.max[ai] - 4
      let p = st.clip.pos[st.clip.axis] + state.dir * 38 * dt
      if (p > hi) { p = hi; state.dir = -1 }
      if (p < lo) { p = lo; state.dir = 1 }
      st.setClipPos(p)
      st = useAnat.getState()
    }
    const c = st.clip
    const target = c.pos[c.axis]
    if (state.axis !== c.axis) { state.axis = c.axis; state.pos = target }
    state.pos += (target - state.pos) * (1 - Math.exp(-dt * 16))
    if (Math.abs(target - state.pos) < 0.01) state.pos = target
    const n = clipNormal(c.axis, c.flip, state.n)
    clipCtx.plane.normal.copy(n)
    clipCtx.plane.constant = -n.dot(AXIS_UNIT[c.axis]) * state.pos
    clipCtx.cameraRemoved = clipCtx.plane.distanceToPoint(camera.position) < 0

    const w = WINDOWS[c.window]
    const [lo, hi] = windowToTex(w.center, w.width)
    ctU.uWin.value.set(lo, hi)
    ctU.uSmooth.value = w.smooth
    const tap = 0.9
    if (c.axis === 'axial') { ctU.uTapU.value.set(tap, 0, 0); ctU.uTapV.value.set(0, 0, tap) }
    else if (c.axis === 'coronal') { ctU.uTapU.value.set(tap, 0, 0); ctU.uTapV.value.set(0, tap, 0) }
    else { ctU.uTapU.value.set(0, 0, tap); ctU.uTapV.value.set(0, tap, 0) }

    const sliceOn = enabled && c.slice === 'full' && !!vol
    clipCtx.slice = sliceOn
    slice.visible = sliceOn
    if (sliceOn) {
      orientQuad(slice, c.axis, state.pos, volBox, 0)
      ;(sliceMat.uniforms.uAlpha.value as THREE.Vector2).set(huToTex(w.alphaHU[0]), huToTex(w.alphaHU[1]))
      // Draw the slice after everything behind it (camera on the cut side) or before (camera on the kept side).
      slice.renderOrder = clipCtx.cameraRemoved ? 60 : -60
    }

    const capsOn = enabled && st.mode === 'solid'
    clipCtx.caps = capsOn
    const hov = st.hover
    for (const cap of caps) {
      const s = cap.s
      // The dense lung trees are already visible in the full CT slice; skip their (costly) stencil passes there.
      const skip = c.slice === 'full' && TREES.includes(s.name)
      let on = capsOn && !skip && s.mesh.visible && s.anim.opacity >= 0.6
      if (on) {
        currentBox(s, state.box)
        on = clipCtx.plane.intersectsBox(state.box)
      }
      cap.back.visible = on
      cap.front.visible = on
      cap.quad.visible = on
      if (!on) continue
      orientQuad(cap.quad, c.axis, state.pos, state.box, 2)
      const u = cap.mat.uniforms
      ;(u.uOffset.value as THREE.Vector3).copy(s.offset)
      u.uFlat.value = c.slice === 'off' || !vol ? 1 : 0
      const hovered = hov?.kind === 'structure' && hov.name === s.name
      u.uTintAmt.value = c.tint ? (hovered ? 0.9 : 0.55) : hovered ? 0.35 : 0
    }
  })

  return (
    <>
      <primitive object={slice} />
      {caps.map((c) => <primitive key={c.s.name} object={c.quad} />)}
    </>
  )
}

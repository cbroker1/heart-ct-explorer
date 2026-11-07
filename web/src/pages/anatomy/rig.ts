/** Imperative bridge between the DOM UI and the R3F scene: camera moves, fitting, screenshots. */
import * as THREE from 'three'
import type { CameraControls } from '@react-three/drei'
import { EXTRA_DIRS, HEART_PARTS, VIEWS, type CameraView } from './meta'
import { currentBox, type Structure } from './meshes'
import { useAnat } from './state'

export const rig = {
  controls: null as CameraControls | null,
  camera: null as THREE.PerspectiveCamera | null,
  gl: null as THREE.WebGLRenderer | null,
  scene: null as THREE.Scene | null,
  structures: [] as Structure[],
  reducedMotion: typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  /** performance.now() of the last programmatic camera move (auto-rotate waits for it). */
  lastFly: 0,
}

export function viewDir(view: CameraView): THREE.Vector3 {
  const v = VIEWS.find((x) => x.key === view)?.dir ?? EXTRA_DIRS[view] ?? EXTRA_DIRS.home
  return new THREE.Vector3(...v).normalize()
}

const tmpBox = new THREE.Box3()
/** Union of the current (exploded) boxes of the structures that pass `filter`. */
export function unionBox(filter: (s: Structure) => boolean): THREE.Box3 {
  const box = new THREE.Box3()
  for (const s of rig.structures) if (filter(s)) box.union(currentBox(s, tmpBox))
  return box
}

/** What a "fit the view" should frame: everything visible (all structures if nothing is). */
export function framedStructures(): Structure[] {
  const st = useAnat.getState()
  const shown = rig.structures.filter((s) => st.visible[s.name])
  return shown.length ? shown : rig.structures
}

function basis(dir: THREE.Vector3) {
  const fwd = dir.clone().normalize()
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd)
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
  right.normalize()
  const up = new THREE.Vector3().crossVectors(fwd, right).normalize()
  return { fwd, right, up }
}

/**
 * Exact framing from sampled surface points (box corners over-estimate badly in oblique views).
 * Returns the look-at target (centred on the silhouette) and the camera distance.
 */
export function fitStructures(list: Structure[], dir: THREE.Vector3, cam: THREE.PerspectiveCamera, pad = 1.05) {
  const { fwd, right, up } = basis(dir)
  const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
  const tanH = tanV * Math.max(cam.aspect, 0.2)
  const pts: number[] = []
  // Frame the layout the scene is heading to (the explode slider animates toward its value).
  const e = useAnat.getState().explode
  for (const s of list) {
    const a = s.geometry.getAttribute('position').array as Float32Array
    const n = a.length / 3
    const step = Math.max(1, Math.floor(n / 1200))
    const ox = s.centroid.x + s.explodeDir.x * e, oy = s.centroid.y + s.explodeDir.y * e, oz = s.centroid.z + s.explodeDir.z * e
    for (let i = 0; i < n; i += step) pts.push(a[3 * i] + ox, a[3 * i + 1] + oy, a[3 * i + 2] + oz)
  }
  if (!pts.length) return null
  const c = new THREE.Vector3()
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i < pts.length; i += 3) {
    c.set(pts[i], pts[i + 1], pts[i + 2])
    const x = c.dot(right), y = c.dot(up), z = c.dot(fwd)
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
    if (z < z0) z0 = z
    if (z > z1) z1 = z
  }
  const target = new THREE.Vector3()
    .addScaledVector(right, (x0 + x1) / 2)
    .addScaledVector(up, (y0 + y1) / 2)
    .addScaledVector(fwd, (z0 + z1) / 2)
  let d = 0
  for (let i = 0; i < pts.length; i += 3) {
    c.set(pts[i], pts[i + 1], pts[i + 2]).sub(target)
    const depth = c.dot(fwd)
    d = Math.max(d, depth + Math.abs(c.dot(right)) / tanH, depth + Math.abs(c.dot(up)) / tanV)
  }
  return { target, distance: d * pad }
}

/** Fly the camera to frame `list`, looking along −dir (default: keep the current direction). */
export function flyTo(list: Structure[], dir?: THREE.Vector3, transition = true, pad = 1.05) {
  const { controls, camera } = rig
  if (!controls || !camera || !list.length) return
  const d = (dir ?? camera.position.clone().sub(controls.getTarget(new THREE.Vector3()))).normalize()
  const fit = fitStructures(list, d, camera, pad)
  if (!fit) return
  const p = fit.target.clone().addScaledVector(d, Math.max(fit.distance, 40))
  rig.lastFly = performance.now()
  void controls.setLookAt(p.x, p.y, p.z, fit.target.x, fit.target.y, fit.target.z, transition && !rig.reducedMotion)
}

/** Fly to one structure, keeping the current viewing direction. */
export function flyToStructure(s: Structure) {
  const big = s.node.group === 'lungs' || s.node.group === 'body'
  const narrow = (rig.camera?.aspect ?? 1.5) < 1
  flyTo([s], undefined, true, big ? 1.12 : narrow ? 2.6 : 2.0)
}

export function setView(view: CameraView, transition = true) {
  const dir = viewDir(view)
  if (view === 'heart') {
    flyTo(rig.structures.filter((s) => HEART_PARTS.includes(s.name)), dir, transition, 1.2)
    return
  }
  // A little air around the model for the overlays (preset chips on top, view buttons below).
  flyTo(framedStructures(), dir, transition, 1.12)
}

/** Download a PNG of the current 3D view (without the gizmo), on the page's dark background. */
export function captureScreenshot(filename = 'my-heart-ct-3d.png') {
  const { gl, scene, camera } = rig
  if (!gl || !scene || !camera) return
  gl.render(scene, camera)
  const src = gl.domElement
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d')
  if (!ctx) return
  const g = ctx.createRadialGradient(c.width * 0.5, c.height * 0.42, 0, c.width * 0.5, c.height * 0.5, Math.max(c.width, c.height) * 0.75)
  g.addColorStop(0, '#131c2b')
  g.addColorStop(1, '#06080c')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(src, 0, 0)
  const k = c.width / Math.max(1, src.clientWidth)
  ctx.font = `600 ${Math.round(12 * k)}px Inter, system-ui, sans-serif`
  ctx.fillStyle = 'rgba(231,237,245,0.55)'
  ctx.fillText('HEART//CT explorer · 3D anatomy from AI segmentation of my CT', 16 * k, c.height - 16 * k)
  c.toBlob((b) => {
    if (!b) return
    const url = URL.createObjectURL(b)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }, 'image/png')
}

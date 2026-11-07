/**
 * Turns the meshopt/quantized GLB into ready-to-render structures:
 *  - dequantizes positions and bakes the node transform (GLB vertices are already world mm),
 *  - recentres each geometry on its volume centroid (so transparent sorting and exploding work),
 *  - computes smooth normals and a BVH for fast hover picking,
 *  - creates the PBR + X-ray materials and the THREE.Mesh objects.
 */
import * as THREE from 'three'
import { MeshBVH, CENTER, acceleratedRaycast } from 'three-mesh-bvh'
import type { MeshNode } from '../../lib/data'
import { EXPLODE_SCALE } from './meta'
import { makeFresnelMaterial, makeOrganMaterial, xrayColor, type FresnelMaterial, type OrganMaterial } from './materials'

export interface Structure {
  i: number
  node: MeshNode
  name: string
  geometry: THREE.BufferGeometry
  /** Volume centroid in world mm (unexploded). */
  centroid: THREE.Vector3
  /** World-space bounds (unexploded). */
  box: THREE.Box3
  /** A surface point close to the centroid, local to the centroid (for floating labels). */
  anchor: THREE.Vector3
  /** Explode offset per unit of the explode slider. */
  explodeDir: THREE.Vector3
  color: THREE.Color
  mesh: THREE.Mesh
  organ: OrganMaterial
  xray: FresnelMaterial
  /** Animated state, updated every frame: fade (0..1 visibility), opacity (effective alpha), glow (highlight). */
  anim: { fade: number; opacity: number; glow: number }
  /** Current explode offset (world mm). */
  offset: THREE.Vector3
}

/** Shared picking state: the active clip plane (fragments on its negative side are invisible). */
export const pickState: { plane: THREE.Plane | null } = { plane: null }

const noRaycast = () => {}

/** BVH raycast that ignores hidden/faded structures and hits that fall in the clipped-away half. */
function pickRaycast(this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
  const s = this.userData.structure as Structure | undefined
  if (!s || !this.visible || s.anim.opacity < 0.03) return
  const plane = pickState.plane
  const prev = raycaster.firstHitOnly
  raycaster.firstHitOnly = !plane
  const hits: THREE.Intersection[] = []
  acceleratedRaycast.call(this, raycaster, hits)
  raycaster.firstHitOnly = prev
  let best: THREE.Intersection | null = null
  for (const h of hits) {
    if (plane && plane.distanceToPoint(h.point) < -0.05) continue
    if (!best || h.distance < best.distance) best = h
  }
  if (best) intersects.push(best)
}

const SMOOTH_ITERS: Record<string, number> = { heart: 3, vessels: 3, abdomen: 3, lungs: 3, body: 3, muscle: 2, airways: 2, bones: 1 }
const THIN = ['lung_arteries', 'lung_veins', 'lung_airways', 'costal_cartilages']

/** Average each vertex normal with its 1-ring a few times (shading only; positions are untouched). */
function smoothNormals(geo: THREE.BufferGeometry, iterations: number, override?: number) {
  const it = override ?? iterations
  const index = geo.getIndex()
  const attr = geo.getAttribute('normal') as THREE.BufferAttribute
  if (!index || !it) return
  const idx = index.array
  const n = attr.array as Float32Array
  const count = attr.count
  const acc = new Float32Array(count * 3)
  for (let k = 0; k < it; k++) {
    acc.fill(0)
    for (let t = 0; t < idx.length; t += 3) {
      const a = 3 * idx[t], b = 3 * idx[t + 1], c = 3 * idx[t + 2]
      const x = n[a] + n[b] + n[c], y = n[a + 1] + n[b + 1] + n[c + 1], z = n[a + 2] + n[b + 2] + n[c + 2]
      acc[a] += x; acc[a + 1] += y; acc[a + 2] += z
      acc[b] += x; acc[b + 1] += y; acc[b + 2] += z
      acc[c] += x; acc[c + 1] += y; acc[c + 2] += z
    }
    for (let v = 0; v < count * 3; v += 3) {
      const l = Math.hypot(acc[v], acc[v + 1], acc[v + 2]) || 1
      n[v] = acc[v] / l
      n[v + 1] = acc[v + 1] / l
      n[v + 2] = acc[v + 2] / l
    }
  }
  attr.needsUpdate = true
}

export function buildStructures(scene: THREE.Object3D, nodes: MeshNode[]): Structure[] {
  scene.updateMatrixWorld(true)
  const byName = new Map<string, THREE.Mesh>()
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) byName.set(m.name, m)
  })
  const out: Structure[] = []
  const v = new THREE.Vector3()
  for (const node of nodes) {
    const src = byName.get(node.name)
    if (!src) continue
    const sg = src.geometry
    const pos = sg.getAttribute('position')
    const n = pos.count
    const f = new Float32Array(n * 3)
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(src.matrixWorld)
      f[3 * k] = v.x
      f[3 * k + 1] = v.y
      f[3 * k + 2] = v.z
    }
    const srcIndex = sg.getIndex()
    const index = srcIndex ? (srcIndex.array as Uint16Array | Uint32Array).slice() : null

    // Volume centroid via signed tetrahedra (exact for closed meshes).
    let vol = 0
    let cx = 0, cy = 0, cz = 0
    const triCount = index ? index.length / 3 : n / 3
    for (let t = 0; t < triCount; t++) {
      const a = index ? index[3 * t] : 3 * t
      const b = index ? index[3 * t + 1] : 3 * t + 1
      const c = index ? index[3 * t + 2] : 3 * t + 2
      const ax = f[3 * a], ay = f[3 * a + 1], az = f[3 * a + 2]
      const bx = f[3 * b], by = f[3 * b + 1], bz = f[3 * b + 2]
      const qx = f[3 * c], qy = f[3 * c + 1], qz = f[3 * c + 2]
      const d = (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6
      vol += d
      cx += d * (ax + bx + qx) / 4
      cy += d * (ay + by + qy) / 4
      cz += d * (az + bz + qz) / 4
    }
    const box = new THREE.Box3()
    for (let k = 0; k < n; k++) box.expandByPoint(v.set(f[3 * k], f[3 * k + 1], f[3 * k + 2]))
    const centroid = Math.abs(vol) > 1e-3 ? new THREE.Vector3(cx / vol, cy / vol, cz / vol) : box.getCenter(new THREE.Vector3())
    if (!box.containsPoint(centroid)) box.getCenter(centroid)

    // Recentre + nearest vertex to the centroid as the label anchor.
    let best = Infinity
    const anchor = new THREE.Vector3()
    for (let k = 0; k < n; k++) {
      f[3 * k] -= centroid.x
      f[3 * k + 1] -= centroid.y
      f[3 * k + 2] -= centroid.z
      const d2 = f[3 * k] ** 2 + f[3 * k + 1] ** 2 + f[3 * k + 2] ** 2
      if (d2 < best) { best = d2; anchor.set(f[3 * k], f[3 * k + 1], f[3 * k + 2]) }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(f, 3))
    if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1))
    geometry.computeVertexNormals()
    // Soften the 0.75 mm slice "terraces" of the marching-cubes surfaces in the shading only.
    smoothNormals(geometry, SMOOTH_ITERS[node.group] ?? 1, THIN.includes(node.name) ? 1 : undefined)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    geometry.boundsTree = new MeshBVH(geometry, { strategy: CENTER, maxLeafTris: 12 })

    const color = new THREE.Color(node.color)
    const organ = makeOrganMaterial(node, color)
    const xc = xrayColor(node, color)
    const xray = makeFresnelMaterial(xc.color, { gain: xc.gain, pow: 2.6, base: 0 })

    const mesh = new THREE.Mesh(geometry, organ)
    mesh.name = node.name
    mesh.position.copy(centroid)
    mesh.raycast = pickRaycast

    const explodeDir = centroid.clone().multiplyScalar(EXPLODE_SCALE[node.group] ?? 1)
    const s: Structure = {
      i: out.length, node, name: node.name, geometry, centroid, box, anchor, explodeDir, color, mesh, organ, xray,
      anim: { fade: 0, opacity: 0, glow: 0 }, offset: new THREE.Vector3(),
    }
    mesh.userData.structure = s
    out.push(s)
  }
  return out
}

/**
 * A helper mesh (stencil pass, highlight shell…) that shares a structure's geometry and never picks.
 * Attach it with s.mesh.add() inside an effect (and remove it in the cleanup).
 */
export function makeHelper(s: Structure, material: THREE.Material, renderOrder: number): THREE.Mesh {
  const m = new THREE.Mesh(s.geometry, material)
  m.raycast = noRaycast
  m.renderOrder = renderOrder
  m.visible = false
  return m
}

/** Free GPU resources. CPU data (and the BVH) stay, so a remount simply re-uploads. */
export function disposeStructures(list: Structure[]) {
  for (const s of list) {
    s.geometry.dispose()
    s.organ.dispose()
    s.xray.dispose()
  }
}

const built = new WeakMap<object, Structure[]>()
/** buildStructures, memoised per GLTF scene (React may call memo factories twice in dev). */
export function getStructures(scene: THREE.Object3D, nodes: MeshNode[]): Structure[] {
  let list = built.get(scene)
  if (!list) {
    list = buildStructures(scene, nodes)
    built.set(scene, list)
  }
  for (const s of list) {
    s.anim.fade = 0
    s.anim.opacity = 0
    s.anim.glow = 0
    s.offset.set(0, 0, 0)
  }
  return list
}

/** World-space box of a structure including its current explode offset. */
export function currentBox(s: Structure, target = new THREE.Box3()) {
  return target.copy(s.box).translate(s.offset)
}

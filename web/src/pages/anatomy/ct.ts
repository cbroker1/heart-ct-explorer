/**
 * The real CT on the cut plane.
 * manifest.render (256×256×183 uint8, HU −1024..1976 → 0..255) is uploaded as a 3D texture;
 * manifest.heartRender (sharper, heart only) is blended in where it exists. A matrix maps three.js
 * world mm → LPS (coords.ts) → continuous voxel index (grid affine) → texture coordinates.
 */
import * as THREE from 'three'
import { useEffect, useState } from 'react'
import { loadGrid, type GridMeta, type Manifest, type Vec3 } from '../../lib/data'
import { lpsToIndex, worldToLps } from '../../lib/coords'

type U8Grid = GridMeta & { huMin: number; huMax: number }

/** world (three.js mm) → normalized texture coordinates of a grid. Handles a general direction matrix. */
export function worldToTexMatrix(g: GridMeta, center: Vec3): THREE.Matrix4 {
  // world → LPS (inverse of lpsToWorld): L = x + cL, P = −z + cP, S = y + cS
  const w2l = new THREE.Matrix4().set(1, 0, 0, center[0], 0, 0, -1, center[1], 0, 1, 0, center[2], 0, 0, 0, 1)
  const d = g.direction
  // LPS → index: S⁻¹ · Dᵀ · (p − origin)
  const dt = new THREE.Matrix4().set(d[0], d[3], d[6], 0, d[1], d[4], d[7], 0, d[2], d[5], d[8], 0, 0, 0, 0, 1)
  const t = new THREE.Matrix4().makeTranslation(-g.origin[0], -g.origin[1], -g.origin[2])
  const s = new THREE.Matrix4().makeScale(1 / g.spacing[0], 1 / g.spacing[1], 1 / g.spacing[2])
  // index → texture: (ijk + 0.5) / dims
  const u = new THREE.Matrix4().makeScale(1 / g.dims[0], 1 / g.dims[1], 1 / g.dims[2]).multiply(new THREE.Matrix4().makeTranslation(0.5, 0.5, 0.5))
  return u.multiply(s).multiply(dt).multiply(t).multiply(w2l)
}

/** World-space axis-aligned bounds of a grid (voxel centres ± half a voxel). */
export function gridWorldBox(g: GridMeta, center: Vec3): THREE.Box3 {
  const inv = worldToTexMatrix(g, center).invert()
  const box = new THREE.Box3()
  const p = new THREE.Vector3()
  for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) box.expandByPoint(p.set(a, b, c).applyMatrix4(inv))
  return box
}

function makeTexture(data: Uint8Array, g: GridMeta, filter: THREE.MagnificationTextureFilter) {
  const tex = new THREE.Data3DTexture(data, g.dims[0], g.dims[1], g.dims[2])
  tex.format = THREE.RedFormat
  tex.type = THREE.UnsignedByteType
  tex.minFilter = filter
  tex.magFilter = filter
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}

export interface CTVolume {
  meta: U8Grid
  data: Uint8Array
  tex: THREE.Data3DTexture
  w2t: THREE.Matrix4
  heart: { meta: U8Grid; data: Uint8Array; tex: THREE.Data3DTexture; w2t: THREE.Matrix4; sizeMM: THREE.Vector3 } | null
  labels: { meta: GridMeta; data: Uint8Array; names: Map<number, string> } | null
  center: Vec3
  /** HU at a world point (trilinear, heart volume where available). null outside the scan. */
  huAt: (w: THREE.Vector3) => number | null
  /** Anatomy label name at a world point (nearest voxel). */
  labelAt: (w: THREE.Vector3) => string | null
  dispose: () => void
}

function trilinear(g: GridMeta, data: Uint8Array, ijk: Vec3): number | null {
  const [nx, ny, nz] = g.dims
  const x = Math.min(Math.max(ijk[0], 0), nx - 1), y = Math.min(Math.max(ijk[1], 0), ny - 1), z = Math.min(Math.max(ijk[2], 0), nz - 1)
  if (ijk[0] < -0.5 || ijk[1] < -0.5 || ijk[2] < -0.5 || ijk[0] > nx - 0.5 || ijk[1] > ny - 0.5 || ijk[2] > nz - 0.5) return null
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z)
  const x1 = Math.min(x0 + 1, nx - 1), y1 = Math.min(y0 + 1, ny - 1), z1 = Math.min(z0 + 1, nz - 1)
  const fx = x - x0, fy = y - y0, fz = z - z0
  const at = (i: number, j: number, k: number) => data[i + nx * (j + ny * k)]
  const c00 = at(x0, y0, z0) * (1 - fx) + at(x1, y0, z0) * fx
  const c10 = at(x0, y1, z0) * (1 - fx) + at(x1, y1, z0) * fx
  const c01 = at(x0, y0, z1) * (1 - fx) + at(x1, y0, z1) * fx
  const c11 = at(x0, y1, z1) * (1 - fx) + at(x1, y1, z1) * fx
  return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz
}

const u8ToHU = (g: U8Grid, v: number) => g.huMin + (v / 255) * (g.huMax - g.huMin)

export function useCTVolume(manifest: Manifest, wanted: boolean) {
  const [state, setState] = useState<{ vol: CTVolume | null; loaded: number; total: number; error: string | null; loading: boolean }>({
    vol: null, loaded: 0, total: 0, error: null, loading: false,
  })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!wanted || state.vol || state.loading) return
    let cancelled = false
    const render = manifest.render
    const heart = manifest.heartRender
    const labels = manifest.renderLabels
    const parts = [render, heart, labels].filter(Boolean) as GridMeta[]
    const total = parts.reduce((a, p) => a + p.bytes, 0)
    const loadedBy = new Map<string, number>()
    const progress = () => {
      if (cancelled) return
      let l = 0
      loadedBy.forEach((v) => (l += v))
      setState((s) => ({ ...s, loaded: l, total }))
    }
    setState((s) => ({ ...s, loading: true, total, loaded: 0, error: null }))
    const load = (g: GridMeta) => loadGrid(g, (l) => { loadedBy.set(g.file, l); progress() }) as Promise<Uint8Array>
    Promise.all([load(render), heart ? load(heart).catch(() => null) : Promise.resolve(null), labels ? load(labels).catch(() => null) : Promise.resolve(null)])
      .then(([rd, hd, ld]) => {
        if (cancelled) return
        const center = manifest.worldCenterLPS
        const tex = makeTexture(rd, render, THREE.LinearFilter)
        const w2t = worldToTexMatrix(render, center)
        let heartVol: CTVolume['heart'] = null
        if (heart && hd) {
          const hbox = gridWorldBox(heart, center)
          heartVol = { meta: heart, data: hd, tex: makeTexture(hd, heart, THREE.LinearFilter), w2t: worldToTexMatrix(heart, center), sizeMM: hbox.getSize(new THREE.Vector3()) }
        }
        const lab = labels && ld ? { meta: labels as GridMeta, data: ld, names: new Map(labels.classes.map((c) => [c.id, c.name])) } : null
        const lpsOf = (w: THREE.Vector3) => worldToLps([w.x, w.y, w.z], center)
        const vol: CTVolume = {
          meta: render, data: rd, tex, w2t, heart: heartVol, labels: lab, center,
          huAt: (w) => {
            const p = lpsOf(w)
            if (heartVol) {
              const ijk = lpsToIndex(heartVol.meta, p)
              const m = 2
              if (ijk.every((v, a) => v >= m && v <= heartVol.meta.dims[a] - 1 - m)) {
                const hv = trilinear(heartVol.meta, heartVol.data, ijk)
                if (hv !== null) return u8ToHU(heartVol.meta, hv)
              }
            }
            const v = trilinear(render, rd, lpsToIndex(render, p))
            return v === null ? null : u8ToHU(render, v)
          },
          labelAt: (w) => {
            if (!lab) return null
            const ijk = lpsToIndex(lab.meta, lpsOf(w)).map(Math.round) as Vec3
            if (ijk.some((v, a) => v < 0 || v >= lab.meta.dims[a])) return null
            const id = lab.data[ijk[0] + lab.meta.dims[0] * (ijk[1] + lab.meta.dims[1] * ijk[2])]
            return id ? lab.names.get(id) ?? null : null
          },
          dispose: () => { tex.dispose(); heartVol?.tex.dispose() },
        }
        setState({ vol, loaded: total, total, error: null, loading: false })
      })
      .catch((e) => { if (!cancelled) setState((s) => ({ ...s, loading: false, error: String(e?.message ?? e) })) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, manifest, attempt])
  useEffect(() => () => state.vol?.dispose(), [state.vol])
  return { ...state, retry: () => setAttempt((a) => a + 1) }
}

/** Plain-English tissue class for a HU value (non-contrast CT). */
export function tissueFor(hu: number): string {
  if (hu < -900) return 'air'
  if (hu < -500) return 'lung (air-filled)'
  if (hu < -200) return 'lung edge / partial volume'
  if (hu < -30) return 'fat'
  if (hu < 100) return 'soft tissue / blood'
  if (hu < 300) return 'dense tissue / cartilage'
  return 'bone or calcium'
}

// ------------------------------------------------------------------ GLSL
export const CT_UNIFORMS_GLSL = /* glsl */ `
uniform sampler3D uVol;
uniform mat4 uW2T;
uniform sampler3D uHeart;
uniform mat4 uW2H;
uniform vec3 uHeartMM;
uniform float uHasHeart;
uniform float uHasVol;
uniform vec2 uWin;
uniform vec3 uTapU;
uniform vec3 uTapV;
uniform float uSmooth;
float anaRaw(vec3 w) {
  vec3 t = (uW2T * vec4(w, 1.0)).xyz;
  float v = texture(uVol, clamp(t, 0.0, 1.0)).r;
  if (uHasHeart > 0.5) {
    vec3 th = (uW2H * vec4(w, 1.0)).xyz;
    vec3 e = min(th, 1.0 - th) * uHeartMM;
    float k = smoothstep(1.5, 9.0, min(min(e.x, e.y), e.z));
    if (k > 0.0) v = mix(v, texture(uHeart, clamp(th, 0.0, 1.0)).r, k);
  }
  return v;
}
float anaSampleCT(vec3 w, out float inside) {
  vec3 t = (uW2T * vec4(w, 1.0)).xyz;
  inside = step(0.0, t.x) * step(t.x, 1.0) * step(0.0, t.y) * step(t.y, 1.0) * step(0.0, t.z) * step(t.z, 1.0);
  float v = anaRaw(w);
  if (uSmooth > 0.0) {
    // light in-plane denoise (low-dose CT is grainy in a soft-tissue window)
    float n4 = anaRaw(w + uTapU) + anaRaw(w - uTapU) + anaRaw(w + uTapV) + anaRaw(w - uTapV);
    v = mix(v, (4.0 * v + n4) / 8.0, uSmooth);
  }
  return v;
}
float anaWindow(float v) { return clamp((v - uWin.x) / (uWin.y - uWin.x), 0.0, 1.0); }
float anaHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`

export interface CTUniforms {
  [k: string]: THREE.IUniform
  uVol: { value: THREE.Data3DTexture | null }
  uW2T: { value: THREE.Matrix4 }
  uHeart: { value: THREE.Data3DTexture | null }
  uW2H: { value: THREE.Matrix4 }
  uHeartMM: { value: THREE.Vector3 }
  uHasHeart: { value: number }
  uHasVol: { value: number }
  uWin: { value: THREE.Vector2 }
  uTapU: { value: THREE.Vector3 }
  uTapV: { value: THREE.Vector3 }
  uSmooth: { value: number }
}

export function makeCTUniforms(): CTUniforms {
  // A 1-voxel placeholder keeps the sampler valid before the real volume arrives.
  const ph = new THREE.Data3DTexture(new Uint8Array([0]), 1, 1, 1)
  ph.format = THREE.RedFormat
  ph.needsUpdate = true
  return {
    uVol: { value: ph }, uW2T: { value: new THREE.Matrix4() }, uHeart: { value: ph }, uW2H: { value: new THREE.Matrix4() },
    uHeartMM: { value: new THREE.Vector3(1, 1, 1) }, uHasHeart: { value: 0 }, uHasVol: { value: 0 }, uWin: { value: new THREE.Vector2(0.28, 0.42) },
    uTapU: { value: new THREE.Vector3(0.9, 0, 0) }, uTapV: { value: new THREE.Vector3(0, 0, 0.9) }, uSmooth: { value: 1 },
  }
}

export function bindCT(u: CTUniforms, vol: CTVolume | null) {
  if (!vol) { u.uHasVol.value = 0; u.uHasHeart.value = 0; return }
  u.uVol.value = vol.tex
  u.uW2T.value.copy(vol.w2t)
  u.uHasVol.value = 1
  if (vol.heart) {
    u.uHeart.value = vol.heart.tex
    u.uW2H.value.copy(vol.heart.w2t)
    u.uHeartMM.value.copy(vol.heart.sizeMM)
    u.uHasHeart.value = 1
  } else u.uHasHeart.value = 0
}

/** Window centre/width (HU) → [lo, hi] in normalized texture units. */
export function windowToTex(center: number, width: number, huMin = -1024, huMax = 1976): [number, number] {
  return [(center - width / 2 - huMin) / (huMax - huMin), (center + width / 2 - huMin) / (huMax - huMin)]
}
export const huToTex = (hu: number, huMin = -1024, huMax = 1976) => (hu - huMin) / (huMax - huMin)

const PLANE_VERT = /* glsl */ `
varying vec3 vAnaW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vAnaW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`

/** Full CT slice on the cut plane: tissue opaque, air/lung see-through, outside the scan discarded. */
export function makeSliceMaterial(ct: CTUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { ...ct, uAlpha: { value: new THREE.Vector2(0.09, 0.2) }, uOpacity: { value: 1 }, uEdge: { value: new THREE.Color('#38d6ff') } },
    vertexShader: PLANE_VERT,
    fragmentShader: /* glsl */ `
      ${CT_UNIFORMS_GLSL}
      uniform vec2 uAlpha;
      uniform float uOpacity;
      uniform vec3 uEdge;
      varying vec3 vAnaW;
      void main() {
        if (uHasVol < 0.5) discard;
        float inside;
        float v = anaSampleCT(vAnaW, inside);
        if (inside < 0.5) discard;
        float g = anaWindow(v) + (anaHash(gl_FragCoord.xy) - 0.5) / 255.0;
        float a = smoothstep(uAlpha.x, uAlpha.y, v);
        a = max(a, 0.07);
        // faint cyan frame where the scan ends
        vec3 t = (uW2T * vec4(vAnaW, 1.0)).xyz;
        vec3 e = min(t, 1.0 - t);
        float edge = 1.0 - smoothstep(0.0, 0.006, min(min(e.x, e.y), e.z));
        vec3 col = mix(vec3(g), uEdge, edge * 0.8);
        gl_FragColor = vec4(col, max(a, edge * 0.7) * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 4,
    toneMapped: false,
  })
}

/**
 * Cap material for one structure: drawn only where the stencil says "inside this structure's cut",
 * showing the CT (optionally tinted with the structure colour) or a flat colour.
 */
export function makeCapMaterial(ct: CTUniforms, tintSRGB: THREE.Vector3) {
  return new THREE.ShaderMaterial({
    uniforms: { ...ct, uTint: { value: tintSRGB }, uTintAmt: { value: 0.55 }, uFlat: { value: 0 }, uOffset: { value: new THREE.Vector3() } },
    vertexShader: PLANE_VERT,
    fragmentShader: /* glsl */ `
      ${CT_UNIFORMS_GLSL}
      uniform vec3 uTint;
      uniform float uTintAmt;
      uniform float uFlat;
      uniform vec3 uOffset;
      varying vec3 vAnaW;
      void main() {
        vec3 flatCol = uTint * 0.82;
        if (uHasVol < 0.5 || uFlat > 0.5) { gl_FragColor = vec4(flatCol, 1.0); return; }
        float inside;
        float v = anaSampleCT(vAnaW - uOffset, inside);
        float g = anaWindow(v) + (anaHash(gl_FragCoord.xy) - 0.5) / 255.0;
        vec3 ct = vec3(g);
        vec3 tinted = g * mix(vec3(1.0), uTint * 1.35, 0.8) + uTint * 0.07;
        vec3 col = mix(ct, tinted, uTintAmt);
        gl_FragColor = vec4(inside > 0.5 ? col : flatCol, 1.0);
      }`,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
}

export function hexToSRGBVec(hex: string) {
  const h = hex.replace('#', '')
  return new THREE.Vector3(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255)
}

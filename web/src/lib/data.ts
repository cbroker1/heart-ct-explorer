/**
 * Data contract between the Python pipeline (pipeline/05_web_assets.py) and the web app.
 * Everything lives under `public/data/`. Paths in the manifest are relative to that folder.
 *
 * Geometry convention (identical to DICOM): patient LPS millimetres.
 *   voxel (i,j,k) centre  ->  origin + D · (i*sx, j*sy, k*sz)
 *   D is `direction` (row-major 3x3) whose COLUMNS are the i, j, k axis directions in LPS.
 * Binary volumes are gzip-compressed little-endian arrays, i (x) fastest, then j, then k.
 */
export type Vec3 = [number, number, number]

export interface GridMeta {
  file: string
  bytes: number          // compressed size, for progress bars
  rawBytes: number
  dtype: 'int16' | 'uint8' | 'uint16'
  /** 16-bit data stored byte-shuffled: all low bytes, then all high bytes (better gzip). */
  shuffle?: boolean
  dims: Vec3
  spacing: Vec3
  origin: Vec3
  direction: number[]    // 9 numbers, row-major
}

export interface VolumeMeta extends GridMeta {
  key: string
  label: string           // short UI name, e.g. "Calcium score"
  description: string     // original DICOM series description
  blurb: string           // one-sentence plain-English explanation
  kernel: string
  sliceThickness: number
  kvp: number
  defaultWindow: [number, number]   // [center, width] in HU
  group: 'heart' | 'chest' | 'lung' | 'ai'
}

export interface LabelClass {
  id: number
  name: string            // machine name, e.g. "heart_ventricle_left"
  display: string         // "Left ventricle"
  color: string           // "#rrggbb"
  group: string           // "heart" | "vessels" | "lungs" | "airways" | "bones" | "abdomen" | "muscle" | "body"
  volumeML?: number
  source?: string         // which model produced it
}

export interface LabelGridMeta extends GridMeta {
  classes: LabelClass[]
}

export interface MeshNode {
  name: string            // matches LabelClass.name or lesion id ("lesion_3")
  display: string
  color: string
  group: string
  triangles: number
  volumeML?: number
  defaultVisible: boolean
  defaultOpacity: number
}

export interface Manifest {
  version: number
  generated: string
  title: string
  exam: Record<string, string | number | string[]>
  /** Heart centroid in LPS mm. The 3D scene origin; see coords.ts. */
  worldCenterLPS: Vec3
  volumes: VolumeMeta[]
  labels: LabelGridMeta             // anatomy labels, on the thin_lung grid
  lesions: LabelGridMeta | null     // calcium candidate lesion ids, on the calcium grid
  render: GridMeta & { huMin: number; huMax: number }      // uint8 volume for ray marching
  renderLabels: LabelGridMeta       // labels resampled onto the render grid
  heartRender: (GridMeta & { huMin: number; huMax: number }) | null   // high-res heart-only uint8 volume
  /** heartFile: small heart-only GLB (same world frame and node names) for light views */
  meshes: { file: string; bytes: number; heartFile?: string; heartBytes?: number; nodes: MeshNode[] }
  files: Record<string, string>     // misc json/png/stl, e.g. calcium: "calcium.json"
}

const BASE = `${import.meta.env.BASE_URL}data/`
export const dataUrl = (rel: string) => BASE + rel

let manifestPromise: Promise<Manifest> | null = null
export function loadManifest(): Promise<Manifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(dataUrl('manifest.json')).then((r) => {
      if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`)
      return r.json() as Promise<Manifest>
    })
  }
  return manifestPromise
}

export async function loadJSON<T = unknown>(rel: string): Promise<T> {
  const r = await fetch(dataUrl(rel))
  if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`)
  return r.json() as Promise<T>
}

export type Progress = (loaded: number, total: number) => void

/** Fetch a file with byte-level progress. */
export async function fetchBytes(rel: string, expectedBytes = 0, onProgress?: Progress): Promise<Uint8Array> {
  const r = await fetch(dataUrl(rel))
  if (!r.ok || !r.body) throw new Error(`${rel}: HTTP ${r.status}`)
  const total = Number(r.headers.get('content-length')) || expectedBytes || 0
  const reader = r.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress?.(loaded, Math.max(total, loaded))
  }
  const out = new Uint8Array(loaded)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.byteLength }
  return out
}

/** gunzip using the browser's native DecompressionStream. */
export async function gunzip(bytes: Uint8Array): Promise<ArrayBuffer> {
  // Some static servers transparently decompress; detect the gzip magic number.
  if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return bytes.slice().buffer
  const ds = new DecompressionStream('gzip')
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds)
  return new Response(stream).arrayBuffer()
}

export type TypedVolume = Int16Array | Uint8Array | Uint16Array

/** Decoded grids, most-recently-used last. Bounded so phones don't run out of memory. */
const CACHE_LIMIT_BYTES = 320 * 1024 * 1024
const cache = new Map<string, { p: Promise<TypedVolume>; bytes: number }>()

function evictIfNeeded() {
  let total = 0
  for (const e of cache.values()) total += e.bytes
  for (const [k, e] of cache) {
    if (total <= CACHE_LIMIT_BYTES || cache.size <= 2) break
    cache.delete(k)
    total -= e.bytes
  }
}

/** Load (and cache) a binary grid described by GridMeta. */
export function loadGrid(meta: GridMeta, onProgress?: Progress): Promise<TypedVolume> {
  const key = meta.file
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)          // refresh LRU position
    cache.set(key, hit)
    return hit.p
  }
  const p = (async () => {
      const gz = await fetchBytes(meta.file, meta.bytes, onProgress)
      let buf = await gunzip(gz)
      if (meta.shuffle && meta.dtype !== 'uint8') buf = unshuffle16(buf)
      const n = meta.dims[0] * meta.dims[1] * meta.dims[2]
      const arr = meta.dtype === 'int16' ? new Int16Array(buf) : meta.dtype === 'uint16' ? new Uint16Array(buf) : new Uint8Array(buf)
      if (arr.length !== n) throw new Error(`${meta.file}: expected ${n} voxels, got ${arr.length}`)
      return arr
    })()
  cache.set(key, { p, bytes: meta.rawBytes || meta.bytes })
  p.catch(() => cache.delete(key))
  evictIfNeeded()
  return p
}

/** Undo the 2-byte shuffle: [lo0 lo1 ... hi0 hi1 ...] -> [lo0 hi0 lo1 hi1 ...]. */
function unshuffle16(buf: ArrayBuffer): ArrayBuffer {
  const src = new Uint8Array(buf)
  const n = src.length >> 1
  const out = new Uint8Array(src.length)
  for (let i = 0; i < n; i++) {
    out[2 * i] = src[i]
    out[2 * i + 1] = src[n + i]
  }
  return out.buffer
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

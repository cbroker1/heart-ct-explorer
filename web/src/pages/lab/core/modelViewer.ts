/** Lazy loader + minimal typings for the vendored <model-viewer> bundle (public/vendor). */

export interface MVMaterial {
  name: string
  pbrMetallicRoughness: {
    baseColorFactor: [number, number, number, number]
    setBaseColorFactor(rgba: [number, number, number, number] | string): void
  }
  setAlphaMode(mode: 'OPAQUE' | 'MASK' | 'BLEND'): void
  setEmissiveFactor?(rgb: [number, number, number] | string): void
}

export interface ModelViewerElement extends HTMLElement {
  src: string | null
  loaded: boolean
  autoRotate: boolean
  cameraOrbit: string
  cameraTarget: string
  fieldOfView: string
  canActivateAR: boolean
  model?: { materials: MVMaterial[] }
  getDimensions(): { x: number; y: number; z: number }
  getCameraOrbit(): { theta: number; phi: number; radius: number }
  jumpCameraToGoal(): void
  resetTurntableRotation?(theta?: number): void
  activateAR(): Promise<void>
}

export const MODEL_VIEWER_SRC = `${import.meta.env.BASE_URL}vendor/model-viewer-4.4.0.min.js`

let pending: Promise<void> | null = null

/** Inject the module script once; resolves when the custom element is defined. */
export function loadModelViewer(timeoutMs = 30000): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (customElements.get('model-viewer')) return Promise.resolve()
  if (pending) return pending
  pending = new Promise<void>((resolve, reject) => {
    // Another component may already have added the bundle: never define the element twice.
    const existing = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).find((s) =>
      s.src.includes('model-viewer'),
    )
    const script = existing ?? document.createElement('script')
    const fail = (msg: string) => {
      pending = null
      if (!existing) script.remove()
      reject(new Error(msg))
    }
    const timer = window.setTimeout(() => fail('The 3D viewer took too long to load.'), timeoutMs)
    script.addEventListener('error', () => {
      window.clearTimeout(timer)
      fail('Could not load the 3D viewer script.')
    })
    customElements.whenDefined('model-viewer').then(() => {
      window.clearTimeout(timer)
      resolve()
    })
    if (!existing) {
      script.type = 'module'
      script.src = MODEL_VIEWER_SRC
      script.dataset.labCore = 'model-viewer'
      document.head.appendChild(script)
    }
  })
  return pending
}

/** Orbit string that looks at a surface point from straight along its normal. */
export function orbitFacing(normal: [number, number, number], radius: string): string {
  const [x, y, z] = normal
  const theta = Math.atan2(x, z)
  const phi = Math.acos(Math.max(-1, Math.min(1, y)))
  // keep the camera a little above/below the equator so it never looks straight down the up-axis
  const clampedPhi = Math.min(Math.max(phi, 0.35), Math.PI - 0.35)
  return `${theta.toFixed(3)}rad ${clampedPhi.toFixed(3)}rad ${radius}`
}

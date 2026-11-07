/** Filament / resin looks for the print preview (kept out of StlPreview so three.js stays lazy). */
export interface Finish {
  key: string
  label: string
  color: string
  roughness: number
  metalness: number
  clearcoat?: number
  transmission?: number
  /** visible layer-line spacing (mm, exaggerated a little so it reads on screen) and strength */
  layer: number
  amp: number
}

export const FINISHES: Finish[] = [
  { key: 'pla-red', label: 'PLA · heart red', color: '#d9424f', roughness: 0.52, metalness: 0, clearcoat: 0.12, layer: 0.9, amp: 0.13 },
  { key: 'pla-bone', label: 'PLA · bone white', color: '#ece3d3', roughness: 0.6, metalness: 0, clearcoat: 0.08, layer: 0.9, amp: 0.1 },
  { key: 'silk-gold', label: 'Silk PLA · gold', color: '#d6a64a', roughness: 0.3, metalness: 0.45, clearcoat: 0.5, layer: 0.9, amp: 0.1 },
  { key: 'resin-grey', label: 'Resin · grey', color: '#8e959e', roughness: 0.34, metalness: 0.05, clearcoat: 0.35, layer: 0.5, amp: 0.035 },
]

export interface StlStats {
  triangles: number
  volumeCm3: number
  size: [number, number, number]
}

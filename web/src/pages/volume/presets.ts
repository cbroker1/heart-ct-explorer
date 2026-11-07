/**
 * Rendering presets. Transfer functions are defined in Hounsfield units (HU); the user's
 * "shift" and "width" sliders transform the control points about `pivot`.
 * Class/label styling is resolved at runtime from manifest.renderLabels.classes by NAME,
 * never by numeric id, so a re-run of the pipeline cannot silently mis-colour things.
 */
import type { LabelClass } from '../../lib/data'
import type { TFPoint } from './tf'

export type PresetKey = 'cinematic' | 'heart' | 'skeleton' | 'lungs' | 'anatomy' | 'xray' | 'mip'
export type Mode = 'tf' | 'label' | 'drr' | 'mip'
export type VolumeKey = 'chest' | 'heart'
export type ViewName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'hero' | 'heroHeart'

export interface Shading { ambient: number; diffuse: number; specular: number; shininess: number }

export interface SliderSpec { label: string; min: number; max: number; step: number; def: number; unit: string; hint: string }

export interface LegendItem {
  /** representative HU (TF presets: swatch follows the live transfer function) */
  hu?: number
  /** fixed css colour (label / grayscale presets) */
  color?: string
  label: string
  note?: string
}

export interface Preset {
  key: PresetKey
  name: string
  tagline: string
  blurb: string
  mode: Mode
  volume: VolumeKey
  tf?: TFPoint[]
  pivot: number
  grad: { lo: number; hi: number; mod: number }
  shading: Shading
  /** slider 1 & 2 meaning differs per mode (TF shift/width, DRR exposure/contrast, MIP level/width) */
  s1: SliderSpec
  s2: SliderSpec
  showOpacity: boolean
  usesLabels: boolean
  legend: LegendItem[]
  /** small CSS gradient for the preset picker */
  swatch: string
  view: ViewName
}

const TF_SHIFT: SliderSpec = { label: 'Shift', min: -300, max: 300, step: 5, def: 0, unit: 'HU', hint: 'Slides every colour/opacity ramp up or down the Hounsfield scale. Positive = only denser tissue shows.' }
const TF_WIDTH: SliderSpec = { label: 'Width', min: 0.4, max: 2.5, step: 0.05, def: 1, unit: '×', hint: 'Stretches (>1) or squeezes (<1) the ramps around their centre. Narrow = crisper, harder edges.' }

export const PRESETS: Preset[] = [
  {
    key: 'cinematic',
    name: 'Cinematic',
    tagline: 'Photo-real, see-through body wall',
    blurb:
      'Every voxel coloured by its density: warm translucent skin and fat, red-brown muscle and organs, ivory bone, air invisible. ' +
      'The AI body-wall label lets the chest wall fade so the heart, great vessels and lung vessels show through.',
    mode: 'tf',
    volume: 'chest',
    pivot: 0,
    tf: [
      { hu: -1024, color: '#000000', alpha: 0 },
      { hu: -600, color: '#5a1812', alpha: 0 },
      { hu: -420, color: '#86271d', alpha: 0.07 },
      { hu: -250, color: '#a8603f', alpha: 0.02 },
      { hu: -150, color: '#e8b97c', alpha: 0.035 },
      { hu: -60, color: '#efc48e', alpha: 0.05 },
      { hu: -10, color: '#8f2219', alpha: 0.25 },
      { hu: 60, color: '#b5392b', alpha: 0.5 },
      { hu: 120, color: '#c9785a', alpha: 0.6 },
      { hu: 200, color: '#e9dbc0', alpha: 0.85 },
      { hu: 450, color: '#fbf5e8', alpha: 1 },
      { hu: 1976, color: '#ffffff', alpha: 1 },
    ],
    grad: { lo: 15, hi: 140, mod: 0.62 },
    shading: { ambient: 0.32, diffuse: 0.85, specular: 0.28, shininess: 28 },
    s1: TF_SHIFT,
    s2: TF_WIDTH,
    showOpacity: true,
    usesLabels: true,
    legend: [
      { hu: -100, label: 'Skin & fat', note: '−190 to −30 HU' },
      { hu: 50, label: 'Muscle, heart & blood', note: '0 to 100 HU' },
      { hu: 400, label: 'Bone', note: '> 200 HU' },
      { color: 'transparent', label: 'Air & lung (invisible)', note: '< −500 HU' },
    ],
    swatch: 'linear-gradient(135deg,#2a0d0a 0%,#a33a2a 38%,#e9c08a 62%,#fbf5e8 100%)',
    view: 'hero',
  },
  {
    key: 'heart',
    name: 'Heart close-up',
    tagline: 'Heart-only scan, 0.6 mm detail',
    blurb:
      'The dedicated ECG-gated heart scan (the calcium-score series), cut out with the AI heart label. Golden = epicardial fat, ' +
      'the natural fat wrapping the heart, where the coronary arteries run. Deep red = heart muscle and blood (on a scan without contrast dye they have the same density). ' +
      'White would be calcium (≥ 130 HU).',
    mode: 'tf',
    volume: 'heart',
    pivot: -60,
    tf: [
      { hu: -1024, color: '#000000', alpha: 0 },
      { hu: -300, color: '#ffe08a', alpha: 0 },
      { hu: -180, color: '#ffd768', alpha: 0.012 },
      { hu: -70, color: '#f5b544', alpha: 0.016 },
      { hu: -30, color: '#7e161b', alpha: 0.35 },
      { hu: 40, color: '#9c1c25', alpha: 0.9 },
      { hu: 125, color: '#b83030', alpha: 0.95 },
      { hu: 175, color: '#fff6e6', alpha: 1 },
      { hu: 1976, color: '#ffffff', alpha: 1 },
    ],
    grad: { lo: 10, hi: 100, mod: 0.6 },
    shading: { ambient: 0.3, diffuse: 0.95, specular: 0.1, shininess: 30 },
    s1: TF_SHIFT,
    s2: TF_WIDTH,
    showOpacity: true,
    usesLabels: true,
    legend: [
      { hu: -120, label: 'Epicardial fat', note: '−190 to −30 HU' },
      { hu: 55, label: 'Heart muscle & blood', note: '0 to 100 HU' },
      { hu: 400, label: 'Calcium (if any)', note: '≥ 130 HU' },
    ],
    swatch: 'linear-gradient(135deg,#3a0508 0%,#a11a22 45%,#f7b84a 75%,#ffe08a 100%)',
    view: 'heroHeart',
  },
  {
    key: 'skeleton',
    name: 'Skeleton',
    tagline: 'Ribs, spine, sternum',
    blurb:
      'Only voxels denser than about 150 HU: bone. Costal cartilage (the flexible front ends of the ribs) is about as dense as muscle, ' +
      'so it is added from the AI label in pale teal. Any calcium deposit would also light up here.',
    mode: 'tf',
    volume: 'chest',
    pivot: 250,
    tf: [
      { hu: -1024, color: '#000000', alpha: 0 },
      { hu: 135, color: '#b49a78', alpha: 0 },
      { hu: 195, color: '#d8c6a6', alpha: 0.3 },
      { hu: 310, color: '#efe4cf', alpha: 0.95 },
      { hu: 700, color: '#fffaf0', alpha: 1 },
      { hu: 1976, color: '#ffffff', alpha: 1 },
    ],
    grad: { lo: 20, hi: 200, mod: 0 },
    shading: { ambient: 0.3, diffuse: 0.85, specular: 0.3, shininess: 32 },
    s1: TF_SHIFT,
    s2: TF_WIDTH,
    showOpacity: true,
    usesLabels: true,
    legend: [
      { hu: 260, label: 'Bone', note: '> 150 HU' },
      { color: '#bfe3dc', label: 'Costal cartilage', note: 'AI label' },
    ],
    swatch: 'linear-gradient(135deg,#1d1a16 0%,#8f7f66 40%,#efe4cf 75%,#ffffff 100%)',
    view: 'front',
  },
  {
    key: 'lungs',
    name: 'Lungs & airways',
    tagline: 'Glass lobes, vessel & bronchial trees',
    blurb:
      'The five lung lobes as tinted glass, the bronchial tree in white, and the blood vessels inside the lungs drawn from the CT densities, ' +
      'coloured blue (arteries, carrying blood from the heart) or red (veins, returning it) by the AI vessel labels.',
    mode: 'tf',
    volume: 'chest',
    pivot: -350,
    tf: [
      { hu: -1024, color: '#000000', alpha: 0 },
      { hu: -640, color: '#f0a0a0', alpha: 0 },
      { hu: -470, color: '#e88a8f', alpha: 0.22 },
      { hu: -250, color: '#d86a78', alpha: 0.6 },
      { hu: 1976, color: '#d86a78', alpha: 0.6 },
    ],
    grad: { lo: 10, hi: 120, mod: 0 },
    shading: { ambient: 0.36, diffuse: 0.8, specular: 0.35, shininess: 36 },
    s1: TF_SHIFT,
    s2: TF_WIDTH,
    showOpacity: true,
    usesLabels: true,
    legend: [
      { color: '#7fd3ff', label: 'Lung lobes', note: 'AI label, glass' },
      { color: '#5a86ff', label: 'Lung arteries', note: 'AI label' },
      { color: '#ff6e6e', label: 'Lung veins', note: 'AI label' },
      { color: '#e4f6ff', label: 'Airways', note: 'AI label' },
    ],
    swatch: 'linear-gradient(135deg,#0b1d2e 0%,#3e6bff 35%,#7fd3ff 65%,#ff6e6e 100%)',
    view: 'front',
  },
  {
    key: 'anatomy',
    name: 'Anatomy colours',
    tagline: 'AI segmentation, by organ',
    blurb:
      'Colours come from the AI segmentation ({n} structures), not from density. Solid organs are opaque; the lungs, pericardial sac and skin are glass. ' +
      'Toggle groups below. Labels are AI estimates on a low-dose scan without contrast.',
    mode: 'label',
    volume: 'chest',
    pivot: 0,
    grad: { lo: 0, hi: 1, mod: 0 },
    shading: { ambient: 0.34, diffuse: 0.8, specular: 0.32, shininess: 40 },
    s1: { ...TF_SHIFT },
    s2: { ...TF_WIDTH },
    showOpacity: false,
    usesLabels: true,
    legend: [],
    swatch: 'conic-gradient(from 200deg,#ff5d6c,#5f80ff,#7fd3ff,#f0e6d2,#9b3f30,#ff5d6c)',
    view: 'hero',
  },
  {
    key: 'xray',
    name: 'X-ray',
    tagline: 'Virtual radiograph you can rotate',
    blurb:
      'A digitally reconstructed radiograph: for every pixel the X-ray attenuation along the ray is summed, exactly like a chest X-ray ' +
      '(bright = more absorption: bone and heart; dark = air in the lungs). Only the 13.8 cm slab that was scanned is included. Rotate it for a lateral view.',
    mode: 'drr',
    volume: 'chest',
    pivot: 0,
    grad: { lo: 0, hi: 1, mod: 0 },
    shading: { ambient: 1, diffuse: 0, specular: 0, shininess: 1 },
    s1: { label: 'Exposure', min: -80, max: 80, step: 1, def: 0, unit: 'mm', hint: 'Shifts the film window by this many millimetres of water-equivalent tissue. Positive = brighter, like a softer exposure.' },
    s2: { label: 'Contrast', min: 0.5, max: 2.5, step: 0.05, def: 1, unit: '×', hint: 'Steepness of the film curve. Higher = more black-and-white.' },
    showOpacity: false,
    usesLabels: false,
    legend: [
      { color: '#f2f5f8', label: 'Bone, heart: absorbs X-rays', note: 'bright' },
      { color: '#6b7178', label: 'Soft tissue', note: 'grey' },
      { color: '#0b0d10', label: 'Air in the lungs', note: 'dark' },
    ],
    swatch: 'radial-gradient(circle at 50% 45%,#f3f6fa 0%,#9aa3ad 35%,#2a2f35 70%,#050608 100%)',
    view: 'front',
  },
  {
    key: 'mip',
    name: 'MIP',
    tagline: 'Brightest voxel along each ray',
    blurb:
      'Maximum-intensity projection: each pixel shows the densest voxel the ray passes through. Great for bone and for anything bright. ' +
      'Use the clip box to make a thin slab: inside the lungs a 1–2 cm slab shows the vessel tree like the radiologist’s MIP series.',
    mode: 'mip',
    volume: 'chest',
    pivot: 0,
    grad: { lo: 0, hi: 1, mod: 0 },
    shading: { ambient: 1, diffuse: 0, specular: 0, shininess: 1 },
    s1: { label: 'Window level', min: -800, max: 1200, step: 10, def: 220, unit: 'HU', hint: 'Centre of the grey ramp in Hounsfield units.' },
    s2: { label: 'Window width', min: 100, max: 3000, step: 10, def: 1500, unit: 'HU', hint: 'Range of HU spread from black to white.' },
    showOpacity: false,
    usesLabels: false,
    legend: [],
    swatch: 'linear-gradient(135deg,#000 0%,#3a3f46 45%,#c9ced4 80%,#fff 100%)',
    view: 'front',
  },
]

export const presetByKey = (k: PresetKey) => PRESETS.find((p) => p.key === k) ?? PRESETS[0]

// ------------------------------------------------------------------ label styling

export const GROUP_ORDER = ['heart', 'vessels', 'lungs', 'airways', 'bones', 'abdomen', 'muscle', 'body'] as const
export type GroupKey = (typeof GROUP_ORDER)[number]

export const GROUP_INFO: Record<GroupKey, { label: string; color: string; hint: string }> = {
  heart: { label: 'Heart', color: '#ff5d6c', hint: 'Chambers, LV muscle, pericardial sac (glass)' },
  vessels: { label: 'Vessels', color: '#5a86ff', hint: 'Aorta, vena cavae, lung arteries & veins' },
  lungs: { label: 'Lungs', color: '#7fd3ff', hint: 'Five lobes, drawn as glass' },
  airways: { label: 'Airways', color: '#c9eeff', hint: 'Trachea, bronchial tree, oesophagus' },
  bones: { label: 'Bones', color: '#f0e6d2', hint: 'Ribs, sternum, spine, scapulae, cartilage' },
  abdomen: { label: 'Upper abdomen', color: '#9b3f30', hint: 'Liver dome, spleen tip, stomach' },
  muscle: { label: 'Back muscles', color: '#b5544a', hint: 'Muscles along the spine' },
  body: { label: 'Skin', color: '#d9a58f', hint: 'Body outline, drawn as faint glass' },
}

export const HEART_REGION_NAMES = [
  'pericardium', 'heart', 'heart_myocardium', 'heart_ventricle_left', 'heart_ventricle_right', 'heart_atrium_left',
  'heart_atrium_right', 'atrial_appendage_left', 'aorta', 'pulmonary_artery', 'pulmonary_vein', 'superior_vena_cava', 'inferior_vena_cava',
]

export const DEFAULT_GROUPS: Record<GroupKey, boolean> = {
  heart: true, vessels: true, lungs: true, airways: true, bones: false, abdomen: true, muscle: false, body: true,
}

const BODY_WALL = new Set(['body_trunc', 'autochthon_left', 'autochthon_right'])
const HEART_REGION = new Set(HEART_REGION_NAMES)
const LUNG_VESSELS = new Set(['lung_arteries', 'lung_veins', 'pulmonary_artery', 'pulmonary_vein'])
const AIRWAYS = new Set(['trachea', 'lung_airways'])
const isLobe = (c: LabelClass) => c.name.startsWith('lung_') && c.name.includes('lobe')

/** Glass strength for glass-rendered classes in the anatomy preset. */
function glassStrength(c: LabelClass): number {
  if (c.name === 'pericardium') return 0.75
  if (c.group === 'lungs') return 0.85
  if (c.group === 'body') return 0.32
  return 0
}

export interface ClassStyling {
  /** bake input: per label id, r = gate, g = solid, b = glass strength (0..255) */
  style: Uint8Array
  /** shader LUT: per label id, sRGB colour + a = tint weight */
  lut: Uint8Array
  gate: boolean
  solid: boolean
  glass: boolean
  tint: boolean
}

export interface StyleOptions {
  groups: Record<GroupKey, boolean>
  cartilage: boolean
  isolateHeart: boolean
}

export function classStyling(preset: PresetKey, classes: LabelClass[], o: StyleOptions): ClassStyling {
  const style = new Uint8Array(256 * 4)
  const lut = new Uint8Array(256 * 4)
  let gate = false, solid = false, glass = false, tint = false
  // alpha channel = "outside the labelled body" (label 0): lets the shader find the skin surface
  const set = (id: number, r: number, g: number, b: number) => {
    style[id * 4] = r; style[id * 4 + 1] = g; style[id * 4 + 2] = b; style[id * 4 + 3] = id === 0 ? 255 : 0
  }
  for (const c of classes) {
    const [r, g, b] = hex3(c.color)
    lut[c.id * 4] = r; lut[c.id * 4 + 1] = g; lut[c.id * 4 + 2] = b; lut[c.id * 4 + 3] = 0
  }
  set(0, 0, 0, 0)
  switch (preset) {
    case 'cinematic':
      // body wall fades (gate), costal cartilage (muscle-dense, so HU can't separate it) is drawn
      // as a smooth pearly label surface instead.
      gate = true; solid = true
      for (const c of classes) {
        const cart = c.name === 'costal_cartilages'
        set(c.id, BODY_WALL.has(c.name) || cart ? 0 : 255, cart ? 255 : 0, 0)
        if (cart) { lut[c.id * 4] = 222; lut[c.id * 4 + 1] = 228; lut[c.id * 4 + 2] = 220 }
      }
      set(0, 0, 0, 0) // outside the trunk label (e.g. arms) fades like the body wall
      break
    case 'heart':
      gate = o.isolateHeart
      for (const c of classes) set(c.id, HEART_REGION.has(c.name) ? 255 : 0, 0, 0)
      break
    case 'skeleton':
      // HU decides what is bone; the AI bone labels only suppress stray dense noise elsewhere
      gate = true; solid = o.cartilage
      for (const c of classes) {
        const cart = c.name === 'costal_cartilages'
        set(c.id, c.group === 'bones' && !cart ? 255 : 0, cart && o.cartilage ? 255 : 0, 0)
      }
      break
    case 'lungs':
      gate = true; solid = true; glass = true; tint = true
      for (const c of classes) {
        const vessel = LUNG_VESSELS.has(c.name)
        set(c.id, vessel ? 255 : 0, AIRWAYS.has(c.name) ? 255 : 0, isLobe(c) ? 220 : 0)
        if (vessel) lut[c.id * 4 + 3] = 235
        if (AIRWAYS.has(c.name)) { lut[c.id * 4] = 232; lut[c.id * 4 + 1] = 246; lut[c.id * 4 + 2] = 255 }
      }
      break
    case 'anatomy':
      solid = true; glass = true
      for (const c of classes) {
        const on = o.groups[(c.group as GroupKey)] ?? false
        if (!on) { set(c.id, 0, 0, 0); continue }
        const gs = glassStrength(c)
        if (gs > 0) set(c.id, 0, 0, Math.round(gs * 255))
        else set(c.id, 0, 255, 0)
      }
      break
    default:
      break
  }
  return { style, lut, gate, solid, glass, tint }
}

function hex3(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Static metadata for the 3D anatomy page: groups, presets, camera views, CT windows and
 * short plain-English descriptions. Nothing here is patient-specific: all numbers shown in the
 * UI come from manifest.json / calcium.json.
 */
import type { MeshNode } from '../../lib/data'

export type GroupKey = 'heart' | 'vessels' | 'airways' | 'lungs' | 'bones' | 'abdomen' | 'muscle' | 'body'
export type CameraView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'heart' | 'home' | 'oblique' | 'chest'
export type ClipAxis = 'axial' | 'coronal' | 'sagittal'
export type SliceMode = 'full' | 'caps' | 'off'
export type WindowKey = 'soft' | 'lung' | 'bone'
export type RenderMode = 'solid' | 'xray'

export interface GroupMeta { key: GroupKey; label: string; color: string; blurb: string }

export const GROUPS: GroupMeta[] = [
  { key: 'heart', label: 'Heart', color: '#ff4d5e', blurb: 'Chambers and muscle of the heart' },
  { key: 'vessels', label: 'Vessels', color: '#ff7759', blurb: 'Aorta, pulmonary vessels, venae cavae' },
  { key: 'airways', label: 'Airways', color: '#a8dcff', blurb: 'Trachea, bronchi (and the esophagus)' },
  { key: 'lungs', label: 'Lungs', color: '#7fd3ff', blurb: 'The five lung lobes' },
  { key: 'bones', label: 'Bones', color: '#f0e6d2', blurb: 'Ribs, sternum, spine, shoulder blades' },
  { key: 'abdomen', label: 'Abdomen', color: '#c46a4f', blurb: 'Upper-abdominal organs caught in the scan' },
  { key: 'muscle', label: 'Muscle', color: '#b5544a', blurb: 'Deep back muscles' },
  { key: 'body', label: 'Body', color: '#d9a58f', blurb: 'Skin and soft-tissue outline' },
]
export const GROUP_BY_KEY: Record<string, GroupMeta> = Object.fromEntries(GROUPS.map((g) => [g.key, g]))
export const groupLabel = (g: string) => GROUP_BY_KEY[g]?.label ?? g

/** How far each group flies outward when exploding (multiplies centroid distance from the heart). */
export const EXPLODE_SCALE: Record<string, number> = {
  heart: 2.1, vessels: 1.5, airways: 1.3, lungs: 0.85, bones: 0.7, abdomen: 1.0, muscle: 0.8, body: 0.3,
}

/** Transparent sort order: inner shells first, outer shells last. */
export const SHELL_ORDER: Record<string, number> = { pericardium: 2, body_trunc: 4 }
export const shellOrder = (n: MeshNode) => SHELL_ORDER[n.name] ?? (n.group === 'lungs' ? 3 : 1)

export const SOURCE_LABEL: Record<string, string> = {
  total: 'TotalSegmentator v2 (“total” model)',
  v1: 'TotalSegmentator v1.5 cardiac model',
  cav: 'TotalSegmentator trunk-cavities model',
  lv: 'TotalSegmentator lung-vessels model',
  body: 'TotalSegmentator body model',
}
/** Which AI model traced a structure. The v1.5 run is its full "total" model: the heart comes from its cardiac part, the spine from its vertebrae part. */
export function sourceLabel(n: MeshNode & { source?: string }): string | null {
  if (!n.source) return null
  if (n.source === 'v1' && n.group === 'bones') return 'TotalSegmentator v1.5 (“total” model, vertebrae part)'
  return SOURCE_LABEL[n.source] ?? null
}

export const GREAT_VESSELS = ['aorta', 'pulmonary_artery', 'pulmonary_vein', 'superior_vena_cava', 'inferior_vena_cava']
export const HEART_PARTS = ['heart_myocardium', 'heart_ventricle_left', 'heart_ventricle_right', 'heart_atrium_left', 'heart_atrium_right', 'atrial_appendage_left']
/** Windpipe + bronchial tree. */
export const AIRWAY_TREE = ['trachea', 'lung_airways']
/** Ribs, cartilage, sternum, spine (the shoulder blades sit outside the cage and only add clutter). */
const isRibcage = (n: MeshNode) => n.group === 'bones' && !n.name.startsWith('scapula_')

// ------------------------------------------------------------------ presets
export interface Preset {
  key: string
  label: string
  hint: string
  show: (n: MeshNode) => boolean
  /** Absolute group opacity (slider value); unspecified groups reset to their default. */
  opacity?: Partial<Record<GroupKey, number>>
  mode?: RenderMode
  view: CameraView
}

export const PRESETS: Preset[] = [
  {
    key: 'chest', label: 'Chest', hint: 'The default view: the heart and great vessels, solid, with the windpipe and bronchi, inside glassy lungs and a ghosted ribcage',
    show: (n) => HEART_PARTS.includes(n.name) || GREAT_VESSELS.includes(n.name) || AIRWAY_TREE.includes(n.name) || n.group === 'lungs' || isRibcage(n),
    opacity: { bones: 0.2, lungs: 0.05 }, view: 'chest',
  },
  {
    key: 'heart', label: 'Heart', hint: 'Just the four chambers and the heart muscle',
    show: (n) => HEART_PARTS.includes(n.name), view: 'heart',
  },
  {
    key: 'vessels', label: 'Heart & great vessels', hint: 'The heart plus the aorta, pulmonary artery and veins, and the venae cavae',
    show: (n) => HEART_PARTS.includes(n.name) || GREAT_VESSELS.includes(n.name), view: 'oblique',
  },
  {
    key: 'lungs', label: 'Lungs & airways', hint: 'Lung lobes as glass, with the bronchial tree and lung vessels inside',
    show: (n) => n.group === 'lungs' || ['trachea', 'lung_airways', 'lung_arteries', 'lung_veins'].includes(n.name),
    opacity: { lungs: 0.24 }, view: 'home',
  },
  {
    key: 'skeleton', label: 'Skeleton', hint: 'Ribs, sternum, spine and shoulder blades, with the heart for scale',
    show: (n) => n.group === 'bones' || n.name === 'heart', view: 'home',
  },
  {
    key: 'full', label: 'Full chest', hint: 'Every main layer at once: lung vessels and airways, upper abdomen, ribs and shoulder blades (busy, but complete)',
    show: (n) => n.defaultVisible, opacity: { bones: 0.34 }, view: 'home',
  },
  {
    key: 'everything', label: 'Everything', hint: 'Every structure at once (the whole-heart shell stays hidden so the chambers do not double up)',
    show: (n) => n.name !== 'heart', view: 'home',
  },
  {
    key: 'ghost', label: 'Ghost body', hint: 'Skin as glass, heart and great vessels solid, faint skeleton',
    show: (n) => n.name === 'body_trunc' || HEART_PARTS.includes(n.name) || GREAT_VESSELS.includes(n.name) || n.group === 'bones',
    opacity: { body: 0.05, bones: 0.16 }, view: 'home',
  },
  {
    key: 'xray', label: 'X-ray', hint: 'Fresnel glow on every surface, like a 3D radiograph',
    show: (n) => n.name !== 'heart', mode: 'xray', view: 'front',
  },
]

// ------------------------------------------------------------------ camera views
/** `short` is used on phones, where the six buttons must fit beside the orientation gizmo. */
export const VIEWS: { key: CameraView; label: string; short: string; title: string; dir: [number, number, number] }[] = [
  { key: 'front', label: 'Front', short: 'Front', title: 'Anterior view: you face the patient, his left on your right', dir: [0, 0, 1] },
  { key: 'back', label: 'Back', short: 'Back', title: 'Posterior view, from behind', dir: [0, 0, -1] },
  { key: 'left', label: 'Left side', short: 'Left', title: 'From the patient’s left side (front of the chest on your left)', dir: [1, 0, 0] },
  { key: 'right', label: 'Right side', short: 'Right', title: 'From the patient’s right side (front of the chest on your right)', dir: [-1, 0, 0] },
  { key: 'top', label: 'Top', short: 'Top', title: 'From above (head end), front of the chest at the top', dir: [0, 1, -0.002] },
  { key: 'heart', label: 'Heart', short: 'Heart', title: 'Close-up of the heart (left-anterior oblique)', dir: [0.62, 0.3, 1] },
]
export const EXTRA_DIRS: Record<string, [number, number, number]> = {
  bottom: [0, -1, -0.002],
  home: [0.5, 0.26, 1],
  oblique: [0.62, 0.3, 1],
  /** Three-quarter front view from the patient's left: the classic textbook angle on the heart. */
  chest: [0.5, 0.26, 1],
}

// ------------------------------------------------------------------ CT windows for the cut plane
/** alphaHU: below the first value the slice is see-through (air, lung), above the second it is opaque. */
export const WINDOWS: Record<WindowKey, { label: string; center: number; width: number; alphaHU: [number, number]; smooth: number; title: string }> = {
  soft: { label: 'Soft tissue', center: 40, width: 400, alphaHU: [-290, -140], smooth: 1, title: 'Window 40/400 HU: heart, vessels, fat and muscle' },
  lung: { label: 'Lung', center: -600, width: 1500, alphaHU: [-1000, -940], smooth: 0.35, title: 'Window −600/1500 HU: lung tissue and airways' },
  bone: { label: 'Bone', center: 500, width: 2000, alphaHU: [-560, -420], smooth: 0.6, title: 'Window 500/2000 HU: bone and calcium' },
}

// ------------------------------------------------------------------ calcium candidates
export const CAND_COLORS: Record<string, string> = {
  coronary: '#ff4d5e', aortic: '#ffb547', valvular: '#a08bff', 'noise-artifact': '#64d2ff', noise: '#64d2ff',
  review: '#ffd60a', bone: '#e7edf5', other: '#8a97a8',
}
export const CAND_LABEL: Record<string, string> = {
  coronary: 'Coronary calcium', aortic: 'Aortic (not coronary)', valvular: 'Valve (not coronary)',
  'noise-artifact': 'Noise (ruled out)', noise: 'Noise (ruled out)', review: 'Flagged for review', bone: 'Bone', other: 'Other',
}

// ------------------------------------------------------------------ floating labels
export const LABELLED = [
  'heart_ventricle_left', 'heart_ventricle_right', 'heart_atrium_left', 'heart_atrium_right', 'aorta',
  'pulmonary_artery', 'superior_vena_cava', 'trachea', 'esophagus', 'lung_upper_lobe_left',
  'lung_upper_lobe_right', 'liver', 'stomach', 'sternum', 'vertebrae_T8', 'heart',
]
/** Shorter names for the floating labels. */
export const SHORT_NAME: Record<string, string> = {
  heart_ventricle_left: 'Left ventricle', heart_ventricle_right: 'Right ventricle', heart_atrium_left: 'Left atrium',
  heart_atrium_right: 'Right atrium', pulmonary_artery: 'Pulmonary artery', superior_vena_cava: 'SVC',
  inferior_vena_cava: 'IVC', lung_upper_lobe_left: 'Left lung', lung_upper_lobe_right: 'Right lung',
  lung_lower_lobe_left: 'L lower lobe', lung_lower_lobe_right: 'R lower lobe', vertebrae_T8: 'Spine (T8)',
  heart_myocardium: 'LV muscle', body_trunc: 'Skin', scapula_left: 'L shoulder blade', scapula_right: 'R shoulder blade',
  heart: 'Heart',
}

// ------------------------------------------------------------------ plain-English blurbs
const BLURBS: Record<string, string> = {
  body_trunc: 'The outline of the body inside the scanned slab: skin, fat and the chest-wall soft tissue.',
  pericardium: 'The sac that wraps the heart, together with the fat inside it. Shown as a translucent shell.',
  heart: 'The whole heart as one smooth shape: all four chambers and their walls together.',
  heart_myocardium: 'The thick muscular wall of the left ventricle, the main pump that pushes blood out to the whole body.',
  heart_ventricle_left: 'The blood-filled cavity of the left ventricle. It pumps oxygen-rich blood into the aorta.',
  heart_ventricle_right: 'Pumps oxygen-poor blood to the lungs through the pulmonary artery. It is the chamber closest to the breastbone.',
  heart_atrium_left: 'Receives oxygen-rich blood from the lungs through the pulmonary veins. It is the most posterior chamber, just in front of the esophagus.',
  heart_atrium_right: 'Collects oxygen-poor blood returning from the body through the superior and inferior vena cava.',
  atrial_appendage_left: 'A small ear-shaped pouch off the left atrium.',
  aorta: 'The body’s main artery. It leaves the left ventricle and arches over the heart (the arch itself is just above this scan), then runs down beside the spine.',
  pulmonary_artery: 'Carries blood from the right ventricle to the lungs to pick up oxygen.',
  pulmonary_vein: 'The veins that bring oxygen-rich blood back from the lungs into the left atrium.',
  superior_vena_cava: 'The large vein that returns blood from the head and arms to the right atrium.',
  inferior_vena_cava: 'The large vein that returns blood from the lower body to the right atrium.',
  lung_arteries: 'The branching arteries inside the lungs, traced by a dedicated lung-vessel model.',
  lung_veins: 'The branching veins inside the lungs, traced by a dedicated lung-vessel model.',
  trachea: 'The windpipe. It splits into the left and right main bronchi just above the heart.',
  lung_airways: 'The bronchial tree: the airways that branch out inside the lungs.',
  esophagus: 'The food pipe. It runs down behind the heart, right in front of the spine.',
  liver: 'Only the top of the liver (the dome under the right side of the diaphragm) is inside this heart scan.',
  spleen: 'Only the upper tip of the spleen reaches into the scanned slab.',
  stomach: 'The top of the stomach (the fundus), just under the left diaphragm.',
  colon: 'A small part of the large bowel near the spleen (the splenic flexure).',
  autochthon_left: 'The deep back muscles that run along the left side of the spine.',
  autochthon_right: 'The deep back muscles that run along the right side of the spine.',
  costal_cartilages: 'Flexible cartilage that joins the front ends of the ribs to the breastbone.',
  sternum: 'The breastbone, right in front of the heart.',
  scapula_left: 'The left shoulder blade, on the back of the ribcage.',
  scapula_right: 'The right shoulder blade, on the back of the ribcage.',
  spinal_cord: 'The spinal cord, protected inside the canal of the vertebrae.',
}
const GROUP_BLURB: Record<string, string> = {
  lungs: 'A lung lobe. The left lung has two lobes and the right lung three. Only the part inside the scanned slab is included.',
  bones: 'Part of the bony chest that protects the heart and lungs.',
}

export function blurbFor(n: MeshNode): string {
  if (BLURBS[n.name]) return BLURBS[n.name]
  if (n.name.startsWith('rib_')) return 'One of the ribs that form the cage around the heart and lungs. Only the part inside the scan is shown.'
  if (n.name.startsWith('vertebrae_')) {
    const sliver = (n.volumeML ?? Infinity) < 3 ? ' Only a thin sliver of it lies inside the scanned slab.' : ''
    return `A thoracic vertebra (${n.name.replace('vertebrae_', '')}), one of the stacked bones of the spine.${sliver}`
  }
  return GROUP_BLURB[n.group] ?? ''
}

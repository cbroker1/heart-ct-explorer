/** Which GLB nodes make up the hero heart (colours come from the manifest). */
import type { MeshNode } from '../../lib/data'
import type { HeartPartSpec, PartKind } from './HeroHeart'

const PARTS: { name: string; kind: PartKind }[] = [
  { name: 'heart_myocardium', kind: 'muscle' },
  { name: 'heart_ventricle_left', kind: 'ventricle' },
  { name: 'heart_ventricle_right', kind: 'ventricle' },
  { name: 'heart_atrium_left', kind: 'atrium' },
  { name: 'heart_atrium_right', kind: 'atrium' },
  { name: 'atrial_appendage_left', kind: 'atrium' },
  { name: 'aorta', kind: 'artery' },
  { name: 'pulmonary_artery', kind: 'artery' },
  { name: 'pulmonary_vein', kind: 'vein' },
  { name: 'superior_vena_cava', kind: 'vein' },
  { name: 'inferior_vena_cava', kind: 'vein' },
]

/** One plain-English line per structure for the hover/tap label (general anatomy, not findings). */
export const PART_INFO: Record<string, string> = {
  heart_myocardium: 'The thick muscular wall of the left ventricle, which does most of the pumping.',
  heart_ventricle_left: 'Pumps oxygen-rich blood into the aorta and out to the whole body.',
  heart_ventricle_right: 'Pumps blood into the pulmonary artery, towards the lungs.',
  heart_atrium_left: 'Collects oxygen-rich blood arriving from the lungs.',
  heart_atrium_right: 'Collects the blood returning from the body.',
  atrial_appendage_left: 'A small ear-shaped pouch off the left atrium.',
  aorta: 'The body\'s main artery: it rises out of the heart, and its descending part runs down beside the spine. The arch joining the two sits just above this scan.',
  pulmonary_artery: 'Carries blood from the right ventricle to both lungs.',
  pulmonary_vein: 'Bring oxygen-rich blood back from the lungs to the left atrium.',
  superior_vena_cava: 'Returns blood from the head and arms to the right atrium.',
  inferior_vena_cava: 'Returns blood from the lower body to the right atrium.',
}

export function heartPartsFrom(nodes: MeshNode[]): HeartPartSpec[] {
  const byName = new Map(nodes.map((n) => [n.name, n]))
  return PARTS.filter((p) => byName.has(p.name)).map((p) => ({ ...p, color: byName.get(p.name)!.color }))
}

/** Initial turntable angle: the classic anterior view (right ventricle and great arteries towards the viewer). */
export const INITIAL_ANGLE = 0.2
export const AUTO_SPIN = 0.16 // rad/s, one turn in ~40 s

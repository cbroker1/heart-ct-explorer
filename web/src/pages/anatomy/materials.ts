/**
 * Materials for the anatomy meshes.
 *  - organ: MeshPhysicalMaterial (clearcoat + sheen for soft tissue, matte for bone) with a small
 *    onBeforeCompile hook that adds a Fresnel "glass rim" when the structure is translucent and
 *    darkens back faces (the inside of a structure seen through a cut).
 *  - fresnel: additive rim shader used for the X-ray mode and for hover/selection highlights.
 * Both honour material.clippingPlanes.
 */
import * as THREE from 'three'
import type { MeshNode } from '../../lib/data'

export interface OrganUniforms {
  uRim: { value: number }
  uRimPow: { value: number }
  uRimColor: { value: THREE.Color }
  uRimGlow: { value: number }
  uBackDim: { value: number }
}
export type OrganMaterial = THREE.MeshPhysicalMaterial & { userData: { u: OrganUniforms } }

const WHITE = new THREE.Color('#ffffff')

export function isGlassy(n: MeshNode) {
  return n.group === 'lungs' || n.group === 'body' || n.name === 'pericardium'
}

export function makeOrganMaterial(n: MeshNode, color: THREE.Color): OrganMaterial {
  const bone = n.group === 'bones' && n.name !== 'spinal_cord'
  const glassy = isGlassy(n)
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness: bone ? 0.6 : glassy ? 0.14 : 0.4,
    metalness: 0,
    clearcoat: bone ? 0.1 : glassy ? 1 : 0.55,
    clearcoatRoughness: bone ? 0.5 : glassy ? 0.05 : 0.24,
    sheen: bone || glassy ? 0 : 0.4,
    sheenRoughness: 0.45,
    sheenColor: color.clone().lerp(WHITE, 0.5),
    specularIntensity: bone ? 0.4 : 0.7,
    side: THREE.DoubleSide,
    emissive: color.clone(),
    emissiveIntensity: 0,
    envMapIntensity: n.group === 'body' ? 0.55 : glassy ? 1.4 : 1.0,
  }) as OrganMaterial
  // Transparent double-sided materials normally render in two passes (back faces, then front).
  // That ordering only matters for the big glass shells; thin structures (ribs, vessels) use one pass.
  m.forceSinglePass = !glassy
  const rimColor = n.group === 'body' ? new THREE.Color('#bfe9ff') : color.clone().lerp(WHITE, 0.35)
  const u: OrganUniforms = {
    uRim: { value: 0 },
    uRimPow: { value: n.group === 'body' ? 3.0 : 2.2 },
    uRimColor: { value: rimColor },
    uRimGlow: { value: 0 },
    uBackDim: { value: n.group === 'body' ? 0.3 : 0.55 },
  }
  m.userData.u = u
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u)
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uRim;\nuniform float uRimPow;\nuniform vec3 uRimColor;\nuniform float uRimGlow;\nuniform float uBackDim;',
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          float anaNdv = clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
          float anaFr = pow(1.0 - anaNdv, uRimPow);
          outgoingLight += uRimColor * anaFr * uRimGlow;
          diffuseColor.a = clamp(diffuseColor.a + anaFr * uRim, 0.0, 1.0);
          if (!gl_FrontFacing) outgoingLight *= uBackDim;
        }
        #include <opaque_fragment>`,
      )
  }
  m.customProgramCacheKey = () => 'ana-organ-v1'
  return m
}

const FRESNEL_VERT = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vAnaN;
varying vec3 vAnaV;
void main() {
  #include <begin_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
  vAnaN = normalize(normalMatrix * normal);
  vAnaV = -mvPosition.xyz;
}`

const FRESNEL_FRAG = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 uColor;
uniform float uPow;
uniform float uGain;
uniform float uBase;
uniform float uOpacity;
varying vec3 vAnaN;
varying vec3 vAnaV;
void main() {
  #include <clipping_planes_fragment>
  float ndv = clamp(abs(dot(normalize(vAnaN), normalize(vAnaV))), 0.0, 1.0);
  float f = pow(1.0 - ndv, uPow) * uGain + uBase;
  gl_FragColor = vec4(uColor * f * uOpacity, 1.0);
  #include <colorspace_fragment>
}`

export interface FresnelUniforms {
  [k: string]: THREE.IUniform
  uColor: { value: THREE.Color }
  uPow: { value: number }
  uGain: { value: number }
  uBase: { value: number }
  uOpacity: { value: number }
}
export type FresnelMaterial = THREE.ShaderMaterial & { uniforms: FresnelUniforms }

/** Additive Fresnel/rim material (X-ray look). Colour is in linear space. */
export function makeFresnelMaterial(color: THREE.Color, opts: { pow?: number; gain?: number; base?: number } = {}): FresnelMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uPow: { value: opts.pow ?? 2.2 },
      uGain: { value: opts.gain ?? 1 },
      uBase: { value: opts.base ?? 0.03 },
      uOpacity: { value: 1 },
    },
    vertexShader: FRESNEL_VERT,
    fragmentShader: FRESNEL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    clipping: true,
    toneMapped: false,
  }) as FresnelMaterial
}

const XRAY_TINT = new THREE.Color('#a9e6ff')
const TREES = ['lung_arteries', 'lung_veins', 'lung_airways']
/** X-ray colour per structure: keeps the heart/vessels in their own hue, everything else drifts toward ice blue. */
export function xrayColor(n: MeshNode, color: THREE.Color): { color: THREE.Color; gain: number } {
  const keepHue = n.group === 'heart' || n.group === 'vessels'
  const c = color.clone().lerp(XRAY_TINT, keepHue ? 0.12 : 0.6)
  // Additive layers pile up quickly: thin, dense trees and big shells get a low gain.
  const gain = TREES.includes(n.name) ? 0.07
    : n.group === 'body' ? 0.13
    : n.group === 'lungs' ? 0.1
    : n.name === 'pericardium' ? 0.08
    : n.group === 'bones' ? 0.22
    : n.group === 'muscle' ? 0.1
    : n.group === 'abdomen' ? 0.18
    : 0.34
  return { color: c, gain }
}

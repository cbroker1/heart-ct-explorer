/**
 * MeshPhysicalMaterial patched (onBeforeCompile) to make the CT heart beat on the GPU.
 *
 * Geometry is pre-transformed into "heart space" (= the GLB world frame, mm, +Y = head), so the
 * deformation is computed in millimetres around the heart's long axis:
 *  - ventricles: radial squeeze toward the long axis (inner wall more than outer wall = the muscle
 *    thickens), longitudinal shortening that pulls the valve plane toward the apex, a slight twist;
 *  - atria: ride the valve plane down (they fill while the ventricles squeeze), then squeeze on the
 *    P wave; veins follow their atrium near the junction;
 *  - arteries: a small pressure pulse that travels away from the valves.
 * Fragment additions: Fresnel rim, beat glow, depolarisation waves, the X-ray slab highlight.
 */
import * as THREE from 'three'

export const ROLE = { ventricle: 0, atrium: 1, artery: 2, vein: 3 } as const

export interface SharedUniforms {
  [k: string]: THREE.IUniform
  uV: THREE.IUniform<number>
  uA: THREE.IUniform<number>
  uTau: THREE.IUniform<number>
  uTs: THREE.IUniform<number>
  uWaveA: THREE.IUniform<number>
  uWaveV: THREE.IUniform<number>
  uGlow: THREE.IUniform<number>
  uSlab: THREE.IUniform<THREE.Vector2>
  uSlabOn: THREE.IUniform<number>
  uTime: THREE.IUniform<number>
  uApex: THREE.IUniform<THREE.Vector3>
  uAxis: THREE.IUniform<THREE.Vector3>
  uHb: THREE.IUniform<number>
  uHa: THREE.IUniform<number>
  uSA: THREE.IUniform<THREE.Vector3>
  uAV: THREE.IUniform<THREE.Vector3>
  uKL: THREE.IUniform<number>
  uTwist: THREE.IUniform<number>
  uKA: THREE.IUniform<number>
  uKE: THREE.IUniform<number>
  uAmount: THREE.IUniform<number>
}

export function makeSharedUniforms(): SharedUniforms {
  return {
    uV: { value: 0 }, uA: { value: 0 }, uTau: { value: 1 }, uTs: { value: 0.3 },
    uWaveA: { value: -1 }, uWaveV: { value: -1 }, uGlow: { value: 0 },
    uSlab: { value: new THREE.Vector2(0, 0) }, uSlabOn: { value: 0 }, uTime: { value: 0 },
    uApex: { value: new THREE.Vector3() }, uAxis: { value: new THREE.Vector3(0, 1, 0) },
    uHb: { value: 70 }, uHa: { value: 50 },
    uSA: { value: new THREE.Vector3() }, uAV: { value: new THREE.Vector3() },
    uKL: { value: 0.085 }, uTwist: { value: 0.1 }, uKA: { value: 0.1 }, uKE: { value: 1.3 },
    uAmount: { value: 1 },
  }
}

export interface PartOptions {
  color: string
  role: number
  kR: number          // radial squeeze of the outer surface (fraction)
  kRin?: number       // radial squeeze of the inner (endocardial) surface
  center?: THREE.Vector3
  centerR?: number
  opacity?: number
  rim: string
}

const VERT_HEAD = /* glsl */`
uniform float uV, uA, uTau, uTs, uHb, uHa, uKL, uTwist, uKA, uKE, uAmount;
uniform vec3 uApex, uAxis, uAV;
uniform float uRole, uKR, uKRin, uCenterR;
uniform vec3 uCenter;
varying vec3 vHeartRest;
varying vec3 vHeartPos;
`

const VERT_BODY = /* glsl */`
  vHeartRest = transformed;
  {
    float vv = uV * uAmount;
    vec3 d = transformed - uApex;
    float h = dot(d, uAxis);
    vec3 r = d - h * uAxis;
    float hn = h / uHb;
    float rl = length(r);
    // endocardial vs epicardial surface of the muscle shell: normal pointing toward the axis = inner
    float inner = (uRole < 0.5 && rl > 1e-3) ? smoothstep(0.2, -0.3, dot(normalize(objectNormal), r / rl)) : 0.0;
    float kR = mix(uKR, uKRin, inner);
    float radial = kR * vv * smoothstep(-0.2, 0.3, hn) * (1.0 - smoothstep(1.0, 1.35, hn));
    float dh = hn <= 1.0 ? -uKL * vv * h : -uKL * vv * uHb * clamp(1.0 - (h - uHb) / uHa, 0.0, 1.0);
    float ang = uTwist * vv * (clamp(hn, 0.0, 1.0) - 0.45);
    float c = cos(ang), s = sin(ang);
    vec3 rr = r * (1.0 - radial);
    rr = rr * c + cross(uAxis, rr) * s;
    vec3 moved = uApex + (h + dh) * uAxis + rr;
    // how much of the ventricular field each kind of tissue follows
    float w = 1.0;
    if (uRole > 1.5 && uRole < 2.5) w = exp(-max(0.0, length(vHeartRest - uAV) - 12.0) / 22.0);
    if (uRole > 2.5) w = clamp(1.0 - (length(vHeartRest - uCenter) - uCenterR) / 28.0, 0.0, 1.0);
    transformed = mix(transformed, moved, w);
    // atrial systole (P wave): squeeze toward the chamber centre; veins join in near the junction
    if (uRole > 0.5 && uRole < 1.5) {
      transformed = uCenter + (transformed - uCenter) * (1.0 - uKA * uA * uAmount);
    } else if (uRole > 2.5) {
      transformed = mix(transformed, uCenter + (transformed - uCenter) * (1.0 - uKA * uA * uAmount), w);
    }
    // arteries: pressure pulse travelling away from the valves (~4.5 m/s)
    if (uRole > 1.5 && uRole < 2.5) {
      float dist = length(vHeartRest - uAV);
      float x = (uTau - 0.05 - dist / 4500.0) / max(uTs, 0.1);
      float e = (x > 0.0 && x < 1.0) ? pow(sin(3.14159265 * x), 0.7) : 0.0;
      transformed += normalize(objectNormal) * uKE * e * uAmount;
    }
  }
  vHeartPos = transformed;
`

const FRAG_HEAD = /* glsl */`
uniform float uWaveA, uWaveV, uGlow, uSlabOn, uTime, uHb, uRole;
uniform vec2 uSlab;
uniform vec3 uRim, uSA, uApex, uAxis;
varying vec3 vHeartRest;
varying vec3 vHeartPos;
`

const FRAG_BODY = /* glsl */`
  {
    vec3 nV = normalize(normal);
    vec3 vV = normalize(vViewPosition);
    float fres = pow(1.0 - clamp(abs(dot(nV, vV)), 0.0, 1.0), 2.4);
    totalEmissiveRadiance += uRim * fres * 0.85;
    totalEmissiveRadiance += diffuseColor.rgb * uGlow * 0.32;
    // depolarisation: a spherical wave from the sinus node over the atria (P wave),
    // then a band sweeping the ventricles from apex to base (QRS)
    vec3 waveCol = vec3(0.22, 0.78, 1.0);
    float wv = 0.0;
    if (uWaveA >= 0.0 && uRole > 0.5 && uRole < 1.5) {
      float dA = length(vHeartRest - uSA);
      wv += exp(-pow((dA - uWaveA * 105.0) / 7.0, 2.0)) * (1.0 - 0.5 * uWaveA);
    }
    if (uWaveV >= 0.0 && uRole < 0.5) {
      float hn = dot(vHeartRest - uApex, uAxis) / uHb;
      wv += exp(-pow((hn - mix(-0.12, 1.1, uWaveV)) / 0.075, 2.0)) * (1.0 - 0.35 * uWaveV);
    }
    totalEmissiveRadiance += waveCol * wv * 1.05;
    // X-ray slab: the part of the heart this shot is imaging
    if (uSlabOn > 0.001) {
      float y = vHeartPos.y;
      float inside = smoothstep(uSlab.x - 1.2, uSlab.x + 1.2, y) * (1.0 - smoothstep(uSlab.y - 1.2, uSlab.y + 1.2, y));
      float edge = exp(-pow((y - uSlab.x) / 0.9, 2.0)) + exp(-pow((y - uSlab.y) / 0.9, 2.0));
      float lines = 0.7 + 0.3 * sin(y * 3.4 - uTime * 9.0);
      totalEmissiveRadiance += vec3(0.30, 0.95, 0.62) * uSlabOn * (inside * 0.26 * lines + edge * 1.1);
    }
  }
`

export function makeHeartMaterial(shared: SharedUniforms, o: PartOptions): THREE.MeshPhysicalMaterial {
  const transparent = (o.opacity ?? 1) < 1
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(o.color).multiplyScalar(0.82),
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.22,
    envMapIntensity: 0.9,
    transparent,
    opacity: o.opacity ?? 1,
    depthWrite: !transparent,
    side: THREE.FrontSide,
  })
  const own = {
    uRole: { value: o.role },
    uKR: { value: o.kR },
    uKRin: { value: o.kRin ?? o.kR },
    uCenter: { value: (o.center ?? new THREE.Vector3()).clone() },
    uCenterR: { value: o.centerR ?? 25 },
    uRim: { value: new THREE.Color(o.rim) },
  }
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, own)
    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY)
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_BODY)
  }
  m.customProgramCacheKey = () => 'hb-heart-v1'
  return m
}

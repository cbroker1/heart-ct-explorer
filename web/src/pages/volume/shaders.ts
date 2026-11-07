/**
 * GLSL 3 (WebGL2) shaders for the volume renderer.
 *
 * Frames used in the ray marcher:
 *   "X space" = millimetres along the volume's own voxel axes, origin at the outer corner of
 *   voxel (0,0,0) (i.e. half a voxel before its centre). The box is [0, uSize]. X space is an
 *   isometry of three.js world space (rotation + translation), so distances are true mm and
 *   lighting can be done here directly. Texture coordinate = p / uSize.
 *
 * Feature switches are #defines (set per preset), continuous parameters are uniforms.
 *   MODE_TF     classic transfer-function compositing (front-to-back, early termination)
 *   MODE_LABEL  label-mask rendering only (solid + glass surfaces from AI segmentation)
 *   MODE_DRR    digitally reconstructed radiograph (attenuation line integral)
 *   MODE_MIP    maximum-intensity projection
 *   USE_GATE    mask.r gates the TF opacity (fade or hide structures by AI label)
 *   USE_SOLID   mask.g = solid label surfaces coloured by label
 *   USE_GLASS   mask.b = glass shells coloured by label
 *   USE_TINT    TF colour tinted by the label one voxel "inside" the surface
 *   USE_SHADING Blinn-Phong headlight + hemisphere ambient
 *   USE_SHADOWS stochastic soft shadow rays (only while refining, uShadows = 1)
 *   PROBE       output the hit position instead of a colour (picking)
 */

export const volumeVert = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uSize;
out vec3 vPosX;
void main() {
  vPosX = position * uSize;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`

export const volumeFrag = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;

in vec3 vPosX;
out vec4 fragColor;

uniform sampler3D uVol;       // R8, linear: normalised intensity (HU = uHuMin + v * uHuRange)
uniform sampler2D uTF;        // 256x1 RGBA16F: linear rgb, alpha = opacity per mm
uniform sampler3D uMask;      // RGBA8, linear: r gate, g solid, b glass (blurred AI label masks)
uniform sampler3D uLabel;     // R8, nearest: AI label ids (render grid)
uniform sampler2D uClassLUT;  // 256x1 RGBA8: sRGB class colour, a = tint weight
uniform sampler2D uStyle;     // 256x1 RGBA8: per class r gate, g solid, b glass (same LUT the mask was baked from)

uniform vec3 uSize;           // box size in mm
uniform vec3 uDims;           // voxel counts
uniform vec3 uCam;            // camera position, X space
uniform vec3 uClipMin;        // clip box, X space mm
uniform vec3 uClipMax;
uniform vec3 uCapMin;         // 1.0 where that clip face is active (for flat "capping")
uniform vec3 uCapMax;
uniform mat4 uToMask;         // X space mm -> mask/label texture coordinates
uniform vec3 uMaskDims;
uniform float uStep;          // mm
uniform float uHuMin;
uniform float uHuRange;
uniform float uOpacity;
uniform float uGateFloor;
uniform vec3 uGrad;           // gradient-magnitude lo, hi (HU/mm), modulation amount
uniform vec3 uLight;          // unit vector towards the light, X space
uniform vec3 uUp;             // screen-up, X space (hemisphere ambient)
uniform vec4 uMat;            // ambient, diffuse, specular, shininess
uniform float uFrame;
uniform float uShadows;
uniform vec4 uWin;            // DRR: lo, width, boneBoost, gamma   MIP: lo, width
uniform float uSolidAlpha;
uniform float uGlass;

#ifndef MAX_STEPS
#define MAX_STEPS 2400
#endif

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

vec4 tfLookup(float v) {
  return texture(uTF, vec2(v * (255.0 / 256.0) + (0.5 / 256.0), 0.5));
}

vec4 classLookup(float labelNorm) {
  return texture(uClassLUT, vec2((floor(labelNorm * 255.0 + 0.5) + 0.5) / 256.0, 0.5));
}

vec3 maskCoord(vec3 p) { return (uToMask * vec4(p, 1.0)).xyz; }

// Colour of a label surface: step inward (up the mask gradient) until we land in a class that is
// actually drawn with that style (channel 1 = solid, 2 = glass), so neighbours never bleed colour in.
vec4 surfaceClass(vec3 mc, vec3 inwardT, int channel) {
  for (int k = 0; k < 4; k++) {
    float lv = texture(uLabel, mc + inwardT * (0.5 + float(k) * 0.8)).r;
    int id = int(lv * 255.0 + 0.5);
    if (texelFetch(uStyle, ivec2(id, 0), 0)[channel] > 0.01) return classLookup(lv);
  }
  return classLookup(texture(uLabel, mc + inwardT * 1.4).r);
}

uniform float uGradStencil;   // central-difference offset in voxels (wider = smoother on noisy data)
uniform float uSkinVeil;      // 1 = keep the skin boundary of gated-out tissue as a veil (cinematic)

vec3 volGrad(vec3 tc) {
  vec3 d = uGradStencil / uDims;
  float gx = texture(uVol, tc + vec3(d.x, 0.0, 0.0)).r - texture(uVol, tc - vec3(d.x, 0.0, 0.0)).r;
  float gy = texture(uVol, tc + vec3(0.0, d.y, 0.0)).r - texture(uVol, tc - vec3(0.0, d.y, 0.0)).r;
  float gz = texture(uVol, tc + vec3(0.0, 0.0, d.z)).r - texture(uVol, tc - vec3(0.0, 0.0, d.z)).r;
  vec3 h = uGradStencil * uSize / uDims;
  return vec3(gx, gy, gz) * uHuRange / (2.0 * h);   // HU per mm
}

// 1 = inside the gated-in region, 0 = gated out (smooth, from the blurred label mask)
uniform vec2 uGateRamp;       // mask.r ramp: low edge, high edge (wide = soft halo, narrow = crisp cut)

float gateIn(vec4 m, float hu) {
  float g = smoothstep(uGateRamp.x, uGateRamp.y, m.r);
#ifdef BONE_PROTECT
  // dense voxels always count as bone, except right at the skin, where the sharp reconstruction
  // kernel overshoots (> +200 HU) and would otherwise sparkle
  g = max(g, smoothstep(110.0, 230.0, hu) * (1.0 - smoothstep(0.02, 0.15, m.a)));
#endif
  return g;
}

vec3 shadeColor(vec3 base, vec3 n, vec3 V, float amt, float vis) {
  n = dot(n, V) < 0.0 ? -n : n;
  float ndl = max(dot(n, uLight), 0.0);
  vec3 H = normalize(uLight + V);
  float spec = pow(max(dot(n, H), 0.0), uMat.w) * uMat.z;
  float hemi = 0.5 + 0.5 * dot(n, uUp);
  vec3 lit = base * (uMat.x * mix(0.55, 1.2, hemi) + uMat.y * ndl * vis) + vec3(spec * vis);
  vec3 flatC = base * (uMat.x + uMat.y * 0.5);
  return mix(flatC, lit, amt);
}

#if defined(USE_SHADOWS) && defined(MODE_TF)
float shadowRay(vec3 p, vec3 L, float jit) {
  float T = 1.0;
  float st = 2.4;
  float t = st * (0.35 + jit);
  for (int i = 0; i < 14; i++) {
    vec3 q = p + L * t;
    if (any(lessThan(q, uClipMin)) || any(greaterThan(q, uClipMax))) break;
    float v = texture(uVol, q / uSize).r;
    float a = tfLookup(v).a * uOpacity * (1.0 - 0.6 * uGrad.z);
#ifdef USE_GATE
    a *= mix(uGateFloor * uGateFloor * 0.5, 1.0, gateIn(texture(uMask, maskCoord(q)), uHuMin + v * uHuRange));
#endif
    T *= pow(1.0 - min(a, 0.98), st);
    if (T < 0.03) break;
    t += st;
  }
  return T;
}
#endif

void main() {
  vec3 ro = uCam;
  vec3 rd = normalize(vPosX - uCam);
  vec3 rdS = vec3(
    abs(rd.x) < 1e-6 ? 1e-6 : rd.x,
    abs(rd.y) < 1e-6 ? 1e-6 : rd.y,
    abs(rd.z) < 1e-6 ? 1e-6 : rd.z);
  vec3 inv = 1.0 / rdS;
  vec3 ta = (uClipMin - ro) * inv;
  vec3 tb = (uClipMax - ro) * inv;
  vec3 tmin = min(ta, tb);
  vec3 tmax = max(ta, tb);
  float tNear = max(max(tmin.x, tmin.y), tmin.z);
  float tFar = min(min(tmax.x, tmax.y), tmax.z);
  float tStart = max(tNear, 0.0);
  if (tFar <= tStart) { fragColor = vec4(0.0); return; }

  // Which clip face did the ray enter through? Cut faces get flat, solid "capping".
  vec3 capN = vec3(0.0);
  float capOn = 0.0;
  if (tNear > 0.0) {
    if (tmin.x >= tmin.y && tmin.x >= tmin.z) {
      capOn = rd.x > 0.0 ? uCapMin.x : uCapMax.x; capN = vec3(rd.x > 0.0 ? -1.0 : 1.0, 0.0, 0.0);
    } else if (tmin.y >= tmin.z) {
      capOn = rd.y > 0.0 ? uCapMin.y : uCapMax.y; capN = vec3(0.0, rd.y > 0.0 ? -1.0 : 1.0, 0.0);
    } else {
      capOn = rd.z > 0.0 ? uCapMin.z : uCapMax.z; capN = vec3(0.0, 0.0, rd.z > 0.0 ? -1.0 : 1.0);
    }
  }

  float jit = fract(ign(gl_FragCoord.xy) + uFrame * 0.61803398875);
  float t = tStart + jit * uStep;
  vec3 V = -rd;
  vec3 hitP = vec3(-1.0);

#if defined(MODE_DRR)
  float sum = 0.0;
  float best = -1e9;
  for (int i = 0; i < MAX_STEPS; i++) {
    if (t > tFar) break;
    vec3 p = ro + rd * t;
    float v = texture(uVol, p / uSize).r;
    float hu = uHuMin + v * uHuRange;
    sum += max(hu + 1000.0, 0.0) + uWin.z * max(hu - 120.0, 0.0);
#ifdef PROBE
    if (hu > best) { best = hu; hitP = p; }
#endif
    t += uStep;
  }
  float wet = sum * 0.001 * uStep;                 // mm of water-equivalent material
  float x = clamp((wet - uWin.x) / uWin.y, 0.0, 1.0);
  float I = pow(x, uWin.w);
  I = mix(I, I * I * (3.0 - 2.0 * I), 0.6);        // film toe + shoulder
  vec3 film = vec3(I) * vec3(0.965, 0.985, 1.0);
  float cover = smoothstep(4.0, 55.0, wet);        // air-only / grazing rays fade out instead of going black
#ifdef PROBE
  fragColor = best > -500.0 ? vec4(hitP / uSize, 1.0) : vec4(0.0);
#else
  fragColor = vec4(toLinear(film), 1.0) * cover;
#endif

#elif defined(MODE_MIP)
  float mx = 0.0;
  for (int i = 0; i < MAX_STEPS; i++) {
    if (t > tFar) break;
    vec3 p = ro + rd * t;
    float v = texture(uVol, p / uSize).r;
    if (v > mx) { mx = v; hitP = p; }
    t += uStep;
  }
  float hu = uHuMin + mx * uHuRange;
  float I = clamp((hu - uWin.x) / uWin.y, 0.0, 1.0);
  float cover = smoothstep(-960.0, -760.0, hu);    // air-only rays stay transparent
#ifdef PROBE
  fragColor = hu > -500.0 ? vec4(hitP / uSize, 1.0) : vec4(0.0);
#else
  fragColor = vec4(toLinear(vec3(I)), 1.0) * cover;
#endif

#else
  // ---------------- compositing modes (TF and/or label surfaces) ----------------
  vec4 acc = vec4(0.0);
  vec3 dM = 1.0 / uMaskDims;
  mat3 J = mat3(uToMask);
  mat3 Jt = transpose(J);
  for (int i = 0; i < MAX_STEPS; i++) {
    if (t > tFar) break;
    vec3 p = ro + rd * t;
    vec3 tc = p / uSize;
    float capW = capOn * (1.0 - smoothstep(0.0, 2.5, t - tNear));

#if defined(USE_GATE) || defined(USE_SOLID) || defined(USE_GLASS) || defined(USE_TINT)
    vec3 mc = maskCoord(p);
#endif
#if defined(USE_GATE) || defined(USE_SOLID) || defined(USE_GLASS)
    vec4 m = texture(uMask, mc);
#endif

#ifdef MODE_TF
    {
      float v = texture(uVol, tc).r;
      vec4 c = tfLookup(v);
      float a = c.a * uOpacity;
      float gIn = 1.0;
#ifdef USE_GATE
      gIn = gateIn(m, uHuMin + v * uHuRange);
      a *= mix(uGateFloor, 1.0, gIn);
#endif
      if (a > 0.0003) {
        vec3 g = volGrad(tc);
        float gm = length(g);
        float edge = smoothstep(uGrad.x, uGrad.y, gm);
        // Gated-in tissue: normal gradient modulation. Gated-out tissue (e.g. the body wall) keeps
        // only its outer skin boundary (next to outside air, mask.a) as a veil; its interior fades
        // much faster, so internal boundaries do not stack up into a haze.
        float modIn = mix(1.0, edge, uGrad.z);
#ifdef USE_GATE
        float skin = smoothstep(0.03, 0.3, m.a) * uSkinVeil;
        float fl = uGateFloor;
        float modOut = skin * edge * edge + (1.0 - skin) * fl * fl * modIn;
        a *= mix(mix(modOut, modIn, gIn), 1.0, capW);
#else
        a *= mix(modIn, 1.0, capW);
#endif
        vec3 n = gm > 1e-3 ? -g / gm : V;
        n = normalize(mix(n, capN, capW));
        vec3 base = c.rgb;
#ifdef USE_TINT
        {
          vec3 inward = gm > 1e-3 ? g / gm : -V;
          vec3 lc = mc + J * (inward * 1.2);
          vec4 cl = classLookup(texture(uLabel, lc).r);
          base = mix(base, toLinear(cl.rgb) * 0.9, cl.a);
        }
#endif
#ifdef USE_SHADING
        float vis = 1.0;
#ifdef USE_SHADOWS
        if (uShadows > 0.5 && a * uStep > 0.03) {
          vis = shadowRay(p, uLight, fract(jit * 7.31 + float(i) * 0.137));
        }
#endif
        vec3 col = shadeColor(base, n, V, max(edge, capW), vis);
#else
        vec3 col = base;
#endif
        float alpha = 1.0 - pow(1.0 - min(a, 0.995), uStep);
        acc.rgb += (1.0 - acc.a) * alpha * col;
        acc.a += (1.0 - acc.a) * alpha;
      }
    }
#endif

#if defined(USE_SOLID) || defined(USE_GLASS)
    if (m.g > 0.18 || (m.b > 0.015 && m.b < 0.985)) {
      vec3 o = dM * 1.5;   // wide stencil = smoother normals on the blurred label masks
      vec4 x1 = texture(uMask, mc + vec3(o.x, 0.0, 0.0));
      vec4 x0 = texture(uMask, mc - vec3(o.x, 0.0, 0.0));
      vec4 y1 = texture(uMask, mc + vec3(0.0, o.y, 0.0));
      vec4 y0 = texture(uMask, mc - vec3(0.0, o.y, 0.0));
      vec4 z1 = texture(uMask, mc + vec3(0.0, 0.0, o.z));
      vec4 z0 = texture(uMask, mc - vec3(0.0, 0.0, o.z));
#ifdef USE_SOLID
      {
        float sa = smoothstep(0.22, 0.44, m.g) * uSolidAlpha;
        if (sa > 0.001) {
          vec3 gT = vec3(x1.g - x0.g, y1.g - y0.g, z1.g - z0.g) / (2.0 * o);   // per texture unit
          vec3 gX = Jt * gT;                                                   // per mm
          float gl = length(gX);
          vec3 n = gl > 1e-4 ? -gX / gl : V;
          n = normalize(mix(n, capN, capW));
          vec3 inwardT = length(gT) > 1e-4 ? normalize(gT * dM) * dM : vec3(0.0);
          vec4 cl = surfaceClass(mc, inwardT, 1);
          vec3 base = toLinear(cl.rgb);
          vec3 col = shadeColor(base, n, V, 1.0, 1.0);
          float alpha = 1.0 - pow(1.0 - min(sa, 0.995), uStep);
          acc.rgb += (1.0 - acc.a) * alpha * col;
          acc.a += (1.0 - acc.a) * alpha;
        }
      }
#endif
#ifdef USE_GLASS
      if (m.b > 0.015 && m.b < 0.985) {
        vec3 gT = vec3(x1.b - x0.b, y1.b - y0.b, z1.b - z0.b) / (2.0 * o);
        vec3 gX = Jt * gT;
        float gl = length(gX);
        if (gl > 1e-4) {
          vec3 n = -gX / gl;
          float facing = abs(dot(n, V));
          float fres = 0.12 + 0.88 * pow(1.0 - facing, 3.0);
          vec3 inwardT = normalize(gT * dM) * dM;
          vec4 cl = surfaceClass(mc, inwardT, 2);
          float ga = uGlass * gl * fres;     // glass strength is baked into mask.b
          if (ga > 0.0005) {
            vec3 base = toLinear(cl.rgb);
            vec3 nn = dot(n, V) < 0.0 ? -n : n;
            vec3 H = normalize(uLight + V);
            float spec = pow(max(dot(nn, H), 0.0), 60.0) * 0.9;
            vec3 col = base * (0.55 + 0.45 * max(dot(nn, uLight), 0.0)) + vec3(spec);
            float alpha = 1.0 - pow(1.0 - min(ga, 0.95), uStep);
            acc.rgb += (1.0 - acc.a) * alpha * col;
            acc.a += (1.0 - acc.a) * alpha;
          }
        }
      }
#endif
    }
#endif

#ifdef PROBE
    if (hitP.x < 0.0 && acc.a > 0.35) hitP = clamp(p + rd * 1.2, uClipMin, uClipMax);   // just inside the surface
#endif
    if (acc.a > 0.985) break;
    t += uStep;
  }
#ifdef PROBE
  fragColor = hitP.x >= 0.0 ? vec4(hitP / uSize, 1.0) : vec4(0.0);
#else
  fragColor = acc;
#endif
#endif
}
`

/** Full-screen triangle. */
export const screenVert = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/** Accumulated premultiplied linear colour -> sRGB canvas, soft highlight shoulder + dither. */
export const displayFrag = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 shoulder(vec3 x) {
  const float k = 0.82;
  vec3 over = max(x - k, 0.0);
  return min(x, vec3(k)) + over / (1.0 + over / (1.0 - k));
}
void main() {
  vec4 c = texture(uTex, vUv);
  float a = clamp(c.a, 0.0, 1.0);
  if (a < 1e-4) { fragColor = vec4(0.0); return; }
  vec3 rgb = shoulder(max(c.rgb / a, 0.0));
  rgb = pow(rgb, vec3(1.0 / 2.2));
  rgb += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(clamp(rgb, 0.0, 1.0) * a, a);
}
`

/**
 * Bakes AI label ids into a smooth RGBA mask volume, one z-layer per draw:
 * per-class style (r gate, g solid, b glass) blurred with a [1 2 1]^3 kernel.
 */
export const bakeFrag = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
uniform sampler3D uLabel;
uniform sampler2D uStyle;
uniform int uLayer;
uniform ivec3 uDims;
out vec4 fragColor;
void main() {
  ivec3 c = ivec3(int(gl_FragCoord.x), int(gl_FragCoord.y), uLayer);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int dz = -1; dz <= 1; dz++)
  for (int dy = -1; dy <= 1; dy++)
  for (int dx = -1; dx <= 1; dx++) {
    ivec3 q = clamp(c + ivec3(dx, dy, dz), ivec3(0), uDims - 1);
    int lab = int(texelFetch(uLabel, q, 0).r * 255.0 + 0.5);
    vec4 s = texelFetch(uStyle, ivec2(lab, 0), 0);
    float w = float((2 - abs(dx)) * (2 - abs(dy)) * (2 - abs(dz)));
    acc += s * w;
    wsum += w;
  }
  fragColor = acc / wsum;
}
`

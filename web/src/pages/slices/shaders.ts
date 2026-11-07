/**
 * GLSL for the MPR renderer. One full-viewport triangle per view; the fragment shader reconstructs the
 * patient-space (LPS mm) point of each pixel and samples every grid through its own inverse affine:
 *   - CT volume: R16I 3D texture, manual trilinear interpolation (integer textures can't filter)
 *   - anatomy labels: R8UI, nearest, colours from a 256x1 RGBA LUT
 *   - calcium candidates: R8UI, nearest, own LUT
 * Slabs (MIP / MinIP / average) are integrated along the plane normal in the shader.
 */

export const VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

export const FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp isampler3D;
precision highp usampler3D;
precision highp sampler2D;

uniform isampler3D uVol;
uniform usampler3D uLab;
uniform usampler3D uLes;
uniform sampler2D uLabLut;
uniform sampler2D uLesLut;

uniform mat4 uVolM;
uniform mat4 uLabM;
uniform mat4 uLesM;
uniform ivec3 uVolDims;
uniform vec2 uVolK;         // k range holding image data (blank padding slices at the stack ends lie outside)
uniform ivec3 uLabDims;
uniform ivec3 uLesDims;

// pixel -> LPS:  p = uP0 + uPdx * gl_FragCoord.x + uPdy * gl_FragCoord.y
uniform vec3 uP0;
uniform vec3 uPdx;
uniform vec3 uPdy;
uniform vec3 uN;

uniform vec2 uWin;          // (low HU, 1 / width)
uniform int uSlabMode;      // 0 none, 1 MIP, 2 MinIP, 3 average
uniform int uSlabN;
uniform float uSlabStep;

uniform int uLabOn;         // label texture uploaded
uniform int uLabMode;       // 0 off, 1 fill, 2 outline
uniform float uLabAlpha;
uniform int uSel;           // selected structure id (0 = none)
uniform int uHov;           // hovered structure id (0 = none)
uniform float uEdge;        // outline neighbour distance in device px
uniform int uLesOn;
uniform int uCalcOn;
uniform float uCalcThr;
uniform vec3 uBg;

out vec4 outColor;

float vox(ivec3 c) { return float(texelFetch(uVol, c, 0).r); }

float sampleHU(vec3 p, out bool inside) {
  vec3 g = (uVolM * vec4(p, 1.0)).xyz;
  vec3 lo = vec3(0.0, 0.0, uVolK.x);
  vec3 hi = vec3(vec2(uVolDims.xy) - 1.0, uVolK.y);
  inside = all(greaterThanEqual(g, lo - 0.5)) && all(lessThan(g, hi + 0.5));
  if (!inside) return -1024.0;
  vec3 gc = clamp(g, lo, hi);
  vec3 f = floor(gc);
  vec3 t = gc - f;
  ivec3 a = ivec3(f);
  ivec3 b = min(a + 1, ivec3(hi));
  float c000 = vox(a);
  float c100 = vox(ivec3(b.x, a.y, a.z));
  float c010 = vox(ivec3(a.x, b.y, a.z));
  float c110 = vox(ivec3(b.x, b.y, a.z));
  float c001 = vox(ivec3(a.x, a.y, b.z));
  float c101 = vox(ivec3(b.x, a.y, b.z));
  float c011 = vox(ivec3(a.x, b.y, b.z));
  float c111 = vox(b);
  float x00 = mix(c000, c100, t.x);
  float x10 = mix(c010, c110, t.x);
  float x01 = mix(c001, c101, t.x);
  float x11 = mix(c011, c111, t.x);
  return mix(mix(x00, x10, t.y), mix(x01, x11, t.y), t.z);
}

// Label lookup with smooth boundaries: the label holding the largest trilinear weight among the 8
// surrounding voxels ("majority" interpolation). Contours become piecewise-linear instead of blocky.
int smoothId(usampler3D tex, mat4 M, ivec3 dims, vec3 p) {
  vec3 g = (M * vec4(p, 1.0)).xyz;
  vec3 dimsF = vec3(dims);
  if (any(lessThan(g, vec3(-0.5))) || any(greaterThan(g, dimsF - 0.5))) return 0;
  vec3 gc = clamp(g, vec3(0.0), dimsF - 1.0);
  vec3 f = floor(gc);
  vec3 t = gc - f;
  ivec3 a = ivec3(f);
  ivec3 b = min(a + 1, dims - 1);
  int ids[8];
  ids[0] = int(texelFetch(tex, a, 0).r);
  ids[1] = int(texelFetch(tex, ivec3(b.x, a.y, a.z), 0).r);
  ids[2] = int(texelFetch(tex, ivec3(a.x, b.y, a.z), 0).r);
  ids[3] = int(texelFetch(tex, ivec3(b.x, b.y, a.z), 0).r);
  ids[4] = int(texelFetch(tex, ivec3(a.x, a.y, b.z), 0).r);
  ids[5] = int(texelFetch(tex, ivec3(b.x, a.y, b.z), 0).r);
  ids[6] = int(texelFetch(tex, ivec3(a.x, b.y, b.z), 0).r);
  ids[7] = int(texelFetch(tex, b, 0).r);
  bool same = true;
  for (int i = 1; i < 8; i++) same = same && ids[i] == ids[0];
  if (same) return ids[0];
  vec3 s = 1.0 - t;
  float ws[8];
  ws[0] = s.x * s.y * s.z; ws[1] = t.x * s.y * s.z; ws[2] = s.x * t.y * s.z; ws[3] = t.x * t.y * s.z;
  ws[4] = s.x * s.y * t.z; ws[5] = t.x * s.y * t.z; ws[6] = s.x * t.y * t.z; ws[7] = t.x * t.y * t.z;
  int best = 0;
  float bestW = -1.0;
  for (int i = 0; i < 8; i++) {
    float acc = 0.0;
    for (int j = 0; j < 8; j++) acc += ids[j] == ids[i] ? ws[j] : 0.0;
    if (acc > bestW + 1e-5) { bestW = acc; best = ids[i]; }
  }
  return best;
}

int labelAt(vec3 p) { return smoothId(uLab, uLabM, uLabDims, p); }
int lesionAt(vec3 p) { return smoothId(uLes, uLesM, uLesDims, p); }

void main() {
  vec3 p = uP0 + uPdx * gl_FragCoord.x + uPdy * gl_FragCoord.y;
  bool inside;
  float hu;
  if (uSlabMode == 0) {
    hu = sampleHU(p, inside);
  } else {
    float acc = uSlabMode == 1 ? -1.0e9 : (uSlabMode == 2 ? 1.0e9 : 0.0);
    int cnt = 0;
    for (int s = 0; s < 160; s++) {
      if (s >= uSlabN) break;
      float o = (float(s) - 0.5 * float(uSlabN - 1)) * uSlabStep;
      bool ins;
      float v = sampleHU(p + uN * o, ins);
      if (!ins) continue;
      cnt++;
      if (uSlabMode == 1) acc = max(acc, v);
      else if (uSlabMode == 2) acc = min(acc, v);
      else acc += v;
    }
    inside = cnt > 0;
    hu = uSlabMode == 3 ? acc / float(max(cnt, 1)) : acc;
  }
  if (!inside) { outColor = vec4(uBg, 1.0); return; }

  float gv = clamp((hu - uWin.x) * uWin.y, 0.0, 1.0);
  vec3 col = vec3(gv);

  // >= 130 HU: red tint that keeps the windowed brightness (so it stays readable in any window)
  if (uCalcOn == 1 && hu >= uCalcThr) {
    col = mix(col, vec3(1.0, 0.17, 0.24) * (0.42 + 0.58 * gv), 0.8);
  }

  if (uLabOn == 1 && (uLabMode != 0 || uSel > 0 || uHov > 0)) {
    int l = labelAt(p);
    if (l > 0) {
      vec4 lc = texelFetch(uLabLut, ivec2(l, 0), 0);
      // hover rings only for structures in visible groups; an explicit selection always shows
      bool hov = l == uHov && lc.a > 0.5;
      bool hot = l == uSel || hov;
      bool edge = false;
      bool ring = false;
      if (uLabMode == 2 || hot) {
        vec3 ex = uPdx * uEdge;
        vec3 ey = uPdy * uEdge;
        edge = labelAt(p + ex) != l || labelAt(p - ex) != l || labelAt(p + ey) != l || labelAt(p - ey) != l;
        // hovered / selected structures get a 2 px ring
        ring = edge || (hot && (labelAt(p + 2.0 * ex) != l || labelAt(p - 2.0 * ex) != l || labelAt(p + 2.0 * ey) != l || labelAt(p - 2.0 * ey) != l));
      }
      if (uLabMode == 1) col = mix(col, lc.rgb, lc.a * uLabAlpha);
      else if (uLabMode == 2) col = mix(col, lc.rgb, lc.a * uLabAlpha * (edge ? 1.0 : 0.09));
      if (l == uSel) col = ring ? mix(col, mix(lc.rgb, vec3(1.0), 0.35), 0.95) : mix(col, lc.rgb, 0.28);
      else if (hov) col = ring ? mix(col, vec3(1.0), 0.88) : mix(col, lc.rgb, 0.12);
    }
  }

  if (uLesOn == 1) {
    int id = lesionAt(p);
    if (id > 0) {
      vec4 c = texelFetch(uLesLut, ivec2(id, 0), 0);
      col = mix(col, c.rgb, 0.92 * c.a);
    }
  }
  outColor = vec4(col, 1.0);
}
`

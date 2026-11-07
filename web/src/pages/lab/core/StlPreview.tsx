/** Small R3F turntable that shows an STL as if it had just come off a 3D printer. */
import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Finish, StlStats } from './finishes'

/** Parse a binary/ASCII STL into a smooth, plate-centred geometry (+ basic stats). */
export function prepareStl(buffer: ArrayBuffer): { geometry: THREE.BufferGeometry; stats: StlStats } {
  let g = new STLLoader().parse(buffer)
  const triangles = g.getAttribute('position').count / 3
  g.deleteAttribute('normal')
  g = mergeVertices(g, 1e-4)
  g.computeVertexNormals()
  g.computeBoundingBox()
  const bb = g.boundingBox!
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2
  g.translate(-cx, -bb.min.y, -cz)                  // stand it on the build plate
  g.computeBoundingBox()
  g.computeBoundingSphere()
  // signed volume (divergence theorem) in mm^3
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const idx = g.getIndex()
  let vol = 0
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const n = idx ? idx.count : pos.count
  for (let i = 0; i < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2)
    vol += a.dot(b.cross(c)) / 6
  }
  const s = new THREE.Vector3()
  g.boundingBox!.getSize(s)
  return { geometry: g, stats: { triangles, volumeCm3: Math.abs(vol) / 1000, size: [s.x, s.y, s.z] } }
}

function usePrintedMaterial(f: Finish): THREE.MeshPhysicalMaterial {
  const mat = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(f.color),
      roughness: f.roughness,
      metalness: f.metalness,
      clearcoat: f.clearcoat ?? 0,
      clearcoatRoughness: 0.45,
      transmission: f.transmission ?? 0,
      thickness: f.transmission ? 28 : 0,
      ior: 1.5,
      attenuationColor: new THREE.Color('#9fcfff'),
      attenuationDistance: f.transmission ? 220 : Infinity,
      sheen: f.key === 'silk-gold' ? 0.4 : 0,
      sheenColor: new THREE.Color('#fff1c4'),
    })
    // Layer lines: a soft stripe every `layer` mm along the print's vertical axis, faded out
    // (screen-space derivative) whenever the stripes get too dense to draw without aliasing.
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uLayer = { value: f.layer }
      shader.uniforms.uAmp = { value: f.amp }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vLcY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLcY = position.y;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vLcY;\nuniform float uLayer;\nuniform float uAmp;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float lcT = vLcY / uLayer;
          float lcFade = clamp(1.0 - fwidth(lcT) * 1.8, 0.0, 1.0);
          float lcS = pow(0.5 + 0.5 * cos(6.2831853 * lcT), 3.0);
          diffuseColor.rgb *= 1.0 - uAmp * lcS * lcFade;`,
        )
    }
    m.customProgramCacheKey = () => `lc-print-${f.layer}-${f.amp}`
    return m
  }, [f])
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

function Printed(props: { geometry: THREE.BufferGeometry; finish: Finish }) {
  const mat = usePrintedMaterial(props.finish)
  return <mesh geometry={props.geometry} material={mat} castShadow receiveShadow />
}

export function StlPreview(props: {
  geometry: THREE.BufferGeometry
  finish: Finish
  spin: boolean
  active: boolean
  height: number
}) {
  const { geometry, finish, spin, active, height } = props
  const target: [number, number, number] = [0, height * 0.46, 0]
  return (
    <Canvas
      className="lc-canvas"
      style={{ position: 'absolute', inset: 0 }}
      dpr={[1, 2]}
      frameloop={active ? 'always' : 'never'}
      camera={{ fov: 30, near: 5, far: 4000, position: [270, height * 1.05 + 90, 360] }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
    >
      <hemisphereLight args={['#e8f0ff', '#2a1f1a', 0.75]} />
      <directionalLight position={[160, 320, 220]} intensity={2.1} />
      <directionalLight position={[-220, 120, -160]} intensity={0.75} color="#9fd8ff" />
      <directionalLight position={[0, 60, 320]} intensity={0.35} color="#ffd6dc" />
      <Printed geometry={geometry} finish={finish} />
      {/* build plate */}
      <mesh position={[0, -2.6, 0]} receiveShadow>
        <boxGeometry args={[250, 5, 250]} />
        <meshStandardMaterial color="#141b25" roughness={0.85} metalness={0.15} />
      </mesh>
      <Grid
        position={[0, 0.05, 0]}
        args={[250, 250]}
        cellSize={10}
        cellThickness={0.6}
        cellColor="#1f2d3b"
        sectionSize={50}
        sectionThickness={1.1}
        sectionColor="#2a5568"
        fadeDistance={1400}
        fadeStrength={1}
      />
      <ContactShadows position={[0, 0.12, 0]} scale={300} resolution={512} blur={2.4} opacity={0.75} far={170} frames={1} />
      <OrbitControls
        makeDefault
        target={target}
        enablePan={false}
        enableZoom={false}
        enableDamping
        rotateSpeed={0.7}
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI / 2 - 0.04}
        autoRotate={spin}
        autoRotateSpeed={1.4}
      />
    </Canvas>
  )
}

import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { withCurve } from '../../core/curve.js'
import { withLocalReflections } from '../../world/reflections.js'
import { helmetGeometry, screenGeometry, visorGeometry } from '../../agents/model.js'

/**
 * Everything the space colony's crew *wears*: helmet, visor, backpack, antenna, blinking
 * tip and chest lamp, the working hammer, and the screen-face patch that lies on the visor.
 *
 * The engine owns the instancing — one `InstancedMesh` per entry, one matrix write per
 * agent per frame — and knows nothing about what a helmet is. This hook owns the geometry,
 * the materials, and the table that says which bone each part hangs off, how far above it,
 * whether it casts a shadow, which per-agent colour tints it, and whether it exists at all
 * outside the working clip.
 *
 * The order of `parts` is the order the engine allocates materials in, and three sorts
 * opaque draws by material id — so it is the order that keeps the frame the same.
 *
 * `cues` sits outside all of that: a helper wears a beacon on its helmet crown, and the
 * engine asks for it the first time a subagent puts one on the map, never at boot.
 *
 * The helmet, the glass visor over a recessed screen, the antenna with its tip on the shaft's
 * own transform, and the suit-white antenna and backpack are upstream's refined crew
 * (38b6562, merged 2026-09-24 from d05ac2f); the geometry is his `agents/model.js`.
 */

/**
 * Where the worn parts sit relative to the bone they hang off, in the mannequin's own
 * units — the root transform carries the crew scale, so everything downstream of a bone is
 * measured in the rig's space and stays put if that scale is ever retuned.
 */
const P = {
  helmetR: 0.48,
  headUp: 0.40, // the head bone sits at the neck; the helmet centres above it
  packZ: -0.3,
  packUp: 0.06,
  // The antenna stands on the crown of the helmet rather than out of its side, so it reads
  // at the distance the colony is normally looked at instead of turning into a loose speck.
  antX: 0.16,
  antY: 0.82,
  antZ: -0.05,
  antRx: 0.06,
  antRz: -0.12,
  // Where the helper's beacon sits: the old tip position, lowered with the helmet.
  tipX: 0.2,
  tipY: 1.08,
  lightZ: 0.26,
  lightY: 0.05,
  // The hammer, in the right hand's own frame. The hand bone's own +Y runs back down the
  // forearm, so the shaft is turned through half a circle to stand the head up out of the
  // fist rather than hang it through the floor.
  gripX: 0,
  gripY: -0.04,
  gripZ: 0.02,
  gripRx: 0,
  gripRz: Math.PI,
}

/** A part's local offset from its bone. Kept as plain data so the engine can just read it. */
const at = (x, y, z, rx = 0, ry = 0, rz = 0) => ({ x, y, z, rx, ry, rz })

/**
 * @param {object} manifest
 * @param {{ reflections?: object }} [ctx]  the crew's local-reflection uniforms, which the
 *   visor glass samples (upstream's `SceneryReflections`); without them it takes the sky's.
 */
export function props(manifest, { reflections = null } = {}) {
  // Everything worn is measured off the helmet, so the suit stays in proportion if the
  // rig is ever scaled again.
  const R = P.helmetR
  const parts = []

  // Helmet shell, with a real opening for the visor and the screen recessed behind it.
  parts.push({
    name: 'helmet',
    geometry: helmetGeometry(R),
    material: suit(0.34, { vertexColors: true, metalness: 0.03, envMapIntensity: 0.9 }),
    role: 'worn',
    bone: 'head',
    offset: at(0, P.headUp, 0),
    castShadow: true,
    tint: 'suit',
    when: null,
  })

  // A clear protective window over the opening. The opaque screen sits behind it; the
  // shell's inner wall naturally occludes the display as the viewing angle changes.
  parts.push({
    name: 'visor',
    geometry: visorGeometry(R),
    material: visorMaterial(reflections),
    role: 'worn',
    bone: 'head',
    offset: at(0, P.headUp, 0),
    castShadow: false,
    tint: null,
    when: null,
  })

  // Backpack + a life-support cylinder on each side.
  parts.push({
    name: 'pack',
    geometry: roundedBox(R * 0.89, R * 0.98, R * 0.55, R * 0.19),
    material: suit(0.66),
    role: 'worn',
    bone: 'chest',
    offset: at(0, P.packUp, P.packZ),
    castShadow: true,
    tint: 'suit',
    when: null,
  })

  parts.push({
    name: 'antenna',
    geometry: antennaGeometry(R),
    material: suit(0.34, { metalness: 0.03 }),
    role: 'worn',
    bone: 'head',
    offset: at(P.antX, P.antY, P.antZ, P.antRx, 0, P.antRz),
    castShadow: true,
    tint: 'suit',
    when: null,
  })

  // The blinking bits: antenna tip and chest lamp. Unlit and pushed past 1.0 so they
  // are the things the bloom pass picks out at night. The tip is authored at the shaft's
  // end and worn on the shaft's exact transform: independent offsets drift off centre when
  // the antenna leans.
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true })
  const tipGeo = new THREE.SphereGeometry(R * 0.105, 12, 8)
  tipGeo.translate(0, ANTENNA_H * R, 0)
  const lampGeo = new THREE.SphereGeometry(R * 0.16, 6, 5)
  parts.push({
    name: 'tip',
    geometry: tipGeo,
    material: glowMat,
    role: 'worn',
    bone: 'head',
    offset: at(P.antX, P.antY, P.antZ, P.antRx, 0, P.antRz),
    castShadow: false,
    tint: 'pulseEye',
    when: null,
  })
  parts.push({
    name: 'lamp',
    geometry: lampGeo,
    material: glowMat.clone(),
    role: 'worn',
    bone: 'chest',
    offset: at(0, P.lightY, P.lightZ),
    castShadow: false,
    tint: 'pulseTrim',
    when: null,
  })

  // The hammer, held in the right hand while a thread is running. Wood and steel rather
  // than suit white, so it reads as a tool at the distance the colony is watched from.
  parts.push({
    name: 'hammer',
    geometry: hammerGeometry(R),
    material: suit(0.62, { vertexColors: true }),
    role: 'worn',
    bone: 'hand',
    offset: at(P.gripX, P.gripY, P.gripZ, P.gripRx, 0, P.gripRz),
    castShadow: true,
    tint: null,
    when: 'working',
  })

  // Face: the shallow curved CRT inside the helmet, separated from the glass by air. The
  // material is the engine's: it samples the expression atlas the faces hook paints, so only
  // the engine can build it.
  parts.push({
    name: 'face',
    geometry: screenGeometry(R),
    material: null,
    role: 'face',
    bone: 'head',
    offset: at(0, P.headUp, 0),
    castShadow: false,
    tint: 'eye',
    when: null,
  })

  /** The head bone sits at the neck; the helmet centres this far above it. */
  return { headLift: P.headUp, parts, cues: { helper: helperBeacon } }
}

/**
 * What a helper wears that no other astronaut does: a beacon on the crown of its helmet, in
 * the colour of the repo its parent's thread belongs to.
 *
 * The same story as the village's cap, told in this colony's own vocabulary. The space crew
 * glb has no static nodes at all — every part here is procedural — so there is nothing to
 * wear as a hat; the tip sphere is the prop that already sits on the crown, and at ~2.6× on
 * the other side of it, in a flat repo colour, it is a marker light rather than a blinker.
 * Mirrored to `−tipX` because the antenna and its tip own the `+x` side.
 *
 * A factory rather than an entry in `parts`: nothing here is constructed until a helper
 * exists, which is what keeps the four frozen space baselines frozen. `toneMapped` and the
 * unlit material match the tip beside it, so the bloom pass treats them alike; the tint is
 * `accent` rather than `pulseEye`, because a cue that blinks is a cue you can miss.
 */
function helperBeacon() {
  const R = P.helmetR
  return [
    {
      name: 'beacon',
      geometry: new THREE.SphereGeometry(R * 0.33, 8, 6),
      material: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true }),
      role: 'worn',
      bone: 'head',
      offset: at(-P.tipX, P.tipY - 0.06, P.antZ),
      castShadow: false,
      tint: 'accent',
      when: null,
    },
  ]
}

// ── geometry ──────────────────────────────────────────────────────────────────────────

// The suit is painted fabric-over-hardshell: fairly rough, not metallic, but glossy
// enough on the helmet to catch a highlight off the environment map.
const suit = (roughness, extra = {}) =>
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 0.04, ...extra })

/**
 * Clear outer glass, with a restrained reflection and a thin edge highlight (upstream
 * 38b6562). Alpha blending avoids a transmission buffer or an extra scene render per frame.
 */
function visorMaterial(reflections) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.08, metalness: 0, ior: 1.46,
    transparent: true, opacity: 1, depthWrite: false, envMapIntensity: 1,
  })
  mat.onBeforeCompile = (shader) => {
    withCurve(shader)
    if (reflections) withLocalReflections(shader, reflections)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float facing = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
       float fresnel = 0.035 + 0.965 * pow( 1.0 - facing, 5.0 );
       // A thin window has two air/glass interfaces. Sum their reflections while
       // preserving the transmission through to the recessed display.
       float windowReflectance = 2.0 * fresnel / ( 1.0 + fresnel );
       diffuseColor.a = windowReflectance;
       // Physical specular already contains Fresnel. Undo the subsequent alpha
       // multiplication so glass reflections aren't attenuated a second time.
       // Reflect the HDR environment, including the planet's sun/clouds. Analytic
       // directional specular adds a second, needle-sharp dot to every visor.
       outgoingLight = reflectedLight.indirectSpecular / max( fresnel, 0.035 );
       #include <opaque_fragment>`
    )
  }
  return mat
}

/** The antenna's height, as a share of the helmet radius. The tip is authored at its end. */
const ANTENNA_H = 0.57

/** The stub the tip sits on, stood up so its base is at the bone rather than through it. */
function antennaGeometry(R) {
  const h = R * ANTENNA_H
  const geo = new THREE.CylinderGeometry(R * 0.035, R * 0.046, h, 8)
  geo.translate(0, h / 2, 0)
  return geo
}

/**
 * A claw hammer, in the rig's own units: a shaft with a steel head across the top.
 *
 * Coloured per vertex rather than per instance, because the two halves are different
 * materials and the instance colour is already spoken for by the suit palette.
 */
function hammerGeometry(R) {
  const shaft = new THREE.CylinderGeometry(R * 0.055, R * 0.07, R * 1.15, 6)
  shaft.translate(0, R * 0.24, 0)
  paint(shaft, 0x8a6440)

  // The head crosses the shaft. It is authored long along X, which is already square to the
  // shaft's Y — turning it a quarter turn about Z, as this used to, stood the head *up in
  // line with* the handle, so the astronaut appeared to be swinging a mallet end-on.
  const head = roundedBox(R * 0.5, R * 0.19, R * 0.19, R * 0.05)
  head.translate(0, R * 0.82, 0)
  paint(head, 0x9aa0a8)

  const merged = BufferGeometryUtils.mergeGeometries([shaft, head], false)
  shaft.dispose()
  head.dispose()
  return merged
}

/** Bake a flat colour into a geometry's vertex colours. */
function paint(geo, hex) {
  const c = new THREE.Color(hex)
  const n = geo.attributes.position.count
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** A cheap rounded box: a low-segment box with its corners pulled onto a sphere. */
function roundedBox(w, h, d, r) {
  const geo = new THREE.BoxGeometry(w, h, d, 2, 2, 2)
  const pos = geo.attributes.position
  const v = new THREE.Vector3()
  const half = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const inner = new THREE.Vector3(
      THREE.MathUtils.clamp(v.x, -half.x, half.x),
      THREE.MathUtils.clamp(v.y, -half.y, half.y),
      THREE.MathUtils.clamp(v.z, -half.z, half.z)
    )
    const out = v.clone().sub(inner)
    if (out.lengthSq() > 0) out.setLength(r)
    pos.setXYZ(i, inner.x + out.x, inner.y + out.y, inner.z + out.z)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}


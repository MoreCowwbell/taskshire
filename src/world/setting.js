import * as THREE from 'three'
import { atlasTexture, hasPart, kitReady, kitUsesVertexColors, part } from './kit.js'
import { mulberry } from '../core/rng.js'
import { withCurve } from '../core/curve.js'

/**
 * The terrain and scatter generators, and nothing else.
 *
 * A setting is nothing but a bag of colours and a couple of switches — terrain, scatter,
 * sky and lighting all read from the same preset. The presets are worlds from the library
 * (`src/worlds/`) wearing the active theme's dressing, and the scatter recipes they name live
 * in that theme's manifest (`src/themes/<id>/manifest.js`), so adding a world is a data change
 * rather than a code change, and a theme dresses the library without touching this file.
 */

export const GROUND_SIZE = 340
/** The one seed the terrain field is built from, by the mesh and by the sampler alike. */
const TERRAIN_SEED = 1337
/** Everything inside this radius is the buildable colony, and is kept nearly flat. */
export const COLONY_RADIUS = 46
const DETAIL_SEGMENTS = { low: 72, medium: 128, high: 190 }

/**
 * Terrain is one plane, displaced and vertex-coloured on the CPU at build time. Doing it
 * once and baking it into the buffer means the GPU only ever sees static geometry — no
 * displacement map sample, no per-frame work — and vertex colours give the surface its
 * mottling for free rather than costing a texture fetch.
 *
 * **One builder for every world.** Our village's worlds and upstream's (merged 2026-09-24 from
 * d05ac2f) used to run two copies of this, picked by a theme flag. They differ only in what a
 * world's data says — the layers of its height field (see `groundHeight`), the shore it paints
 * and how hard it darkens its far field — so each difference is a branch on that data, and a
 * world renders the floats it always rendered whichever theme it stands in.
 */
export function createTerrain(setting, detail) {
  const segments = DETAIL_SEGMENTS[detail] || DETAIL_SEGMENTS.medium
  const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, segments, segments)
  geo.rotateX(-Math.PI / 2)

  const field = fieldFor(setting)
  const noise = field.noise
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)

  const low = new THREE.Color(setting.ground.low)
  const high = new THREE.Color(setting.ground.high)
  const tint = new THREE.Color(setting.ground.tint)
  const c = new THREE.Color()

  /**
   * The beach, painted rather than modelled.
   *
   * The bare strip between the last hay bale and the water is a *height* band — nothing is
   * planted under `level + SHORE_BAND` — and until now it was whatever the `low`→`high` ramp
   * happened to paint down there, which on this valley is the same green as the meadow. A
   * gentler bank makes that strip eleven units wide instead of six, which is eleven units of
   * green running into blue: more beach, and still no beach.
   *
   * So `coast.sand` is mixed in over the band the bank passes through, full at the waterline
   * and gone at both ends of it. The top is `level + SHORE_BAND + 3`, three units above the
   * line the scatter guard draws, so the sand fades out through the first row of things
   * growing on the bank rather than stopping short of it.
   *
   * **It was `+ 1` until 2026-09-12.** A band that ended a unit above the scatter guard is
   * five units of bank, and five units of bank at the top of the default frame is a strip
   * — inside the tilt-shift blur, with the surf's white hard against it, so the tan read as
   * a pale seam rather than as sand. Widening it to seven is the cheapest thing that gives
   * the colour enough pixels to be a colour; the swatch itself is the kit's own tan and did
   * not move.
   *
   * **The foot runs two units *under* the waterline.** It was cut that way for the flat sea the
   * valley had until 2026-09-30, whose swell and 3.5-unit quads exposed a hand's width of bed
   * seaward of the line; the sea is upstream's now (`water.js`), and it shows more of the bed
   * rather than less. Its shallows are see-through — about 0.55 opaque against 0.92 over deep
   * water — and its swell troughs `waveHeight` under the level, so the sand under the first
   * units of water is what reads as the shallows through the turquoise, and sand that stopped
   * dead at the line would draw a hard green edge along the one thing the wobble exists to make
   * curved.
   *
   * **And the band is gated on the water's reach, not on height alone.** Height alone is a
   * statement about the whole map: any dry hollow that happens to sit between `level - 2` and
   * `level + SHORE_BAND + 1` paints tan, and out in the far-field hills at r 60 to 80 there are
   * several — the worst measured 0.75 of full sand at (27, 75), a tan patch in the middle of a
   * meadow with no water within a hundred units of it. `shoreReach` is where the sea's own
   * smoothstep begins, so gating on it says what was meant all along: this is beach, and beach
   * is ground the sea reaches. The gate costs nothing at its own edge, because the drop there
   * is zero by construction and the sand weight with it.
   *
   * Optional, and a branch rather than a lerp by zero: a coast with no `sand` — and every
   * setting with no coast at all — paints the float it always painted. The bank and its sand
   * are the `coast`'s; the line the sand is measured from is the sea's own `water.level`.
   */
  const water = setting.water
  const coast = setting.coast
  const sand = coast?.sand !== undefined ? new THREE.Color(coast.sand) : null
  const sandLevel = sand ? water.level : 0
  const sandAxis = sand ? coast.axis : null

  /**
   * Upstream's beach, the other way a world paints one: `shore.color` over a band measured in
   * height around the waterline, `shore.band` of it, with no reach gate — his water sits in the
   * terrain's own hollows, so any ground that close to the level is shore. Then the bed: ground
   * under a level-and-colours sea darkens toward `water.deep`, so the shallows read as shallows
   * through the water. A sea behind a `coast` paints its own sand down the bank and no bed. Each
   * is a branch on the data it reads, so a world without that data paints what it always painted.
   */
  const shore = setting.shore ? new THREE.Color(setting.shore.color) : null
  const bed = water && !coast ? new THREE.Color(water.deep).multiplyScalar(0.45) : null
  const level = water?.level ?? -Infinity
  const band = setting.shore?.band ?? 0
  const farShade = setting.farShade ?? FAR_SHADE
  const shadeFrom = COLONY_RADIUS * farShade.from
  const shadeTo = GROUND_SIZE * farShade.to

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const dist = Math.hypot(x, z)
    const y = groundHeight(x, z, field, setting)
    pos.setY(i, y)

    // Colour: height-driven blend, mottled with a second noise band so it never bands.
    const shade = THREE.MathUtils.clamp(0.42 + y * 0.09 + fbm(noise, x * 0.09, z * 0.09, 2) * 0.5, 0, 1)
    c.copy(low).lerp(high, shade)
    const speck = fbm(noise, x * 0.55, z * 0.55, 1)
    c.lerp(tint, Math.max(0, speck) * 0.22)
    if (sand && x * sandAxis[0] + z * sandAxis[1] >= shoreReach(x, z, setting)) {
      const k = sandWeight(y, sandLevel)
      if (k > 0) c.lerp(sand, k)
    }
    if (shore && band > 0) {
      const above = y - level
      const dry = 1 - THREE.MathUtils.smoothstep(above, band * 0.55, band * 1.25)
      const wet = 1 - THREE.MathUtils.smoothstep(-above, 0, 2.5)
      c.lerp(shore, THREE.MathUtils.clamp(dry * wet, 0, 1) * 0.92)
    }
    if (bed && y < level) {
      c.lerp(bed, THREE.MathUtils.clamp((level - y) / 6, 0, 1))
    }
    // Darken the far field so the eye settles on the colony and the hills read as a silhouette
    // rather than as more ground competing with the plots for attention. See `FAR_SHADE`.
    c.multiplyScalar(1 - THREE.MathUtils.smoothstep(dist, shadeFrom, shadeTo) * farShade.amount)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
    // Flat-ish shading keeps the low-poly read; a dielectric surface with no spec highlight
    // is what sells "dust" rather than "plastic".
    envMapIntensity: 0.3,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.receiveShadow = true
  mesh.name = 'terrain'

  if (setting.shape === 'sky') {
    // A floating island has ground exactly where the colony's hex cells are, plus a margin
    // of grass, and nothing anywhere else. The plane still has to exist — the height field
    // is sampled off it — so the fragments outside the footprint are thrown away instead,
    // measured in the shader as the distance to the nearest cell centre. The footprint is
    // handed in by the colony whenever a zone grows or shrinks; the island grows with it.
    const cells = { value: Array.from({ length: SKY_MAX_CELLS }, () => new THREE.Vector2(1e6, 1e6)) }
    const uniforms = { uSkyCells: cells, uSkyCellCount: { value: 0 }, uSkyReach: { value: 8 } }
    mat.onBeforeCompile = (shader) => {
      withCurve(shader)
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n varying vec2 vSkyXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vSkyXZ = transformed.xz;')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec2 vSkyXZ;
           uniform vec2 uSkyCells[ ${SKY_MAX_CELLS} ];
           uniform int uSkyCellCount;
           uniform float uSkyReach;
           float bcHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
           float bcNoise( vec2 p ) {
             vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
             return mix( mix( bcHash( i ), bcHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( bcHash( i + vec2( 0.0, 1.0 ) ), bcHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
           }`
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
           {
             float bcNear = 1e9;
             for ( int i = 0; i < ${SKY_MAX_CELLS}; i++ ) {
               if ( i >= uSkyCellCount ) break;
               bcNear = min( bcNear, distance( vSkyXZ, uSkyCells[ i ] ) );
             }
             // The edge is ragged, not a run of arcs: the reach wanders with a little noise,
             // so the grass frays over the rock lip in bites and tongues.
             float bcFray = bcNoise( vSkyXZ * 0.55 ) * 0.7 + bcNoise( vSkyXZ * 1.7 ) * 0.3;
             if ( bcNear > uSkyReach * ( 0.78 + 0.34 * bcFray ) ) discard;
           }`
        )
    }
    mat.customProgramCacheKey = () => 'bc-terrain-sky'
    mesh.userData.setFootprint = (list, reach) => {
      const n = Math.min(list.length, SKY_MAX_CELLS)
      for (let i = 0; i < SKY_MAX_CELLS; i++) {
        if (i < n) cells.value[i].set(list[i].x, list[i].z)
        else cells.value[i].set(1e6, 1e6)
      }
      uniforms.uSkyCellCount.value = n
      uniforms.uSkyReach.value = reach
    }
  }

  // Sampler so anything placed later can sit exactly on the surface.
  mesh.userData.heightAt = (x, z) => groundHeight(x, z, field, setting)
  return mesh
}

/**
 * How the far field darkens, so the eye settles on the colony: by `amount` at most, ramping in
 * from `from × COLONY_RADIUS` out to `to × GROUND_SIZE`. A world's `farShade` overrides it.
 *
 * This is the village's, and it is hard on purpose: the hills read as a silhouette rather than
 * as more ground competing with the plots. Upstream's worlds carry a gentler one (0.55 over
 * 0.8–0.36), because a bright little world should stay bright to its edges. The two ends are
 * fractions of the two radii rather than distances because that is how both generators wrote
 * them, and `COLONY_RADIUS * 0.7` is a product a stored `32.2` would not reproduce to the ulp.
 */
const FAR_SHADE = { from: 0.7, to: 0.35, amount: 0.75 }

/** Where the sea is, on a coast: the far side of the default view, so you look out to it. */
const COAST_DIR = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 }
/** How far out the land ends on a coast. Past the colony, before the far hills. */
const COAST_OFFSET = 58
/** The island's outer islets start past here; the island itself is the colony's footprint. */
const ISLAND_RADIUS = 60
/** How far the beach runs out from the last hex cell before the bed drops into the sea. */
const ISLAND_BEACH = 5
const ISLAND_SHELF = 26
/** The hex cells the island is built around — the colony hands them over as it grows. */
let _islandCells = []
let _islandReach = ISLAND_RADIUS
/** How far under the sea the bed settles, on either shape. Deep enough to read as sea. */
const SEA_DEPTH = 7
/** How far past the plots a floating island's ground reaches: a grass margin, then nothing. */
export const SKY_MARGIN = 3.2
/** The most hex cells the sky terrain's cut-out can be told about. */
export const SKY_MAX_CELLS = 96

/**
 * The height field, every layer of it, in the order the layers are laid:
 *
 * 1. the bare ground — flat where the colony lives, then far-field hills that ramp in over the
 *    next forty metres, so nothing ever builds on a slope but the horizon still has shape — and
 *    what the landform does to those hills: `lakes` folds them, `hills` drives them, a `sky`
 *    shape flattens them, `dunes` lays ridges over them and a `clearing` starts them further
 *    out and holds the colony floor up to its `floor`;
 * 2. upstream's sea, on an `island` or a `coast`, with the islets out in it;
 * 3. the craters, dug down to the water on a `lakes` world;
 * 4. our half-plane coast and the ridges (`shapeValley`).
 *
 * Each family of worlds keeps the order it had — ours was ground → craters → bank → ridge,
 * upstream's ground → sea → craters — and one pipeline runs both because no world carries both
 * a shape sea and a half-plane one. Every layer is a branch on the world's data, never a
 * multiply by zero or one, so a world without it computes the floats it always computed.
 *
 * **One function, for the mesh and for everything standing on it.** `createTerrain` bakes the
 * mesh from this and `terrainHeight` places the scatter, the crew and the buildings with it, and
 * the two have to agree to the last float or scatter floats above the ground it sampled. A
 * formula written out twice is a formula that can gain a term on one side only, and `hills`
 * was exactly such a term.
 *
 * **`hills`** is an optional per-setting multiplier on the far-field term (default 1), which is
 * how a setting gets real relief past its plots without touching the floor the colony is built
 * on: the term is already zero inside `COLONY_RADIUS - 6` and only fully in at 40 units past it,
 * and the `gentle` term the flat middle is made of does not take the multiplier at all. It is
 * applied as a **branch rather than as a multiply by one**. `x * 1` is exact in IEEE 754 for
 * every finite float, so the arithmetic would survive either way — but the order of the
 * multiplies would not be the order it was, and the baselines are compared byte for byte.
 *
 * **`lakes`** is for a world whose water is meant to sit in its hollows — lakes, ponds, lava
 * pools. The far field has to stay *above* the waterline there, or every dip in the hills floods
 * and the colony ends up on an island it was never meant to be on, so the broad noise is folded:
 * its valleys turn into ridges, and only the crater bowls dip below the surface. Upstream
 * inferred it from "has water and is not an island or a coast"; it is declared on the world
 * instead, because that rule would fold the valley, whose sea lies behind a half-plane bank, not in a hollow.
 *
 * **`clearing`** (`{ from, to, floor }`, see `src/worlds/clearing.js`) is for the short worlds,
 * whose far field rose so close to the plots that the burial guard and the village's skirt test
 * refused most of the outer rings. Two changes, both on the bare ground only, so the sea,
 * the craters, the lakes, the half-plane coast and the ridges are laid over them as before:
 *
 * - the far-field term is multiplied by a second ramp, off inside `from` and full at `to`, so
 *   the hills and the hollows between them move out together. Lowering the hills alone would
 *   not have done: in the village most of the refused cells were hollows under the skirt, not
 *   hills over the deck;
 * - inside the colony radius the ground never sinks below `floor`, blended back to the bare
 *   ground over the twenty units past it.
 *
 * Measured with the guard as it stood, over rings 0 to 11: the twelve short worlds dealt
 * between 36 and 49 cells in the village and, in space, between 38 and 48 on the five worlds
 * whose hills were closest, which is fewer than the owner's 61 tiles. With the clearing every
 * one of them deals between 66 (village Luna) and 228 (space Terra), with the rule that keeps a
 * deck out of the water on as well. The rest view sees only the top band of the change, the far
 * side of the colony, where the ground moves by at most about four units (Dune), three
 * (Mountain) and three (Cinder); the floor lift moves ground in view by at most a fifth of a
 * unit.
 */
function groundHeight(x, z, field, setting) {
  const { noise, craters, islets } = field
  const dist = Math.hypot(x, z)
  const outside = THREE.MathUtils.smoothstep(dist, COLONY_RADIUS - 6, COLONY_RADIUS + 40)
  const gentle = fbm(noise, x * 0.035, z * 0.035, 3) * 0.5
  let broad = fbm(noise, x * 0.012, z * 0.012, 4)
  if (setting.lakes) broad = Math.abs(broad) * 0.9 + 0.08
  let far = broad * 9 + fbm(noise, x * 0.05, z * 0.05, 2) * 1.4
  if (setting.hills !== undefined && setting.hills !== 1) far *= setting.hills
  const shape = setting.shape
  // A floating island is only as big as the colony on it, and everything past that is cut
  // away in the terrain shader (see createTerrain); the field itself stays gentle out there
  // so the rim is level with the plots.
  if (shape === 'sky') far *= 0.15
  else if (shape === 'dunes') {
    // Long ridges running one way, bent by noise so they read as wind-blown rather than
    // corrugated. Faint inside the colony, tall past it.
    const bend = fbm(noise, x * 0.01, z * 0.01, 2) * 18
    const ridge = Math.pow(0.5 + 0.5 * Math.sin((x * 0.7 + z * 0.3) * 0.13 + bend), 1.6)
    far += ridge * 4.5 - 1.5
  }
  // A world with a `clearing` holds its hills further off, and never lets the colony floor
  // sink under a deck's skirt. Both are branches, like `hills`: a world without one computes
  // the floats it always did, and the lift is gated on distance too, because past the blend
  // `floor + (y - floor) * 1` is not always `y` to the last bit.
  const clearing = setting.clearing
  if (clearing) far *= THREE.MathUtils.smoothstep(dist, clearing.from, clearing.to)
  let y = gentle * setting.roughness * (1 - outside) + far * outside * setting.roughness
  if (clearing && y < clearing.floor && dist < COLONY_RADIUS + 20)
    y = clearing.floor + (y - clearing.floor) * THREE.MathUtils.smoothstep(dist, COLONY_RADIUS, COLONY_RADIUS + 20)

  let sea = 0 // 0 on land, 1 where the sea bed has fully taken over
  if (shape === 'island') {
    // Land is the colony's own hex footprint plus a beach, and the sea takes over past
    // that — so a repo claiming a tile pushes the coast out, and a repo folding away lets
    // the water back in. The waterline wanders a little so it is a coast, not a stencil.
    let near = dist
    for (let i = 0; i < _islandCells.length; i++) {
      const c = _islandCells[i]
      const d = Math.hypot(x - c.x, z - c.z)
      if (d < near || i === 0) near = d
    }
    const wobble = fbm(noise, x * 0.03 + 5, z * 0.03 + 9, 2) * 6
    sea = THREE.MathUtils.smoothstep(near + wobble, _islandReach, _islandReach + ISLAND_SHELF)
  } else if (shape === 'coast') {
    const along = x * COAST_DIR.x + z * COAST_DIR.z
    // The waterline wanders, or the beach is a ruler.
    const wobble = fbm(noise, x * 0.02 + 7, z * 0.02 + 3, 2) * 9
    sea = THREE.MathUtils.smoothstep(along + wobble, COAST_OFFSET - 4, COAST_OFFSET + 32)
  }
  if (sea > 0) {
    // Hills sink with the land rather than poking up out of the water as pinnacles. The bed
    // falls away slowly at first and steeply later, which is what makes a beach a beach.
    y = y * (1 - sea) - SEA_DEPTH * Math.pow(sea, 1.7)
    for (const islet of islets) {
      const d = Math.hypot(x - islet.x, z - islet.z)
      if (d > islet.r) continue
      const t = 1 - d / islet.r
      y += islet.h * t * t * (3 - 2 * t) * sea
    }
  }

  for (const crater of craters) {
    const d = Math.hypot(x - crater.x, z - crater.z)
    if (d > crater.r * 1.5) continue
    // A bowl with a raised rim — the rim is what makes it read as an impact.
    const t = d / crater.r
    if (t < 1) {
      if (setting.lakes) {
        // On a lake world the bowl is dug down to the *water*, not down from the ground, so
        // every crater is a lake and none is a dry dent on top of a folded hill.
        const floor = setting.water.level - crater.depth * 0.5
        y = Math.min(y, floor + (y - floor) * t * t)
      } else {
        y -= (1 - t * t) * crater.depth
      }
    } else {
      y += (1 - Math.abs(t - 1.22) / 0.28) * crater.depth * 0.32
    }
  }

  // The half-plane coast and the wall, last, over whatever the layers above left.
  return shapeValley(y, x, z, noise, setting)
}

/**
 * How far inland the sea's drop begins and how far past the shoreline it finishes.
 *
 * The pair are the *shape of the bank*, and they are exported because they are a contract
 * rather than a tuning knob: `Colony._blockedCells` and `Colony._rebuildNavigation` both
 * short-circuit inland of where the smoothstep can reach, and a band that grew while that
 * literal stayed at 10 would fence the crew out of ground the sea never touches — or, worse,
 * let a plot be dealt on ground the sea has just taken.
 *
 * Thirty units between them rather than the eighteen this replaces, and the valley's `depth`
 * comes down from 10 to 7 to go with it: the slope through the steep middle of the smoothstep
 * falls from about 0.7 world units per unit along the axis to about 0.35, which is half. What
 * that buys is the beach. `SHORE_BAND` (4) is measured in *height*, so the bare strip between
 * the last hay bale and the water is however far the ground takes to climb four units — six
 * units of ground on the old cliff, about eleven on this one. Six units is a kerb; eleven is
 * a beach, and with `coast.sand` painted on it, it reads as one.
 *
 * They are not symmetric on purpose. The landward half is longer because that is the half the
 * camera sees: the drop starts gently well back from the water and steepens as it arrives.
 */
export const SHORE_IN = 16
export const SHORE_OUT = 14

/**
 * How far along the shore the harbour holds the waterline still, and where the coast is free
 * to wander again.
 *
 * `coast.wobble` bends the shoreline, and a bent shoreline under a pier that was measured
 * against a straight one is a pier with its legs in the air or its head buried in a headland.
 * Every distance in `boat.js` — the reach out, the freeboard, the berth, the threshold — is a
 * measurement against the waterline at the dock's own shore coordinate, so that coordinate is
 * pinned: the wobble is multiplied by a smoothstep that is 0 within `WOBBLE_PIN` of it and 1
 * past `WOBBLE_FREE`.
 *
 * Twelve and twenty-eight: twelve covers the harbour's own footprint — the pier head reaches
 * 10.9 seaward of the cell and the ship's berth 14.77, but both of those are measured *along*
 * the axis, and what has to be flat is the run *across* it, which is the pier's width and the
 * ship's 12.92 of length centred on the cell, so a little under 7 either way. Sixteen units of
 * ramp past that is long enough that the mask's own edge is not a visible kink: measured on
 * the valley, the waterline moves 2.7 units over those 16, a slope of about a seventh, which
 * is gentler than the bays the noise makes on its own. (`amp: 9` is the *ceiling* on the bend,
 * not what the ramp actually spends — the fbm is nowhere near its extreme at the mask's edge.)
 */
const WOBBLE_PIN = 12
const WOBBLE_FREE = 28

/**
 * Hex cell size, and the flat-top axial→world map, duplicated from `plots.js`.
 *
 * `plots.js` already imports `mulberry` from this file, so importing `hexToWorld` back would
 * close a module cycle for two lines of arithmetic. `plots.js`'s `CELL` and `hexToWorld` are
 * the source of truth; this is the one thing the terrain needs from the lattice — where the
 * ceremony's cell falls along the shore — and it is arithmetic with no state in it.
 */
const HEX_CELL = 7.6

/**
 * The dock's coordinate *along* the shore, or `null` for a setting whose sea no ceremony
 * stands on. See `WOBBLE_PIN`.
 *
 * A setting that declares a `coast` but no `ceremony` pins nothing, and that is the right answer
 * rather than a gap: the mask exists to hold the waterline still under measurements somebody
 * took against it, and a coast with no arrival on it has none. Its shore is free to bend from
 * end to end.
 */
function dockAlongShore(setting) {
  const cell = setting.ceremony?.cell
  if (!cell) return null
  const x = HEX_CELL * 1.5 * cell.q
  const z = HEX_CELL * Math.sqrt(3) * (cell.r + cell.q / 2)
  return shoreCoord(x, z, setting.coast.axis)
}

/**
 * How far along the *shore* a point lies — the perpendicular of `coast.axis`, which is the
 * coordinate the coast wanders as a function of. `axis` is a unit vector, so its perpendicular
 * `(-az, ax)` is one too and this is a distance in world units.
 */
const shoreCoord = (x, z, axis) => -x * axis[1] + z * axis[0]

/**
 * Where the waterline stands at a point: `coast.from`, bent by the wobble and held still in
 * front of the harbour.
 *
 * A coast with no `wobble` returns `coast.from` and evaluates nothing, which is what keeps
 * a coast that was authored straight exactly as straight as it was.
 */
function shoreAt(x, z, noise, coast, dockP) {
  const wobble = coast.wobble
  if (!wobble) return coast.from
  const p = shoreCoord(x, z, coast.axis)
  let bend = fbm(noise, p * wobble.scale, 0, 2) * wobble.amp
  if (dockP !== null) bend *= THREE.MathUtils.smoothstep(Math.abs(p - dockP), WOBBLE_PIN, WOBBLE_FREE)
  return coast.from + bend
}

/**
 * How far along `coast.axis` the sea's influence begins at a point — the wobbled, harbour-
 * pinned shoreline less `SHORE_IN`. Seaward of it the ground is on the bank; inland of it the
 * smoothstep contributes exactly nothing and the terrain is the plain dry field every setting
 * without water has.
 *
 * **It is a line, not a number, which is the whole reason it is exported.** Three callers
 * outside this file used to compare against `from` less a constant — the sand blend, the
 * allocator's skirt test and the navigation grid's wet test — and a constant has to carry
 * slack for the bend, which means it is wrong on both sides at once: too far inland everywhere
 * the coast happens to bulge seaward, and only just far enough where it does not. The slack was
 * measurable. Nine valley cells failed the deck-skirt test on far-field hill noise the sea
 * never reaches, one of them out in ring four.
 *
 * This is the same expression `shapeValley` itself uses, off the same memoised noise, so there
 * is no slack anywhere and no way for the two to drift apart. One fbm, and none at all for a
 * coast with no `wobble`.
 *
 * @param {number} x
 * @param {number} z
 * @param {object} setting  must carry a `coast`; a setting without one has no shore to reach.
 * @returns {number} signed distance along `coast.axis`
 */
export function shoreReach(x, z, setting) {
  return shoreAt(x, z, fieldFor(setting).noise, setting.coast, dockAlongShore(setting)) - SHORE_IN
}

/**
 * A coast down one side of the map and a mountain wall up the other, in that order, and then
 * the coast's sea bed deepened under the water (`coast.bed`), last of all.
 *
 * Both are optional and both are *signed distance along an axis*, not a radius: `axis` is a
 * unit vector in the ground plane and `d = x·ax + z·az` is how far along it a point lies, so
 * `d > from` is a half-plane — one shoreline across the picture rather than a ring
 * around the colony. That is the whole difference between a valley with a sea on one side
 * and the island this replaces.
 *
 * The coast's `from` is no longer one number, though the ridge's still is: `coast.wobble`
 * makes it a function of how far along the shore a point lies, which is what gives the valley
 * bays and headlands instead of a ruled line. Everything downstream follows it for free —
 * `blockedCells`, the navigation predicate, the scatter guards and the waterline tests all ask
 * `terrainHeight`, and `terrainHeight` is this. See `shoreAt` for the bend and `WOBBLE_PIN`
 * for why it stops in front of the harbour.
 *
 * It is the last layer of `groundHeight`, which both bakes the mesh and places everything that
 * stands on it; a single float of disagreement between the two is scatter hovering above the
 * ground or sunk into it.
 *
 * Each half is a branch, never a multiply by zero: a setting with neither field returns `y`
 * untouched, which is what keeps a dry world's floats exactly what they always were. The bank
 * is ours only — a world's `coast`; upstream's worlds have no bank here, because his terrain
 * makes its hollows and his shapes (`shape: 'coast'`, a different field) make his coasts.
 */
function shapeValley(y, x, z, noise, setting) {
  const coast = setting.coast
  if (coast) {
    const d = x * coast.axis[0] + z * coast.axis[1]
    const from = shoreAt(x, z, noise, coast, dockAlongShore(setting))
    y -= THREE.MathUtils.smoothstep(d, from - SHORE_IN, from + SHORE_OUT) * coast.depth
  }
  // One ridge or several: the mountain carries two, one entering across the top of the frame
  // and one closing the top right. They *add*, so where two half-planes overlap the ground is
  // the sum of both climbs rather than the deeper of them — which is what puts a high shoulder
  // in the corner the two ranges meet in. Spelled as a branch on the array rather than as a
  // `[].concat`, because this is the hottest function in the file: the mesh calls it once per
  // vertex and the crew calls it every frame, and neither wants a one-element array each time.
  const ridge = setting.ridge
  if (ridge) {
    if (Array.isArray(ridge)) for (const one of ridge) y = liftRidge(y, x, z, noise, one)
    else y = liftRidge(y, x, z, noise, ridge)
  }
  /**
   * The bed, deepened by `coast.bed` wherever the ground is already under the water, and nowhere
   * else: the depth under `level` is scaled, so ground on the waterline stays on it and every
   * dry point keeps its float to the bit — the beach, the sand, the dock, the door, every cell
   * and the navigation grid read exactly what they read before. Raising the bank's `depth`
   * instead would have moved the beach and every measurement the harbour was built against.
   *
   * **Last, after the ridge, not straight after the bank.** The ridge *adds*, so ground the bank
   * took under the water can come back above it once the ridge's climb is on: scaled before the
   * climb, such a point is dug out and then lifted by the same amount as before, and lands short
   * of where it was. Measured: at (−60, −59), where the rise runs down into the sea, the ground
   * stands at −4.686, fourteen thousandths above the water, and scaling before the ridge put it
   * at −4.699, under it. Scaled here, on the final height, a dry point never enters the branch.
   *
   * A branch, like every other layer, so a coast with no `bed` computes the floats it always did.
   */
  if (coast?.bed) {
    const level = setting.water.level
    if (y < level) y = level - (level - y) * coast.bed
  }
  return y
}

/**
 * One ridge's climb, added to the ground under it.
 *
 * Noise on the *amplitude* rather than on the distance: a plain smoothstep is a ramp with a
 * machined edge, and breaking the height of the climb instead gives the massif spurs and
 * saddles while leaving where it starts exactly where `from` says.
 */
function liftRidge(y, x, z, noise, ridge) {
  const d = x * ridge.axis[0] + z * ridge.axis[1]
  return (
    y +
    THREE.MathUtils.smoothstep(d, ridge.from, ridge.from + ridge.width) *
      ridge.height *
      (0.55 + 0.45 * fbm(noise, x * 0.05, z * 0.05, 2))
  )
}

/** Craters only ever land outside the colony, so they never eat a build plot. */
function makeCraters(count, seed) {
  const rand = mulberry(seed ^ 0x9e37)
  const out = []
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2
    const d = COLONY_RADIUS + 14 + rand() * 110
    const r = 4 + rand() * 16
    out.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r, depth: r * (0.18 + rand() * 0.16) })
  }
  return out
}

/** The smaller islands out past the main one. Fixed per seed, like everything else here. */
function makeIslets(setting, seed) {
  if (setting.shape !== 'island') return []
  const rand = mulberry(seed ^ 0x51ed)
  const out = []
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2
    const d = ISLAND_RADIUS + ISLAND_SHELF + 18 + rand() * 60
    const r = 9 + rand() * 14
    // Tall enough to clear the sea bed *and* the waterline with room for a palm or two.
    out.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r, h: SEA_DEPTH + 1.6 + rand() * 2.2 })
  }
  return out
}

// ── scatter ───────────────────────────────────────────────────────────────────────────

/**
 * How a theme plants: the scatter style its dressing puts on every setting it resolves (see
 * `src/worlds/resolve.js`). Each key absent is the village's own, which is what every setting
 * planted before upstream's worlds arrived; the space colony's dressing carries his.
 *
 *   budget       candidates the main population throws at full density, halved on an island,
 *                which has much less usable ground
 *   spread       how far out a candidate lands: `'sqrt'` of a uniform draw, which is uniform in
 *                area, or that draw to a power — his 0.58 leans toward the colony. Two branches,
 *                because `pow(x, 0.5)` is not `sqrt` to the last bit
 *   groves       flora gathers into groves, at three more draws per candidate, taken or not
 *   retries      on a world with water, candidates per prop planted: the loop stops once the
 *                budget is planted, so 1 is exactly one candidate per prop, wet or dry
 *   kitFallback  `'whole'`: a recipe missing any part falls back whole to the primitives, and
 *                every population shares one material. `'filter'`: the parts in hand are used,
 *                the primitives only if that is nothing, and each kit gets a material of its own
 *   flora        which recipe makes a world of flora — rounder fallback shapes, a softer
 *                material, groves: the one it `is`, or every one it is `not`
 */
const SCATTER_STYLE = { budget: 900, spread: 'sqrt', groves: false, retries: 1, kitFallback: 'whole', flora: { is: 'flora' } }
/**
 * How far above the waterline the ground has to stand before anything is planted on it.
 *
 * It is measured in *height*, and the shore it clears is the slope that height buys: on the
 * valley's bank, about six units of bare ground, which at the top of the default frame is
 * the twenty pixels of beach that make the coast read as a coast rather than as a cut-out.
 * A metre of it would be two pixels.
 *
 * Which makes this a contract with every setting that declares `water`: `level` has to sit
 * at least this far *below* the flat ground the colony stands on, or the guard culls the
 * village's own meadow as surf. The valley's `level` is authored against it.
 */
export const SHORE_BAND = 4

/** How far *above* the waterline the sand fades to nothing. See the beach note in `createTerrain`. */
export const SAND_RISE = SHORE_BAND + 3

/** How far *below* the waterline the sand still paints, for the shallows that show it through the sea. */
export const SAND_FALL = 2

/**
 * How much `coast.sand` the ground at height `y` takes, on a shore whose waterline is `level`.
 *
 * Full at the line and smoothstepped to nothing at `level + SAND_RISE` going up and at
 * `level - SAND_FALL` going down. Callers gate it on `shoreReach` first — this answers about
 * height only, and height alone would paint dry inland hollows tan.
 */
export function sandWeight(y, level) {
  return y >= level
    ? 1 - THREE.MathUtils.smoothstep(y - level, 0, SAND_RISE)
    : 1 - THREE.MathUtils.smoothstep(level - y, 0, SAND_FALL)
}

/** The fallback when the kit has not loaded: the primitives this used to be made of. */
function fallbackShapes(isFlora) {
  const shapes = isFlora
    ? [new THREE.IcosahedronGeometry(0.5, 0), new THREE.ConeGeometry(0.42, 1.5, 5), new THREE.SphereGeometry(0.5, 6, 4)]
    : [
        new THREE.DodecahedronGeometry(0.55, 0),
        new THREE.IcosahedronGeometry(0.6, 0),
        new THREE.TetrahedronGeometry(0.72, 0),
      ]
  for (const g of shapes) g.computeVertexNormals()
  return shapes.map((geo) => ({ geo, sink: 0.25, size: [0.28, 0.83], tint: true, upright: false }))
}

/**
 * How far a prop that is not `upright` may be tilted about x, and leaned about z, from the
 * vertical it was authored on. Each is drawn independently in ±this.
 */
const TILT_LIMIT = 0.25
/**
 * The most of a tilted prop's height that can end up in the ground plane.
 *
 * `sin` of *twice* the limit, because the spin drawn between the tilt and the lean can put
 * both rotations on the same axis, where they add rather than combining in quadrature.
 */
const TILT_SIN = Math.sin(TILT_LIMIT * 2)

/**
 * How far a planted prop's body reaches from the point it stands on.
 *
 * The circumscribed radius in the ground plane, because the piece is spun freely about y: a
 * corner `ex` out on one axis and `ez` on the other sweeps `hypot(ex, ez)` as it turns, and an
 * axis extent is therefore not an upper bound on anything. Measured from the *origin* rather
 * than as half the width, since the origin is the point the instance is placed at and a piece
 * is free to be authored off-centre.
 *
 * A prop that is not `upright` is laid down with a tilt about x *and* a lean about z, each
 * drawn independently in ±`TILT_LIMIT`, and `TILT_SIN` is the fraction of the piece's height
 * that swings into the ground plane at the worst of it. Not the quadrature of the two: the
 * spin between them can bring both axes into line, and two quarter-radian rotations about one
 * axis are a half-radian one. A single-axis figure under-measured a tall prop tilted both ways
 * by a fifth of its reach.
 *
 * The height is the furthest the piece goes from its origin in *either* direction, because a
 * piece is free to be authored hanging below the point it is planted at — a fallen trunk, a
 * bough — and `max.y` alone measures nothing about one of those.
 *
 * The sum is an upper bound rather than the exact figure, and a tight one: swept over box
 * shapes from 0.2 × 20 × 0.2 to 8 × 0.2 × 8, on and off their own origin, across every tilt,
 * lean and spin the draw can deal, the worst body measured 0.999 of it.
 *
 * Deliberately *not* the navigation grid's `spread * scale * 0.65`: that number is shrunk on
 * purpose so the crew can walk between boulders, while this one has to keep a rock off a deck.
 */
export function scatterReach(kind, sx, sy, sz) {
  const geo = kind.geo
  if (!geo.boundingBox) geo.computeBoundingBox()
  const b = geo.boundingBox
  const ex = Math.max(Math.abs(b.min.x), Math.abs(b.max.x)) * sx
  const ez = Math.max(Math.abs(b.min.z), Math.abs(b.max.z)) * sz
  const ey = Math.max(Math.abs(b.min.y), Math.abs(b.max.y)) * sy
  return Math.hypot(ex, ez) + (kind.upright ? 0 : ey * TILT_SIN)
}

/**
 * Rocks, boulders and plants. All instanced, all placed with a deterministic RNG so the
 * same setting always looks the same, and all kept clear of the plots and walkways.
 *
 * **One scatter for every world, in the style the setting carries** (`SCATTER_STYLE`). Our
 * village's and upstream's (merged 2026-09-24 from d05ac2f) used to be two copies of this,
 * picked by a theme flag; each style now runs as a set of branches on its own options, float
 * for float and draw for draw what its copy ran. That includes the objects it creates and their
 * order — the fallback shapes, then the materials (one, or one per kit, each made the first time
 * a mesh asks for it), then the instanced meshes, main before rim before each ridge — because
 * three.js stamps every one with a UUID drawn from `Math.random`, and that stream seats the crew.
 *
 * Two things follow the setting's data rather than its style. Under the sea behind a `coast`
 * nothing is planted within `SHORE_BAND` of the waterline; under upstream's water anywhere else,
 * each recipe entry keeps to its `zone` (`land`, `shore` or `water`) against his shore band, and
 * what stands in the water floats on it. And `inside`, upstream's floating-island predicate, is
 * read whenever it is passed.
 */
export function createScatter(setting, recipes, density, keepClear = [], seed = 4242, inside = null) {
  const group = new THREE.Group()
  group.name = 'scatter'
  const budget = setting.budget ?? SCATTER_STYLE.budget
  const count = Math.round(budget * THREE.MathUtils.clamp(density, 0, 1) * (setting.shape === 'island' ? 0.5 : 1))
  if (count <= 0) return group

  const rand = mulberry(seed)
  const spread = setting.spread ?? SCATTER_STYLE.spread
  const groves = setting.groves ?? SCATTER_STYLE.groves
  const retries = setting.retries ?? SCATTER_STYLE.retries
  const whole = (setting.kitFallback ?? SCATTER_STYLE.kitFallback) === 'whole'
  const flora = setting.flora ?? SCATTER_STYLE.flora
  const isFlora = flora.is !== undefined ? setting.scatter === flora.is : setting.scatter !== flora.not

  /**
   * One recipe's kinds: its parts from their kits (the forest pack unless an entry names
   * another), or the primitives. `'whole'` takes the recipe only if every part is in hand;
   * `'filter'` takes the parts that are — the nature kit failing to load, say — and falls back
   * only if that is nothing. `fromKit` says whether any part came from a kit.
   */
  const kindsOf = (list) => {
    const entries = list.map((r) => ({ ...r, kit: r.kit || 'forest' }))
    const inHand = (r) => hasPart(r.part, r.kit)
    const kept = whole ? (entries.every(inHand) ? entries : []) : entries.filter(inHand)
    if (kept.length) return { fromKit: true, kinds: kept.map((r) => ({ ...r, geo: part(r.part, r.kit) })) }
    return { fromKit: false, kinds: fallbackShapes(isFlora).map((r) => ({ ...r, kit: 'forest', weight: 1 })) }
  }

  const { fromKit: ready, kinds } = kindsOf(recipes[setting.scatter] || recipes.rocks)

  // The material, made the first time a mesh asks for it. The pack's atlas carries the greens
  // and the greys, and the per-instance colour is a *tint* on top of it — white for anything
  // already the right colour, the setting's own rock for a boulder that has to belong to this
  // world; the vertex-coloured kit is the same idea over its vertices. `'whole'` has one for the
  // lot, textured when the main recipe is in hand; `'filter'` one per kit, textured when it is.
  const materials = new Map()
  const materialFor = (kit) => {
    const key = whole ? 'whole' : kit
    let m = materials.get(key)
    if (m) return m
    const textured = whole ? ready : kitReady(kit)
    m = new THREE.MeshStandardMaterial({
      map: textured ? atlasTexture(kit) : null,
      vertexColors: kitUsesVertexColors(kit),
      color: 0xffffff,
      roughness: isFlora ? 0.82 : 0.95,
      metalness: 0,
      flatShading: !textured,
    })
    materials.set(key, m)
    return m
  }

  const total = kinds.reduce((sum, k) => sum + k.weight, 0)
  const meshes = kinds.map((k) => {
    const m = new THREE.InstancedMesh(k.geo, materialFor(k.kit), Math.ceil((count * k.weight) / total) + 8)
    m.userData.upright = Boolean(k.upright)
    return m
  })

  const rock = new THREE.Color(setting.rock)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  const fill = new Array(kinds.length).fill(0)
  const water = setting.water
  const band = setting.shore?.band ?? 0.6

  /**
   * Every seeded draw one candidate makes, before any cull has looked at it.
   *
   * That ordering is the point twice over. The reach cannot be tested without the size, and
   * the size cannot be known without drawing it — and once every candidate spends the same
   * numbers whether it is planted or not, the ground stops depending on which tiles happened
   * to be kept clear. It used to: a culled candidate spent two draws and a planted one eight,
   * so a zone gaining a tile re-scattered the entire world.
   *
   * The draw order inside a candidate is exactly what it was: kind, size, tilt, spin, roll,
   * three scale jitters, three colour offsets.
   */
  const drawCandidate = (kindList, kindTotal, gain = 1) => {
    let roll = rand() * kindTotal
    let which = kindList.length - 1
    for (let k = 0; k < kindList.length; k++) {
      roll -= kindList[k].weight
      if (roll <= 0) {
        which = k
        break
      }
    }
    const kind = kindList[which]
    const [lo, hi] = kind.size
    const s = (lo + rand() * (hi - lo)) * gain
    const tilt = kind.upright ? 0 : (rand() - 0.5) * TILT_LIMIT * 2
    const spin = rand() * Math.PI * 2
    const lean = kind.upright ? 0 : (rand() - 0.5) * TILT_LIMIT * 2
    const jitter = kind.upright ? 0.14 : 0.35
    const sx = s * (1 - jitter / 2 + rand() * jitter)
    const sy = s * (1 - jitter / 2 + rand() * jitter)
    const sz = s * (1 - jitter / 2 + rand() * jitter)
    const hue = (rand() - 0.5) * 0.03
    const sat = (rand() - 0.5) * 0.08
    const lum = (rand() - 0.5) * 0.14
    return { which, kind, s, tilt, spin, lean, sx, sy, sz, hue, sat, lum, reach: scatterReach(kind, sx, sy, sz) }
  }

  /**
   * The height a candidate of `kind` stands at, at (x, z), or null where it may not stand.
   *
   * Nothing grows in the sea. Behind a `coast` nothing stands in the surf either: the ground
   * has to be `SHORE_BAND` clear of the waterline, which is what leaves the bare shore band
   * between the last hay bale and the blue. Under upstream's water anywhere else each entry
   * keeps to its zone against his shore band, and a prop in the water floats on it rather than
   * stand on the bed. Both tests are on *height* rather than distance, so they cull whatever
   * shape the coast happens to be; a setting with no water never evaluates either.
   */
  const standing = (kind, x, z) => {
    const y = sampleY(x, z, setting)
    if (!water) return y
    if (setting.coast) return y < water.level + SHORE_BAND ? null : y
    const above = y - water.level
    const zone = kind.zone || 'land'
    if (zone === 'land' && above < band * 0.7 + 0.1) return null
    if (zone === 'shore' && (above < 0.12 || above > band * 1.1)) return null
    if (zone === 'water' && (above > -0.05 || above < -1.2)) return null
    return zone === 'water' ? water.level : y
  }

  /** Placing one drawn candidate, once every cull has let it through, on ground `y`. */
  const plant = (mesh, slot, c, x, y, z) => {
    dummy.position.set(x, y - c.s * c.kind.sink, z)
    dummy.rotation.set(c.tilt, c.spin, c.lean)
    dummy.scale.set(c.sx, c.sy, c.sz)
    dummy.updateMatrix()
    mesh.setMatrixAt(slot, dummy.matrix)
    // Foliage keeps the colour it was painted; rock takes the setting's. The tint is lifted
    // because it *multiplies* the atlas rather than replacing it — the pack's stone is a
    // mid grey, and rust times mid grey is a much darker rust than the ground it sits on.
    if (c.kind.tint) color.copy(rock).multiplyScalar(1.55)
    else color.setRGB(1, 1, 1)
    color.offsetHSL(c.hue, c.sat, c.lum)
    mesh.setColorAt(slot, color)
  }

  // More candidates than props on a wet world, when the style asks: on a world that is mostly
  // sea, most throws land in it. The loop stops once the budget is planted either way.
  const attempts = water ? count * retries : count
  const grove = []
  let placed = 0
  for (let i = 0; i < attempts && placed < count; i++) {
    // Bias outward: a ring is thicker where there is more area, which √ gives for free; a
    // smaller power leans the ring back toward the colony.
    const a = rand() * Math.PI * 2
    let d = 9 + (spread === 'sqrt' ? Math.sqrt(rand()) : Math.pow(rand(), spread)) * 150
    let x = Math.cos(a) * d
    let z = Math.sin(a) * d
    // Mixed groups read as vegetation; isolated tiny trees read as scattered props. The three
    // draws are spent every time, joined or not, so the stream stays aligned whatever was
    // culled; which grove a candidate joins still depends on which were planted before it.
    if (groves && isFlora) {
      const join = rand()
      const pick = rand()
      const offsetRoll = rand()
      if (grove.length && join < 0.3) {
        const g = grove[Math.floor(pick * grove.length)]
        const offset = 1.2 + offsetRoll * 3
        x = g.x + Math.cos(a) * offset
        z = g.z + Math.sin(a) * offset
        d = Math.hypot(x, z)
      }
    }
    // Far-field props are allowed to be much bigger, which reads as distance.
    const far = THREE.MathUtils.smoothstep(d, COLONY_RADIUS, 130)
    const c = drawCandidate(kinds, total, 1 + far * 1.9)

    // Culls, all of them after the draws. The prop's *body* has to clear the plots and the
    // apron, not merely the point it was planted at.
    if (keepClear.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + c.reach)) continue
    if (inside && !inside(x, z)) continue

    const mesh = meshes[c.which]
    const slot = fill[c.which]
    if (slot >= mesh.instanceMatrix.count) continue
    const y = standing(c.kind, x, z)
    if (y === null) continue

    placed++
    if (groves && isFlora && c.kind.upright && (c.kind.zone || 'land') === 'land' && grove.length < 48) {
      if (!grove.some((g) => Math.hypot(x - g.x, z - g.z) < 6)) grove.push({ x, z })
    }
    plant(mesh, slot, c, x, y, z)
    fill[c.which] = slot + 1
  }

  meshes.forEach((mesh, i) => {
    mesh.count = fill[i]
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    group.add(mesh)
  })

  /**
   * The rim: what the camera actually sees past the plots. The default view never reaches
   * the horizon — the top of the frame is ground about 60 units out — so a setting's
   * landscape has to be built in the ring from the last plot to the edge of the picture.
   * A second, denser population there, from a recipe of the setting's own, at the sizes it
   * authors: the far-field growth the main scatter uses does not apply, because the rim is
   * close and wants to stay small and packed.
   *
   * It runs *after* the main population is finished, so every `rand` the main loop draws is
   * the one it always drew and a setting with no `rim` executes none of this at all.
   */
  const rim = setting.rim
  if (rim && recipes[rim.recipe]) {
    const rimCount = Math.round(rim.count * THREE.MathUtils.clamp(density, 0, 1))
    const { kinds: rimKinds } = kindsOf(recipes[rim.recipe])
    const rimTotal = rimKinds.reduce((sum, k) => sum + k.weight, 0)
    const rimMeshes = rimKinds.map((k) => {
      const m = new THREE.InstancedMesh(k.geo, materialFor(k.kit), Math.ceil((rimCount * k.weight) / rimTotal) + 8)
      m.userData.rim = true
      m.userData.upright = Boolean(k.upright)
      return m
    })
    const rimFill = new Array(rimKinds.length).fill(0)
    // Uniform in *area* across the annulus, which is what keeps the ring from crowding its
    // inner edge: √ of a uniform draw between the two squared radii.
    const inner2 = rim.inner * rim.inner
    const outer2 = rim.outer * rim.outer
    for (let i = 0; i < rimCount; i++) {
      const a = rand() * Math.PI * 2
      const d = Math.sqrt(inner2 + rand() * (outer2 - inner2))
      const x = Math.cos(a) * d
      const z = Math.sin(a) * d
      const c = drawCandidate(rimKinds, rimTotal)

      if (keepClear.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + c.reach)) continue
      if (inside && !inside(x, z)) continue
      const y = standing(c.kind, x, z)
      if (y === null) continue

      const mesh = rimMeshes[c.which]
      const slot = rimFill[c.which]
      if (slot >= mesh.instanceMatrix.count) continue

      plant(mesh, slot, c, x, y, z)
      rimFill[c.which] = slot + 1
    }

    rimMeshes.forEach((mesh, i) => {
      mesh.count = rimFill[i]
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      group.add(mesh)
    })
  }

  /**
   * The crags on the mountain wall. `ridge` raises the terrain past `from`; this is the
   * silhouette on top of it — without it the wall is a smooth noise-broken slope, and a
   * slope that size with nothing standing on it reads as a wrinkle in the ground rather
   * than as mountains.
   *
   * Placement is a *strip*, not an annulus: uniform along the axis from `from` to a little
   * past the top of the climb, and the full width of the ground across it, so the wall runs
   * off both sides of the picture the way a range does. Sizes are literal, as on the rim.
   *
   * It runs last, after the rim's meshes are sealed, so it consumes no `rand` that either
   * population before it drew — a setting with no `ridge` executes none of this at all.
   *
   * A setting may carry a *list* of ridges, and each one is populated in turn from its own
   * recipe at its own count: two ranges are two strips of crags, not one strip shared. The
   * order is the manifest's, so the draws a second range makes are the ones after the first
   * range has finished — which is why adding one to a setting that had none leaves every
   * earlier population's stream exactly where it was.
   */
  for (const ridge of [].concat(setting.ridge || [])) {
    if (!recipes[ridge.recipe]) continue
    const ridgeCount = Math.round(ridge.count * THREE.MathUtils.clamp(density, 0, 1))
    const { kinds: ridgeKinds } = kindsOf(recipes[ridge.recipe])
    const ridgeTotal = ridgeKinds.reduce((sum, k) => sum + k.weight, 0)
    const ridgeMeshes = ridgeKinds.map((k) => {
      const m = new THREE.InstancedMesh(k.geo, materialFor(k.kit), Math.ceil((ridgeCount * k.weight) / ridgeTotal) + 8)
      m.userData.ridge = true
      m.userData.upright = Boolean(k.upright)
      return m
    })
    const ridgeFill = new Array(ridgeKinds.length).fill(0)
    const [ax, az] = ridge.axis
    // The band the crags stand in: the climb itself plus a margin past the top of it, so the
    // massif has peaks behind its own shoulder rather than a bare plateau.
    const span = ridge.width + 24
    for (let i = 0; i < ridgeCount; i++) {
      const along = ridge.from + rand() * span
      const across = (rand() - 0.5) * GROUND_SIZE
      const x = along * ax - across * az
      const z = along * az + across * ax
      const c = drawCandidate(ridgeKinds, ridgeTotal)

      if (keepClear.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + c.reach)) continue
      if (inside && !inside(x, z)) continue
      // The strip is drawn in the axis's own frame and turned, so its ends can poke past the
      // square of ground; a crag out there would stand on nothing.
      if (Math.abs(x) > GROUND_SIZE / 2 || Math.abs(z) > GROUND_SIZE / 2) continue
      const y = standing(c.kind, x, z)
      if (y === null) continue

      const mesh = ridgeMeshes[c.which]
      const slot = ridgeFill[c.which]
      if (slot >= mesh.instanceMatrix.count) continue

      plant(mesh, slot, c, x, y, z)
      ridgeFill[c.which] = slot + 1
    }

    ridgeMeshes.forEach((mesh, i) => {
      mesh.count = ridgeFill[i]
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      group.add(mesh)
    })
  }
  return group
}

/**
 * Terrain height at a world point — the same field the mesh was built from, evaluated on
 * demand. Used to place scatter, and to keep anything that walks on the ground *on* it.
 */
export function terrainHeight(x, z, setting) {
  return sampleY(x, z, setting)
}

/**
 * The fixed parts of a setting's height field — its noise table, its craters and, on an island,
 * its islets — built once per setting id and shared by the mesh and every sampler: the noise
 * table alone is 64k floats. There is one terrain seed on purpose: the sampler and
 * `createTerrain` must build the same noise, and a seed parameter on either side is an
 * invitation to hand them different ones.
 */
const _fields = new Map()
function fieldFor(setting) {
  let f = _fields.get(setting.id)
  if (!f) {
    f = {
      noise: makeNoise(TERRAIN_SEED),
      craters: makeCraters(setting.craters, TERRAIN_SEED),
      islets: makeIslets(setting, TERRAIN_SEED),
    }
    _fields.set(setting.id, f)
  }
  return f
}

function sampleY(x, z, setting) {
  return groundHeight(x, z, fieldFor(setting), setting)
}

// ── upstream's worlds ─────────────────────────────────────────────────────────────────

/**
 * Upstream's worlds (merged 2026-09-24 from d05ac2f): the eight new ones — Dune, Canopy,
 * Shoreline, Archipelago, Frost, Aerie, Cinder, Harvest, Blossom — and his rework of the
 * original three. A world there is still a bag of colours, now with a few more switches:
 *
 *   water    { level, shallow, deep, foam, ... }   a sea, lakes, or lava — see water.js
 *   shape    'plain' | 'island' | 'coast' | 'dunes' | 'sky'   (sky: a floating island)
 *   lakes    true       the water sits in the hollows: the far field folds, craters are lakes
 *   farShade { from, to, amount }   how hard the far field darkens — see FAR_SHADE
 *   shore    { color, band }    the sand: how far *above* the waterline, in height, it reaches
 *   weather  [{ kind, rate }]   what drifts through the air
 *   clouds   { amount, color, speed }   cumulus on the sky dome — see sky.js
 *   fauna    { birds, butterflies, fish, drones }   — see fauna.js
 *   audio    { beds, events, shore }   — see audio/ambience.js
 *   grade    { saturation, warmth }   a nudge to the colour grade
 *   grass    { root, tip, height, width, sway }   a field of wispy blades — see grass.js
 *
 * The worlds live in the library (`src/worlds/`) with every other world. Their height field,
 * terrain mesh and scatter are the ones every world builds (`groundHeight`, `createTerrain`,
 * `createScatter`), each of his layers a branch on the world's own data and his way of planting
 * a scatter style the space colony's dressing sets. What is below reads his water: the
 * shoreline points and `underWater`.
 *
 * **One sea, and the valley's bank beside it.** Every world's `water` is his, a level with
 * colours on it — `{ level, shallow, deep, foam, ... }` — and the terrain decides where it is
 * wet; the colony builds `water.js` for it wherever a world has one. The valley's own sea was a
 * flat plane of ours (`createWater`) until 2026-09-30, and what made it ours was never the sea
 * but the land: the half-plane the ground drops away behind, which is the world's `coast` —
 * `{ axis, from, depth, sand, wobble, bed }`, see `shapeValley`. A coast paints its own sand down
 * the bank and no bed (`createTerrain`), keeps the scatter a `SHORE_BAND` off the water, and has
 * its own cell and walking rules in the colony; its water is the same water. (`shape: 'coast'`
 * is upstream's coast, a string, and a different field; no world carries both.)
 */

/**
 * Where the water meets the land, as a scatter of points — what the ambience engine puts
 * its lapping sources at. Sampled on a coarse grid once per planet: a cell under the water
 * with a neighbour above it is a shoreline. A world with no water has none.
 */
const _shores = new Map()
export function shorelinePoints(planet, spacing = 10) {
  if (!planet.water) return []
  let pts = _shores.get(planet.id)
  if (pts) return pts
  pts = []
  const level = planet.water.level
  const half = GROUND_SIZE / 2 - spacing
  for (let x = -half; x <= half; x += spacing) {
    for (let z = -half; z <= half; z += spacing) {
      if (terrainHeight(x, z, planet) >= level) continue
      const dry =
        terrainHeight(x + spacing, z, planet) >= level ||
        terrainHeight(x - spacing, z, planet) >= level ||
        terrainHeight(x, z + spacing, planet) >= level ||
        terrainHeight(x, z - spacing, planet) >= level
      if (dry) pts.push({ x, z })
    }
  }
  _shores.set(planet.id, pts)
  return pts
}

/**
 * Tell the island worlds which hex cells the colony holds. The field is evaluated on demand
 * everywhere, so this only has to be set before the terrain is (re)built; the shoreline
 * cache goes with it, since the coast has moved.
 */
export function setIslandFootprint(cells, cellRadius) {
  _islandCells = cells.map((c) => ({ x: c.x, z: c.z }))
  _islandReach = cellRadius + ISLAND_BEACH
  _shores.clear()
}

/**
 * Run `fn` with the island shaped around `cells` instead, then put back the footprint that was
 * there — even when `fn` throws — and return what `fn` returned.
 *
 * It is how a question about the ground can be asked of an island the colony has not grown yet:
 * the burial guard judges every cell as if it were land, because a cell it deals always becomes
 * land (see `Colony._blockedCells`). The only cache the footprint feeds is the shoreline's, and
 * it is dropped on the way in and again on the way out; the fixed fields (`_fields`) never read
 * the footprint.
 */
export function withIslandFootprint(cells, cellRadius, fn) {
  const cellsWere = _islandCells
  const reachWas = _islandReach
  setIslandFootprint(cells, cellRadius)
  try {
    return fn()
  } finally {
    _islandCells = cellsWere
    _islandReach = reachWas
    _shores.clear()
  }
}

/**
 * Which way the sea lies from `at`, as a unit `[x, z]`, for any form of water a world has — or
 * null where that has no answer.
 *
 * - The valley's half-plane bank says so itself: `coast.axis`, the same array.
 * - A `coast` runs its shore across `COAST_DIR`, so the sea is that way from anywhere on land.
 * - An `island` is surrounded, so the nearest sea is straight out from the middle through `at`
 *   (`{x, z}`); at the middle itself there is no one direction, and the answer is null.
 * - Anything else has no sea to face.
 *
 * What a harbour reads to turn its pier seaward, and what the colony reads to keep the water in
 * front of it open.
 */
export function coastAxis(setting, at) {
  if (setting?.coast) return setting.coast.axis
  if (setting?.shape === 'coast') return [COAST_DIR.x, COAST_DIR.z]
  if (setting?.shape === 'island') {
    const d = Math.hypot(at.x, at.z)
    return d > 0 ? [at.x / d, at.z / d] : null
  }
  return null
}

/** The island's current footprint, as `setIslandFootprint` left it. For tests. */
export function islandFootprint() {
  return { cells: _islandCells, reach: _islandReach }
}

/** Whether a world point is under the world's water, if it has any. */
export function underWater(x, z, planet) {
  if (!planet.water) return false
  return terrainHeight(x, z, planet) < planet.water.level
}

// ── noise ─────────────────────────────────────────────────────────────────────────────

/**
 * Small deterministic PRNG — same seed, same world, every reload. It lives in
 * `core/rng.js` so pure modules can use it without pulling three in; re-exported here
 * because half the world modules already import it from this file.
 */
export { mulberry }

/** Value noise on a hashed lattice with smoothstep interpolation — cheap and smooth enough. */
function makeNoise(seed) {
  const rand = mulberry(seed)
  const size = 256
  const table = new Float32Array(size * size)
  for (let i = 0; i < table.length; i++) table[i] = rand() * 2 - 1

  return function noise(x, y) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const u = xf * xf * (3 - 2 * xf)
    const v = yf * yf * (3 - 2 * yf)
    const at = (a, b) => table[(((a % size) + size) % size) * size + (((b % size) + size) % size)]
    const a = at(xi, yi)
    const b = at(xi + 1, yi)
    const c = at(xi, yi + 1)
    const d = at(xi + 1, yi + 1)
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
  }
}

export function fbm(noise, x, y, octaves) {
  let sum = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp
    norm += amp
    amp *= 0.5
    freq *= 2.07
  }
  return sum / norm
}

import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry } from './setting.js'
import { hasFeature } from '../core/features.js'
import { accentGlow, accentMask, atlasGrid, atlasTexture, cellIndex, hasEmissive, hasPart, part, pbrTables } from './kit.js'
import { expandRecipe } from './recipes.js'
import { BAYER_GLSL, FADE_DISCARD, fadeFloorUniform, ghostAmount } from './fade.js'
import { withCurve } from '../core/curve.js'

/**
 * Colony buildings — one per thread, assembled out of KayKit's *Space Base Bits* (CC0) and
 * seeded from the thread's own id, so a given session always builds the same structure on
 * every reload and in every setting.
 *
 * The pack is a modular one, which is the whole reason a kind stays short: a habitat is a
 * base module with a roof module on it, a workshop is the garage variant with a rover
 * parked outside. Every part shares one gradient atlas, so a nine-part greenhouse still
 * merges down to a single geometry and a single draw call.
 *
 * The catalogue itself is not here — it is data in the theme's manifest, walked by
 * `recipes.js`. This file knows how to *place* a part and how to light it, and nothing at
 * all about what a habitat looks like.
 *
 * Three things ride on top of the pack's own art:
 *
 * 1. **Construction progress sinks the building into the ground.** The vertex stage lowers
 *    the whole structure and the fragment stage discards whatever ends up below the deck, so
 *    a thread's building rises as it grows without ever touching a vertex buffer — and what
 *    is on screen is always a *complete* building, part of it buried. Slicing the top off
 *    instead, which is what this used to do, guts a kit of closed shells: at two-thirds
 *    finished a biodome loses its entire dome and becomes an empty ring.
 * 2. **The accent is a repainted atlas cell.** Kay's gold trim band is cell 11 of the 8x4
 *    atlas; the fragment stage swaps its hue for the repo's accent while keeping the
 *    swatch's own light-to-dark gradient. One repo, one colour, no extra material.
 * 3. **PBR comes from the atlas too.** Roughness and metalness are looked up per cell, so
 *    the grey structural swatch behaves like brushed metal and the solar swatch like glass
 *    even though both arrive as flat colour in a single texture.
 */

/** Shared across every building, so night falling is one uniform write for the whole colony. */
export const buildingUniforms = {
  uNight: { value: 0 },
  /** Seconds, for anything that turns. One write drives every rotor in the colony. */
  uTime: { value: 0 },
  /**
   * A planet's colour on the hull. The neutral structural swatches lean toward this when
   * the amount is up — desert clay turns the same kit into adobe — and because it is
   * shared, switching planet re-themes every standing building with two writes and no
   * rebuild. Amount 0 is a true no-op, so the other worlds cost nothing.
   */
  uPlanetTint: { value: new THREE.Color(1, 1, 1) },
  uPlanetTintAmount: { value: 0 },
}

/**
 * Surface response per atlas cell, and the swatches the accent owns. Both come from the
 * theme's kit table — the pack ships one material for everything, and this is what gives a
 * colony made of it any specular variety at all under the environment map.
 *
 * The defaults below stand in only until `configureBuildings` runs at boot; they are the
 * shape of an 8x4 atlas with Kay's own roughness and no accent.
 */
let ATLAS = { cols: 8, rows: 4 }
let CELL_COUNT = ATLAS.cols * ATLAS.rows
let ROUGHNESS = new Float32Array(CELL_COUNT).fill(0.6)
let METALNESS = new Float32Array(CELL_COUNT).fill(0.0)
let ACCENT_MASK = new Float32Array(CELL_COUNT)
/**
 * Cells that glow on their own — a torch flame, a forge mouth. Optional: a kit that
 * declares none leaves `EMISSIVE_ON` false and the shader is built without the term, so a
 * theme that has never heard of emissive cells compiles exactly the program it always did.
 */
let EMISSIVE = new Float32Array(CELL_COUNT * 3)
let EMISSIVE_INTENSITY = new Float32Array(CELL_COUNT)
let EMISSIVE_ON = false
/**
 * How hard the accent cells come up after dark. The theme's, via `kits.base.accentGlow`;
 * the value here is only what stands in until `configureBuildings` runs, and it is the
 * space theme's own so that shader computes the very same product it always has.
 *
 * It is a knob because the term means different things in different fictions. A colony's
 * window strips are electric light and want the whole of it; a village's roofs are lit by
 * torches on the kerb below them, and at full strength they read as neon rather than as
 * thatch with a fire under it.
 */
let ACCENT_GLOW = 1.15
/**
 * Upstream's planet tint (merged 2026-09-24 from d05ac2f): the swatches a world's
 * `buildingTint` may lean toward its own colour — the kit's neutral hull and frame greys, so
 * Dune's clay turns the same modules into adobe. Filled by `configureBuildings` only where some
 * setting of the theme carries a `buildingTint`; every other theme leaves `PLANET_TINT_ON` false
 * and its shader is built without a line of the term.
 */
let PLANET_TINT_MASK = new Float32Array(CELL_COUNT)
let PLANET_TINT_ON = false
/** The cells that tint names, looked up in the base kit's own `cells` table. */
const PLANET_TINT_CELLS = ['WHITE', 'GREY', 'SLATE']
/**
 * His fit (merged 2026-09-24): the radius a whole recipe — barrels, rover and all — may reach
 * at any yaw. Ring slots have 2.15 m to the kerb. Applied only where the theme's yard is
 * upstream's (`plots.yard: 'reserved'`), which keeps its props this far from every slot; any
 * other theme's buildings take `BUILDING_SCALE` exactly as its manifest says.
 */
export const BUILDING_RADIUS = 2
/** Whether buildings are fitted inside `BUILDING_RADIUS`: the theme's yard is `'reserved'`. */
let FIT_TO_YARD = false

/**
 * The catalogue, and the two numbers it is authored against. All three arrive from the
 * theme's manifest; the values here only stand in until boot calls `configureBuildings`.
 *
 * `BUILDING_SCALE` is set against the crew, not the plot: an astronaut is about 1.1 units
 * tall, and a habitat you can see over is not a habitat. `DECK` is the top face of a base
 * module, which is where a recipe's roof modules and masts stack.
 */
let BUILDING_SCALE = 1.45
let DECK = 1.0
let KINDS = {}
let KIND_IDS = []
/** The accent a building wears until a plot assigns it one. Also the theme's. */
let DEFAULT_ACCENT = 0xc96442
/**
 * The kit node a theme lights its nights with — `manifest.plots.clutterLamp`, the very same
 * name the kerb clutter picks its flames out by. A recipe that places it puts a real torch
 * on the building, so `createBuilding` writes those placements down and the colony feeds
 * them to the ember emitter alongside the kerb ones. `null` for a theme that names none,
 * and then no building carries a lamp list at all.
 */
let LAMP_NODE = null
/**
 * What a quiet repo grows over itself — `manifest.decay`, or null for a theme that declares
 * none. Only two fields are read here: `kit`, which is where the ruin's nodes are looked up,
 * and `ruin`, the recipe a building is replaced by once its zone is far enough gone. See the
 * manifest block's own comment, and `world/decay.js` for the rule that decides "far enough".
 */
let DECAY = null
/**
 * Every node the ruin recipe names outright — a literal, or any member of a pick list, in
 * whichever branch it sits. Read off the manifest once, at configure time, because it is a
 * property of the theme rather than of any one building.
 *
 * It is what lets `createRuin` say "not yet" without running anything. `_syncRuin` asks once
 * per fallen building per poll, and every ask before the lazy kit lands would otherwise expand
 * the recipe in full only to throw the parts away. A node named through a `var` cannot be known
 * without running the recipe and so is not in here; the expanded parts are still held against
 * the kit afterwards, and this is the cheap half of the same question.
 */
let RUIN_NODES = new Set()

/** Where the accent goes as a zone fades: the space deck's neutral, which reads the same on grass. */
const GHOST_GREY = new THREE.Color(0x8c8c90)

/**
 * Install the theme's cell tables and building catalogue. Runs after `configureKits` and
 * before the first building; it only reads manifest data, so it need not wait for the GLBs.
 *
 * `plots` is `manifest.plots`, the same block `configurePlots` reads, and two of its keys
 * are read here. With a `clutterLamp`, every building records where its recipe put one,
 * which is all a torch on a wall needs to gutter like a torch on a kerb. A `'reserved'`
 * `yard` keeps its props `BUILDING_RADIUS` from every slot, so its buildings are fitted
 * inside it. `decay` is `manifest.decay`, and without it `createRuin` has nothing to build
 * and no building ever falls down. `settings` is `manifest.settings`: the tint is wired into
 * the shader when any of them carries a `buildingTint`, which is what the colony reads the
 * tint from, however the setting came by it.
 */
export function configureBuildings(spec, palette, plots = {}, decay = null, { settings = [] } = {}) {
  ATLAS = atlasGrid('base')
  CELL_COUNT = ATLAS.cols * ATLAS.rows
  const pbr = pbrTables('base')
  ROUGHNESS = pbr.roughness
  METALNESS = pbr.metalness
  EMISSIVE = pbr.emissive
  EMISSIVE_INTENSITY = pbr.emissiveIntensity
  EMISSIVE_ON = hasEmissive('base')
  ACCENT_MASK = accentMask('base')
  ACCENT_GLOW = accentGlow('base')
  BUILDING_SCALE = spec.scale
  DECK = spec.deck
  KINDS = spec.kinds
  KIND_IDS = Object.keys(KINDS)
  DEFAULT_ACCENT = palette.accent
  LAMP_NODE = plots.clutterLamp || null
  DECAY = decay || null
  RUIN_NODES = declaredNodes(DECAY?.ruin?.parts || [])
  FIT_TO_YARD = plots.yard === 'reserved'
  PLANET_TINT_ON = settings.some((s) => s.buildingTint !== undefined)
  PLANET_TINT_MASK = new Float32Array(CELL_COUNT)
  if (PLANET_TINT_ON)
    for (const name of PLANET_TINT_CELLS) {
      try {
        PLANET_TINT_MASK[cellIndex('base', name)] = 1
      } catch {
        // A kit without that swatch named simply has less hull to tint.
      }
    }
}

/** Walk a recipe's steps for the node names written into it, down both arms of every branch. */
function declaredNodes(steps, out = new Set()) {
  for (const step of steps) {
    if ('if' in step) {
      declaredNodes(step.then || [], out)
      declaredNodes(step.else || [], out)
      continue
    }
    const node = step.node ?? step.ring?.node ?? step.grid?.node
    if (typeof node === 'string') out.add(node)
    else if (Array.isArray(node)) for (const n of node) out.add(n)
  }
  return out
}

// ── composition ───────────────────────────────────────────────────────────────────────

/**
 * A tiny placement helper. Parts are baked to the building's own frame as they are added,
 * each carrying a per-vertex emissive flag, so the whole lot merges into one buffer.
 */
class Composer {
  constructor() {
    this.parts = []
    /**
     * Where each part ended up, kept alongside the geometry it is baked into. Once `finish`
     * merges the lot there is no way back from a vertex to the node that supplied it, and a
     * torch on a tavern wall has to be findable again to throw an ember. Record shape:
     * `{ node, x, y, z, stage }` in the building's own frame, `y` the part's bounding-box
     * top so a torch's entry is at the flame rather than at its foot.
     */
    this.placed = []
  }

  /**
   * @param {string} name  a node name from the kit
   * @param {object} [o]   `x`/`y`/`z` offset, `ry` yaw, `s` uniform scale, `emissive` 0..1,
   *   and `kit` — which kit the node is looked up in, `base` unless a caller says otherwise.
   *   Only the ruin does: it is built out of the dressing's own kit, through this same path,
   *   so that it merges, scales, sinks, dithers and goes dark exactly as a house does.
   */
  add(name, o = {}) {
    const geo = part(name, o.kit || 'base', { solo: o.solo })
    const s = o.s ?? 1
    if (s !== 1) geo.scale(s, s, s)
    if (o.ry) geo.rotateY(o.ry)
    geo.translate(o.x || 0, o.y || 0, o.z || 0)

    const count = geo.attributes.position.count
    geo.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(count).fill(o.emissive || 0), 1))

    // Rotors turn in the vertex shader rather than as child meshes, so a turbine is still
    // one merged geometry and one draw call. Each spinning vertex carries the hub it turns
    // about and how fast, which is what lets one building hold several of them.
    const rate = o.spin || 0
    const spin = new Float32Array(count).fill(rate)
    const pivot = new Float32Array(count * 3)
    if (rate) {
      for (let i = 0; i < count; i++) {
        pivot[i * 3] = o.x || 0
        pivot[i * 3 + 1] = o.y || 0
        pivot[i * 3 + 2] = o.z || 0
      }
    }
    geo.setAttribute('aSpin', new THREE.BufferAttribute(spin, 1))
    geo.setAttribute('aPivot', new THREE.BufferAttribute(pivot, 3))

    // Which fraction of the thread's progress this part waits for. A recipe that stages
    // nothing fills the attribute with zeroes and the fragment stage never discards.
    geo.setAttribute('aStage', new THREE.BufferAttribute(new Float32Array(count).fill(o.stage || 0), 1))

    // The placement, written down before the merge loses it. Measured after the transforms
    // above, so `top` is where this part actually ends in the building's frame.
    geo.computeBoundingBox()
    this.placed.push({ node: name, x: o.x || 0, y: geo.boundingBox.max.y, z: o.z || 0, stage: o.stage || 0 })

    this.parts.push(geo)
    return this
  }

  finish() {
    const merged = BufferGeometryUtils.mergeGeometries(this.parts, false)
    for (const p of this.parts) p.dispose()
    merged.computeBoundingBox()
    return merged
  }
}

// ── the reveal shader ─────────────────────────────────────────────────────────────────

/**
 * Everything the atlas makes possible, in one `onBeforeCompile`.
 *
 * Progress lowers the building and discards whatever falls below ground, with the band just
 * above that line painted in the accent — the "under construction" glow.
 * The accent also replaces the gold trim swatch outright, and per-cell roughness and
 * metalness turn one flat texture into a surface with metal, paint and glass in it.
 */
function decorate(material, uniforms) {
  // Both are empty unless the kit declares an emissive cell, which is what keeps a theme
  // without one compiling the very same shader source it always has.
  const emissiveDecl = EMISSIVE_ON
    ? `\n         uniform vec3 uCellEmissive[ ${CELL_COUNT} ];\n         uniform float uCellEmissiveIntensity[ ${CELL_COUNT} ];`
    : ''
  const emissiveTerm = EMISSIVE_ON
    ? `\n         totalEmissiveRadiance += uCellEmissive[ cell ] * uCellEmissiveIntensity[ cell ];`
    : ''
  // Upstream's planet tint, on the same terms: empty unless a setting of the theme carries one.
  const tintDecl = PLANET_TINT_ON
    ? `\n         uniform vec3 uPlanetTint;\n         uniform float uPlanetTintAmount;\n         uniform float uCellPlanetTint[ ${CELL_COUNT} ];`
    : ''
  const tintTerm = PLANET_TINT_ON
    ? `
         // The planet's own colour on the neutral hull swatches, before the accent gets
         // its say — same luminance trick, so panels keep their shading as they change.
         float tintAmount = uCellPlanetTint[ cell ] * uPlanetTintAmount;
         if ( tintAmount > 0.0 ) {
           float tintLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
           diffuseColor.rgb = mix( diffuseColor.rgb, uPlanetTint * clamp( tintLum * 1.9, 0.3, 1.5 ), tintAmount );
         }`
    : ''
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    if (hasFeature('curve')) withCurve(shader)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aEmissive;
         attribute float aSpin;
         attribute vec3 aPivot;
         attribute float aStage;
         varying float vEmissive;
         varying vec2 vAtlasUv;
         varying float vLocalY;
         varying float vStage;
         uniform float uProgress;
         uniform float uMaxY;
         uniform float uMinY;
         uniform float uTime;

         // Turn a point about the Z axis through a hub. The pack's rotors are modelled as
         // vertical discs facing along Z, which is the axis a wind turbine actually turns on.
         vec3 botSpin( vec3 p, vec3 hub, float angle ) {
           vec3 r = p - hub;
           float s = sin( angle );
           float c = cos( angle );
           return hub + vec3( r.x * c - r.y * s, r.x * s + r.y * c, r.z );
         }`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         if ( aSpin > 0.0 ) objectNormal = botSpin( objectNormal, vec3( 0.0 ), uTime * aSpin );`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vEmissive = aEmissive;
         vStage = aStage;
         // Our own copy of the UV: three renames its map varying between versions, and the
         // cell lookup below has to survive that.
         vAtlasUv = uv;
         if ( aSpin > 0.0 ) transformed = botSpin( transformed, aPivot, uTime * aSpin );
         // Measured *after* the rotor has turned, so a blade sweeping past the ground line
         // is revealed and hidden by the same rule as everything else.
         vLocalY = transformed.y;
         // The whole structure is lowered into the ground, and the fragment stage throws
         // away whatever ends up below the deck. What is on screen is therefore always a
         // *complete* building, part of it buried — never a sliced one.
         transformed.y -= ( 1.0 - uProgress ) * ( uMaxY - uMinY );`
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying float vEmissive;
         varying vec2 vAtlasUv;
         varying float vLocalY;
         varying float vStage;
         uniform float uProgress;
         uniform float uStage;
         uniform float uMaxY;
         uniform float uMinY;
         uniform vec3 uAccent;
         uniform float uNight;
         uniform float uAccentGlow;${tintDecl}
         uniform float uCellAccent[ ${CELL_COUNT} ];
         uniform float uCellRoughness[ ${CELL_COUNT} ];
         uniform float uCellMetalness[ ${CELL_COUNT} ];${emissiveDecl}
         uniform float uFade;
         uniform float uFadeFloor;
         uniform float uLightsOut;${BAYER_GLSL}

         // Which swatch of the 8x4 gradient atlas this fragment landed in.
         int atlasCell() {
           int cx = int( clamp( floor( vAtlasUv.x * ${ATLAS.cols}.0 ), 0.0, ${ATLAS.cols - 1}.0 ) );
           int cy = int( clamp( floor( vAtlasUv.y * ${ATLAS.rows}.0 ), 0.0, ${ATLAS.rows - 1}.0 ) );
           return cy * ${ATLAS.cols} + cx;
         }`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         // A part the thread has not earned yet. Stages are the recipe's own fractions of the
         // thread's progress; a recipe without them stages everything at 0 and never discards.
         if ( vStage > uStage + 0.0005 ) discard;
         // Ground level, in the building's own frame, as it sinks. Measured from the
         // geometry's real floor rather than from zero: a few parts of the kit — a rover's
         // wheels, a crate's skids — sit a little proud of it, and testing against zero
         // would cut them off a building that is otherwise finished.
         float ground = uMinY + ( 1.0 - uProgress ) * ( uMaxY - uMinY );
         if ( vLocalY < ground - 0.001 ) discard;
         ${FADE_DISCARD}
         int cell = atlasCell();`
      )
      // The accent repaint. Luminance carries the swatch's own gradient across, so the trim
      // keeps its shading instead of going flat the moment it changes colour.
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>${tintTerm}
         float accentAmount = uCellAccent[ cell ];
         if ( accentAmount > 0.0 ) {
           float lum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
           diffuseColor.rgb = mix( diffuseColor.rgb, uAccent * clamp( lum * 1.9, 0.3, 1.5 ), accentAmount );
         }`
      )
      // Per-cell PBR: painted panels, brushed metal and photovoltaic glass in one texture.
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = uCellRoughness[ cell ];')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = uCellMetalness[ cell ];')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         // Lamps and beacons, flagged per vertex when the recipe placed them.
         totalEmissiveRadiance += diffuseColor.rgb * vEmissive * ( 0.25 + uNight * 2.4 );
         // Window strips and trim come on after dark, in the repo's own colour.
         totalEmissiveRadiance += uAccent * uCellAccent[ cell ] * uNight * uAccentGlow;${emissiveTerm}
         // The construction line: a bright band riding just above the ground it rises from.
         float band = 1.0 - smoothstep( 0.0, 0.22, vLocalY - ground );
         totalEmissiveRadiance += uAccent * band * ( 1.0 - step( 0.999, uProgress ) ) * 1.5;
         // A ghost town is dark: every glow this building has goes out at any fade at all.
         totalEmissiveRadiance *= 1.0 - uLightsOut;`
      )
  }
  return material
}

/**
 * Shadows are rendered with three's own depth material, which knows nothing about the
 * sink — so without this a building at ten percent still casts its finished silhouette from
 * its finished position. The depth pass gets the same offset and the same discard, reading
 * the very same uniform objects.
 */
function depthMaterial(uniforms) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    if (hasFeature('curve')) withCurve(shader)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aSpin;
         attribute vec3 aPivot;
         attribute float aStage;
         varying float vLocalY;
         varying float vStage;
         uniform float uProgress;
         uniform float uMaxY;
         uniform float uMinY;
         uniform float uTime;

         vec3 botSpin( vec3 p, vec3 hub, float angle ) {
           vec3 r = p - hub;
           float s = sin( angle );
           float c = cos( angle );
           return hub + vec3( r.x * c - r.y * s, r.x * s + r.y * c, r.z );
         }`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         if ( aSpin > 0.0 ) transformed = botSpin( transformed, aPivot, uTime * aSpin );
         vLocalY = transformed.y;
         vStage = aStage;
         transformed.y -= ( 1.0 - uProgress ) * ( uMaxY - uMinY );`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying float vLocalY;
         varying float vStage;
         uniform float uProgress;
         uniform float uStage;
         uniform float uMaxY;
         uniform float uMinY;
         uniform float uFade;
         uniform float uFadeFloor;${BAYER_GLSL}`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         // The same rule as the surface pass: a part the thread has not earned casts no
         // shadow either, or a bare lot would sit under a finished building's silhouette.
         if ( vStage > uStage + 0.0005 ) discard;
         if ( vLocalY < uMinY + ( 1.0 - uProgress ) * ( uMaxY - uMinY ) - 0.001 ) discard;
         ${FADE_DISCARD}`
      )
  }
  return mat
}

/**
 * How wide a structure stands, as the half-width of the square that contains it.
 *
 * The largest absolute extent on either ground axis, so a building that is wider than it is
 * deep is blocked on its width — the navigation grid inflates this into a circle, and a
 * circle drawn on the shorter side would leave the long side walkable.
 *
 * Pure, and exported, because a ruin has to be measured the same way its house was: the swap
 * hands the mesh a different geometry and `userData.footprint` has to follow it.
 *
 * @param {THREE.Box3} box a geometry's own bounding box, already scaled
 * @returns {number}
 */
export function footprintOf(box) {
  return Math.max(Math.abs(box.max.x), Math.abs(box.min.x), Math.abs(box.max.z), Math.abs(box.min.z))
}

/**
 * Build one structure. `seed` is derived from the thread id, so the same session always
 * gets the same building; `kind` can be forced, otherwise the seed picks it.
 *
 * Requires `loadKit()` to have resolved — boot awaits it before the first roster arrives.
 */
export function createBuilding({ seed = 1, accent = DEFAULT_ACCENT, kind = null } = {}) {
  const rand = mulberry(seed)
  const chosen = kind && KINDS[kind] ? kind : KIND_IDS[Math.floor(rand() * KIND_IDS.length)]

  const c = new Composer()
  const { label, parts } = expandRecipe(KINDS[chosen], rand, { deck: DECK })
  for (const p of parts) c.add(p.node, p)
  const geo = c.finish()
  // Trimmed to fit a slot: the catalogue is authored on the pack's module grid and scaled
  // once here, so tuning the plot lattice never means re-tuning ten recipes. With upstream's
  // yard (`plots.yard: 'reserved'`), his fit (2026-09-24) also caps it so the complete recipe,
  // barrels and rover included, stays inside `BUILDING_RADIUS` at any yaw.
  let scale = BUILDING_SCALE
  if (FIT_TO_YARD) {
    let radius = 0
    const positions = geo.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      radius = Math.max(radius, Math.hypot(positions.getX(i), positions.getZ(i)))
    }
    scale = Math.min(BUILDING_SCALE, BUILDING_RADIUS / Math.max(radius, 0.001))
  }
  geo.scale(scale, scale, scale)
  // `scale()` transforms position and normal and nothing else, so a custom attribute that
  // holds a *position* has to be taken along by hand. Miss this and a rotor turns about a
  // hub left behind at the unscaled height — the blades orbit a point below themselves.
  const pivot = geo.getAttribute('aPivot')
  if (pivot) {
    for (let i = 0; i < pivot.count * 3; i++) pivot.array[i] *= scale
    pivot.needsUpdate = true
  }
  geo.computeBoundingBox()
  const height = geo.boundingBox.max.y
  const footprint = footprintOf(geo.boundingBox)

  // One uniform block, shared by the surface pass and the shadow pass.
  const uniforms = {
    uProgress: { value: 1 },
    // How much of the recipe the thread has earned. 1 until a staged theme says otherwise,
    // which is why a theme that never sets `buildings.staged` discards nothing.
    uStage: { value: 1 },
    uMaxY: { value: height },
    uMinY: { value: geo.boundingBox.min.y },
    uAccent: { value: new THREE.Color(accent) },
    uFade: { value: 0 },
    uFadeFloor: fadeFloorUniform,
    uLightsOut: { value: 0 },
    uNight: buildingUniforms.uNight,
    uTime: buildingUniforms.uTime,
    uAccentGlow: { value: ACCENT_GLOW },
    uCellAccent: { value: ACCENT_MASK },
    ...(PLANET_TINT_ON
      ? {
          uPlanetTint: buildingUniforms.uPlanetTint,
          uPlanetTintAmount: buildingUniforms.uPlanetTintAmount,
          uCellPlanetTint: { value: PLANET_TINT_MASK },
        }
      : {}),
    uCellRoughness: { value: ROUGHNESS },
    uCellMetalness: { value: METALNESS },
    ...(EMISSIVE_ON
      ? { uCellEmissive: { value: EMISSIVE }, uCellEmissiveIntensity: { value: EMISSIVE_INTENSITY } }
      : {}),
  }

  const material = decorate(
    new THREE.MeshStandardMaterial({
      map: atlasTexture(),
      // Roughness and metalness arrive per atlas cell; these are only the fallback values.
      roughness: 0.6,
      metalness: 0,
      emissive: 0x000000, // additions in the shader are the only emission
      // Single-sided, unlike the procedural buildings this replaced.
      //
      // The pack's models are closed solids, so there is nothing to see through — and being
      // closed is exactly why they must not be drawn double-sided. They are modelled as
      // stacked boxes, which leaves a floor and the ceiling under it sharing a plane all
      // over the kit: a landing pad and the lander standing on it put 38 up-facing and 17
      // down-facing triangles at one height. Drawn double-sided both halves of every such
      // pair rasterise at identical depth and the winner is decided by floating-point
      // noise, which is a whole colony of surfaces flickering. Back-face culling throws the
      // downward half away before it can fight.
      side: THREE.FrontSide,
    }),
    uniforms
  )

  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  const depth = depthMaterial(uniforms)
  depth.side = THREE.BackSide
  mesh.customDepthMaterial = depth

  mesh.userData.kind = chosen
  /**
   * Every torch this recipe placed, in the building's own frame and at the building's own
   * scale — the same `BUILDING_SCALE` the geometry just took, applied about the origin, so
   * a placement scales with it. The colony rotates and translates these into the world when
   * it rebuilds navigation. Empty for a theme that names no `clutterLamp`, and empty for a
   * recipe that places none, which is every recipe in the space kit's catalogue.
   */
  mesh.userData.lamps = LAMP_NODE
    ? c.placed
        .filter((p) => p.node === LAMP_NODE)
        .map((p) => ({
          x: p.x * scale,
          y: p.y * scale,
          z: p.z * scale,
          stage: p.stage,
        }))
    : []
  mesh.userData.label = label
  mesh.userData.height = height
  mesh.userData.footprint = footprint
  mesh.userData.uniforms = uniforms
  mesh.userData.progress = 1
  mesh.userData.setProgress = (p) => {
    const v = THREE.MathUtils.clamp(p, 0, 1)
    mesh.userData.progress = v
    uniforms.uProgress.value = v
    mesh.visible = v > 0.02
  }

  mesh.userData.stage = 1
  mesh.userData.setStage = (s) => {
    const v = THREE.MathUtils.clamp(s, 0, 1)
    mesh.userData.stage = v
    uniforms.uStage.value = v
  }

  // The repo's colour drains out of the trim as the zone fades; the deck's own neutral is
  // where it goes, so a ghost's roofs and the ghost's slab read as one grey thing. Both the
  // dither and the drain are what "Fade ghost towns" governs, so both go through
  // `ghostAmount`; the lights read the true fade, because a ghost is dark either way.
  const baseAccent = new THREE.Color(accent)
  mesh.userData.setFade = (fade) => {
    const v = THREE.MathUtils.clamp(fade, 0, 1)
    const ghost = ghostAmount(v)
    uniforms.uFade.value = ghost
    uniforms.uLightsOut.value = v > 0 ? 1 : 0
    uniforms.uAccent.value.copy(baseAccent).lerp(GHOST_GREY, ghost)
  }

  /**
   * Put a ruin where this building stands, or take it away again.
   *
   * A swap of `mesh.geometry` and nothing else: the material, the depth material, the uniform
   * block, the position and the yaw all stay exactly as they were, so the ruin dithers if and
   * only if the dither is switched on, goes dark with `uLightsOut`, wears the zone's drained
   * accent and casts the shadow of what is actually standing there. Building a second mesh
   * would have meant keeping two of everything in step by hand for no gain.
   *
   * The intact structure is kept rather than disposed, because a repo can wake up: a commit in
   * a folder nobody has touched for a fortnight puts the house back on the very next poll, and
   * rebuilding it from the recipe would spend seeded draws at an arbitrary moment.
   *
   * Four numbers have to follow the swap, and they are all the geometry's own.
   *
   * `uMinY` / `uMaxY` are its floor and ceiling, and the reveal shader measures the ground
   * line and the construction band off them — left at the house's, a ruin a third of its
   * height would be discarded outright. `userData.height` is the same ceiling read by
   * everything outside the shader, and `userData.footprint` is how much ground it stands on:
   * the navigation grid inflates that into the circle it blocks, so a ruin left wearing its
   * house's number blocks ground it does not occupy, or leaves ground it does occupy open.
   * The grid re-reads both on its next rebuild, which `Colony._refreshFades` now asks for
   * whenever a swap happens.
   */
  mesh.userData.intact = geo
  mesh.userData.ruin = null
  mesh.userData.setRuin = (ruin) => {
    const next = ruin || mesh.userData.intact
    if (!next || mesh.geometry === next) return
    mesh.geometry = next
    mesh.userData.ruin = ruin || null
    uniforms.uMinY.value = next.boundingBox.min.y
    uniforms.uMaxY.value = next.boundingBox.max.y
    mesh.userData.height = next.boundingBox.max.y
    mesh.userData.footprint = footprintOf(next.boundingBox)
  }

  return mesh
}

/**
 * The heap a building has gone to once its repo is far enough gone — `manifest.decay.ruin`,
 * expanded through the very same recipe path a house is (2026-09-12, `feature/ghost-decay`).
 *
 * The same path is the point. A ruin that were its own mesh with its own material would have
 * to be taught the fade, the lights, the accent drain, the sink and the shadow pass over
 * again, and would drift from the building it replaces the first time any of those changed.
 * This hands back a geometry in the building's own frame, at the building's own scale, for
 * `setRuin` to swap into the mesh that is already standing.
 *
 * `null` when the theme declares no ruin, and — the case that actually happens — when the
 * dressing's kit has not landed yet. The colony writes every zone's fade again the moment it
 * does (`Colony.settled`), and the building falls down on that write instead.
 *
 * The seed is the thread's, twisted, so a ruin is stable per session without being the same
 * draw the house was built from: a one-part recipe spends nothing, but a theme whose ruin
 * picks between three heaps must not pick the one its own building's first draw did.
 *
 * @param {{seed?: number}} [opts]
 * @returns {THREE.BufferGeometry | null}
 */
export function createRuin({ seed = 1 } = {}) {
  if (!DECAY?.ruin) return null
  // Asked before the recipe is run rather than after, because until the kit lands the answer
  // is no on every poll and there is no reason to build a parts list for the bin each time.
  for (const node of RUIN_NODES) if (!hasPart(node, DECAY.kit)) return null
  const { parts } = expandRecipe(DECAY.ruin, mulberry(seed ^ 0x5eed), { deck: DECK })
  // Again, on what the run actually produced: a node the recipe reaches through a `var` is
  // not in `RUIN_NODES` and this is the only place it can be held against the kit.
  if (!parts.length || !parts.every((p) => hasPart(p.node, DECAY.kit))) return null

  const c = new Composer()
  for (const p of parts) c.add(p.node, { ...p, kit: DECAY.kit })
  const geo = c.finish()
  geo.scale(BUILDING_SCALE, BUILDING_SCALE, BUILDING_SCALE)
  // A position-valued attribute has to be scaled by hand, exactly as in `createBuilding` —
  // nothing in the ruin spins today, and the day one does it must not orbit its own foot.
  const pivot = geo.getAttribute('aPivot')
  if (pivot) {
    for (let i = 0; i < pivot.count * 3; i++) pivot.array[i] *= BUILDING_SCALE
    pivot.needsUpdate = true
  }
  geo.computeBoundingBox()
  return geo
}

/** Scaffolding around anything still going up. One instanced mesh for the whole colony. */
export class Scaffolds {
  constructor(scene, capacity = 256) {
    const geo = new THREE.CylinderGeometry(0.045, 0.045, 1, 5)
    geo.translate(0, 0.5, 0) // pivot at the foot, so scaling grows it upward
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xb08d52, roughness: 0.85, flatShading: true }),
      capacity
    )
    this.mesh.castShadow = true
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(this.mesh)
    this.scene = scene
    this.capacity = capacity
    this._dummy = new THREE.Object3D()
  }

  /** `sites` are `{ x, y, z, radius, height }` for every building not yet finished. */
  update(sites) {
    const d = this._dummy
    let n = 0
    for (const site of sites) {
      for (let i = 0; i < 4 && n < this.capacity; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.78
        const x = site.x + Math.cos(a) * site.radius
        const z = site.z + Math.sin(a) * site.radius
        if (site.contains && !site.contains(x, z)) continue
        d.position.set(x, site.y, z)
        d.rotation.set(0, a, 0)
        d.scale.set(1, Math.max(0.4, site.height), 1)
        d.updateMatrix()
        this.mesh.setMatrixAt(n++, d.matrix)
      }
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.scene.remove(this.mesh)
  }
}

import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { decorateFade, decorateReveal, ghostAmount } from './fade.js'
import { atlasTexture, decorateCellEmissive, hasPart, part } from './kit.js'
import { planDecay, swapPlan } from './decay.js'
import { mulberry } from './setting.js'
import { hasFeature } from '../core/features.js'
import { curveInstalled, withCurve } from '../core/curve.js'
import { OVERLAY_LAYER } from '../core/engine.js'
import { BUILDING_RADIUS } from './buildings.js'

/**
 * Project plots — the fenced-off sections of the map, one per repo.
 *
 * Plots sit on a hexagonal lattice, and a project claims **as many cells as it has threads
 * to house**: a repo with forty sessions sprawls across six tiles, a one-off gets a single
 * tile. The cells tile exactly, so a multi-cell plot reads as one continuous zone, and the
 * accent border is drawn only on the edges that actually face something else — internal
 * seams between a project's own cells get no border at all.
 *
 * Cells are handed out in a spiral from the middle, biggest project first, so the busiest
 * repo lands where you are already looking and quiet ones ring the edge.
 */

/** Hex size, centre to corner. Cells tile exactly at this radius. */
const CELL = 7.6
/** Exported for hit-testing: on a hex lattice the nearest cell centre *is* the containing cell. */
export const PLOT_CELL = CELL
/** Pulled in a hair so two neighbouring plots never z-fight along a shared edge. */
const TILE = CELL * 0.992
/**
 * Top face of a plot's tile slab — the surface everything on a plot stands on, and the one
 * height every prop, building, kerb and pair of boots on a plot is measured from.
 *
 * It has to clear the ground it is laid on. Inside the colony the terrain is gentle but not
 * flat: it runs from about -0.3 to +0.24 on the Moon and half again as far on Mars, so the
 * old 0.22 put the top face *level with the high patches* — decks read as sunken, props sat
 * in the ground up to their waists, and every surface that met the terrain tore. This stands
 * the slab proud of the roughest ground any plot can be dealt.
 *
 * A live binding, not a constant: the value is the theme's, installed by `configurePlots`
 * before the first plot is built. The literal here is only what the space theme ships.
 */
export let DECK_TOP = 0.45
/**
 * How far the slab's underside reaches below y=0.
 *
 * The prism used to stop dead at zero, and zero is *above* the ground over most of a plot:
 * the colony floor bottoms out near -0.36 in the roughest setting, so about three fifths of
 * every plot's edge had open air under it. At the camera's shallowest tilt — six degrees off
 * the horizon — you could see straight through that gap, and even at the resting isometric
 * angle it read as a slab hovering a hand's width off the dirt.
 *
 * Buried by definition, so it only has to reach past the lowest ground a plot can be dealt;
 * it is never the surface anything is measured from. That is still `DECK_TOP`.
 */
let DECK_SKIRT = 0.4
/** The whole prism: the rim you can see, plus the skirt buried under it. */
let DECK_HEIGHT = DECK_TOP + DECK_SKIRT
/**
 * Building slots per cell: one in the middle and six around it.
 *
 * A hard limit, not a target. `threadsPerTile` is the user's opinion about how many *threads*
 * justify a tile; this is how many buildings a tile can physically hold, and past it the zone
 * says `+N` rather than standing two houses in one spot.
 */
export const SLOTS_PER_CELL = 7
const MAX_CELLS = 9
/** A stable colour per repo, probed forward on collision. Read through `plotPalette()`. */
let PALETTE = []
/**
 * The lattice cell the ceremony — the ship, the castle, the dock — owns. Nothing else may be
 * placed there. `configurePlots` installs the theme's default; `setCeremonyCell` is how a
 * setting that wants its arrival somewhere else (the valley's dock, down on the shore) moves
 * it, which is why this is a module-level setter rather than a constructor argument: the cell
 * changes while plots are alive, and the allocator has to be reading the new one.
 */
let CEREMONY_CELL = { q: -2, r: 1 }
/** Kit props scattered along the kerb, and the scales they are placed at. */
let CLUTTER = []
let CLUTTER_SCALE = 1.35
/** The one prop that is scaled by `CLUTTER_LAMP_SCALE`, named by the theme rather than here. */
let CLUTTER_LAMP = ''
let CLUTTER_LAMP_SCALE = 1.1
/**
 * Whether to stand the engine's own lamp post on every cell corner. On unless a theme says
 * otherwise: a theme whose `clutterLamp` is a real light — the medieval torch — already has
 * its night lighting on the kerb and does not want a streetlight next to it.
 */
let LAMP_POSTS = true
/**
 * How a theme lays its kerb props out: `manifest.plots.yard`. `'reserved'` is upstream's yard
 * (259f434, merged 2026-09-24): each prop reserves its whole footprint and a walking gap, and a
 * cramped one is skipped rather than pushed onto a building or over the kerb. Absent is the
 * yard every other theme always had, which places a prop by its centre point.
 */
let YARD = null
/** The theme's deck and kerb painters, installed by `configurePlots` with the constants. */
let SURF = null
/**
 * The colour a `deckTint: 'ground'` theme paints its decks, or null for every other theme.
 *
 * A village green is the same green in three seasons unless something tells it otherwise,
 * and a summer meadow laid on a snowfield is the loudest thing in the picture. This carries
 * the *setting's* own ground colour onto the deck, so a plot reads as a mown patch of the
 * country around it rather than as a rug dropped on top of it. Set by `setPlotSeason` and
 * read both by `_buildDeck` (new plots) and by the colony (plots that already exist).
 */
let DECK_SEASON = null
/**
 * What a ghost town grows over itself — `manifest.decay`, or null for a theme that declares
 * none, which is every theme but the village. See `world/decay.js` for the rules and the
 * manifest block's own comment for what each field means.
 */
let DECAY = null

/** Filled from the theme manifest before the first plot is built. */
export function configurePlots(spec, surf, decay = null) {
  DECK_TOP = spec.deckTop
  DECK_SKIRT = spec.deckSkirt
  DECK_HEIGHT = DECK_TOP + DECK_SKIRT
  PALETTE = spec.palette.slice()
  CEREMONY_CELL = { ...spec.ceremonyCell }
  CLUTTER = spec.clutter.slice()
  CLUTTER_SCALE = spec.clutterScale
  CLUTTER_LAMP = spec.clutterLamp
  CLUTTER_LAMP_SCALE = spec.clutterLampScale
  LAMP_POSTS = spec.lampPosts !== false
  YARD = spec.yard ?? null
  SURF = surf
  DECAY = decay || null
}

/**
 * Move the ceremony onto another lattice cell.
 *
 * Two things read `CEREMONY_CELL` and both have to agree: `ceremonyPosition` decides where the
 * arrival stands, and `allocateCells` refuses to hand that cell to a repo. So this is called
 * *before* the ceremony is constructed and before the next allocation, never between them.
 *
 * @param {{q: number, r: number}} cell
 */
export function setCeremonyCell(cell) {
  CEREMONY_CELL = { q: cell.q, r: cell.r }
}

/** Which cell the ceremony owns right now. */
export const ceremonyCell = () => ({ ...CEREMONY_CELL })

export const plotPalette = () => PALETTE

/**
 * Tell the plots which setting they are standing in, so a `deckTint: 'ground'` theme can
 * follow it. Cheap enough to call on every setting change, and a no-op for every theme that
 * tints its decks by the repo accent or not at all — which is what keeps the space boot path
 * free of the one allocation this makes.
 *
 * Deliberately a module-level setter rather than a constructor argument: the setting changes
 * while plots are alive, and threading it through `Plot` would put a copy of it on every one
 * of them that the next swap would have to go and find again.
 */
export function setPlotSeason(setting) {
  if (!SURF || SURF.deckTint !== 'ground' || !setting) return
  // Lifted toward white before it is used, because `material.color` multiplies: the deck's
  // own painted grass is already dark, and the ground tint at full strength takes a meadow
  // to mud. This keeps the hue and gives back most of the value.
  DECK_SEASON = new THREE.Color(setting.ground.tint).lerp(new THREE.Color(0xffffff), DECK_SEASON_LIFT)
}

/** How far the ground tint is lifted toward white before the deck is multiplied by it. */
const DECK_SEASON_LIFT = 0.35

/**
 * How strongly a `deckTint: 'glaze'` deck leans toward its repo's accent — the user's
 * "Zone tint" slider, 0 to 0.5, set by `setDeckGlaze`.
 *
 * The glaze is the accent laid over the grass like a sheet of tinted glass: at 0.2 the grass's
 * own colour is mixed a fifth of the way toward the kerb's. It is done in the shader because a
 * multiply cannot do it: `material.color` scales the texture channel by channel, and a
 * saturated green has almost no red or blue for a red or blue tint to scale, so every tint
 * just darkens it. The mix acts on the painted colour after the texture is read and before
 * the light is, so shadows and the day still fall on it.
 */
let DECK_GLAZE = 0.2

/** Set the glaze strength. Plots already standing pick it up through `refreshDeckGlaze`. */
export function setDeckGlaze(amount) {
  DECK_GLAZE = amount
}

/**
 * Lay the glaze into a deck material. The two uniforms live on the plot, so the fade can
 * drain the glaze along with everything else.
 */
function decorateDeckGlaze(material, uniforms) {
  const prev = material.onBeforeCompile
  material.onBeforeCompile = (shader) => {
    prev?.(shader)
    shader.uniforms.uDeckAccent = uniforms.accent
    shader.uniforms.uDeckGlaze = uniforms.amount
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 uDeckAccent;
         uniform float uDeckGlaze;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         diffuseColor.rgb = mix(diffuseColor.rgb, uDeckAccent, uDeckGlaze);`
      )
  }
  const prevKey = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `${prevKey()}|deck-glaze`
  return material
}

/** The current seasonal deck colour, or null when the theme does not use one. */
export const plotDeckColor = () => DECK_SEASON

/**
 * The texture maps a surfaces hook's `deck()` handed back, with the ones it left out left out.
 *
 * Every map on a deck is optional — the medieval kit deck paints from the atlas and has no
 * roughness map — and three's `setValues` warns for a key that is present with the value
 * `undefined` ("parameter 'roughnessMap' has value of undefined"), once per plot per boot.
 * Omitting the key is the same material, since a map three is not given is `null` either way.
 */
export function deckMaps(plate) {
  const maps = {}
  for (const key of ['map', 'normalMap', 'roughnessMap']) if (plate?.[key] != null) maps[key] = plate[key]
  return maps
}

/** Where a fading plot's colour goes. Matches `GHOST_GREY` in `buildings.js` by design. */
const GHOST_GREY = new THREE.Color(0x8c8c90)

const HEX_DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
]

/**
 * Edge j of a flat-top hexagon runs between the corners at 60j° and 60(j+1)°, so its
 * midpoint faces 60j+30°. This maps that edge to the neighbour sitting across it.
 */
const EDGE_TO_DIR = [0, 5, 4, 3, 2, 1]

const key = (q, r) => `${q},${r}`
/**
 * The one way a lattice cell is spelled as a string.
 *
 * Exported because three parties now build these keys and they all have to agree to the
 * character: this module's own pool, the colony's blocked set, and the tests. A second
 * spelling anywhere — `q + ',' + r`, a template with a space — is a set that silently never
 * matches, and the symptom is a plot standing in the sea rather than an error.
 */
export const cellKey = key
const ORIGIN = { q: 0, r: 0 }

/**
 * The outermost ring the tile pool reaches, and therefore the furthest a zone can ever be
 * placed. Read by `allocateCells`'s pool and by the colony, which has to know how much ground
 * the crew might have to walk.
 */
export const PLOT_RINGS = 11

/** Which ring a cell sits on: its hex distance from the middle. */
export const ringOf = ({ q, r }) => (Math.abs(q) + Math.abs(q + r) + Math.abs(r)) / 2

/**
 * How far the furthest deck a zone can be dealt reaches from the middle.
 *
 * `√3 · CELL · rings` is the furthest cell *centre* — down the z axis, where the lattice is
 * taller than it is wide (11.4 a step in x against 13.16 in z) — and `CELL` again is that
 * tile's own circumradius. Anything past this is scenery.
 */
export const latticeReach = () => Math.sqrt(3) * CELL * PLOT_RINGS + CELL

/** Flat-top axial hex → world. */
export function hexToWorld(q, r, size = CELL) {
  return { x: size * 1.5 * q, z: size * Math.sqrt(3) * (r + q / 2) }
}

/**
 * The inverse: which cell a world point falls in. Exact rather than nearest-centre, because
 * it decides whether something is standing on a plot's raised deck or on bare ground, and a
 * radius test would put an astronaut on a deck it is not actually over.
 */
export function worldToHex(x, z, size = CELL) {
  const q = x / (size * 1.5)
  const r = z / (size * Math.sqrt(3)) - q / 2
  return cubeRound(q, r)
}

/** Round fractional axial coordinates to the cell that actually contains the point. */
function cubeRound(q, r) {
  const y = -q - r
  let rq = Math.round(q)
  let rr = Math.round(r)
  const ry = Math.round(y)
  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const dy = Math.abs(ry - y)
  // Whichever axis drifted furthest is the one recomputed from the other two.
  if (dq > dr && dq > dy) rq = -rr - ry
  else if (dr > dy) rr = -rq - ry
  return { q: rq, r: rr }
}

function hexRing(radius) {
  if (radius === 0) return [{ q: 0, r: 0 }]
  const out = []
  let q = HEX_DIRS[4][0] * radius
  let r = HEX_DIRS[4][1] * radius
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      out.push({ q, r })
      q += HEX_DIRS[i][0]
      r += HEX_DIRS[i][1]
    }
  }
  return out
}

/**
 * How many cells a zone needs for the threads it is housing.
 *
 * `perCell` is the user's own Zone size setting rather than the seven slots a cell actually
 * has: past seven, buildings share slots (`slotFor` wraps), which reads fine for a while and
 * turns to soup somewhere past a dozen — hence the clamp. Below one it would divide a count
 * by zero, so the same clamp catches a hand-edited setting at the bottom end too.
 */
const cellsNeeded = (threadCount, perCell = SLOTS_PER_CELL) => {
  const per = Number.isFinite(perCell) ? Math.max(1, Math.min(14, Math.round(perCell))) : SLOTS_PER_CELL
  return Math.max(1, Math.min(MAX_CELLS, Math.ceil(threadCount / per)))
}

/** Hex distance in axial coordinates: the cube distance, halved. */
function hexDistance(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2
}

/** Shared so the common call allocates nothing. Never written to; nothing here may write to it. */
const EMPTY_BLOCKED = new Set()

/** A flat-top cell's six corners as unit offsets, the bearings every rule samples at. */
const CORNERS = [0, 1, 2, 3, 4, 5].map((i) => [Math.cos((Math.PI / 3) * i), Math.sin((Math.PI / 3) * i)])

/**
 * Where the burial rule reads the ground under one cell, as offsets in cell radii: 19 points
 * rather than the other rules' seven. The centre; six at half the radius on the corner bearings;
 * the six corners; and the six edge midpoints, `cos 30°` of the radius out on the bearings
 * halfway between corners.
 *
 * Seven samples leave most of the slab unread, and a hill can rise over the deck between them:
 * with the far-field hills in their place on the short worlds, ground stood up to 0.94 above
 * the deck top between the seven on space Dune's `6,3`, and some dealt cell had ground over its
 * deck on eleven space pairs and on the village's Dune. Nineteen points leave at most 0.111
 * over the deck between them, read on a lattice a quarter of a cell apart, on space Luna's
 * `-1,8` in ring 8; every other pair leaves less than 0.03. The cells it costs, of the
 * dealable ones in rings 0–11: twelve on space Luna, four on Mars and on Dune, three on
 * Archipelago, two on the valley (`5,-7` and `8,0`), one each on Terra, Shoreline, Canopy,
 * Frost, Harvest and Cinder, and one on the village's Dune (`0,5`); none on any other pair, and
 * every pair still deals at least 61. Past the pool it also refuses the forest's `3,-12` in
 * both themes.
 *
 * Only the ceiling reads them. The floor and the slope keep their seven, because their
 * thresholds were tuned on seven.
 */
const BURIAL_POINTS = [
  [0, 0],
  ...CORNERS.map(([u, v]) => [u / 2, v / 2]),
  ...CORNERS,
  ...CORNERS.map(([u, v], i) => [(u + CORNERS[(i + 1) % 6][0]) / 2, (v + CORNERS[(i + 1) % 6][1]) / 2]),
]

/**
 * Which lattice cells a plot may not be laid on, given a test for ground it may.
 *
 * The allocator is water-blind by construction: it hands out cells by size and adjacency and
 * has no idea which of them are under a sea. That was survivable while the shoreline sat
 * further out than any cell a zone could reach, and stops being survivable the moment the
 * coast comes inside the lattice — a repo dealt a wet tile gets a slab floating over open
 * water, or, one cell landward of that, a slab with daylight under its seaward rim.
 *
 * So the test is on the **corners as well as the centre**: a hex whose middle is on the bank
 * can still have two corners hanging over the drop, and the slab is a prism, not a post. Seven
 * samples per cell, and a cell fails if any one of them does.
 *
 * **The second rule is the slope**, and it is the one a setting with hills past its plots needs
 * even when it has no sea at all. A deck is a flat slab: laid on ground that falls away under
 * it, it stands proud on the high side and hangs in the air on the low one, and no amount of
 * skirt hides that once the ground under one cell moves by more than a slab is thick. So the
 * *spread* between the seven samples is measured, and a cell whose ground climbs more than
 * `maxTilt` across itself is refused. Opt-in and off by default: `maxTilt` is `Infinity` and
 * `heightAt` is null unless a theme asks for the rule, so every setting that does not — the
 * whole space theme included — walks exactly the loop it always walked.
 *
 * The tilt is measured only on cells the coast rule kept, because it costs seven terrain
 * samples and a cell already blocked has nothing to add.
 *
 * **The third rule is the ceiling**: a slab must not be buried, so a cell is refused when the
 * ground at any of `BURIAL_POINTS` stands above `ceiling` — nineteen points, not seven, because
 * a hill rises over a deck between the corners (see there). Off unless `ceiling` is finite and
 * `heightAt` is given; a height that is not a number counts as buried.
 *
 * Pure apart from `hexToWorld`, which is arithmetic — no terrain, no setting, no three. The
 * caller supplies `isDry` and `heightAt`, which is where all the knowledge of what "dry enough"
 * and "how steep" mean lives; `tests/plots.test.mjs` supplies synthetic ones.
 *
 * @param {(x: number, z: number) => boolean} isDry  true where a slab may stand
 * @param {{rings?: number, size?: number, heightAt?: ((x: number, z: number) => number) | null,
 *   maxTilt?: number, ceiling?: number}} [opts]  how far out to walk, the cell radius, the
 *   ground sampler the slope and ceiling rules read, the spread the slope allows across one
 *   cell, and the height no ground under a cell may stand above
 * @returns {Set<string>} `cellKey` strings, one per cell that fails
 */
export function blockedCells(isDry, { rings = 12, size = CELL, heightAt = null, maxTilt = Infinity, ceiling = Infinity } = {}) {
  const sampling = typeof heightAt === 'function'
  const tilting = sampling && Number.isFinite(maxTilt)
  const burying = sampling && Number.isFinite(ceiling)
  const out = new Set()
  for (let ring = 0; ring <= rings; ring++) {
    for (const cell of hexRing(ring)) {
      const { x, z } = hexToWorld(cell.q, cell.r, size)
      let bad = !isDry(x, z)
      for (let i = 0; i < 6 && !bad; i++) {
        const a = (Math.PI / 3) * i
        if (!isDry(x + size * Math.cos(a), z + size * Math.sin(a))) bad = true
      }
      for (let i = 0; i < BURIAL_POINTS.length && !bad && burying; i++) {
        const [u, v] = BURIAL_POINTS[i]
        if (!(heightAt(x + size * u, z + size * v) <= ceiling)) bad = true
      }
      if (!bad && tilting) {
        let lo = heightAt(x, z)
        let hi = lo
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i
          const h = heightAt(x + size * Math.cos(a), z + size * Math.sin(a))
          if (h < lo) lo = h
          if (h > hi) hi = h
        }
        bad = hi - lo > maxTilt
      }
      if (bad) out.add(key(cell.q, cell.r))
    }
  }
  return out
}

/**
 * The blocked set, plus the cell the ceremony's threshold stands in.
 *
 * Every arrival appears at a point outside the disc the colony blocks at the ceremony cell,
 * and for a castle or a lander that point is still *inside the ceremony's own cell* — which
 * the allocator already reserves, so nothing more was ever needed. A pier is the case that
 * breaks it: the dock's cell is a shore station and its threshold is 7.5 units landward of it,
 * which on this lattice is a different cell entirely and one no rule reserved. With enough
 * zones on the map a repo would be dealt it, and villagers would come ashore on a neighbour's
 * deck.
 *
 * So the cell under the door is reserved too, for every ceremony. It costs the castle and the
 * lander nothing — their doors resolve to the cell they already stand on — and it is the whole
 * fix for the dock.
 *
 * Pure, and non-mutating: a new set is returned, so the caller's own may be a shared constant.
 *
 * @param {Set<string>} blocked
 * @param {number} x  the threshold's world x — `ceremony.door()`
 * @param {number} z
 * @returns {Set<string>} `blocked` itself when the cell is already in it, else a copy plus it
 */
export function withDoorCell(blocked, x, z) {
  const cell = worldToHex(x, z)
  const k = key(cell.q, cell.r)
  if (blocked.has(k)) return blocked
  const out = new Set(blocked)
  out.add(k)
  return out
}

/**
 * The lattice cells in a wedge: those whose centres lie further out along `axis` than `origin`,
 * and within `halfAngle` of it as seen from `origin`. The cell at `origin` itself is not in it.
 *
 * It is how a harbour keeps its water: `Colony._blockedCells` refuses these on an island, so no
 * repo is dealt the sea in front of the pier and the island never grows across it.
 *
 * @param {{x: number, z: number}} origin  a world point, the apex
 * @param {[number, number]} axis  a unit `[x, z]`
 * @param {number} halfAngle  radians
 * @param {number} [rings]  how far out the lattice is walked
 * @returns {{q: number, r: number}[]}
 */
export function wedgeCells(origin, axis, halfAngle, rings = PLOT_RINGS) {
  const [ax, az] = axis
  const cos = Math.cos(halfAngle)
  const out = []
  for (let ring = 0; ring <= rings; ring++) {
    for (const cell of hexRing(ring)) {
      const { x, z } = hexToWorld(cell.q, cell.r)
      const vx = x - origin.x
      const vz = z - origin.z
      const along = vx * ax + vz * az
      if (along > 1e-9 && along >= cos * Math.hypot(vx, vz)) out.push(cell)
    }
  }
  return out
}

/**
 * Hand out cells to projects, keeping every zone exactly where it already is.
 *
 * This used to be a pure function of the size list, and that was the bug: one thread
 * appearing anywhere changed the order, the order decided the cells, and the whole colony
 * re-laid itself out. A zone you were watching could jump to the far side of the map
 * because a *different* repo gained a session, which makes the place impossible to learn.
 *
 * So the previous layout is an input. A zone that still needs the same number of cells
 * keeps precisely the cells it had; one that grew keeps them and claims neighbours; one
 * that shrank drops the cells it claimed most recently. Only a repo that has never been
 * placed is placed at all, and it takes the innermost cells still free — which is what
 * keeps the busy middle busy.
 *
 * Each list is ordered root-first and growth appends, so a shrink is a slice, and
 * grow-then-shrink puts a zone back in exactly the shape it started in.
 *
 * Contiguity still comes from a flood fill: slicing runs out of a hex spiral looks like it
 * would work and does not, because the last cell of one ring and the first of the next sit
 * on opposite sides of the colony.
 *
 * @param projects [{ id, size }], biggest first — the order only decides who gets the
 *   innermost seed among repos that are *new*.
 * @param previous Map of id → cells from the last pass (or a saved colony file).
 * @param opts `perCell` — how many threads one tile houses, the user's Zone size setting;
 *   `blocked` — a `Set` of `cellKey` strings that may not be built on, which is how a
 *   coastal setting keeps a repo out of its own sea. Every key in it is treated exactly as
 *   the ceremony cell is: never pooled, never grown into, and a zone whose *root* is one of
 *   them is seeded afresh rather than quietly re-rooted onto a surviving tile. The default
 *   is empty, so every dry setting allocates precisely as it always did.
 *   `relocated` — an optional `Set` the relocation pass writes the id of every zone it *moved*
 *   into. The caller cannot work that out from the result: a zone's root tile also changes when
 *   a blocked cell appears under it or `threadsPerTile` re-deals it, and only a zone the
 *   allocator picked up and put down elsewhere is the map rearranging itself.
 * @returns Map of id → cells.
 */
export function allocateCells(projects, previous = new Map(), { perCell = SLOTS_PER_CELL, blocked = EMPTY_BLOCKED, relocated = null } = {}) {
  const reserved = key(CEREMONY_CELL.q, CEREMONY_CELL.r)
  // Shrinking has hysteresis (upstream f2cce25, merged 2026-09-24). A zone sitting exactly on
  // a cell boundary would otherwise hand a tile back the moment one thread is archived and
  // claim it again when the next one starts — and every hand-back rebuilds the plot and walks
  // its whole crew. A tile is only returned once the repo has lost a few threads past the line.
  const wanted = projects.map((p) => {
    const before = previous.get(p.id)
    let want = cellsNeeded(p.size, perCell)
    if (before && before.length > want) want = Math.min(before.length, cellsNeeded(p.size + 3, perCell))
    return { id: p.id, want }
  })
  const total = wanted.reduce((n, w) => n + w.want, 0)

  // Spiral order decides where a *new* project settles. The pool runs past what is needed
  // so there is always somewhere to grow into.
  const pool = []
  const free = new Set()
  // The pool has to reach every cell anybody *remembers*, not merely as far as today's
  // colony needs. Sized from `total` alone, a zone that has sat out at ring five for a week
  // finds its own cell missing from `free` the moment the colony shrinks, cannot reclaim
  // it, and is re-seeded in the middle — which is exactly the jump this function exists to
  // prevent, arriving by the back door.
  let farthest = 0
  for (const project of projects) {
    for (const cell of previous.get(project.id) || []) farthest = Math.max(farthest, hexDistance(cell, ORIGIN))
  }
  for (let ring = 0; (pool.length < total + 30 || ring <= farthest) && ring <= PLOT_RINGS; ring++) {
    for (const cell of hexRing(ring)) {
      const k = key(cell.q, cell.r)
      if (k === reserved || blocked.has(k)) continue
      pool.push(cell)
      free.add(k)
    }
  }

  const held = new Map()
  for (const { id, want } of wanted) {
    const before = previous.get(id)
    if (!before || !before.length) continue
    // The root cell is the whole point — it is the zone's origin, and everything standing
    // on the zone is placed relative to it. A blob that loses its root has *moved*, so if
    // the root is gone this project is seeded afresh rather than quietly re-rooted onto
    // whichever of its old cells happens to still be free.
    if (!free.has(key(before[0].q, before[0].r))) continue
    const keep = []
    for (const cell of before) {
      if (keep.length >= want) break // shrunk: whatever it claimed last is what it gives up
      const k = key(cell.q, cell.r)
      if (!free.has(k)) continue // the ceremony's cell, a blocked one, or a hand-edited duplicate
      free.delete(k)
      keep.push({ q: cell.q, r: cell.r })
    }
    if (keep.length) held.set(id, keep)
  }

  const out = new Map()
  // Anybody who was already here grows first, so a newcomer cannot take the cell a zone
  // was about to expand into while its own seed is still free.
  for (const { id, want } of wanted) {
    const cells = held.get(id)
    if (!cells) continue
    growBlob(cells, want, free)
    out.set(id, cells)
  }

  /**
   * A zone that needs more ground and is hemmed in *moves*, rather than stacking its
   * buildings on the tiles it has.
   *
   * After the settled zones have grown and before any newcomer is planted, so a zone that is
   * stuck outranks a new repo but can never take the cell a settled one was about to expand
   * into. Its own tiles go back on the market first — the island it is standing in is only
   * measurable with its own cells in it — and go back to it untouched if there is nowhere with
   * room for the whole zone. Nothing else is moved, so a relocation never cascades.
   */
  for (const { id, want } of wanted) {
    const cells = out.get(id)
    if (!cells || cells.length >= want) continue
    for (const c of cells) free.add(key(c.q, c.r))
    const seed = seedFor(pool, free, want, true)
    if (!seed) {
      for (const c of cells) free.delete(key(c.q, c.r))
      continue
    }
    free.delete(key(seed.q, seed.r))
    const moved = [{ q: seed.q, r: seed.r }]
    growBlob(moved, want, free)
    out.set(id, moved)
    // Reported, because only this pass is the map rearranging itself: a root tile also changes
    // when the coast blocks the ground under a zone, when `threadsPerTile` re-deals it, or on a
    // Compact, and none of those wants to be announced as a zone moving to open ground.
    relocated?.add(id)
  }

  for (const { id, want } of wanted) {
    if (out.has(id)) continue
    const seed = seedFor(pool, free, want)
    if (!seed) {
      out.set(id, [])
      continue
    }
    free.delete(key(seed.q, seed.r))
    const cells = [{ q: seed.q, r: seed.r }]
    growBlob(cells, want, free)
    out.set(id, cells)
  }
  return out
}

/** Claim free neighbours until the blob is big enough, hugging its root cell first. */
function growBlob(cells, want, free) {
  const root = cells[0]
  while (cells.length < want) {
    let best = null
    let bestScore = Infinity
    for (const c of cells) {
      for (const [dq, dr] of HEX_DIRS) {
        const n = { q: c.q + dq, r: c.r + dr }
        if (!free.has(key(n.q, n.r))) continue
        // Hug the root first, then the middle of the colony, so blobs come out compact.
        const score = hexDistance(n, root) * 100 + hexDistance(n, ORIGIN)
        if (score < bestScore) {
          bestScore = score
          best = n
        }
      }
    }
    if (!best) break // completely hemmed in by neighbours
    free.delete(key(best.q, best.r))
    cells.push(best)
  }
}

/**
 * Which free cells are joined to which, and how big each of those islands is.
 *
 * This is the question "is there room for a zone of `want` tiles anywhere?", and it has an
 * exact answer rather than a conservative one: `growBlob` expands from the whole blob's
 * frontier, never from a single cell, so a seed inside a free component of at least `want`
 * cells can always be grown to `want`. Component size *is* the test.
 *
 * One pass over `free`, six neighbours a cell. Called only for a zone that could not grow,
 * which on an ordinary colony is never.
 *
 * @param {Set<string>} free  cell keys still on the market
 * @returns {Map<string, number>} cell key → the size of its component
 */
function componentSizes(free) {
  const sizes = new Map()
  for (const start of free) {
    if (sizes.has(start)) continue
    const stack = [start]
    const members = [start]
    sizes.set(start, 0)
    while (stack.length) {
      const k = stack.pop()
      const comma = k.indexOf(',')
      const q = Number(k.slice(0, comma))
      const r = Number(k.slice(comma + 1))
      for (const [dq, dr] of HEX_DIRS) {
        const nk = key(q + dq, r + dr)
        if (!free.has(nk) || sizes.has(nk)) continue
        sizes.set(nk, 0)
        members.push(nk)
        stack.push(nk)
      }
    }
    for (const k of members) sizes.set(k, members.length)
  }
  return sizes
}

/**
 * Where to plant a zone of `want` tiles: the innermost free cell whose island can hold the
 * whole of it.
 *
 * Innermost because `pool` is a spiral from the middle, and the middle is both where the holes
 * appear as repos leave and where you are already looking.
 *
 * `requireRoom` is the difference between a newcomer and a zone that is moving. A newcomer with
 * nowhere roomy still wants a tile — one cramped tile beats no zone, and it is how a repo stays
 * on the map on a nearly full colony. A zone that already has ground must not trade it for
 * ground no better: a jump is the most disruptive thing the map does and it has to buy the
 * whole problem.
 */
function seedFor(pool, free, want, requireRoom = false) {
  const sizes = componentSizes(free)
  const roomy = pool.find((c) => (sizes.get(key(c.q, c.r)) || 0) >= want)
  if (roomy || requireRoom) return roomy || null
  return pool.find((c) => free.has(key(c.q, c.r))) || null
}

export const ceremonyPosition = () => {
  const { x, z } = hexToWorld(CEREMONY_CELL.q, CEREMONY_CELL.r)
  return new THREE.Vector3(x, 0, z)
}

/**
 * Three builds a 6-sided cylinder with its first vertex on +Z, which puts its corners at
 * 30°, 90°, 150°… — a *pointy-top* hexagon. The lattice, the edge-to-neighbour mapping and
 * the border bars all assume a **flat-top** hexagon with corners at 0°, 60°, 120°… so every
 * hexagonal prism has to be turned by this much to agree with them. Without it the decks sit
 * a half-step out of phase and their corners poke through the borders.
 */
const HEX_PHASE = Math.PI / 6

/** Corner i of a flat-top hexagon, in plot-local coordinates. */
function corner(cx, cz, i, size) {
  const a = (Math.PI / 3) * i
  return [cx + size * Math.cos(a), cz + size * Math.sin(a)]
}

/** A flat-top hexagonal prism, phase-corrected. */
/**
 * Replace a geometry's UVs with a world-planar projection.
 *
 * A hex tile is a six-sided cylinder, and a cylinder's cap UVs are a disc — which turns a
 * tiling plate pattern into a medallion, one per tile. Projecting from XZ instead makes the
 * seams run straight across a whole plot, so seven cells read as one apron rather than seven
 * repeats. Upright faces get the rim treatment: the deck's edge is a shallow band next to
 * the plot it wraps, and a flat XZ projection smears it into streaks at exactly the grazing
 * angle it is seen from.
 *
 * `height` is the prism's own height, which is what the rim's texel density is set against.
 * It is not `DECK_TOP`: the slab reaches below the ground as well as above it, and a rim
 * scaled to only the part you can see would stretch the plate over the part you cannot.
 */
function planarUv(geo, scale, offsetX = 0, offsetZ = 0, height = DECK_TOP) {
  const pos = geo.attributes.position
  const nrm = geo.attributes.normal
  const src = geo.attributes.uv
  const uv = new Float32Array(pos.count * 2)
  /** How many times the deck plate repeats around a tile's rim, at the deck's own scale. */
  const perimeterRepeats = (6 * TILE) / SURF.deckTextureScale
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (Math.abs(nrm.getY(i)) > 0.5) {
      // Top and bottom: straight down, in world space, so the pattern runs across tiles.
      uv[i * 2] = (x + offsetX) / scale
      uv[i * 2 + 1] = (z + offsetZ) / scale
    } else {
      // The rim keeps the cylinder's own unwrap, only rescaled to world density.
      //
      // Two simpler ideas both fail here. A fixed horizontal axis like `x + z` is *constant*
      // along two of every six sides of a hexagon, which leaves those faces with no UV
      // gradient, a degenerate tangent, and — since three builds the normal-mapped shading
      // frame out of that — solid black. Arc length from `atan2` fixes the gradient but
      // introduces a seam: the face straddling ±π jumps a full turn in one step, crushing a
      // dozen repeats of the texture into one panel, which reads as fine stripes at the
      // corners and as mud once mipmapping averages them. The generated unwrap already
      // solves both, because it duplicates the vertices at the seam.
      uv[i * 2] = src.getX(i) * perimeterRepeats
      // The cylinder's own v runs 0 at the foot of the prism to 1 at its top, so scaling it
      // by the prism's real height is what keeps the plate at world density whatever the
      // slab's total depth. Lifted off zero so a rim this shallow samples the middle of a
      // plate rather than straddling the seam that runs along the texture's own edge.
      uv[i * 2 + 1] = 0.25 + src.getY(i) * (height / scale)
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/**
 * Point a kerb bar's upper face at the lit dash strip and every other face at plain colour.
 *
 * A box hands all six of its faces the same 0..1 UV square, so one strip drawn once is
 * stretched down the sides and across the ends as well. On a bar 14cm tall that squashes
 * the dark gaps between dashes into what reads as a solid black edge — most visible exactly
 * where two plots meet and six of those edges gather at a corner.
 */
function kerbUv(geo) {
  const nrm = geo.attributes.normal
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) {
    if (nrm.getY(i) > 0.5) {
      uv.setY(i, SURF.kerbUv.top.v0 + uv.getY(i) * (SURF.kerbUv.top.v1 - SURF.kerbUv.top.v0))
    } else {
      uv.setXY(i, SURF.kerbUv.side.u, SURF.kerbUv.side.v)
    }
  }
  uv.needsUpdate = true
}

/**
 * Stamp one geometry with the band of decay it is drawn in — `(show, hide)` on every vertex,
 * which `decorateReveal` forwards to the fragment stage. `(-1, 2)` means always, because the
 * decay uniform only ever runs 0..1.
 *
 * Per vertex rather than per draw so that three populations with three different answers can
 * merge into the one mesh the kerb clutter has always been.
 */
function setReveal(geo, show, hide) {
  const count = geo.attributes.position.count
  const data = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    data[i * 2] = show
    data[i * 2 + 1] = hide
  }
  geo.setAttribute('aReveal', new THREE.BufferAttribute(data, 2))
}

function hexPrism(radius, height) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 6)
  geo.rotateY(HEX_PHASE)
  return geo
}

// ── plot mesh ─────────────────────────────────────────────────────────────────────────

export class Plot {
  constructor({ id, name, index, cells, accent }) {
    this.id = id
    this.name = name
    this.index = index
    this.cells = cells
    this.accent = accent
    this.cellKeys = new Set(cells.map((c) => key(c.q, c.r)))

    // The plot's origin is its **root** tile — the one it was seeded on and never gives up
    // — rather than the centroid of whatever cells it holds this minute. A zone that gains
    // a tile must not drag its buildings, its crew and its name sideways: the root stays
    // exactly where it was and the new tile appears beside it.
    const origin = hexToWorld(cells[0].q, cells[0].r)
    let sx = 0
    let sz = 0
    this.localCenters = cells.map((c) => {
      const { x, z } = hexToWorld(c.q, c.r)
      sx += x
      sz += z
      return { x: x - origin.x, z: z - origin.z }
    })
    this.center = new THREE.Vector3(origin.x, 0, origin.z)
    // Where the camera aims and where the name plate goes: the middle of the whole zone,
    // so an L-shaped blob is framed as one place rather than from its corner.
    this.middle = new THREE.Vector3(sx / cells.length, 0, sz / cells.length)
    let anchor = this.localCenters[0]
    let anchorD = Infinity
    for (const p of this.localCenters) {
      const dx = p.x - (this.middle.x - origin.x)
      const dz = p.z - (this.middle.z - origin.z)
      const d = dx * dx + dz * dz
      if (d < anchorD) {
        anchorD = d
        anchor = p
      }
    }
    this.labelAnchor = new THREE.Vector3(this.center.x + anchor.x, 0, this.center.z + anchor.z)
    this.radius = CELL * Math.sqrt(cells.length)

    this.group = new THREE.Group()
    this.group.position.copy(this.center)
    this.group.name = `plot:${id}`

    /** How far this zone has faded, 0..1. One uniform, shared by every material on the plot. */
    this.fade = 0
    this.fadeUniform = { value: 0 }
    /**
     * The same number again, unfiltered, for the dressing.
     *
     * `fadeUniform` carries `ghostAmount(fade)` — zero unless the user asked for the dither —
     * where the decay is what says "left alone" when the dither is off, so it reads the fade
     * itself. Two uniforms rather than one because they answer two different questions about
     * the same zone, and the answer to the second is never allowed to be nothing.
     */
    this.decayUniform = { value: 0 }
    /** Whether the yard has been rebuilt with its decay half in it. Once per plot, at most. */
    this.decayed = false

    this._buildDeck()
    this._buildBorder()
    this._buildPosts()
    // Before the clutter, not after: the decay dressing has to miss every building slot, and
    // it is built from inside `_buildClutter`. `_buildSlots` is pure arithmetic over the cell
    // centres and allocates no three object, so moving it up spends no seeded draw and moves
    // no pixel.
    this.slots = this._buildSlots()
    this._buildClutter()
  }

  /** One merged slab of hex tiles. */
  _buildDeck() {
    // UVs are assigned per tile, before it is moved into place: the rim wraps around the
    // tile's own centre, so it has to be at the origin when that is worked out. The top's
    // projection takes the tile's offset explicitly, which keeps the plate pattern running
    // continuously across a whole plot.
    //
    // …unless the theme builds its own cell. `surfaces().deckGeometry` is the opt-in: a theme
    // whose kit ships a ground tile hands one back per cell and the engine merges, tints,
    // fades and disposes it exactly as it does its own prism. Absent — or answering null,
    // which is what a theme whose kit has not loaded does — the prism below is built instead,
    // with the arithmetic it has always had. See `docs/kits.md`.
    const parts = this.localCenters.map(({ x, z }) => {
      const built = SURF.deckGeometry?.({
        tile: TILE,
        top: DECK_TOP,
        skirt: DECK_SKIRT,
        x,
        z,
        textureScale: SURF.deckTextureScale,
      })
      if (built) {
        // A built cell is authored with its top face at y 0, so it is placed by that face
        // directly — the same rule the prism follows, arrived at by a shorter road.
        built.translate(x, DECK_TOP, z)
        return built
      }
      const geo = hexPrism(TILE, DECK_HEIGHT)
      planarUv(geo, SURF.deckTextureScale, x, z, DECK_HEIGHT)
      // Positioned by its *top* face rather than by its middle: everything on a plot is
      // measured from that face, so it is the end of the prism that has to stay put when
      // the skirt under it changes depth.
      geo.translate(x, DECK_TOP - DECK_HEIGHT / 2, z)
      return geo
    })
    const geo = BufferGeometryUtils.mergeGeometries(parts)
    parts.forEach((g) => g.dispose())

    // Dark and nearly desaturated: the deck is a backdrop for buildings, and the accent
    // belongs on the border where it can outline the zone without shouting. The plate
    // pattern arrives as a texture and this tints it, which is why the drawing is authored
    // neutral grey.
    // Dark, but not black. The deck is a backdrop and wants to sit under the buildings
    // rather than compete with them — but its rim faces sideways, so whatever the top reads
    // as in full sun the edge reads as one stop darker, and a backdrop that goes to nothing
    // at the plot boundary just looks like a hole.
    // …unless the theme paints its own deck. A grass tile is already the colour it wants to
    // be, and tinting it by the repo's accent turns a meadow into a coloured rug.
    // `'ground'` is the third way: the deck keeps its own drawing but takes the *setting's*
    // colour, so the same green reads as summer meadow, autumn stubble or frozen turf.
    // `'glaze'` leaves the colour white too and lays the accent over the deck in the shader
    // instead — see `DECK_GLAZE` for why a multiply cannot.
    const glazed = SURF.deckTint === 'glaze'
    const color =
      SURF.deckTint === 'none' || glazed
        ? new THREE.Color(0xffffff)
        : SURF.deckTint === 'ground'
          ? new THREE.Color(DECK_SEASON ?? 0xffffff)
          : new THREE.Color(this.accent).offsetHSL(0, -0.38, 0).multiplyScalar(0.9)
    // Kept so the fade can drain the deck toward grey without losing the colour it drains
    // from — which the seasons repaint from under it through `setDeckTint`.
    this._deckBase = color.clone()
    const plate = SURF.deck()
    const material = new THREE.MeshStandardMaterial({
      color,
      ...deckMaps(plate),
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.82,
      metalness: 0.18,
    })
    if (glazed) {
      this._deckGlaze = { accent: { value: new THREE.Color(this.accent) }, amount: { value: DECK_GLAZE } }
      decorateDeckGlaze(material, this._deckGlaze)
    }
    this.deck = new THREE.Mesh(geo, decorateFade(material, this.fadeUniform))
    this.deck.receiveShadow = true
    this.group.add(this.deck)
  }

  /**
   * The glowing accent kerb, drawn as one bar per *outside* edge — skipping shared edges is
   * what makes six tiles read as one zone instead of a honeycomb.
   *
   * Two things here exist purely to stop the borders flickering. The bar is inset so it lies
   * wholly **inside** its own tile: centred on the edge it would overlap the neighbouring
   * plot's bar by more than its own width, and two interpenetrating emissive slabs in
   * different colours z-fight along every shared edge in the colony. And it sits **on top of**
   * the deck rather than straddling it, so no two surfaces in a plot are ever coplanar.
   */
  _buildBorder() {
    const parts = []
    const apothem = TILE * Math.cos(Math.PI / 6)
    const width = 0.32
    // How far the bar's outer face stands in from the tile's edge. The default is the space
    // theme's own literal, so a theme that says nothing puts its kerb exactly where it always
    // stood. A theme whose deck is a kit tile needs more — a modelled tile has a bevel round
    // its top face and a bar laid across that leans outward — and it cannot know the tile
    // radius at boot, when `surfaces()` runs, so the field may also be a function of it.
    const inset = typeof SURF.kerbInset === 'function' ? SURF.kerbInset(TILE) : (SURF.kerbInset ?? 0.05)
    // Centreline of the bar, pulled inboard far enough to clear the tile edge entirely.
    const mid = apothem - inset - width / 2
    // The bars form a smaller regular hexagon, whose side equals its own circumradius.
    const side = mid / Math.cos(Math.PI / 6)

    this.cells.forEach((cell, i) => {
      const { x, z } = this.localCenters[i]
      for (let edge = 0; edge < 6; edge++) {
        const dir = HEX_DIRS[EDGE_TO_DIR[edge]]
        if (this.cellKeys.has(key(cell.q + dir[0], cell.r + dir[1]))) continue

        const angle = (Math.PI / 3) * edge + Math.PI / 6
        // Sits on the deck: bottom flush with the deck's top face, never inside it.
        const geo = new THREE.BoxGeometry(width, 0.14, side * 1.02)
        kerbUv(geo)
        geo.rotateY(-angle)
        geo.translate(x + Math.cos(angle) * mid, DECK_TOP + 0.07, z + Math.sin(angle) * mid)
        parts.push(geo)
      }
    })

    if (!parts.length) return
    const geo = BufferGeometryUtils.mergeGeometries(parts)
    parts.forEach((g) => g.dispose())
    // Every bar is the same length, so a box's own 0..1 UVs put the same run of dashes on
    // each one without any reprojection.
    const lit = SURF.kerb()
    this._borderBase = new THREE.Color(this.accent)
    this.borderMaterial = decorateFade(
      new THREE.MeshStandardMaterial({
        color: this.accent,
        map: lit.map,
        emissive: this.accent,
        emissiveMap: lit.emissiveMap,
        emissiveIntensity: 0.5,
        normalMap: lit.normalMap,
        normalScale: new THREE.Vector2(0.5, 0.5),
        roughness: 0.55,
        metalness: 0.1,
      }),
      this.fadeUniform
    )
    this.border = new THREE.Mesh(geo, this.borderMaterial)
    this.border.receiveShadow = true
    this.group.add(this.border)
  }

  /**
   * A lamp post on one corner of each cell — the plot's own night lighting.
   *
   * Skipped entirely when the theme lights its kerbs itself (`plots.lampPosts: false`). That
   * leaves `lampMaterial` unset, which is why `setNight` reaches for it optionally.
   */
  _buildPosts() {
    if (!LAMP_POSTS) return
    const posts = []
    const lamps = []
    this.localCenters.forEach(({ x, z }, i) => {
      const [px, pz] = corner(x, z, (i * 2) % 6, TILE * 0.72)
      const pole = new THREE.CylinderGeometry(0.055, 0.085, 1.8, 6)
      pole.translate(px, DECK_TOP + 0.9, pz)
      posts.push(pole)
      const head = new THREE.SphereGeometry(0.14, 8, 6)
      head.translate(px, DECK_TOP + 1.84, pz)
      lamps.push(head)
    })

    const poleMesh = new THREE.Mesh(
      BufferGeometryUtils.mergeGeometries(posts),
      decorateFade(new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.7, metalness: 0.3 }), this.fadeUniform)
    )
    poleMesh.castShadow = true
    // The shadow pass runs its own material, so without this a ghosted post keeps a solid
    // shadow. The same dither in the depth material speckles it away with the post itself.
    poleMesh.customDepthMaterial = decorateFade(
      new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
      this.fadeUniform
    )
    this.lampMaterial = decorateFade(new THREE.MeshBasicMaterial({ color: this.accent, toneMapped: true }), this.fadeUniform)
    this.lamps = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(lamps), this.lampMaterial)
    this._lampBase = new THREE.Color(this.accent)
    this.group.add(poleMesh, this.lamps)
    posts.forEach((g) => g.dispose())
    lamps.forEach((g) => g.dispose())
  }

  /**
   * Ground clutter — crates, drums and a floodlight or two, hugging the kerb.
   *
   * A plot with buildings on its slots and nothing anywhere else reads as a car park. This
   * fills the gap for one extra draw call: a merged mesh of kit props, placed against the
   * outer edge of each cell where the crew's routes between slots do not run. Accepted
   * footprints also go into the navigation grid so nobody walks through a barrel.
   *
   * Seeded off the plot's own name, so a repo's yard is laid out the same on every reload.
   *
   * **In decay mode it is built a second time**, identically, with the ghost's half added:
   * every prop the theme's `swap` table knows emits both geometries — the original with a
   * window that closes at its threshold, the emptied twin with one that opens there — and the
   * overgrowth is planted on top. The `mulberry(hash + 17)` stream is replayed in exactly the
   * same order, so the yard does not move when a zone starts to go; only what is drawn of it
   * changes, and at `uDecay == 0` that is precisely what was drawn before.
   *
   * @param {boolean} [decay]  build the ghost's half as well. Only `_dressForDecay` passes true.
   */
  _buildClutter(decay = false) {
    const props = CLUTTER
    if (!props.every((n) => hasPart(n))) return

    const rand = mulberry(hashString(this.id) + 17)
    const parts = []
    /**
     * In decay mode only: what each geometry in `parts` is and where it was put, so the swap
     * can find a prop again after the fact. It has to be after the fact — the thresholds are
     * spread over how many swappable props the yard turned out to hold, which is not known
     * until the last cell has been walked.
     */
    const placed = []
    /**
     * Where every kerb prop was put, one record per placed part:
     * `{ name, x, z, r, top }` — the kit node name, the plot-local position, the radius the
     * navigation grid should block (before `AGENT_RADIUS` is added), and the prop's height
     * above the deck. This is the only record of the yard's layout, and two readers depend
     * on it: `Colony._rebuildNavigation` blocks a disc per entry, and picks the entries whose
     * `name` is `manifest.plots.clutterLamp` to hand `particles.ambient` its lamp positions
     * (`y = DECK_TOP + top`). A ghost plot (`fade > 0`) contributes obstacles but no lamps.
     */
    this.clutterSpots = []
    const reservedYard = YARD === 'reserved'

    this.localCenters.forEach(({ x, z }) => {
      // Two bands, both chosen to miss the buildings. The slot ring sits at 0.58 of a tile
      // and a building reaches about 1.5 units past it, so the gaps *between* consecutive
      // ring slots are clear — and so is the strip inside the kerb, past every slot.
      const spots = []
      for (let i = 0; i < 6; i++) {
        if (rand() > 0.45) spots.push({ a: (Math.PI / 3) * i + Math.PI / 3, r: TILE * (0.52 + rand() * 0.1) })
      }
      for (let i = 0; i < 3; i++) {
        if (rand() > 0.35) spots.push({ a: rand() * Math.PI * 2, r: TILE * (0.78 + rand() * 0.07) })
      }

      for (const { a, r } of spots) {
        const name = props[Math.floor(rand() * props.length)]
        const geo = part(name)
        const s = name === CLUTTER_LAMP ? CLUTTER_LAMP_SCALE : CLUTTER_SCALE
        geo.scale(s, s, s)
        // Drawn into a local before it is applied, because the twin that replaces this prop in
        // a ghost town has to stand at the same angle. The draw is in exactly the place in the
        // stream it has always been in — `scale` spends nothing.
        const ry = rand() * Math.PI * 2
        geo.rotateY(ry)
        const px = x + Math.cos(a) * r
        const pz = z + Math.sin(a) * r
        // How much ground this prop actually covers, rather than a guess: a stack of cargo
        // containers is three times the footprint of a lamp, and a radius that splits the
        // difference is one an astronaut walks into the corner of.
        geo.computeBoundingBox()
        const box = geo.boundingBox
        if (reservedYard) {
          // Upstream's yard (259f434, merged 2026-09-24), for a theme whose `plots.yard` is
          // `'reserved'`: reserve a full footprint and a walking gap, not just a centre point,
          // and skip a cramped prop instead of pushing it onto a building or over the kerb. Every
          // other theme keeps the yard it always had — the rule moves and drops props, which is
          // every kerb pixel.
          const spread = Math.hypot(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)), Math.max(Math.abs(box.min.z), Math.abs(box.max.z)))
          if (
            !this.containsLocal(px, pz, spread + 0.16) ||
            this.slots.some((sl) => Math.hypot(px - sl.x, pz - sl.z) < BUILDING_RADIUS + spread + 0.4) ||
            this.clutterSpots.some((sp) => Math.hypot(px - sp.x, pz - sp.z) < sp.r + spread + 0.25)
          ) {
            geo.dispose()
            continue
          }
          // Sat on the deck by its own floor, so `top` is its full height above the deck.
          const top = box.max.y - box.min.y
          geo.translate(px, DECK_TOP - box.min.y, pz)
          parts.push(geo)
          if (decay) placed.push({ name, x: px, z: pz, s, ry })
          this.clutterSpots.push({ name, x: px, z: pz, r: spread, top })
          continue
        }
        const spread = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5
        // Read *before* the translate, like `spread` above it: `translate` moves the cached
        // bounding box along with the geometry, so asking afterwards would hand back a height
        // with the deck's own thickness added to it.
        const top = box.max.y
        geo.translate(px, DECK_TOP, pz)
        parts.push(geo)
        if (decay) placed.push({ name, x: px, z: pz, s, ry })
        // The position is plot-local and `top` is measured from the deck — read above, before
        // the translate. Carrying the node name and the height here saves every reader from
        // having to know the theme's lamp geometry or the scale it was placed at; see the
        // field's jsdoc at the top of this method for the record's shape and its readers.
        this.clutterSpots.push({ name, x: px, z: pz, r: Math.max(0.45, spread * 0.86), top })
      }
    })

    if (decay) this._addDecay(parts, placed)

    if (!parts.length) return
    const geo = BufferGeometryUtils.mergeGeometries(parts, false)
    parts.forEach((g) => g.dispose())
    let material = decorateFade(
      decorateCellEmissive(new THREE.MeshStandardMaterial({ map: atlasTexture(), roughness: 0.6, metalness: 0.05 })),
      this.fadeUniform
    )
    let depth = decorateFade(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), this.fadeUniform)
    if (decay) {
      material = decorateReveal(material, this.decayUniform)
      depth = decorateReveal(depth, this.decayUniform)
    }
    this.clutter = new THREE.Mesh(geo, material)
    this.clutter.castShadow = true
    // Same as the posts: the shadow pass gets the dither too, so a ghosted crate's shadow
    // speckles away with it rather than lying solid on the deck — and the reveal window with
    // it, or a felled crate would keep casting the shadow of the one that stood there.
    this.clutter.customDepthMaterial = depth
    this.clutter.receiveShadow = true
    this.group.add(this.clutter)
  }

  /**
   * The ghost's half of the yard: the emptied twins, and what grows up through the deck.
   *
   * Appended to the very same `parts` list the kerb clutter was built into, so all of it
   * merges into one geometry and one draw call — which is the whole reason the reveal is a
   * per-vertex window rather than three meshes toggled by hand.
   *
   * The overgrowth draws from a **private** `mulberry(hash + 41)` rather than from the yard's
   * own stream, let alone from `Math.random`: the layouts must not be able to shift each
   * other, and under the snapshot harness `Math.random` is the one seeded stream the villagers
   * are seated from (see `docs/kits.md` §7).
   *
   * Every name is looked up in the decay kit, which `_decayReady` has already found all of
   * them in — a yard is not dressed until the whole dressing is in hand, so there is no
   * half-loaded case to fall back from.
   */
  _addDecay(parts, placed) {
    const plan = swapPlan(
      placed.map((p) => p.name),
      DECAY.swap || {}
    )
    const closesAt = new Map(plan.map((p) => [p.index, p.at]))
    // Everything the yard already had is on screen from the first frame; a prop the ghost
    // exchanges goes out at its own threshold, the instant its twin comes in.
    parts.forEach((geo, i) => setReveal(geo, -1, closesAt.has(i) ? closesAt.get(i) : 2))

    for (const { index, replacement, at } of plan) {
      const { x, z, s, ry } = placed[index]
      const geo = part(replacement, DECAY.kit)
      geo.scale(s, s, s)
      geo.rotateY(ry)
      geo.translate(x, DECK_TOP, z)
      setReveal(geo, at, 2)
      parts.push(geo)
    }

    for (const spot of planDecay({
      centers: this.localCenters,
      tile: TILE,
      slots: this.slots,
      clutterSpots: this.clutterSpots,
      rand: mulberry(hashString(this.id) + 41),
      perCell: DECAY.perCell,
      names: DECAY.scatter,
      scale: DECAY.scale,
    })) {
      const geo = part(spot.name, DECAY.kit)
      geo.scale(spot.s, spot.s, spot.s)
      geo.rotateY(spot.ry)
      geo.translate(spot.x, DECK_TOP, spot.z)
      setReveal(geo, spot.at, 2)
      parts.push(geo)
    }
  }

  /**
   * Whether the decay kit has landed with everything this theme's dressing names in it.
   *
   * Asked before a yard is rebuilt rather than at the load, because the kit is fetched lazily
   * and a plot that starts to fade in the same frame the request goes out must simply wait for
   * the next write of its fade — `Colony` makes that write when the promise resolves.
   */
  _decayReady() {
    if (!DECAY) return false
    const names = [...(DECAY.scatter || []), ...Object.values(DECAY.swap || {})]
    return names.every((n) => hasPart(n, DECAY.kit))
  }

  /**
   * Rebuild the yard with the ghost's half in it. Once per plot, the first time its zone is
   * anything but full strength and the kit is in.
   *
   * The old mesh is disposed rather than kept: the two differ by an attribute on every vertex
   * and by three shader chunks, and keeping both would mean a second draw call on every ghost
   * for a geometry that draws nothing. Rebuilding is exact — same stream, same order — so
   * nothing about the yard moves, and at `uDecay == 0` the new mesh draws the old picture,
   * which is why a repo that wakes up again needs no third build.
   */
  _dressForDecay() {
    this.decayed = true
    if (this.clutter) {
      this.group.remove(this.clutter)
      this.clutter.geometry.dispose()
      this.clutter.material.dispose()
      this.clutter.customDepthMaterial?.dispose()
      this.clutter = null
    }
    this._buildClutter(true)
  }

  /**
   * Slots, in plot-local coordinates: cell centre first, then the ring around it, cell by
   * cell. Fixed rather than random, so a session keeps its spot as siblings come and go —
   * a building must never jump because a neighbour was archived.
   */
  _buildSlots() {
    const slots = []
    for (const { x, z } of this.localCenters) {
      slots.push({ x, z })
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6
        slots.push({ x: x + Math.cos(a) * TILE * 0.58, z: z + Math.sin(a) * TILE * 0.58 })
      }
    }
    return slots
  }

  /** The slot at this index, or null past the last one — slots never wrap. */
  slotFor(index) {
    return index >= 0 && index < this.slots.length ? this.slots[index] : null
  }

  /** A complete circular footprint must fit on one of the deck's actual hex faces. */
  containsLocal(x, z, radius = 0) {
    const apothem = TILE * Math.sqrt(3) / 2 - radius
    return this.localCenters.some((c) => {
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + Math.PI / 6
        if ((x - c.x) * Math.cos(a) + (z - c.z) * Math.sin(a) > apothem) return false
      }
      return true
    })
  }

  containsWorld(x, z, radius = 0) {
    return this.containsLocal(x - this.center.x, z - this.center.z, radius)
  }

  /** The same slot in world space, or null when there is no such slot. */
  worldSlot(index, out = new THREE.Vector3()) {
    const s = this.slotFor(index)
    if (!s) return null
    return out.set(this.center.x + s.x, DECK_TOP, this.center.z + s.z)
  }

  /**
   * Repaint the deck. Only a `deckTint: 'ground'` theme ever calls this — it is how a plot
   * that was built in one season follows the colony into the next without being rebuilt.
   */
  setDeckTint(color) {
    if (!this.deck) return
    this._deckBase.set(color)
    this._applyFadeColours()
  }

  /**
   * How far this zone has faded. The dither and the lights read the uniform; the colours
   * are drained here in JS, since the deck's tint is already a per-plot value the seasons
   * repaint and there is nothing to gain from doing the mix on the GPU.
   */
  setFade(fade) {
    const v = Math.min(1, Math.max(0, fade))
    if (v === this.fade) return
    this.fade = v
    this.refreshFade()
  }

  /**
   * Write this plot's fade out again, whatever it is.
   *
   * Split from `setFade`, which early-returns on a value it already holds — and *how* a fade
   * is drawn is no longer settled by the number alone: "Fade ghost towns" decides whether the
   * dither and the drain see it at all, so flipping that setting has to replay every plot's
   * own fade without any of them having changed.
   */
  refreshFade() {
    const v = this.fade
    // First, because it may replace the clutter mesh outright: every uniform below is then
    // written onto the material that is actually standing, rather than onto one that has just
    // been disposed — which is how a ghost's torches stayed lit through the rebuild.
    if (v > 0 && !this.decayed && this._decayReady()) this._dressForDecay()
    this.fadeUniform.value = ghostAmount(v)
    // Not through `ghostAmount`: the dressing is what says a repo has been left alone once the
    // dither is off, so it reads the fade itself whatever the look setting says.
    this.decayUniform.value = v
    // The lights read the true fade rather than the look: a ghost town is dark because
    // nobody is home, which is so whether or not it is drawn thin.
    if (this.clutter?.material.userData.uLightsOut) this.clutter.material.userData.uLightsOut.value = v > 0 ? 1 : 0
    this._applyFadeColours()
  }

  /** Write the glaze strength out again — after the slider moves, or as the zone fades. */
  refreshDeckGlaze() {
    if (this._deckGlaze) this._deckGlaze.amount.value = DECK_GLAZE * (1 - ghostAmount(this.fade))
  }

  _applyFadeColours() {
    const grey = ghostAmount(this.fade)
    if (this.deck) this.deck.material.color.copy(this._deckBase).lerp(GHOST_GREY, grey)
    this.refreshDeckGlaze()
    if (this.borderMaterial) {
      this.borderMaterial.color.copy(this._borderBase).lerp(GHOST_GREY, grey)
      this.borderMaterial.emissive.copy(this._borderBase).lerp(GHOST_GREY, grey)
    }
  }

  /** Night lighting, plus a pulse on the border when this plot holds something urgent. */
  setNight(night, urgent, elapsed) {
    // A ghost town has its lights off: the kerb stops glowing and the lamps go black at any
    // fade at all, rather than easing down with it.
    const lit = this.fade > 0 ? 0 : 1
    if (this.borderMaterial) {
      this.borderMaterial.emissiveIntensity =
        lit * (0.3 + night * 1.4 + (urgent ? 0.4 + Math.sin(elapsed * 3.4) * 0.32 : 0))
    }
    // Absent when the theme builds no lamp posts; its kerb lights are kit geometry instead,
    // lit by the atlas's own emissive cell rather than by a material this has to animate.
    this.lampMaterial?.color.copy(this._lampBase).multiplyScalar(lit * (0.5 + night * 2.4))
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose()
        o.material.dispose()
        o.customDepthMaterial?.dispose()
      }
    })
  }
}

/**
 * How many of a zone's threads it has no building slot for.
 *
 * Two things produce one: `threadsPerTile` set above seven, and the nine-tile cap on a repo
 * with more open sessions than 63. Either way the honest answer is a number on the plate, not
 * a stack of houses.
 */
export const overflowFor = (count, cellCount) => Math.max(0, count - cellCount * SLOTS_PER_CELL)

/** What the plate says about that number, and nothing at all when there is none. */
export const badgeText = (overflow) => (overflow > 0 ? `+${overflow}` : '')

// ── labels ────────────────────────────────────────────────────────────────────────────

/**
 * Project name plates. Drawn to a canvas once per project and billboarded in the vertex
 * shader, so they stay upright and legible from any camera angle without a per-frame
 * lookAt on the CPU.
 */
export function createLabel(text, accent, pixelRatio = 4, badge = '') {
  const fontSize = 34
  const font = `500 ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
  // The badge is the count of threads this zone has no building for. Smaller and heavier than
  // the name, in a pill, because it is a number about the zone rather than part of its title.
  const badgeFont = `600 ${Math.round(fontSize * 0.72)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
  const badgePad = 10
  const dot = 9
  const gap = 10
  const pad = 14

  const measure = document.createElement('canvas').getContext('2d')
  measure.font = font
  const textWidth = Math.ceil(measure.measureText(text).width)
  measure.font = badgeFont
  const badgeW = badge ? Math.ceil(measure.measureText(badge).width) + badgePad * 2 : 0

  const canvas = document.createElement('canvas')
  const w = textWidth + dot + gap + pad * 2 + (badge ? gap + badgeW : 0)
  const h = fontSize + pad * 2
  canvas.width = Math.ceil(w * pixelRatio)
  canvas.height = Math.ceil(h * pixelRatio)
  const c = canvas.getContext('2d')
  c.scale(pixelRatio, pixelRatio)

  // No plate and no outline — legibility comes from a soft dark halo behind the glyphs,
  // which sits on grass, regolith or rust equally well and disappears the moment you stop
  // reading it. A small accent dot is all that ties the name to its zone.
  c.font = font
  c.textAlign = 'left'
  c.textBaseline = 'middle'
  const textX = pad + dot + gap
  const midY = h / 2

  c.shadowColor = 'rgba(0,0,0,0.85)'
  c.shadowBlur = 9
  c.fillStyle = 'rgba(0,0,0,0.9)'
  for (let i = 0; i < 3; i++) c.fillText(text, textX, midY) // build the halo up in passes
  c.beginPath()
  c.arc(pad + dot / 2, midY, dot / 2, 0, Math.PI * 2)
  c.fill()

  c.shadowBlur = 0
  c.fillStyle = '#' + new THREE.Color(accent).getHexString()
  c.beginPath()
  c.arc(pad + dot / 2, midY, dot / 2, 0, Math.PI * 2)
  c.fill()
  c.fillStyle = '#f4f2ee'
  c.fillText(text, textX, midY)

  if (badge) {
    const bx = textX + textWidth + gap
    const bh = fontSize * 0.86
    c.fillStyle = 'rgba(0,0,0,0.55)'
    c.beginPath()
    c.roundRect(bx, midY - bh / 2, badgeW, bh, bh * 0.3)
    c.fill()
    c.font = badgeFont
    c.textAlign = 'center'
    c.fillStyle = '#f4f2ee'
    c.fillText(badge, bx + badgeW / 2, midY)
    c.textAlign = 'left'
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  // A plate holds a near-constant screen size, so it is *magnified* when you lean in and
  // *minified* when you pull out, and it has to survive both: the pixel ratio covers the
  // close end, mipmaps the far one. Without them a distant name crawls with aliasing.
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8

  const height = 0.56
  const geo = new THREE.PlaneGeometry(height * (w / h), height)
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    // A name plate is a label on the world rather than an object in it: it floats above its
    // zone, so a habitat between it and the camera used to cut the name in half. Like the
    // badges, it is drawn on top of the scene and ordered against them — badges come last,
    // because the one that wants you matters more than the zone it is standing in.
    depthTest: false,
    toneMapped: false,
    opacity: 0,
  })
  // With upstream's world curve installed (a theme with `curve`), the anchor is bent like the
  // ground under it, so a plate stays over its zone when the world curves away; the quad
  // itself is then built flat in view space as before. Without it, `bcBend` does not exist
  // and the anchor is the exact expression it always was.
  const bent = curveInstalled()
  mat.onBeforeCompile = (shader) => {
    if (bent) withCurve(shader)
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      bent
        ? `vec4 mvPosition = viewMatrix * vec4( bcBend( ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz ), 1.0 );
       float dist = -mvPosition.z;
       mvPosition.xy += position.xy * ( 0.55 + dist * 0.03 );
       gl_Position = projectionMatrix * mvPosition;`
        : `vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
       float dist = -mvPosition.z;
       mvPosition.xy += position.xy * ( 0.55 + dist * 0.03 );
       gl_Position = projectionMatrix * mvPosition;`
    )
  }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 8
  mesh.frustumCulled = false
  mesh.visible = false
  // After bloom and tilt-shift, with the badges — see the engine's overlay pass, which only a
  // theme with `overlay` builds. Anywhere else the plate stays on the scene's own layer.
  if (hasFeature('overlay')) mesh.layers.set(OVERLAY_LAYER)
  mesh.userData.dispose = () => {
    texture.dispose()
    geo.dispose()
    mat.dispose()
  }
  return mesh
}

export function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

import * as THREE from 'three'
import { featureRng, isolated } from '../core/rng.js'
import {
  createTerrain,
  createScatter,
  terrainHeight,
  shoreReach,
  coastAxis,
  SHORE_BAND,
  SHORE_IN,
  SAND_RISE,
  SKY_MARGIN,
  SKY_MAX_CELLS,
  setIslandFootprint,
  withIslandFootprint,
  shorelinePoints,
} from '../world/setting.js'
import { createWater as createPlanetWater } from '../world/water.js'
import { Fauna } from '../world/fauna.js'
import { BuildingSurfaces } from '../world/building-surfaces.js'
import { createGrass } from '../world/grass.js'
import { createSkyIsland } from '../world/skyisland.js'
import { createHexIsland } from '../world/hexisland.js'
import { SceneryReflections } from '../world/reflections.js'
import { worldDoor } from '../world/ceremony.js'
import { Sky } from '../world/sky.js'
import { settingFor } from '../themes/index.js'
import {
  Plot,
  allocateCells,
  blockedCells,
  ceremonyPosition,
  createLabel,
  badgeText,
  overflowFor,
  hashString,
  worldToHex,
  ringOf,
  DECK_TOP,
  PLOT_RINGS,
  plotPalette,
  plotDeckColor,
  setPlotSeason,
  setDeckGlaze,
  setCeremonyCell,
  ceremonyCell,
  withDoorCell,
  wedgeCells,
  hexToWorld,
  PLOT_CELL,
} from '../world/plots.js'
import { createBuilding, createRuin, buildingUniforms, Scaffolds } from '../world/buildings.js'
import { ruined } from '../world/decay.js'
import { loadLazyKit, setKitAtlas } from '../world/kit.js'
import { setFadeGhosts } from '../world/fade.js'
import { zoneFate, countedStates, isCounted } from './fate.js'
import { helperEntries, isHelperId } from './helpers.js'
import { Astronauts } from '../agents/astronauts.js'
import { crewCharacters, kindForThread, strikeCrossed } from '../agents/cast.js'
import { Indicators, BADGE } from '../agents/indicators.js'
import { MAX_AGENT_CAP } from '../core/settings.js'
import { Particles } from '../agents/particles.js'
import { Navigation } from '../agents/navigation.js'
import { bendPoint } from '../core/curve.js'
import { translateCells } from '../world/plot-move.js'

/**
 * The colony: everything that turns a list of agent threads into a place.
 *
 * The mapping is the whole game. It is a strict precedence rather than a set of independent
 * flags — errored, then active, then merged, then waiting — so an astronaut can only ever be
 * telling you one thing, and the loudest true thing wins.
 *
 *   errored          → blocked, red eyes, a `!` over its head
 *   active           → hammering away at its building, sparks flying
 *   PR merged        → celebrating, confetti, a `✓`
 *   idle or unread   → stopped and waiting on you, a bobbing `?` — click it to open the thread,
 *                      or mark it viewed to tell it you have seen it
 *   anything else    → by how long it has been quiet: pottering about its plot, then sitting
 *                      down after a day, then asleep after three
 *
 * Threads group by repo, one repo per hex plot. Which of them are on the ground at all is
 * the user's: the Zone size settings pick the states that count, those get a building, and
 * of those the open ones (active and idle) get a villager. A closed session leaves the map
 * on its own — no archive click needed — which is what keeps the skyline a picture of what
 * you have open rather than of everything you have ever run.
 */

const DAY_MS = 24 * 60 * 60 * 1000
/** Quiet this long and a villager sits down on its plot. */
const REST_MS = DAY_MS
/** Quiet this long and it lies down (or nods off where it sits) for a nap. */
const STALE_MS = 3 * DAY_MS
/** How wide an astronaut is, for the purpose of not fitting through gaps it should not. */
const AGENT_RADIUS = 0.26
/** Progress a live thread adds per second, so a working site visibly grows while you watch. */
const LIVE_GROWTH = 0.004
/** How many zones' positions to remember, including repos with nothing running in them. */
const LAYOUT_MEMORY = 80
/** Seconds of colony time the arrival's bell waits before it will ring for anyone else. */
export const BELL_GAP = 2.5
/**
 * The floating island's own random stream (`featureRng`). Its name is the feature the island was
 * built under until it followed the world's `shape`, kept as the seed on purpose: another name
 * is another stream, and every cloud puff over Aerie would move.
 */
const ISLAND_STREAM = 'planetWorlds'
/**
 * How many UUIDs the valley's old flat sea took off the page's stream on every terrain build: its
 * geometry, its material and its mesh. See `_buildTerrain`.
 */
const FLAT_SEA_UUIDS = 3
/**
 * How close to its target a reveal has to get before it is simply *given* the target.
 *
 * `damp` approaches geometrically and never arrives, so the step it asks for shrinks with the
 * distance left. The old code answered that by refusing to *write* a step under 0.0005, which
 * left the value itself frozen wherever the frame rate happened to strand it: 0.0403 going
 * down on a 144 Hz screen, above the 0.02 that takes a retiring building off the map, and
 * 0.9597 going up. Snapping to the target instead terminates at any frame rate, and half a
 * percent of a structure's height over one frame is not a pop anybody can see.
 */
export const PROGRESS_SNAP = 0.005

/**
 * One frame of a building's reveal. Pure, so the frame-rate table lives in `node --test`
 * rather than being inferred from a colony.
 */
export function nextProgress(progress, target, dt, snap = PROGRESS_SNAP) {
  const next = THREE.MathUtils.damp(progress, target, 1.8, dt)
  return Math.abs(target - next) <= snap ? target : next
}
/**
 * Every cell the tile pool can deal (rings 0 to `PLOT_RINGS`), plus the arrival's, in world
 * space: the island `Colony._blockedCells` judges the ground on. A module function rather than
 * a method, because the guard is also run through the prototype on a stand-in colony.
 */
function latticeCells() {
  const list = []
  for (let q = -PLOT_RINGS; q <= PLOT_RINGS; q++) {
    for (let r = -PLOT_RINGS; r <= PLOT_RINGS; r++) if (ringOf({ q, r }) <= PLOT_RINGS) list.push(hexToWorld(q, r))
  }
  const ship = ceremonyPosition()
  list.push({ x: ship.x, z: ship.z })
  return list
}
/**
 * How wide the harbour a ship keeps open in front of its dock on an island is: the half-angle,
 * seen from the dock, of the wedge of cells seaward of it that no repo is dealt (`wedgeCells`).
 *
 * An island is the colony's own footprint, so a cell dealt beside the harbour pushes the shore
 * out into it, and a harbour narrower than the island's beach is no harbour. **63°, measured**
 * on Archipelago's dock `{ q: -1, r: -1 }` with the island grown to every cell the guard leaves
 * dealable, sampling the ground along the pier's line. Re-measured on the cleared ground (the
 * far field ramped in from 55 units, 2026-09-29), and the angle holds: at 30° to 60° the two
 * ring-3 cells either side of that line, `{-3, 0}` and `{0, -3}`, 60° off it and 22.8 from the
 * dock, stay land and carry the waterline from 24.80 out to 26.25 on the pier's line. Past 60°
 * they are cut and the grown island's shore stands exactly where the fresh one's does, so the
 * pier, the berth and the sea lane are one set of numbers however far the colony has grown.
 * The next dealable cells out are at 70.89°, so 63 is three degrees clear of the one edge and
 * nearly eight of the other. What it costs is six cells of room: 77 dealable at 45° against 71,
 * the dock's own cell apart.
 */
const HARBOUR_HALF_ANGLE = (63 * Math.PI) / 180
/**
 * How `_workSite` walks round a building when the spot it wants is walled off: fifteen degrees
 * at a time, alternating sides so the answer stays as near the outward angle as it can, out to
 * the far side. Fifteen degrees is about a metre along a two-and-a-half-metre ring, which is
 * two nav cells — fine enough to find the gap between two buildings, coarse enough that the
 * whole walk is two dozen lookups.
 */
const RING_STEPS = []
for (let deg = 15; deg <= 180; deg += 15) {
  RING_STEPS.push((deg * Math.PI) / 180)
  if (deg < 180) RING_STEPS.push((-deg * Math.PI) / 180)
}


export const STATUS_ORDER = ['blocked', 'waiting', 'working', 'celebrating', 'idle', 'resting', 'sleeping']

export const STATUS_LABEL = {
  working: 'Working',
  waiting: 'Waiting on you',
  blocked: 'Blocked',
  celebrating: 'Shipped',
  idle: 'Idle',
  resting: 'Resting',
  sleeping: 'Dormant',
  spawning: 'Arriving',
  leaving: 'Heading home',
}

/**
 * Whether a thread is asking for you: it is unread, or it is an idle session — one that has
 * stopped and wants something from you, which is exactly what the desktop app's unread flag
 * used to be the only way to spot. Marking it viewed (`thread.viewed`, set from `viewedAt`
 * until the thread moves on again) answers both.
 */
export function isAsking(thread) {
  return Boolean(thread.unread || (thread.state === 'idle' && !thread.viewed))
}

/** Thread → behaviour. First match wins, exactly like the board's auto-sort. */
export function statusFor(thread, now = Date.now()) {
  if (thread.hasError) return 'blocked'
  if (thread.state === 'active') return 'working'
  if (thread.prState === 'MERGED') return 'celebrating'
  if (isAsking(thread)) return 'waiting'
  const quiet = now - thread.lastActivityAt
  if (quiet > STALE_MS) return 'sleeping'
  if (quiet > REST_MS) return 'resting'
  return 'idle'
}

/**
 * Which behaviours earn a badge. Dormant, resting and idle deliberately get none: their pose and
 * face already say it, and with most of a real thread list sitting quiet, a badge over
 * every one of them buries the single `?` that actually wants you.
 */
const BADGE_FOR = {
  waiting: BADGE.waiting,
  blocked: BADGE.blocked,
  working: BADGE.working,
  celebrating: BADGE.done,
  sleeping: BADGE.none,
  idle: BADGE.none,
  resting: BADGE.none,
  spawning: BADGE.spawning,
  leaving: BADGE.leaving,
}

/** Transcript size → how finished the building looks. Log scale: threads grow fast early. */
/**
 * How far along a thread is, on a log scale over its transcript size. This drives the bar
 * on the thread card — it no longer drives how much of the building you can see.
 *
 * It used to. The shader draws construction by sinking the structure into the ground and
 * discarding what falls below the deck, and mapping transcript size onto that meant most
 * buildings stood permanently waist-deep in their own plot. Read as a picture of a colony
 * rather than as a chart, that is not "this thread is young", it is "this building is
 * broken" — a dome cut off by a flat plane looks like a rendering fault, and it is the
 * first thing the eye goes to. So the sink is now only what it is good at: the few seconds
 * of a new building rising out of the ground.
 */
export function transcriptProgress(thread) {
  const size = Math.max(1, thread.sizeBytes || 0)
  return THREE.MathUtils.clamp((Math.log10(size) - 3) / 3.5, 0.05, 1)
}

export class Colony {
  constructor(scene, settings, camera, renderer, theme) {
    this.theme = theme
    this.scene = scene
    this.settings = settings
    this.camera = camera
    this.renderer = renderer

    this.setting = settingFor(theme, settings.get('setting'))
    /**
     * Upstream's planet systems (merged 2026-09-24 from d05ac2f): his sea and lakes, the
     * wildlife and cargo drones, the meadow, the floating island, motes of light, local visor
     * reflections, the building tint and the sound hooks. Each exists only where the theme
     * declares its feature (`src/core/features.js`), except the two that follow the world: the
     * floating island its `shape`, and the tint its dressing's `buildingTint`. Each builds on
     * its own random stream (`isolated`, `featureRng`): every three allocation spends four
     * draws, and the global stream is the one the crew is seated from.
     */
    this.features = theme.features
    this._applyPlanetTint()
    // Before the first plot is built, so a theme whose decks follow the ground has the
    // season in hand the moment the first roster lands.
    setPlotSeason(this.setting)
    this.sky = new Sky(scene, settings, renderer)
    this.sky.setSetting(this.setting)
    // Push the stored time in explicitly. `settings.set` is a no-op when the value has not
    // changed, so a colony restored at dusk would otherwise open in the morning and stay
    // there until something happened to touch the slider.
    this.sky.setTime(settings.get('timeOfDay'))

    /**
     * Whether this theme builds in stages. A staged theme hides the parts of a recipe whose
     * `stage` runs ahead of the thread's own transcript progress, so a young thread is a bare
     * lot and an old one a finished yard. A theme that omits the flag is whole from the first
     * frame — which is what keeps the space colony pixel-for-pixel what it was.
     */
    this.staged = Boolean(theme.manifest.buildings.staged)

    /**
     * What a quiet repo grows over itself, or null for a theme that says nothing — which is
     * every theme but the village, and is why none of this costs the space colony a byte.
     */
    this.decay = theme.manifest.decay || null
    /**
     * The request for the dressing's kit, once something on the map has actually started to
     * fade, and null until then. The kit is declared `lazy` precisely so that a colony with no
     * ghost in it allocates nothing from it: harvesting a glb spends four seeded draws per
     * geometry, material and texture, so loading it at boot would move every villager in the
     * village (see `docs/kits.md` §7 and `loadLazyKit`).
     */
    this._decayKit = null

    /**
     * Who lives where. A theme may say which kinds suit which villager, and then a plot's
     * building is drawn from that villager's own list rather than from the recipe seed — the
     * mage gets the shrine, the smith the forge. A theme that declares no map (space) hands
     * `createBuilding` a null kind and the seed picks exactly as it always did.
     */
    this.characters = crewCharacters(theme.manifest.crew)
    this.byCharacter = theme.manifest.buildings.byCharacter || null

    this.plots = new Map()
    /**
     * Upstream's water on a world that has it — a sea, lakes or lava, `{ level, shallow, deep }`,
     * the valley's sea behind its `coast` among them — or null. See `_buildPlanetWater`.
     */
    this.sea = null
    /**
     * Set by whoever owns the speakers: (name, x, y, z, gain) for a sound the world just made.
     * `gain` is optional and the ambience's own 1 when left out, which is what the wildlife
     * calls leave it as. Set only where the theme has the `sound` feature, so anything that
     * asks for it first may read the theme's `sounds` table, which the schema requires there.
     */
    this.onSound = null
    /** Per repo, whether it is on the map and how far it has faded. Rewritten every poll. */
    this.fates = new Map()
    this.plotOrder = []
    /**
     * World positions of every flame the village is lit by — the kerbs' torches and the ones
     * recipes stood against their own walls — refreshed with the navigation grid.
     */
    this.lampSpots = []
    /**
     * Where every zone sits, kept across polls *and* across the departures of the threads
     * that made it: a repo whose last session you archive comes back to the same ground
     * when a new one starts. Seeded from the colony file by `restoreLayout`.
     */
    this.plotCells = new Map()
    /**
     * The repos this world has no room for, by name and sorted: on the map they have no zone,
     * and in `plotCells` they keep the ground they had. `onUnplaced(names, added)` hears of it
     * whenever the list changes; a new world starts it from empty.
     */
    this.unplaced = []
    this.onUnplaced = null
    /** Where this world stands the repos whose memory it keeps elsewhere — see `_syncPlots`. */
    this._placedHere = null
    /** Repos whose root tile moved on this poll: their crew is placed, not sent walking. */
    this.movedPlots = new Set()
    /** Of those, the ones the allocator moved because they had run out of room to grow. */
    this.relocatedPlots = new Set()
    this.buildings = new Map()
    this.threads = new Map()
    /**
     * The subagents standing on the map, by roster id, for the card that describes one.
     * Rewritten every poll — a helper whose subagent has finished is simply not in it.
     */
    this.helpers = new Map()
    this.usedAccents = new Set()

    this.worldGroup = new THREE.Group()
    this.worldGroup.name = 'world'
    scene.add(this.worldGroup)

    this.ceremony = this._makeCeremony()
    /**
     * The lattice cells this setting will not let a repo build on. See `_blockedCells`.
     *
     * Immediately after the ceremony, because the set includes the cell under its threshold,
     * and well before the first roster can reach `_syncPlots`: an empty set would deal that
     * roster tiles in the sea, or the ground its own arrivals appear on. After the island's
     * footprint, which the guard puts back when it has judged the island whole.
     */
    this._shapeIsland()
    this.blockedCells = this._blockedCells()
    this.astronauts = new Astronauts(scene, settings, theme)
    this.astronauts.world = this._world()
    /**
     * The colony's clock: the `elapsed` the engine last handed `update`, so anything timed
     * against it pauses with the page and can be driven by hand. `_lastBell` is when the
     * arrival last rang, on that clock.
     */
    this.elapsed = 0
    this._lastBell = -Infinity
    this.astronauts.onEntrance = (agent) => this._announceArrival(agent)
    // Sized for the largest preset rather than the current one: unlike the astronaut meshes these
    // buffers are never rebuilt, so allocating against today's `maxAgents` means raising quality
    // later silently starves the badges — the one `?` that wants you being the thing that goes
    // missing. A badge is a single quad; the spare instances cost almost nothing.
    this.indicators = new Indicators(scene, settings, MAX_AGENT_CAP, theme.manifest.crew.headClearance, { overlay: this.features.overlay })
    this.particles = new Particles(scene, settings)
    this.fx = theme.hooks.particles(this.particles, theme.manifest)
    this.scaffolds = new Scaffolds(scene, 320)
    this.nav = new Navigation()
    this.astronauts.setNavigation(this.nav)

    this.plotGroup = new THREE.Group()
    this.labelGroup = new THREE.Group()
    scene.add(this.plotGroup, this.labelGroup)

    if (this.features.fauna) {
      isolated(featureRng('fauna'), () => {
        // What a dropped crate lands on: a roof, the water, or the ground.
        this.buildingSurfaces = new BuildingSurfaces(this.buildings, (x, z) => this.surfaceAt(x, z))
        // Birds, butterflies, fish and the cargo drones: the life that carries no information.
        this.fauna = new Fauna(scene, settings)
      })
    }
    if (this.features.visor) {
      this.reflections = isolated(
        featureRng('visor'),
        () =>
          new SceneryReflections({
            scene,
            renderer,
            settings,
            sky: this.sky,
            astronauts: this.astronauts,
            excluded: () => [this.labelGroup, this.indicators.mesh, this.particles.points, this.fauna?.group, this.grass?.mesh],
          })
      )
    }
    if (this.features.motes) this._c2 = new THREE.Color()

    // Dismissing the HUD has to survive a poll: labels are chrome, and a scan landing while
    // everything is hidden must not quietly put them back on screen.
    this.uiVisible = true
    this.hoveredPlot = null
    this.activePlots = new Set()
    this._dustTint = new THREE.Color(this.setting.ground.high)
    this.stats = { agents: 0, projects: 0, working: 0, waiting: 0, blocked: 0, done: 0 }

    this._buildTerrain()
  }

  /**
   * Which lattice cells this setting refuses a plot, as `cellKey` strings.
   *
   * Five rules, and they answer different questions.
   *
   * **The slab must not float**, which is the coast. A plot is a hexagonal prism whose
   * underside reaches `plots.deckSkirt` below y=0, so any cell with a sample below that has
   * open air under its rim — and on a shore the sample that fails first is a corner hanging
   * over the drop, never the centre. `blockedCells` samples all seven.
   *
   * On a setting **with water** the skirt test is applied only where the sea's smoothstep is
   * live, past `shoreReach(x, z, setting)`. Inland of that the ground is the plain terrain field
   * every dry setting has, and the far-field hills in it dip below -0.4 of their own accord:
   * unguarded, the rule culled eighteen of ring four's twenty-four cells on this valley when only
   * eight of them are sea, pushing a colony that needs more than thirty-eight cells out to ring
   * five and past the navigation square. Those ten were hill noise the forest builds on happily.
   * So the question the rule asks there is "is this cell in the water's reach, and if so does it
   * float", not "is this ground low".
   *
   * On a **dry** setting whose theme sets `maxTilt` the same skirt test runs ungated, because
   * there is no reach to gate it on and a slab does not care what dug the hollow. That is a
   * deliberate trade and it costs the forest about ten cells of ring four — see the dry branch
   * below for the mountain cell that made the case.
   *
   * **`shoreReach` rather than a number**, which matters once the coast bends. A scalar
   * threshold has to carry the wobble's amplitude as slack or it can sit seaward of a bay, and
   * the slack is not free: at `amp: 9` it opened the window from thirty units to fifteen and
   * handed the skirt test five more cells of dry far-field hill to judge — `{-1,4}`, `{0,5}`,
   * `{0,6}`, `{0,7}` and `{1,8}`, one of them in ring four — every one of them ground the sea
   * never reaches. Asking the shoreline itself costs one fbm and has no slack in either
   * direction. Blocked on this valley: 175 cells, against 180 with the slack.
   *
   * **The slab must not lie on a slope**, which is `plots.maxTilt` — the spread the ground is
   * allowed to move across one cell's seven samples. It is the rule a setting with `hills` above
   * 1 needs and the coast rule cannot give: the far-field relief starts forty units out, which
   * is inside the lattice, and ground that climbs two units across a 15-unit cell puts a flat
   * deck on a hillside with daylight under one rim and the other buried. Unlike the coast rule it
   * runs on dry settings too, because the mountain has no sea and every slope in the picture.
   *
   * **The slab must not be buried**, which is the skirt test turned over: no ground under the
   * cell may stand above `plots.deckTop`, read at 19 points rather than the other rules' seven,
   * because a hill rose over a deck between the corners on eleven space worlds and the village's
   * Dune (the numbers are at `BURIAL_POINTS` in the plots module). The deck is laid at that
   * fixed height wherever the cell is, and
   * `groundAt` puts the crew on it, so a cell on high ground draws turf over the whole deck
   * and a villager sunk to the waist in the hill. The slope rule never caught it because a
   * hilltop can be *evenly* high: the forest's `0,-6` stands at 3.10 with less than 1.2 of
   * spread. Nothing inside ring 4 reaches the deck on any setting, so it went unseen until
   * every repo was shown at once and a Compact dealt the forest out to rings five and six
   * (2026-09-27).
   *
   * Unlike the slope and the dry floor it is **not** opt-in: it runs on every setting in every
   * theme, because the deck stands at `deckTop` in upstream's worlds too and the crew stands on
   * it there as well. Upstream's worlds had no guard at all, and before the clearing their
   * far-field hills stood over the deck from ring 4 out: 5 to 21 cells of ring 4 on every space
   * world but the two islands, and already 2 of ring 3 on the moon and 1 on the volcanic world
   * (2026-09-28).
   * On an `island` the ground depends on the footprint, so the guard judges the island whole
   * — every cell of the lattice as land — and puts the colony's own footprint back after.
   *
   * **The slab must not stand in the water**, on upstream's planet water: none of its seven samples
   * below `water.level`, in every theme — see `lake` in the body.
   *
   * **The threshold's cell is reserved**, which is every ceremony — see `withDoorCell`. It has
   * to run after the arrival exists, which is why both callers compute this *after* the
   * ceremony is built or swapped and before anything reaches `_syncPlots`.
   *
   * Measured on the valley at `coast.from: 40` (2026-09-11): with the water term taken out the
   * ground over rings 0–3 runs -0.174 to +0.143 and bottoms at -0.268 across the colony disc,
   * so no cell the sea can reach is culled by noise either, and the skirt rule stands as
   * written rather than falling back to `level + SHORE_BAND`. Thirty of the thirty-seven cells
   * within ring three survive, which is more ground than the fixture has ever used.
   */
  _blockedCells() {
    const water = this.setting.water
    const setting = this.setting
    /**
     * The slope rule's two halves: how much climb across one cell this theme will stand, and the
     * ground it measures. A theme that names no `maxTilt` gets `Infinity`, which switches the
     * slope off — and with it the dry floor below, so the space theme's worlds are refused for
     * the ceiling and nothing else they were not refused for before. The sampler itself is on
     * everywhere, because the ceiling reads it.
     *
     * It is a *theme* number rather than a setting one because it is a statement about the slab,
     * not about the country: a deck is the same flat prism in every world, and what it can be
     * laid on does not change when the season does. `hills` is the setting's knob.
     */
    const maxTilt = this.theme.manifest.plots.maxTilt ?? Infinity
    const heightAt = (x, z) => terrainHeight(x, z, setting)
    const floor = -this.theme.manifest.plots.deckSkirt
    // The top of the slab, on every setting, read at 19 points a cell by `blockedCells` — see
    // "must not be buried" above.
    const ceiling = this.theme.manifest.plots.deckTop
    /**
     * On an island every rule reads the ground with the whole lattice as land (`latticeCells`),
     * not the colony's footprint. A cell the allocator deals always becomes part of the island,
     * so "this cell as land" is the question it is really asking, and the answer must not depend
     * on how far the island had grown when the guard ran: judged on the footprint of the day, a
     * fresh colony's outer cells were sea, low and dealable, and the hills that rose under them
     * as the island grew buried the decks. The colony's own footprint is back in place after.
     */
    const judge =
      setting.shape === 'island'
        ? (isDry, options) => withIslandFootprint(latticeCells(), PLOT_CELL, () => blockedCells(isDry, options))
        : blockedCells
    /**
     * **The slab must not stand in the water**, on upstream's planet water (`level`, `shallow`,
     * `deep`) with no `coast` in front of it: a cell with any of its seven samples strictly below
     * `water.level` is refused, in every theme. `lake` is that level, or `-Infinity` where there
     * is no such water, which leaves the rules below exactly as they were. Behind a `coast` the
     * bank's own rule decides, below, and it never reads `lake`: that is what keeps the valley's
     * refused cells what they were when its sea was a flat plane of our own.
     *
     * The village never needed it said: its floor, `-deckSkirt`, stands above every planet
     * water level it has, so a cell with a sample under the water already has one under the
     * floor and its refused sets do not move. The space theme has no floor, and upstream kept
     * its colonies dry by the shape of the ground alone — which held until the colony was
     * dealt far enough out to reach the shore. What it costs, measured in rings 0–11 on the
     * ramped ground with the 19-point burial rule (2026-09-29): the beach had 310 dealable
     * cells, 153 of them with a corner or the centre in the sea, and deals 157; the ocean had
     * 231 (the island grown or fresh alike), 82 of them wet, and deals 149; the jungle loses
     * one ring-11 cell by its pond, 81 to 80. Every other world keeps its count.
     */
    const lake = water && !setting.coast && Number.isFinite(water.level) ? water.level : -Infinity
    let blocked
    // Our bank is the world's `coast`: the sea's own rule, below.
    if (setting.coast) {
      const [ax, az] = setting.coast.axis
      blocked = judge(
        (x, z) => x * ax + z * az < shoreReach(x, z, setting) || terrainHeight(x, z, setting) >= floor,
        { heightAt, maxTilt, ceiling }
      )
    } else if (Number.isFinite(maxTilt)) {
      /**
       * No sea to fall into, but hills to fall down — and the *same* skirt test, because the
       * question the skirt asks was never about water.
       *
       * A deck's underside reaches `deckSkirt` below y=0 wherever it is laid, so ground below
       * that has open air under the rim whether the hollow it sits in was dug by a sea or by
       * the far-field noise. The coast rule only ever gated it on the water's reach to stop it
       * culling dry hill noise the allocator was happy to build on — a judgement about *which*
       * hollows count, not about what a slab needs. A dry setting has no reach to gate on, so
       * it asks the plain question: is this cell's ground above the underside of the slab?
       *
       * It was found the way these are always found. The mountain's `3,1` stands at -1.30 with
       * `hills` on it, which is 0.90 of daylight under one rim, and the tilt rule let it
       * through because the cell is *evenly* low — a floor, not a slope. Both rules are needed
       * and neither implies the other.
       */
      blocked = judge((x, z) => terrainHeight(x, z, setting) >= Math.max(floor, lake), { heightAt, maxTilt, ceiling })
    } else if (lake > -Infinity) {
      // No `maxTilt`, so no floor — but a planet's water to keep the decks out of.
      blocked = judge((x, z) => terrainHeight(x, z, setting) >= lake, { heightAt, ceiling })
    } else {
      // No sea, and no `maxTilt` to opt into the slope and the floor: the ceiling alone.
      blocked = judge(() => true, { heightAt, ceiling })
    }
    /**
     * The harbour, on an island only: the wedge of cells seaward of a ship's dock is kept for the
     * water (`HARBOUR_HALF_ANGLE`). Read off the setting rather than the ceremony — the dock's own
     * cell and the island's axis through it — so a stand-in colony judges it the same. Not on the
     * valley or a coast: there the same wedge would take dry land beside the sea, and the sea in
     * front of their docks is sea whatever is dealt.
     */
    if (setting.shape === 'island' && setting.ceremony?.kind === 'boat') {
      const cell = setting.ceremony.cell || this.theme.manifest.plots.ceremonyCell
      const dock = hexToWorld(cell.q, cell.r)
      const axis = coastAxis(setting, dock)
      if (axis) for (const c of wedgeCells(dock, axis, HARBOUR_HALF_ANGLE)) blocked.add(`${c.q},${c.r}`)
    }
    /**
     * The threshold, off the ceremony's own transform.
     *
     * This runs before the first render walk, and again on the frame a setting is swapped, so
     * `group.matrixWorld` is still the identity here. `worldDoor` composes the group's own
     * transform rather than waiting for it — which is why `door()` is trustworthy this early
     * and the crew and the reserved cell now agree by construction. Forcing the matrix first
     * is the repair that looks obvious and is worse than the disease: `updateMatrixWorld`
     * rewrites `matrix`, `matrixWorld` and every child's the same way, a few frames early.
     */
    const door = worldDoor(
      this.ceremony.group,
      this.ceremony.doorLocal,
      this._doorAt || (this._doorAt = new THREE.Vector3())
    )
    return withDoorCell(blocked, door.x, door.z)
  }

  // ── ceremony ────────────────────────────────────────────────────────────────────────

  /**
   * Build the arrival this setting asks for, on the cell it asks for.
   *
   * The cell is installed first and by hand. `configurePlots` put the theme's default in at
   * boot, but a setting may move it — the valley's dock stands down on the shore rather than
   * up among the plots — and two things read that one module-level value: `ceremonyPosition`,
   * which is where the arrival stands, and `allocateCells`, which refuses to hand that cell to
   * a repo. So it has to be right before either of them is asked.
   *
   * The setting goes to the hook as well as the manifest, because *which* arrival a theme
   * builds is the setting's own choice. A theme with one fixed ceremony — the space colony's
   * lander — simply never reads it.
   */
  _makeCeremony() {
    setCeremonyCell(this.setting.ceremony?.cell || this.theme.manifest.plots.ceremonyCell)
    return this.theme.hooks.ceremony(this.scene, ceremonyPosition(), this.theme.manifest, this.setting)
  }

  // ── terrain ─────────────────────────────────────────────────────────────────────────

  _buildTerrain() {
    if (this.terrain) {
      this.worldGroup.remove(this.terrain)
      this.terrain.geometry.dispose()
      this.terrain.material.dispose()
    }
    if (this.scatterGroup) {
      this.worldGroup.remove(this.scatterGroup)
      disposeTree(this.scatterGroup)
    }

    this._shapeIsland()
    this.terrain = createTerrain(this.setting, this.settings.get('groundDetail'))
    this.worldGroup.add(this.terrain)
    /**
     * The draws the valley's old sea spent here, still spent.
     *
     * Until 2026-09-30 a world with a `coast` got a flat sea of our own, built right here on the
     * page's own stream: its geometry, its material and its mesh, three of three's UUIDs at four
     * `Math.random` draws each. Upstream's sea draws it now, on the water feature's own stream,
     * and spends nothing from the page's — so without these twelve draws every villager seated
     * after a switch to the valley would take another seat, in the village and in space alike.
     * The three UUIDs are drawn and dropped, which keeps the stream exactly where the old sea
     * left it and allocates nothing.
     */
    if (this.setting.coast) for (let i = 0; i < FLAT_SEA_UUIDS; i++) THREE.MathUtils.generateUUID()
    // A floating island is built on a `sky` world, and one left from the world before is taken down.
    if (this.setting.shape === 'sky' || this.island || this.rock) isolated(featureRng(ISLAND_STREAM), () => this._buildIsland())
    if (this.features.water) isolated(featureRng('water'), () => this._buildPlanetWater())
    this._buildScatter()

    // The ship has legs, and legs have to reach the ground. Its landing spot is a hex cell,
    // but the height of that spot is the setting's, so it is set here rather than once at
    // construction — a world with more relief would otherwise leave it hovering.
    const ship = ceremonyPosition()
    this.ceremony.group.position.y = terrainHeight(ship.x, ship.z, this.setting)
    // Whatever floats in the arrival rides this sea's own swell, or bobs on its own where there
    // is none. A new sea is a new object, so it is handed over after every build, and after the
    // group has its height, which is what the swell is measured against. A castle or a fortress
    // has nothing that floats and no `setSea`.
    this.ceremony.setSea?.(this.sea ? (x, z, t) => this.sea.heightAt(x, z, t) : null)

    this._dustTint.set(this.setting.ground.high)

    if (!this.features.fauna) return
    // Only when the world itself changed. The terrain is rebuilt for a scatter or detail
    // setting too, and re-seeding the wildlife for that puts every flock back at its spawn
    // point in the middle of the map — a quality toggle should not restart the birds.
    if (this._faunaSetting !== this.setting.id) {
      this._faunaSetting = this.setting.id
      isolated(featureRng('fauna'), () =>
        this.fauna.setPlanet(this.setting, {
          heightAt: (x, z) => this.groundAt(x, z),
          parcelSurfaceAt: (x, z) => this.buildingSurfaces.at(x, z),
          waterLevel: this.setting.water?.level ?? null,
          waterHeightAt: this.sea ? (x, z, t) => this.sea.heightAt(x, z, t) : undefined,
        })
      )
    }
    isolated(featureRng('fauna'), () => this._syncFaunaSites())
  }

  // ── upstream's planet systems (each behind its own feature) ────────────────────────────

  /** Where the drones fly between: the lander, and every building with anyone at it. */
  _syncFaunaSites() {
    const sites = []
    for (const [id, entry] of this.buildings) {
      if (entry.retiring) continue
      const p = entry.mesh.position
      sites.push({ x: p.x, y: p.y, z: p.z, radius: entry.mesh.userData.footprint, active: this._isActive(id) })
    }
    const pad = ceremonyPosition()
    pad.y = this.ceremony.group.position.y
    this.fauna.setSites({ ship: this.ceremony.door(), pad, sites })
  }

  /**
   * What holds a floating island up: nothing. What it needs instead is an underside — rock
   * and roots and vines hanging off the rim — and a sea of cloud far below it.
   */
  _buildIsland() {
    if (this.island) {
      this.worldGroup.remove(this.island.group)
      this.island.dispose()
      this.island = null
    }
    if (this.rock) {
      this.rock.dispose()
      this.rock = null
    }
    if (this.setting.shape !== 'sky') return
    const detail = this.settings.get('groundDetail')
    // The cloud sea and the drifting puffs come from here; the round underside it also
    // builds is switched off, because this island is not round — see `_syncIslandRock`.
    this.island = createSkyIsland({
      planet: this.setting,
      heightAt: (x, z) => terrainHeight(x, z, this.setting),
      rimRadius: this._footprintRadius() + 6,
      quality: detail === 'high' ? 'high' : detail === 'low' ? 'low' : 'medium',
    })
    this.island.meshes.underside.visible = false
    this.island.meshes.vines.visible = false
    this.island.setDaylight(this.sky.dayFactor ?? 1)
    this.worldGroup.add(this.island.group)
    this._syncIslandRock()
  }

  /**
   * An island world is shaped around the colony: the coast has to know the cells before
   * anything reads the ground — the terrain build, and whatever stands on it.
   */
  _shapeIsland() {
    if (this.setting.shape === 'island') setIslandFootprint(this._footprintCells(), PLOT_CELL)
  }

  /** Every hex cell the colony holds, plus the arrival's, in world space. */
  _footprintCells() {
    const list = []
    for (const plot of this.plotOrder) {
      for (const local of plot.localCenters) list.push({ x: plot.center.x + local.x, z: plot.center.z + local.z })
    }
    const ship = ceremonyPosition()
    list.push({ x: ship.x, z: ship.z })
    return list.slice(0, SKY_MAX_CELLS)
  }

  _footprintRadius() {
    let r = PLOT_CELL
    for (const c of this._footprintCells()) r = Math.max(r, Math.hypot(c.x, c.z) + PLOT_CELL)
    return r
  }

  /**
   * Whether a point is on the island: within a cell and its grass margin, a touch
   * conservative so grass and scatter stay off the frayed edge. Everywhere but a floating
   * island, all ground is ground.
   */
  onIsland(x, z) {
    if (this.setting.shape !== 'sky') return true
    const reach = (PLOT_CELL + SKY_MARGIN) * 0.86
    for (const c of this._footprintCells()) {
      const dx = x - c.x
      const dz = z - c.z
      if (dx * dx + dz * dz < reach * reach) return true
    }
    return false
  }

  /** The rock under the plots: a jagged plug per cell, so the island grows with the colony. */
  _syncIslandRock() {
    if (this.setting.shape !== 'sky') return
    if (this.rock) {
      this.rock.dispose()
      this.rock = null
    }
    const cells = this._footprintCells()
    this.terrain.userData.setFootprint?.(cells, PLOT_CELL + SKY_MARGIN)
    const detail = this.settings.get('groundDetail')
    const p = this.setting.skyIsland || {}
    this.rock = createHexIsland({
      cells,
      cellRadius: PLOT_CELL,
      margin: SKY_MARGIN,
      palette: { soil: p.soil, rock: p.rock, vine: p.vine, moss: this.setting.ground.low },
      quality: detail === 'low' ? 'low' : 'medium',
    })
    this.worldGroup.add(this.rock.group)
  }

  /**
   * Upstream's sea, lakes or lava — one plane at the world's water level; where the terrain
   * is lower, there is water. The valley's sea too: its `coast` shapes the land under it, and
   * the water over it is this.
   */
  _buildPlanetWater() {
    if (this.sea) {
      this.worldGroup.remove(this.sea.mesh)
      this.sea.dispose()
      this.sea = null
    }
    if (!this.setting.water) return
    const detail = this.settings.get('groundDetail')
    this.sea = createPlanetWater({
      planet: this.setting,
      heightAt: (x, z) => terrainHeight(x, z, this.setting),
      quality: detail === 'high' ? 'high' : detail === 'low' ? 'low' : 'medium',
    })
    if (this.sea) this.worldGroup.add(this.sea.mesh)
  }

  /** A ring on the water at a point, if there is water there. Safe to call anywhere. */
  ripple(x, z, strength = 1) {
    if (!this.sea) return
    if (terrainHeight(x, z, this.setting) >= this.setting.water.level) return
    this.sea.ripple(x, z, strength)
  }

  /**
   * The meadow, on worlds that have one. Kept clear of the same ground the scatter is, and
   * rebuilt with it: a plot laid over grass would have blades poking up through the deck.
   *
   * **And off the sand, behind a `coast`.** Upstream's grass stops at his shore band
   * (`shore.band` over the level), which the valley does not have: its beach is the band
   * `createTerrain` paints, seaward of `shoreReach` and under `level + SAND_RISE`, and grass
   * standing in it reads as a lawn run down to the water. That is the same band, gated the same
   * way, so a blade stops where the sand starts to show and never on a dry inland hollow. The
   * wobble bends the shore at most `wobble.amp` either way, so a blade inland of that is on no
   * sand and skips the noise `shoreReach` samples: most of the meadow.
   */
  _buildGrass(clear) {
    const apron = clear[clear.length - 1]
    if (this.grass) {
      this.grass.dispose()
      this.grass = null
    }
    const setting = this.setting
    const coast = setting.coast
    const sandTop = coast ? setting.water.level + SAND_RISE : 0
    const inland = coast ? coast.from - (coast.wobble?.amp ?? 0) - SHORE_IN : 0
    const onSand = (x, z) => {
      if (!coast) return false
      const d = x * coast.axis[0] + z * coast.axis[1]
      return d >= inland && d >= shoreReach(x, z, setting) && terrainHeight(x, z, setting) < sandTop
    }
    const detail = this.settings.get('groundDetail')
    this.grass = createGrass({
      planet: setting,
      heightAt: (x, z) => terrainHeight(x, z, setting),
      blocked: (x, z) =>
        !this.onIsland(x, z) ||
        this.plotOrder.some((plot) => plot.containsWorld(x, z, -0.4)) ||
        (apron && (x - apron.x) ** 2 + (z - apron.z) ** 2 < apron.r * apron.r) ||
        onSand(x, z),
      density: this.settings.get('scatterDensity'),
      quality: detail === 'high' ? 'high' : detail === 'low' ? 'low' : 'medium',
    })
    if (this.grass) this.worldGroup.add(this.grass.mesh)
  }

  /**
   * The buildings' shared planet-tint uniforms. Shared is the point: every standing building
   * re-themes on a world switch without a rebuild. Clay on Dune, nothing anywhere else. The
   * setting's `buildingTint` is its dressing's; a theme none of whose settings carries one has
   * no tint in its building shader, and these two values reach nothing.
   */
  _applyPlanetTint() {
    const tint = this.setting.buildingTint
    buildingUniforms.uPlanetTint?.value.set(tint ?? 0xffffff)
    if (buildingUniforms.uPlanetTintAmount) buildingUniforms.uPlanetTintAmount.value = tint != null ? 1 : 0
  }

  /** The surface anything floating or falling meets: the water where there is water, else the ground. */
  surfaceAt(x, z) {
    const ground = this.groundAt(x, z)
    const level = this.sea ? this.setting.water.level : undefined
    return level !== undefined && ground < level ? level : ground
  }

  /**
   * Someone new has just walked out of the arrival (`Astronauts.onEntrance`, which a thread the
   * page has seen before never calls). Where the theme's arrival has an `event` — a keep's bell —
   * it plays at the threshold, once: a batch of new threads in one poll is one piece of news,
   * so the bell rings at most once every `BELL_GAP` seconds of colony time. Silent where the
   * arrival has no event, and wherever nothing is listening (`onSound`).
   *
   * It reads the theme's `sounds` table as `soundWorld` does, with no fallback: the crew calls
   * this for every theme, but `onSound` is set only where there is an ambience — a theme with
   * the `sound` feature, whose table the schema requires — so that is asked first.
   */
  _announceArrival(agent) {
    // The bell is news of a thread: a subagent walking out of the keep belongs to one already here.
    if (!this.onSound || isHelperId(agent.id)) return
    const event = this.theme.manifest.sounds.arrival[this.ceremony.kind]?.event
    if (!event || this.elapsed - this._lastBell < BELL_GAP) return
    this._lastBell = this.elapsed
    const door = this.ceremony.door(this._bellAt || (this._bellAt = new THREE.Vector3()))
    // At the bells' level: the hand bell plays at 0.9, and both bells' levels were measured there.
    this.onSound(event, door.x, door.y + 1, door.z, 0.9)
  }

  /**
   * Everything making a noise right now, as positional sources, for upstream's ambience.
   * Objects are reused between frames so the audio engine can key voices by id. Asked only
   * where there is an ambience, so the theme's `sounds` table is read with no fallback.
   */
  soundWorld(target) {
    const sources = this._soundSources || (this._soundSources = [])
    let n = 0
    const take = (id, sound, x, y, z, gain = 1) => {
      const s = sources[n] || (sources[n] = { id: '', sound: '', x: 0, y: 0, z: 0, gain: 1 })
      s.id = id
      s.sound = sound
      s.x = x
      s.y = y
      s.z = z
      s.gain = gain
      n++
    }
    const sounds = this.theme.manifest.sounds
    for (const agent of this.astronauts.agents) {
      if (agent.state === 'at-site' && agent.status === 'working' && agent.scale > 0.5) {
        take(`work:${agent.id}`, sounds.work, agent.pos.x, agent.pos.y + 0.6, agent.pos.z, 0.9)
      }
    }
    // The arrival's own loop, where it has one — the lander's hum, the moored boat's creak — from
    // wherever the ceremony says the noise is, or a little over its cell. A keep has none: it
    // rings when somebody walks out (`_announceArrival`) and is quiet in between.
    const loop = sounds.arrival[this.ceremony.kind]?.loop
    if (loop) {
      const at = this.ceremony.soundAt?.(this._soundAt || (this._soundAt = new THREE.Vector3()))
      if (at) take('ship', loop, at.x, at.y, at.z, 0.7)
      else {
        const ship = ceremonyPosition()
        take('ship', loop, ship.x, this.ceremony.group.position.y + 3, ship.z, 0.7)
      }
    }
    this.fauna?.drones.forEach((d, i) => take(`drone:${i}`, 'drone-whine', d.x, d.y, d.z, d.busy ? 1 : 0.35))
    sources.length = n

    let water = null
    if (this.sea && this.setting.audio?.shore) {
      // The half-dozen bits of shoreline nearest the view: the whole coast is hundreds of
      // points, and the engine only has ten voices to give out.
      const shore = this._soundWater || (this._soundWater = { level: 0, points: [] })
      shore.points = shorelinePoints(this.setting)
        .map((p) => ({ p, d: (p.x - target.x) ** 2 + (p.z - target.z) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 6)
        .map((e) => e.p)
      shore.level = this.setting.water.level
      shore.focusX = target.x
      shore.focusZ = target.z
      water = shore
    }
    return { night: this.sky.nightFactor ?? 0, sources, water }
  }

  /**
   * Light that lives *on* things (upstream fc8e115): every building near the view sheds a slow
   * mote now and then, the lander's beacon draws a few of its own, and on a world with anything
   * growing on it the yard fills with fireflies after dark.
   */
  _emitMotes(dt, night) {
    if (!this.particles.enabled || !this.fx.mote) return
    const full = this.settings.get('particles') === 'full'
    const focus = this.sky.focus
    const c = this._c2
    const warm = this._c3 || (this._c3 = new THREE.Color())
    const living = this.setting.scatter !== 'rocks'
    const fireflies = living && night > 0.35
    const reach = full ? 48 : 34
    const reach2 = reach * reach
    for (const [id, entry] of this.buildings) {
      if (entry.retiring || entry.progress < 0.5) continue
      const p = entry.mesh.position
      const dx = p.x - focus.x
      const dz = p.z - focus.z
      if (dx * dx + dz * dz > reach2) continue
      const live = this._isActive(id)
      const plot = this.plots.get(entry.plot)
      const rate = (live ? 0.9 : 0.28) * (full ? 1 : 0.55) * (0.6 + night * 0.9)
      if (Math.random() < dt * rate) {
        const r = 0.9 + Math.random() * 1.4
        const a = Math.random() * Math.PI * 2
        if (night > 0.35) c.set(plot?.accent ?? 0xfff0c0).lerp(warm.set(0xfff0c0), 0.35).multiplyScalar(2.2)
        else c.set(0xfff2d0).multiplyScalar(1.6)
        this.fx.mote(p.x + Math.cos(a) * r, p.y + 0.4 + Math.random() * 1.8, p.z + Math.sin(a) * r, c, 0.055, 4)
      }
      if (fireflies && Math.random() < dt * (full ? 0.7 : 0.35) * night) {
        const r = 1.5 + Math.random() * 3.5
        const a = Math.random() * Math.PI * 2
        c.setRGB(1.5, 2.3, 0.55)
        this.fx.mote(p.x + Math.cos(a) * r, p.y + 0.2 + Math.random() * 1.2, p.z + Math.sin(a) * r, c, 0.07, 5)
      }
    }
    // The lander's beacon and pad lights draw a slow halo of their own.
    const ship = this.ceremony.group.position
    const sdx = ship.x - focus.x
    const sdz = ship.z - focus.z
    if (sdx * sdx + sdz * sdz < reach2 && Math.random() < dt * (0.8 + night * 1.4)) {
      const a = Math.random() * Math.PI * 2
      const r = 2 + Math.random() * 3
      c.setRGB(0.7, 1.4, 2.4)
      this.fx.mote(ship.x + Math.cos(a) * r, ship.y + 0.3 + Math.random() * 5, ship.z + Math.sin(a) * r, c, 0.06, 5)
    }
  }

  /**
   * Ground scatter, placed to miss every tile of every plot and the ship's apron.
   *
   * Kept separate from the terrain because of *when* it has to run: the world is built
   * before the first roster arrives, so at that point there are no plots to avoid, and
   * boulders and trees end up under decks that are laid on top of them afterwards — poking
   * through in fragments. So this runs again whenever a zone's footprint changes, which is
   * cheap next to rebuilding the terrain mesh alongside it.
   */
  _buildScatter() {
    if (this.scatterGroup) {
      this.worldGroup.remove(this.scatterGroup)
      disposeTree(this.scatterGroup)
    }
    const clear = []
    for (const plot of this.plotOrder) {
      for (const local of plot.localCenters) {
        clear.push({ x: plot.center.x + local.x, z: plot.center.z + local.z, r: 8.6 })
      }
    }
    const ship = ceremonyPosition()
    // The apron is the ceremony's own: a castle's walls cover a great deal more ground than
    // the lander's legs, and a dock covers it in a different shape again.
    clear.push({ x: ship.x, z: ship.z, r: this.ceremony.apron })
    this.scatterGroup = createScatter(
      this.setting,
      this.theme.manifest.scatter,
      this.settings.get('scatterDensity'),
      clear,
      undefined,
      // A floating island keeps its scatter on the island; everywhere else all ground is ground.
      (x, z) => this.onIsland(x, z)
    )
    this.worldGroup.add(this.scatterGroup)
    this._scatterFootprint = this._plotFootprint()
    if (this.features.grass) isolated(featureRng('grass'), () => this._buildGrass(clear))
    // The crew routes around scatter, so a new scatter is a new navigation grid.
    if (this.nav) this._rebuildNavigation()
  }

  /** What the scatter has to avoid, as one string — cheap to compare every poll. */
  _plotFootprint() {
    return this.plotOrder.map((plot) => plot.signature).join('|')
  }

  /**
   * Called once the model kits are in.
   *
   * The colony is built before boot has finished fetching them, so the first terrain is
   * scattered with fallback primitives. Rebuilding it here is what puts the real trees and
   * boulders down — without it the ground keeps its placeholders until something else
   * happens to invalidate the terrain, which on a colony nobody touches is never.
   */
  onAssetsReady() {
    // The kits have only just arrived, so this is the first moment the setting's season can
    // actually be put on them. A theme whose kits declare no atlases is untouched.
    this._applyAtlas()
    this._buildTerrain()
  }

  setSetting(id) {
    const setting = settingFor(this.theme, id)
    if (!setting || setting === this.setting) return
    const before = this.setting
    this.setting = setting
    if (this.features.visor) this.reflections.invalidate()
    this._applyPlanetTint()
    this.sky.setSetting(setting)
    this._applyAtlas()
    this._applyDeckSeason()

    /**
     * Swap the arrival when this setting wants a different one, or the same one on another
     * cell: the village comes out of a castle in the forest and off a boat in the valley.
     *
     * The kinds are compared as *declared* — neither setting's `kind` is resolved against the
     * theme's default, so two settings that both leave it out agree — and the cell against the
     * one actually installed, which is the only place the current cell is written down.
     *
     * Before `_buildTerrain`, because that is what re-scatters the ground and rebuilds the
     * navigation grid, and both measure themselves from the ceremony's position, apron and
     * clearance. A moved cell also invalidates the plot layout, and nothing is done about that
     * here: `allocateCells` drops any cell it is asked to reserve on the very next poll, and a
     * zone whose root it takes is re-seeded, so the lattice repairs itself within one scan.
     */
    const wantCell = setting.ceremony?.cell || this.theme.manifest.plots.ceremonyCell
    const atCell = ceremonyCell()
    // The declared blocks are compared by identity, not by `kind`: a boat bakes its setting's
    // sea (axis, level) at build time, so two boat settings on one cell still need their own.
    // Settings that leave the block out share the theme default, and one castle; so do two
    // that inherit one block from the same dressing entry, which the resolver copies once.
    if (before.ceremony !== setting.ceremony || atCell.q !== wantCell.q || atCell.r !== wantCell.r) {
      this.ceremony.dispose()
      this.ceremony = this._makeCeremony()
    }

    // After the swap, because the set includes the cell under the arrival's threshold, and
    // before `_buildTerrain` — which re-scatters the ground and rebuilds the navigation grid,
    // both measured from the ceremony's position, apron and clearance. `_syncPlots` may be
    // handed a roster on the very next tick, and it reads this. The island's footprint goes
    // in first, so the one the guard puts back is this setting's, not the last one's.
    this._shapeIsland()
    this.blockedCells = this._blockedCells()

    this._buildTerrain()
  }

  /** The kit sheet: the setting's own season, unless the user forced one. */
  _applyAtlas() {
    const season = this.settings.get('season')
    // A name no kit of this theme declares — a season stored under another theme — is Auto,
    // not whichever sheet the kit happens to list first.
    const known = Object.values(this.theme.manifest.kits || {}).some((k) => k.atlases && season in k.atlases)
    setKitAtlas(known ? season : this.setting.atlas || null)
  }

  /**
   * Put the setting's colour on every deck already standing.
   *
   * The kits get their season by having one shared texture's image replaced, but a plot deck
   * is drawn rather than atlased, so its season is a material colour and has to be walked.
   * A no-op for a theme that tints its decks any other way — `plotDeckColor` is null there.
   */
  _applyDeckSeason() {
    setPlotSeason(this.setting)
    const color = plotDeckColor()
    if (!color) return
    for (const plot of this.plotOrder) plot.setDeckTint(color)
  }

  /**
   * Draw every zone's fade again without changing any of them.
   *
   * What a fade *looks* like is a setting now — "Fade ghost towns" — and nothing about the
   * repos moves when it is flipped, so neither `setFade` nor the poll would write anything:
   * both are guarded on the value having changed. This replays the numbers the plots and
   * buildings already hold, which is the whole of what the toggle has to do.
   */
  _refreshFades() {
    for (const plot of this.plotOrder) plot.refreshFade?.()
    let swapped = false
    for (const [id, entry] of this.buildings) {
      entry.mesh.userData.setFade?.(entry.fade ?? 0)
      swapped = this._syncRuin(id, entry, entry.fade ?? 0) || swapped
    }
    // A ruin stands on different ground than the house it replaced, and the grid only learns
    // that when it is rebuilt. `setThreads` already rebuilds after its own `_syncRuin` pass;
    // this is the other path, and the one that actually happens — the lazy decay kit lands
    // after the poll that asked for it, so the building falls down here. The `fadeGhosts`
    // toggle never changes `ruined(fade, ruinAt)`, so it swaps nothing and stays a redraw.
    if (swapped && this.nav) this._rebuildNavigation()
  }

  /**
   * Whether this building is a house or a heap.
   *
   * Past `decay.ruinAt` the recipe's structure is swapped out for the dressing kit's ruin, and
   * below it the house comes back — a repo you commit to again is not left in rubble. Both
   * directions run through the one mesh (`setRuin`), so the thing standing on the slot keeps
   * its material, its uniforms, its position and its shadow through the change.
   *
   * Called from two places for one reason: the poll writes every fade, and the lazy kit lands
   * *after* the poll that asked for it. A building that was already past the threshold when
   * the request went out is handed its ruin by `_refreshFades` on arrival, which is what
   * `createRuin` answering null until then is for.
   *
   * @returns {boolean} whether a geometry was swapped, in either direction — the caller's cue
   *   that the navigation grid is holding the wrong footprint for this slot.
   */
  _syncRuin(id, entry, fade) {
    if (!this.decay) return false
    const want = ruined(fade, this.decay.ruinAt)
    if (want && !entry.ruin) {
      const geo = createRuin({ seed: hashString(id) })
      if (!geo) return false
      entry.ruin = geo
      entry.mesh.userData.setRuin?.(geo)
      return true
    } else if (!want && entry.ruin) {
      entry.mesh.userData.setRuin?.(null)
      entry.ruin.dispose()
      entry.ruin = null
      return true
    }
    return false
  }

  /**
   * Everything this poll set in motion that has not landed yet, as one promise.
   *
   * Exactly one thing qualifies today: the dressing kit's fetch, and the pass over the plots
   * that follows it. It matters to the screenshot harness, which drives `poll()` with the
   * clock paused — a fetch that resolves whenever the disk feels like it would otherwise put
   * the kit's own allocations, and the four seeded draws each of them spends, at a different
   * simulated instant every run. Awaiting this pins them to the instant the roster landed.
   *
   * A colony with no ghost in it has nothing pending and hands back a promise that is already
   * resolved, which costs the space theme a microtask and nothing else.
   */
  settled() {
    return this._decayKit ?? Promise.resolve()
  }

  onSettingsChanged(changed, scope) {
    if (changed.has('setting')) this.setSetting(this.settings.get('setting'))
    else if (scope.world) this._buildTerrain()
    // Its own branch: forcing a season is one texture upload, not a world rebuild.
    if (changed.has('season')) this._applyAtlas()
    // Likewise: whether a ghost is drawn thin is a look, not a world. Nothing is rebuilt and
    // no fade changes — every plot and building simply writes the one it already has again.
    if (changed.has('fadeGhosts')) {
      setFadeGhosts(this.settings.get('fadeGhosts'))
      this._refreshFades()
    }
    if (changed.has('deckGlaze')) {
      setDeckGlaze(this.settings.get('deckGlaze'))
      for (const plot of this.plotOrder) plot.refreshDeckGlaze()
    }

    this.sky.onSettingsChanged(changed)
    this.astronauts.onSettingsChanged(changed)
    this.particles.onSettingsChanged(changed)
    if (this.features.fauna) isolated(featureRng('fauna'), () => this.fauna.onSettingsChanged(changed))
    if (this.features.clouds && changed.has('clouds')) isolated(featureRng('clouds'), () => this.sky.setSetting(this.setting))
    if (changed.has('showLabels')) this._syncLabels()
    if (changed.has('timeOfDay')) this.sky.setTime(this.settings.get('timeOfDay'))
  }

  // ── roster ──────────────────────────────────────────────────────────────────────────

  /**
   * Take a fresh scan and reshape the colony around it. Everything here is keyed by stable
   * ids — repo name for plots, session id for buildings — so a poll that changes nothing
   * moves nothing on screen.
   */
  setThreads(threads, archivedIds = new Set(), zone = { hidden: [], pinned: [], forgotten: [] }, knownIds = new Set()) {
    const now = Date.now()
    // The browser's own archive list is laid over the server's `state`: a click has to take
    // effect now, not at the next poll, and the server will agree within a few seconds.
    const withState = threads.map((t) =>
      t.archived || archivedIds.has(t.id) ? { ...t, state: 'archived', archived: true } : t
    )
    const live = withState.filter((t) => t.state !== 'archived')
    // What the user asked to see on the ground. Everything else is history: still in the
    // side panel, but with no tile of its own and nothing standing on it.
    const counted = countedStates(this.settings)
    const shown = withState.filter((t) => isCounted(t, counted))

    // Which repos are on the map at all, and how far each has faded. Decided before
    // grouping so a repo that has left never reaches the allocator — which is what frees
    // its tiles — and a fading one carries its number down to its plot and its buildings.
    // Archived threads are history and stay out of the fate — unless the user ticked them,
    // in which case a repo made only of archived threads still deserves its tile.
    const visible = counted.has('archived') ? withState : live
    this.fates = zoneFate(visible, {
      now,
      activeOnly: this.settings.get('activeOnly'),
      fadeDays: this.settings.get('fadeDays'),
      hideDays: this.settings.get('hideDays'),
      hidden: zone.hidden,
      pinned: zone.pinned,
      forgotten: zone.forgotten,
    })

    /**
     * The first zone to start fading is what pays for the dressing's kit.
     *
     * Asked here, off the fates, rather than from inside a plot: this is the one place that
     * knows every repo's number, and the request has to be made once for the colony rather
     * than once per ghost. When it lands every plot and building writes its fade again, which
     * is what actually dresses them — `Plot.refreshFade` builds its yard's decay half on the
     * first write it sees with the kit in hand.
     *
     * The chain is terminated here rather than left to reach `settled()`. Both ends memoise it
     * — `loadLazyKit` on the kit record, the colony on `_decayKit` — so a dressing whose file
     * is missing is rejected once and then handed to every poll that awaits it afterwards,
     * which is a toast about a 404 every fifteen seconds for as long as the tab is open. A kit
     * that will not load means the ghosts go undressed, and that is worth saying once, quietly,
     * and no more: every plot and building keeps the fade it already has, `_decayReady` and
     * `createRuin` both answer no, and `_decayKit` stays set so the file is never asked for
     * again. The same guard covers a `part()` that throws inside `_refreshFades`.
     */
    if (this.decay && !this._decayKit && [...this.fates.values()].some((f) => f.show && f.fade > 0)) {
      this._decayKit = loadLazyKit(this.decay.kit)
        .then(() => {
          // The season, for form's sake: the decay kit declares no `atlases` of its own — its
          // models UV into the base kit's grid and are drawn with the base kit's texture — so
          // `setKitAtlas` skips it and this is a no-op for it. It is here so that a theme whose
          // dressing does ship its own sheets is not a surprise.
          this._applyAtlas()
          this._refreshFades()
        })
        .catch((err) => console.warn('decay kit:', err))
    }

    // Group by repo, biggest project first so the busiest work lands nearest the middle.
    // Every repo the fate shows keeps a plot — one bare tile at least, so a repo whose last
    // session just closed stays on the map to fade on its own schedule and its history
    // stays reachable from the panel. Only the counted threads go into a repo's list: they
    // are what sizes the plot and what gets a building.
    const byProject = new Map()
    for (const thread of visible) {
      const key = thread.project || 'unknown'
      if (!this.fates.get(key)?.show) continue
      if (!byProject.has(key)) byProject.set(key, [])
      if (isCounted(thread, counted)) byProject.get(key).push(thread)
    }
    const projects = [...byProject.entries()].sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length
      return a[0].localeCompare(b[0])
    })

    this._syncPlots(projects)

    const roster = []
    const seenBuildings = new Set()
    const stats = { agents: 0, projects: projects.length }
    for (const key of STATUS_ORDER) stats[key] = 0
    // Plots holding anything that wants your attention get a pulsing rim, so you can spot
    // the repo that needs you from right across the colony without reading a single label.
    const urgent = new Set()
    // Plots with anyone working, waiting or stuck keep their name on screen; quiet ones
    // only show it on hover.
    const active = new Set()
    // Threads running subagents, collected here and turned into roster entries *after* every
    // thread has one: `setRoster` slices the roster at the agent cap, and a helper that came
    // before a thread would push that thread's own villager off the map.
    const crewed = []
    /**
     * Roster entries waiting for a site, with what `_workSite` needs to compute one.
     *
     * Sites are filled in below, after `_rebuildNavigation`, and that order is the whole point:
     * a site is a claim about ground somebody can stand on, and only the grid built from *this*
     * poll's buildings can judge it. Computing them here — against the grid the last poll left
     * — put every site at boot inside its own building's blocked disc.
     */
    const siteless = []

    for (const [name, list] of projects) {
      const plot = this.plots.get(name)
      if (!plot) continue
      const fade = this.fates.get(name)?.fade ?? 0
      plot.setFade?.(fade)
      // Oldest thread first, so the *first* assignment of slots is deterministic.
      list.sort((a, b) => a.createdAt - b.createdAt)
      // Seven slots a tile, hard. Past the last one a thread gets no building and no villager,
      // and the plate says how many — the alternative is two houses in one spot.
      const capacity = plot.slots.length
      const overflow = overflowFor(list.length, plot.cells.length)
      const teleport = this.movedPlots.has(name)
      // After the first assignment a thread keeps the slot it was given for as long as the plot
      // stands (upstream f2cce25): numbering by position in this list meant one archive shifted
      // every younger sibling one slot along — every building on the plot moved and every
      // villager walked, for a thread that had left. A newcomer takes the lowest free slot.
      // What stays ours is the overflow: a thread that got no ground gives its number back
      // every poll, so the oldest of them is first into a slot an archive frees, and nothing is
      // ever numbered past the plot's slots into a wrapped, shared spot.
      const slotOf = plot.slotOf || (plot.slotOf = new Map())
      const onPlot = new Set(list.map((t) => t.id))
      for (const [id, slot] of [...slotOf]) if (!onPlot.has(id) || slot >= capacity) slotOf.delete(id)
      const taken = new Set(slotOf.values())
      for (const thread of list) {
        if (slotOf.has(thread.id)) continue
        let slot = 0
        while (taken.has(slot)) slot++
        taken.add(slot)
        slotOf.set(thread.id, slot)
      }

      list.forEach((thread) => {
        const i = slotOf.get(thread.id)
        const placed = i < capacity
        let building = null
        if (placed) {
          building = this._syncBuilding(thread, plot, i)
          seenBuildings.add(thread.id)
          building.fade = fade
          building.mesh.userData.setFade?.(fade)
          this._syncRuin(thread.id, building, fade)
        }

        // A ghost town has nobody in it. The buildings stay; the villagers do not, and the
        // counts are of who is on the map, so a faded repo's threads are not in them either.
        if (fade > 0) return
        // Only an open session is a person. A closed one leaves its building standing and
        // walks off the map, which is how the colony stops being a museum of every
        // transcript ever written.
        if (thread.state !== 'active' && thread.state !== 'idle') return

        const status = statusFor(thread, now)
        if (stats[status] !== undefined) stats[status]++
        if (status === 'waiting' || status === 'blocked') urgent.add(plot.id)
        if (status === 'waiting' || status === 'blocked' || status === 'working') active.add(plot.id)
        // Counted, and counted honestly — but there is nobody on the map for it. `stats.agents`
        // is bodies, so it only counts the threads that got ground.
        if (!placed) return
        stats.agents++

        const entry = {
          id: thread.id,
          thread,
          status,
          /** Filled in after the grid is rebuilt; see `siteless`. */
          site: null,
          // Where the work actually is. A working astronaut circles it rather than standing
          // at one spot, so it needs the building, not just a place to stand near it.
          anchor: building.mesh.position.clone(),
          // The repo's colour, for anything the crew wears that is tinted `accent` — the
          // village's shield says which plot a villager belongs to from across the map.
          accent: plot.accent,
          // Already on the colony's books, so it does not need an entrance.
          known: knownIds.has(thread.id),
          // Its zone is somewhere else now, so it is placed rather than sent walking.
          teleport,
        }
        roster.push(entry)
        siteless.push({ entry, plot, building, index: i })

        if (thread.subagents?.length) crewed.push({ thread, plot, building, index: i })
      })

      // The plate, after the walk that counted the overflow. A zone with something it cannot
      // show keeps its name up, or the badge would only be visible on hover. A ghost town
      // carries no badge at all: nothing on it is current, and a `+N` on a faded zone is a
      // number about work nobody is doing.
      this._syncPlate(plot, fade > 0 ? 0 : overflow)
      if (overflow > 0 && fade === 0) active.add(plot.id)
    }

    // Anything that dropped out of the scan — archived, or a transcript that vanished —
    // takes its building down and walks its astronaut back to the ship. Before the rebuild,
    // so the ground a departing building stood on is open by the time sites are chosen.
    for (const [id, entry] of this.buildings) {
      if (!seenBuildings.has(id)) this._removeBuilding(id, entry)
    }

    // Every non-archived thread, counted or not: the card, the scaffolding and the growth
    // rule all ask about threads the map is not necessarily showing a building for.
    this.threads = new Map(live.map((t) => [t.id, t]))
    this.urgentPlots = urgent
    this.activePlots = active
    this._rebuildNavigation()

    // The grid is current: now every villager can be given somewhere it can actually get to.
    for (const { entry, plot, building, index } of siteless) {
      entry.site = this._workSite(plot, building, index)
    }

    // The helpers, after every thread. Nothing here touches `stats`, `urgent` or `active`: a
    // subagent is work the thread is already doing, and counting it twice would make the HUD
    // disagree with the side panel about how much is open. Their sites come off the same
    // rebuilt grid, and by the same ring walk — a helper wedged in a pocket is a villager
    // wedged in a pocket.
    this.helpers = new Map()
    for (const { thread, plot, building, index } of crewed) {
      // Per plot, because the crewed list spans every project — the outer loop's own
      // `teleport` is about whichever project happened to be walked last.
      const teleport = this.movedPlots.has(plot.id)
      const anchor = building.mesh.position.clone()
      for (const entry of helperEntries(
        thread,
        // A ring around the building, sharing it with its own villager: the parent stands at
        // its outward angle and n helpers take the rest of the circle, all of them at the
        // radius `_workSite` already clears the footprint by.
        (k, n) => this._workSite(plot, building, index, ((k + 1) * Math.PI * 2) / (n + 1)),
        anchor,
        plot.accent
      )) {
        entry.teleport = teleport
        roster.push(entry)
        this.helpers.set(entry.id, { thread: entry.thread, helper: entry.helper })
      }
    }

    if (this.features.fauna) isolated(featureRng('fauna'), () => this._syncFaunaSites())
    this.stats = { ...stats, done: stats.celebrating }
    this.astronauts.setRoster(roster, this._world())
    return this.stats
  }

  /** The seam the plate test stubs: everything about a plate that needs a canvas. */
  _makeLabel(name, accent, badge) {
    return createLabel(name, accent, 4, badge)
  }

  /**
   * The plate a zone wears: its name, plus `+N` when it has more threads than building slots.
   *
   * Rebuilt rather than repainted, because the text is baked into a canvas texture — and only
   * when the number actually changed, which on almost every zone is never. The plate is also
   * what makes the overflow visible at all, so an overflowing zone is added to `activePlots`
   * by `setThreads`: that set is exactly "keep this name on screen".
   */
  _syncPlate(plot, overflow) {
    if (plot.label && plot.overflow === overflow) return
    plot.overflow = overflow
    if (plot.label) {
      this.labelGroup.remove(plot.label)
      plot.label.userData.dispose?.()
    }
    const label = this._makeLabel(plot.name, plot.accent, badgeText(overflow))
    label.position.set(plot.labelAnchor.x, 3.2, plot.labelAnchor.z)
    plot.label = label
    this.labelGroup.add(label)
  }

  _syncPlots(projects) {
    // The previous layout is an input, so a zone only moves when its own footprint changes
    // — never because a different repo gained or lost a thread. `plotCells` carries it
    // between polls, and the colony file carries it between sessions.
    //
    // A repo whose memory this world keeps elsewhere (`_keptLayout`) is dealt from where it
    // stands on this world instead, so it holds its place from poll to poll like any other.
    const relocated = new Set()
    const here = this._placedHere?.on === this.blockedCells ? this._placedHere.cells : null
    const layout = allocateCells(
      projects.map(([name, list]) => ({ id: name, size: list.length })),
      here?.size ? new Map([...this.plotCells, ...here]) : this.plotCells,
      { perCell: this.settings.get('threadsPerTile'), blocked: this.blockedCells, relocated }
    )
    // Remembered, not replaced: a project that has just lost its last thread keeps its
    // ground on the books, and the oldest entries fall off the end. What this world could not
    // give a repo is not remembered either — see `_keptLayout` — only held for this world, in
    // `_placedHere`, which a new world (a new `blockedCells`) starts from empty.
    const kept = this._keptLayout(layout)
    const placedHere = new Map()
    for (const [name, cells] of layout) {
      if (!cells.length) continue
      if (kept.has(name)) {
        placedHere.set(name, cells)
        continue
      }
      this.plotCells.delete(name)
      this.plotCells.set(name, cells)
    }
    this._placedHere = { on: this.blockedCells, cells: placedHere }
    while (this.plotCells.size > LAYOUT_MEMORY) this.plotCells.delete(this.plotCells.keys().next().value)
    this._syncUnplaced(layout)

    const wanted = new Map()
    for (const [name, cells] of layout) wanted.set(name, `${name}:${cells.map((c) => `${c.q},${c.r}`).join('/')}`)

    // A plot is rebuilt whenever its own footprint moved, and left completely alone
    // whenever it did not.
    this.movedPlots = new Set()
    for (const [name, plot] of this.plots) {
      if (wanted.get(name) === plot.signature) continue
      // The *root* tile, not the signature: a zone that gained a tile keeps its origin and
      // therefore its buildings, and its crew should walk the metre `plot.middle` moved them.
      // A root that changed is a zone that is somewhere else, which its people cannot walk to.
      const root = layout.get(name)?.[0]
      if (root && (root.q !== plot.cells[0].q || root.r !== plot.cells[0].r)) this.movedPlots.add(name)
      this.plotGroup.remove(plot.group)
      if (plot.label) {
        this.labelGroup.remove(plot.label)
        plot.label.userData.dispose?.()
      }
      this.usedAccents.delete(plot.accent)
      plot.dispose()
      this.plots.delete(name)
    }

    /**
     * The zones the allocator picked up and put down elsewhere because they had run out of
     * room, restricted to the ones that visibly went somewhere: a relocation may re-seed on
     * the tile it already held, and a zone whose root did not move has not moved.
     *
     * A strict subset of `movedPlots`, and the one the HUD announces. The rest of `movedPlots`
     * is a root that changed for a reason the user already knows about — a Compact they
     * clicked, a coast that blocked the ground, a Zone size they lowered — and the crew is
     * teleported for all of them alike.
     */
    this.relocatedPlots = new Set([...relocated].filter((name) => this.movedPlots.has(name)))

    projects.forEach(([name], index) => {
      if (this.plots.has(name)) return
      const cells = layout.get(name)
      if (!cells?.length) return
      const accent = this._pickAccent(name)
      const plot = new Plot({ id: name, name, index, cells, accent })
      plot.signature = wanted.get(name)
      this.plots.set(name, plot)
      this.plotGroup.add(plot.group)
    })

    this.plotOrder = [...this.plots.values()]
    // Zones that just moved, appeared or grew are zones the scatter does not know about.
    if (this.scatterGroup && this._plotFootprint() !== this._scatterFootprint) {
      // On upstream's island in the sea the coast itself follows the zones, which is the whole
      // terrain; on his floating island the rock under them follows too.
      if (this.setting.shape === 'island') this._buildTerrain()
      else {
        this._buildScatter()
        if (this.island) isolated(featureRng(ISLAND_STREAM), () => this._syncIslandRock())
      }
    }
    // Which hex cells are decked. Ground height is asked for once per moving agent per
    // frame, so it wants to be a lookup rather than a scan over every plot's every tile.
    this.deckedCells = new Set()
    for (const plot of this.plotOrder) {
      for (const cell of plot.cells) this.deckedCells.add(`${cell.q},${cell.r}`)
    }
    this._syncLabels()
  }

  /**
   * The repos whose deal on this world is not written to memory, so that going back to a world
   * with room puts every repo back on exactly the cells it had there (owner, 2026-09-28).
   *
   * - **No room**: a repo the allocator dealt nothing. Written down, its `[]` would forget its
   *   ground, and the next world with room would seed it afresh somewhere else.
   * - **Moved off refused ground**: a repo that remembers a cell this world refuses — its
   *   `blockedCells`, or its arrival's cell. The allocator moves it (or refuses it) exactly as
   *   it always has, and it stands there on this world, but its memory stays where it was.
   * - **Standing on someone's memory**: a repo dealt a cell that one of the above still
   *   remembers. A crowded-out repo's cells are free here, so the allocator may hand them to a
   *   neighbour or a newcomer; written down, two repos would remember one cell and one of them
   *   would lose it on the way back. Such a repo keeps its own memory (a newcomer, none), and
   *   since that may free a cell a third repo was dealt, this runs until nothing more is kept.
   *
   * Every other repo is remembered where it was dealt, as always, so on a world where nobody
   * is refused ground this is the empty set and the memory moves exactly as it did.
   */
  _keptLayout(layout) {
    const refused = this.blockedCells
    const ship = ceremonyCell()
    const shipKey = `${ship.q},${ship.r}`
    const kept = new Set()
    /** Cell key → the kept repo remembering it. */
    const claimed = new Map()
    const keep = (name) => {
      kept.add(name)
      for (const c of this.plotCells.get(name) || []) claimed.set(`${c.q},${c.r}`, name)
    }
    for (const [name, cells] of layout) {
      const before = this.plotCells.get(name)
      if (!before?.length) continue
      const off = before.some((c) => {
        const k = `${c.q},${c.r}`
        return k === shipKey || refused?.has(k)
      })
      if (off || !cells.length) keep(name)
    }
    for (let grew = kept.size > 0; grew; ) {
      grew = false
      for (const [name, cells] of layout) {
        if (kept.has(name)) continue
        if (!cells.some((c) => (claimed.get(`${c.q},${c.r}`) ?? name) !== name)) continue
        keep(name)
        grew = true
      }
    }
    return kept
  }

  /**
   * Which repos this world has no room for, and telling `onUnplaced` when that changes. The
   * list is judged against the world it was made on (its `blockedCells`), so a new world
   * starts from empty and a repo still left out there is news again.
   */
  _syncUnplaced(layout) {
    const names = [...layout].filter(([, cells]) => !cells.length).map(([name]) => name).sort()
    const was = this._unplacedOn === this.blockedCells ? this.unplaced || [] : []
    this._unplacedOn = this.blockedCells
    this.unplaced = names
    if (names.length === was.length && names.every((n, i) => n === was[i])) return
    const added = names.filter((n) => !was.includes(n))
    this.onUnplaced?.(names, added)
  }

  /**
   * How high the ground is at a world point — the surface anything walking stands on.
   *
   * A plot's tiles are a raised slab, so on one of those it is the deck; everywhere else it
   * is the terrain, sampled from the same noise field the mesh was built from. Without this
   * the crew walks along y=0 while the ground around them runs from -0.35 to +0.20, and they
   * spend half the colony buried to the shins.
   */
  /** The bits of the world the crew needs to know about, as plain callbacks. */
  _world() {
    return {
      door: () => this.ceremony.door(),
      groundAt: (x, z) => this.groundAt(x, z),
    }
  }

  groundAt(x, z) {
    const cell = worldToHex(x, z)
    if (this.deckedCells?.has(`${cell.q},${cell.r}`)) return DECK_TOP
    return terrainHeight(x, z, this.setting)
  }

  /** A stable colour per repo, probing forward on a collision so no two plots match. */
  _pickAccent(name) {
    const palette = plotPalette()
    const start = hashString(name) % palette.length
    for (let i = 0; i < palette.length; i++) {
      const accent = palette[(start + i) % palette.length]
      if (!this.usedAccents.has(accent)) {
        this.usedAccents.add(accent)
        return accent
      }
    }
    return palette[start]
  }

  _syncBuilding(thread, plot, index) {
    let entry = this.buildings.get(thread.id)
    // Whole, always. A building that has finished rising is a building you can see all of.
    const target = 1

    if (!entry) {
      const kind = kindForThread(thread.id, this.byCharacter, this.characters)
      const mesh = createBuilding({ seed: hashString(thread.id), accent: plot.accent, kind })
      const pos = plot.worldSlot(index)
      mesh.position.copy(pos)
      mesh.rotation.y = ((hashString(thread.id) >>> 8) % 360) * (Math.PI / 180)
      // New buildings rise from nothing rather than appearing whole.
      mesh.userData.setProgress(0)
      this.worldGroup.add(mesh)
      // `fade` is written by `setThreads` a line after this returns; it is initialised here
      // all the same, so `_refreshFades` has a number to replay however it is reached.
      entry = { mesh, plot: plot.id, slot: index, progress: 0, target, stage: 1, retiring: false, fade: 0 }
      this.buildings.set(thread.id, entry)
    } else {
      // Where this building belongs *now*. Comparing the world position rather than the
      // plot id and slot number is what catches a zone that was rebuilt underneath it: the
      // repo is the same and the slot is the same, but the ground moved, and a habitat left
      // behind on bare terrain takes its astronaut off the plot with it.
      const want = plot.worldSlot(index, this._slotAt || (this._slotAt = new THREE.Vector3()))
      if (entry.plot !== plot.id || entry.slot !== index || entry.mesh.position.distanceToSquared(want) > 1e-4) {
        entry.plot = plot.id
        entry.slot = index
        entry.mesh.position.copy(want)
      }
    }

    // Which of the recipe's parts the thread has earned. A theme that stages nothing is whole
    // from the first frame; one that does follows the HUD's own progress number for the thread.
    const stage = this.staged ? transcriptProgress(thread) : 1
    if (entry.stage !== stage) {
      entry.stage = stage
      entry.mesh.userData.setStage(stage)
    }

    entry.target = target
    entry.accent = plot.accent
    entry.retiring = false
    return entry
  }

  _removeBuilding(id, entry) {
    // Wind the reveal back down, then take it out — a building that vanishes mid-frame
    // reads as a glitch, one that sinks reads as being packed up.
    entry.retiring = true
    entry.target = 0
    if (entry.progress <= 0.02) {
      this.worldGroup.remove(entry.mesh)
      // Up to three geometries and never fewer than one: the structure on the mesh right now,
      // the intact one it is holding on to in case the repo wakes up, and the ruin that took
      // its place. Through a `Set`, because the first is always one of the other two.
      for (const geo of new Set([entry.mesh.geometry, entry.mesh.userData.intact, entry.ruin])) geo?.dispose()
      entry.mesh.material.dispose()
      entry.mesh.customDepthMaterial?.dispose()
      this.buildings.delete(id)
    }
  }

  /**
   * Hand the navigation grid the colony's current footprint.
   *
   * The blocking radius is the building's bounding radius trimmed a little, plus the
   * astronaut's own width. The trim matters: the bounding radius already over-covers
   * anything that is not round, and blocking the full extent closes the gaps between a ring
   * of buildings, which is exactly where the crew needs to walk.
   */
  /**
   * Ground nobody may stand on, whatever is built on the colony.
   *
   * Two halves, and both are functions of the setting alone — which is why the whole thing is
   * cached by `Navigation.setGround` rather than evaluated per poll.
   *
   * **The sea**, which is not a circle and cannot be one: the shore is a half-plane that cuts
   * across the navigation square. Anything under `level + SHORE_BAND` is beach or slope — the
   * same band `createScatter` plants nothing on — so villagers keep to the flat and nobody
   * wades off to the corner. The distance test comes first because it is the cheaper half and
   * inland of `shoreReach` the sea contributes nothing: the height test there was asking about
   * dry far-field hills, which dip under the band on their own and are ground the crew walks
   * quite happily.
   *
   * **Everything outside the lattice**, because that is scenery rather than colony. It keeps
   * the far field's boulders from walling off ground nobody needs, keeps the reachability fill
   * to the ground that matters, and keeps `SEED_MIN_SHARE` meaning what it meant when the
   * square was the colony. One ring of slack, so the walking margin outside the last deck is
   * walkable: ring twelve is where the margin lives.
   */
  _groundVeto() {
    const setting = this.setting
    const water = setting.water
    let wet = null
    if (setting.coast) {
      const [ax, az] = setting.coast.axis
      const floor = water.level + SHORE_BAND
      wet = (x, z) => x * ax + z * az >= shoreReach(x, z, setting) && terrainHeight(x, z, setting) < floor
    }
    return (x, z) => {
      if (ringOf(worldToHex(x, z)) > PLOT_RINGS + 1) return true
      return wet ? wet(x, z) : false
    }
  }

  _rebuildNavigation() {
    const obstacles = []
    for (const entry of this.buildings.values()) {
      if (entry.retiring) continue
      const p = entry.mesh.position
      const r = (entry.mesh.userData.footprint || 1.2) * 0.8 + AGENT_RADIUS
      obstacles.push({ x: p.x, z: p.z, r })
    }
    // Ground clutter counts too. A crate is only knee-high, but an astronaut walking
    // straight through one is exactly as wrong as one walking through a habitat.
    //
    // The same pass picks the lit props out: a theme whose kerb clutter includes a lamp gets
    // the world position of every flame, which is what the particles hook needs to put an
    // ember over one. Collected here rather than kept up to date on the side because this is
    // already the one place that runs whenever any plot's clutter changes.
    const lamp = this.theme.manifest.plots.clutterLamp
    this.lampSpots = []
    // `Plot._buildClutter` produces these; the jsdoc on `Plot.clutterSpots` has the record shape.
    for (const plot of this.plotOrder) {
      for (const spot of plot.clutterSpots || []) {
        obstacles.push({ x: plot.center.x + spot.x, z: plot.center.z + spot.z, r: spot.r + AGENT_RADIUS })
        // A ghost's torches are out, so nothing should throw embers over them.
        if (spot.name === lamp && !(plot.fade > 0)) {
          this.lampSpots.push({ x: plot.center.x + spot.x, y: DECK_TOP + spot.top, z: plot.center.z + spot.z })
        }
      }
    }
    // Torches a recipe placed on its building — the tavern's pair, the watchtower's one —
    // reach the ember emitter the same way the kerb torches do. A ghost's are out, and a
    // torch the thread has not earned yet (`stage`) is not standing there to throw one.
    //
    // The rotation is written out by hand rather than gone through `localToWorld`: this runs
    // whenever the roster lands, and a `Vector3` per torch per rebuild is garbage for a
    // three-line matrix. `rotation.y` is the only one a building has, and a positive one
    // turns +z toward +x, so world x = px + lx·cos + lz·sin and world z = pz − lx·sin + lz·cos.
    for (const entry of this.buildings.values()) {
      if (entry.retiring) continue
      const plot = this.plots.get(entry.plot)
      if (!plot || plot.fade > 0) continue
      const m = entry.mesh
      const c = Math.cos(m.rotation.y)
      const s = Math.sin(m.rotation.y)
      for (const lamp of m.userData.lamps || []) {
        // The shader's own tolerance, so a torch and its ember never disagree at a boundary.
        if (lamp.stage > entry.stage + 0.0005) continue
        this.lampSpots.push({
          x: m.position.x + lamp.x * c + lamp.z * s,
          y: m.position.y + lamp.y,
          z: m.position.z - lamp.x * s + lamp.z * c,
        })
      }
    }
    // Ground scatter counts as well. A boulder an astronaut can walk through is the same
    // bug as a habitat it can walk through, and a sleeping one parked inside a solar panel
    // is what that bug looks like from the outside. Instances are read straight off the
    // matrices, so this costs no bookkeeping of its own.
    const mat = this._navMatrix || (this._navMatrix = new THREE.Matrix4())
    for (const mesh of this.scatterGroup?.children || []) {
      if (!mesh.isInstancedMesh || !mesh.count) continue
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox
      const spread = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, mat)
        const scale = Math.hypot(mat.elements[0], mat.elements[1], mat.elements[2])
        const r = spread * scale * 0.65
        // Only what an astronaut would visibly stand *inside*. Blocking every pebble and
        // sprig fences the corridors between zones — the crew walks the gaps between plots
        // to get anywhere, and scatter is placed in exactly those gaps.
        if (r < 0.55) continue
        obstacles.push({ x: mat.elements[12], z: mat.elements[14], r: r + AGENT_RADIUS })
      }
    }

    const ship = ceremonyPosition()
    obstacles.push({ x: ship.x, z: ship.z, r: this.ceremony.clearance + AGENT_RADIUS })
    /**
     * And anything else the arrival stands on that one disc at the cell cannot hold: the
     * fortress's rear tower, which is behind the keep and well outside `clearance`. Optional —
     * the lander, the dock and the forest's castle declare no `blocks` at all — and world-space
     * already, so nothing here has to know what shape a ceremony is.
     */
    for (const b of this.ceremony.blocks || []) obstacles.push({ x: b.x, z: b.z, r: b.r + AGENT_RADIUS })

    this.nav.setGround(this._groundVeto(), this.setting.id)
    this.nav.rebuild(obstacles)
    /**
     * And then: which of that open ground anybody can actually get to.
     *
     * Seeded at the threshold because that is where every villager comes from — the pockets
     * between overlapping buildings are open cells nobody can reach from it, and a work site in
     * one is a villager walking at a wall until it gives up. Here rather than in `setThreads`
     * so every path that rebuilds the grid — a new scatter, a ruin coming down — leaves the map
     * agreeing with it; the fill itself is skipped when neither the ground nor the door moved.
     */
    const door = this.ceremony.door(this._navDoor || (this._navDoor = new THREE.Vector3()))
    this.nav.setSeed(door.x, door.z)
  }

  /** The plot under a world point. On a hex lattice the nearest cell centre is the cell. */
  plotAt(x, z) {
    let best = null
    let bestD = Infinity
    for (const plot of this.plotOrder) {
      for (const local of plot.localCenters) {
        const dx = x - (plot.center.x + local.x)
        const dz = z - (plot.center.z + local.z)
        const d = dx * dx + dz * dz
        if (d < bestD) {
          bestD = d
          best = plot
        }
      }
    }
    return bestD <= PLOT_CELL * PLOT_CELL ? best : null
  }

  /**
   * The plot whose name plate is under the cursor.
   *
   * Plates are billboarded in the vertex shader — a CPU raycast against the quad would test
   * the geometry as authored, which is not where it ends up on screen. So this repeats the
   * shader's own maths instead: the plate sits at its anchor in view space and spans
   * `half * (0.55 + dist * 0.03)`, which projects to `half * k * P / dist` in NDC.
   *
   * Opacity is deliberately not consulted. A quiet project's plate is invisible until it is
   * pointed at, and it is this hit test that decides it is being pointed at.
   */
  pickLabel(ndcX, ndcY) {
    const view = this._labelView || (this._labelView = new THREE.Vector3())
    const p = this.camera.projectionMatrix.elements
    let best = null
    let bestDist = Infinity
    for (const plot of this.plotOrder) {
      const label = plot.label
      if (!label) continue
      // Bent like the shader bends the anchor, so a far plate is hit where it is drawn. The
      // bend is the identity on a theme that never installs the world curve.
      const dist = -bendPoint(view.copy(label.position)).applyMatrix4(this.camera.matrixWorldInverse).z
      if (dist <= 0.01 || dist >= bestDist) continue
      const geo = label.geometry.parameters
      const k = 0.55 + dist * 0.03
      const cx = (view.x * p[0]) / dist
      const cy = (view.y * p[5]) / dist
      if (Math.abs(ndcX - cx) > ((geo.width / 2) * k * p[0]) / dist) continue
      if (Math.abs(ndcY - cy) > ((geo.height / 2) * k * p[5]) / dist) continue
      bestDist = dist
      best = plot
    }
    return best
  }

  /**
   * Take the zone layout out of the colony file. Cells arrive as `[q, r]` pairs from a file
   * a person can edit, so anything that is not a pair of whole numbers is dropped rather
   * than trusted — a bad entry would put a zone on a cell that does not exist.
   */
  restoreLayout(saved) {
    const clean = new Map()
    for (const [name, cells] of Object.entries(saved || {})) {
      if (!Array.isArray(cells)) continue
      const list = []
      for (const cell of cells) {
        const q = Array.isArray(cell) ? cell[0] : cell?.q
        const r = Array.isArray(cell) ? cell[1] : cell?.r
        if (Number.isInteger(q) && Number.isInteger(r)) list.push({ q, r })
      }
      if (list.length) clean.set(String(name), list)
    }
    this.plotCells = clean
    this._placedHere = null
  }

  /**
   * Forget the layout, so the next roster lays every zone out afresh from the middle.
   *
   * The allocator's whole design is that a zone never moves once placed, and the cost of
   * that is holes: a repo that left frees its tiles, its neighbours stay where they are, and
   * the middle empties out over weeks. This is the one deliberate exception — asked for by a
   * button, never on its own — and it drops the memory of departed repos with it, which is
   * what lets the survivors close up. The caller re-applies the current roster straight
   * after, so the map is never seen empty.
   */
  compactLayout() {
    this.plotCells = new Map()
    this._placedHere = null
  }

  /** The same, on the way out. */
  layoutForSave() {
    const out = {}
    for (const [name, cells] of this.plotCells) out[name] = cells.map((c) => [c.q, c.r])
    return out
  }

  // ── dragging a zone (upstream 658cab1, 9c0fc54) ───────────────────────────────────────

  /** The zones actually on the map, name → cells — what a drag validates against. */
  visibleLayout() {
    const out = new Map()
    for (const [name, plot] of this.plots) out.set(name, plot.cells)
    return out
  }

  /**
   * The ground a drop is judged on beyond the other zones: this setting's arrival cell, which
   * the colony may wrap round, and every cell the setting refuses a plot — sea, slope, the
   * threshold. See `planMove` in `world/plot-move.js`.
   */
  dragGround() {
    return { ship: ceremonyCell(), blocked: this.blockedCells }
  }

  /**
   * Translate one zone's remembered footprint. Bookkeeping only: the caller re-runs the roster
   * pass, and the signature diff in `_syncPlots` tears the old plot down and raises it on the
   * new ground.
   */
  movePlot(name, dq, dr) {
    const cells = this.plotCells.get(name)
    if (!cells || (!dq && !dr)) return
    this.plotCells.set(name, translateCells(cells, dq, dr))
  }

  /**
   * Adopt a whole planned layout at once — a drag can slide the zones it stranded back into
   * contact, and that has to land in one write. Bookkeeping only, like `movePlot`.
   */
  applyLayout(layout) {
    if (!layout) return
    // Only the zones the plan moves. The rest are where they stand, which on a world that
    // kept a repo's memory elsewhere (`_keptLayout`) is not what `plotCells` remembers.
    const moved = new Map()
    for (const [name, cells] of layout) {
      const standing = this.plots.get(name)?.cells
      if (standing && standing.length === cells.length && standing.every((c, i) => c.q === cells[i].q && c.r === cells[i].r)) continue
      moved.set(name, cells)
    }
    if (!moved.size) return
    /**
     * A drop is the user's own placement, so it is remembered, even for a zone this world was
     * only holding (`_placedHere`). The ground under it may be remembered by a repo that is not
     * standing on it — one off the map, or one this world moved or had no room for — and two
     * repos remembering one cell is a collision on the next world with room. The other repo
     * forgets its ground and is dealt afresh when it next needs it.
     */
    const landed = new Set()
    for (const cells of moved.values()) for (const c of cells) landed.add(`${c.q},${c.r}`)
    for (const [name, cells] of [...this.plotCells]) {
      if (!moved.has(name) && cells.some((c) => landed.has(`${c.q},${c.r}`))) this.plotCells.delete(name)
    }
    for (const [name, cells] of moved) {
      this.plotCells.set(name, cells)
      this._placedHere?.cells.delete(name)
    }
  }

  /**
   * Cosmetic lift while a zone is being carried. Nothing consults it — the real move is a
   * rebuild on drop, and a cancelled drag sets it back to zero. Buildings ride along by
   * position, since they live in the world group rather than the plot's.
   *
   * Upstream also turns the carried zone see-through by writing `transparent` and `opacity` on
   * every material in the plot. Not here: this fork's decks and kerbs share kit materials across
   * every plot, and some carry the fade dither, so that write would ghost the whole village and
   * could not be undone to what it was. The ghost tiles under the cursor say where it will land.
   */
  setPlotLift(name, dy) {
    const plot = this.plots.get(name)
    if (!plot) return
    plot.group.position.y = dy
    if (plot.label) plot.label.position.y = 3.2 + dy
    const slot = this._liftSlot || (this._liftSlot = new THREE.Vector3())
    for (const entry of this.buildings.values()) {
      if (entry.plot !== name || entry.retiring) continue
      entry.mesh.position.y = plot.worldSlot(entry.slot, slot).y + dy
    }
  }

  setHoveredPlot(plot) {
    this.hoveredPlot = plot || null
  }

  /**
   * Names fade in for the plots that have something going on, and for whichever one you are
   * pointing at. Everywhere else the colony stays unlabelled.
   */
  _updateLabels(dt) {
    const show = this.uiVisible && this.settings.get('showLabels')
    for (const plot of this.plotOrder) {
      const label = plot.label
      if (!label) continue
      const wanted = show && (this.activePlots.has(plot.id) || this.hoveredPlot === plot) ? 1 : 0
      const next = THREE.MathUtils.damp(label.material.opacity, wanted, 9, dt)
      label.material.opacity = next
      label.visible = next > 0.01
    }
  }

  /**
   * Where the astronaut stands: just outside its building, facing in.
   *
   * `spin` turns that spot around the building without changing anything else about it —
   * still clear of the footprint, still pulled back onto its own plot, still on ground the
   * crew can actually walk to. It is how a thread's helpers share the building with it
   * rather than standing in it: the index cannot do that job, since it only ever has an
   * effect on a building sitting dead in the middle of its zone.
   *
   * Called only after `_rebuildNavigation`, so the grid it asks is the one this poll's
   * buildings actually make rather than the one the last poll left behind.
   */
  _workSite(plot, entry, index, spin = 0) {
    const b = entry.mesh.position
    // Outward from the *middle* of the zone rather than from its root tile: the root sits
    // on one edge of a grown blob, and standing spots measured from there all point the
    // same way instead of fanning around the buildings.
    const middle = plot.middle || plot.center
    const dx = b.x - middle.x
    const dz = b.z - middle.z
    const len = Math.hypot(dx, dz)
    // Buildings in the middle of a plot have no outward direction, so fan those out by index.
    const a = (len > 0.2 ? Math.atan2(dz, dx) : (index * 2.4) % (Math.PI * 2)) + spin
    // Clear of the building's *own* footprint rather than a fixed 2.35: a big habitat blocks
    // more ground than a small one, and a standing spot inside that radius is a spot the
    // crew can never actually reach — it walks at the wall for as long as the thread lives.
    const blocked = (entry.mesh.userData.footprint || 1.2) * 0.8 + AGENT_RADIUS
    const stand = Math.max(2.35, blocked + 0.5)
    let site = new THREE.Vector3(b.x + Math.cos(a) * stand, 0, b.z + Math.sin(a) * stand)
    // Outward points straight off the zone for a building on its edge, and an astronaut
    // standing in the neighbouring repo's yard reads as belonging to that repo. The inside
    // of its own plot is always the better answer when the outside is somebody else's.
    const onPlot = (v) => {
      const cell = worldToHex(v.x, v.z)
      return plot.cellKeys.has(`${cell.q},${cell.r}`)
    }
    if (!onPlot(site)) {
      const inward = new THREE.Vector3(b.x - Math.cos(a) * stand, 0, b.z - Math.sin(a) * stand)
      if (onPlot(inward)) site = inward
    }

    const nav = this.nav
    if (!nav || nav.isReachable(site.x, site.z)) return site

    /**
     * The spot is open ground the villager can never get to — a pocket between this building
     * and its neighbour, or the far side of a ring of them. Nudging it to the nearest *free*
     * cell, which is what this used to do, only moves it further into the pocket.
     *
     * So walk the ring instead: the same distance from the same building, a notch at a time to
     * either side, and take the first spot that is both reachable and on this repo's own ground.
     * A villager standing on the neighbour's yard reads as belonging to the neighbour, so that
     * preference is worth a whole walk round the ring before it is given up — but a reachable
     * spot anywhere beats a beautiful one nobody can reach.
     */
    let anywhere = null
    const spot = this._ringSpot || (this._ringSpot = new THREE.Vector3())
    for (const step of RING_STEPS) {
      const angle = a + step
      spot.set(b.x + Math.cos(angle) * stand, 0, b.z + Math.sin(angle) * stand)
      if (!nav.isReachable(spot.x, spot.z)) continue
      if (onPlot(spot)) return spot.clone()
      if (!anywhere) anywhere = spot.clone()
    }
    if (anywhere) return anywhere

    // The whole ring is walled off — a building ringed by its neighbours. Stand as close to it
    // as the walkable world allows, which is at least somewhere the villager can be. Scanned
    // from the *site* rather than from the building: the site carries the spin that fans a
    // thread's helpers apart, and scanning from the centre would land every one of them on the
    // same cell. `nearestFree` is still the backstop, because a spot inside a wall is worse
    // than a spot nobody can walk to.
    const free = nav.nearestReachable(site.x, site.z) || nav.nearestFree(site.x, site.z)
    if (free) site.set(nav.toWorld(free.ix), 0, nav.toWorld(free.iz))
    return site
  }

  // ── per-frame ───────────────────────────────────────────────────────────────────────

  update(dt, elapsed, focus) {
    this.elapsed = elapsed
    if (focus) this.sky.setFocus(focus)
    const cycled = this.sky.update(dt, elapsed, this.camera)
    if (cycled) this.settings.values.timeOfDay = this.sky.time

    const night = this.sky.nightFactor ?? 0
    buildingUniforms.uNight.value = night
    // One write turns every rotor in the colony.
    buildingUniforms.uTime.value = elapsed
    this.ceremony.update(dt, elapsed, night)

    this._growBuildings(dt)
    this.astronauts.update(dt, elapsed)
    this.astronauts.updateRings(elapsed)
    this.indicators.update(this.astronauts.agents, elapsed, (a) => this._badgeFor(a))
    this._emit(dt, elapsed)
    // The motes' own draws and the mote recipe's are all the motes stream's.
    if (this.features.motes) isolated(featureRng('motes'), () => this._emitMotes(dt, night))
    // The lamps and the night are for themes that light their own kerbs and want their weather
    // to keep hours: where the lit clutter is, and how dark it has got. The ground is for
    // upstream's weather, where things that live near the ground hug whatever is under them.
    // Each hook reads the arguments it declares and never sees the rest: the village's takes
    // the lamps and the night, and leaves the ground alone.
    const groundAt = this._surfaceAt || (this._surfaceAt = (x, z) => this.surfaceAt(x, z))
    this.fx.ambient(dt, this.camera, this.setting, this.lampSpots, night, groundAt)
    this.particles.update(dt)
    const f = this.features
    // The sea, the meadow and the wildlife each run where the theme has them; the floating
    // island runs wherever the world is one.
    if (f.water || f.grass || f.fauna || this.setting.shape === 'sky') isolated(featureRng('planet-frame'), () => this._updatePlanet(dt, elapsed, night, focus))
    this._updatePlots(night, elapsed)
    this._updateScaffolds()
    this._updateLabels(dt)
    if (f.visor) isolated(featureRng('visor'), () => this.reflections.update(dt, focus || this.sky.focus, this.camera))
  }

  /** The planet systems' frame: water, meadow, island, wildlife — each where its feature is. */
  _updatePlanet(dt, elapsed, night) {
    this.sea?.update(dt, elapsed, this.camera, night, this.sky.sunDir)
    this.grass?.update(dt, elapsed)
    if (this.island) {
      this.island.update(dt, elapsed, this.camera)
      this.island.setDaylight(this.sky.dayFactor ?? 1)
    }
    this.rock?.update(dt, elapsed)
    this.fauna?.update(
      dt,
      elapsed,
      this.camera,
      night,
      this._faunaHooks ||
        (this._faunaHooks = {
          ripple: (x, z, s) => this.ripple(x, z, s),
          sound: (name, x, y, z) => this.onSound?.(name, x, y, z),
        })
    )
  }

  _growBuildings(dt) {
    for (const [id, entry] of this.buildings) {
      // A running thread's site creeps upward while you watch it.
      if (!entry.retiring && this._isLive(id)) entry.target = Math.min(1, entry.target + LIVE_GROWTH * dt)
      const next = nextProgress(entry.progress, entry.target, dt)
      // Written whenever it moved, which is what the old floor was quietly preventing. A
      // building that has reached its target returns it unchanged, so a settled colony still
      // writes no uniforms.
      if (next !== entry.progress) {
        entry.progress = next
        entry.mesh.userData.setProgress(next)
      }
      if (entry.retiring && entry.progress <= 0.02) this._removeBuilding(id, entry)
    }
  }

  _isLive(id) {
    const thread = this.threads.get(id)
    return Boolean(thread && thread.state === 'active')
  }

  /** A site somebody is standing at: working, or stopped waiting on you. */
  _isActive(id) {
    const thread = this.threads.get(id)
    return Boolean(thread && (thread.state === 'active' || thread.unread || thread.hasError))
  }

  _badgeFor(agent) {
    if (agent.state === 'spawning') return BADGE.spawning
    if (agent.state === 'leaving') return BADGE.leaving
    // Badges only appear once an astronaut has actually reached its post — a stream of
    // symbols bobbing over a walking crowd is noise.
    if (agent.state !== 'at-site') return BADGE.none
    return BADGE_FOR[agent.status] ?? BADGE.none
  }

  /** Particle emission, driven by what each astronaut is doing. */
  _emit(dt, elapsed) {
    if (!this.particles.enabled) return
    const full = this.settings.get('particles') === 'full'

    for (const agent of this.astronauts.agents) {
      if (agent.scale < 0.5) continue
      // What this one is standing on, which on a plot is the deck rather than the terrain
      // under it. Everything thrown off an astronaut has to land back on the same surface.
      const ground = agent.groundY || 0

      // Sparks when the tool lands, once per swing, read off the work clip itself. Locomotion
      // wins over status in `_animate`, so an agent whose status is `working` but which is
      // pottering across its plot is playing a walk cycle — and a walk cycle has no downbeat
      // to throw sparks off. Gated on the clip the same way the state-gated props are, and
      // the phase is dropped whenever the swing is not running so the next real one fires
      // from a clean start rather than mid-stride.
      if (agent.state === 'at-site' && agent.status === 'working' && agent.clipKey === agent.workClip) {
        const phase = this.astronauts.clipPhase(agent)
        if (strikeCrossed(agent._strikePhase ?? -1, phase, this.astronauts.clipStrike(agent))) {
          // Where the tool is, which is an arm's length out and a chest's height up — both
          // measured on a full-grown villager, so both come in with the body. `fx.step` keeps
          // its own numbers: boot dust is thrown off the ground, not off the body.
          const reach = 0.55 * agent.size
          this.fx.work(
            agent.pos.x + Math.sin(agent.yaw) * reach,
            agent.pos.y + reach,
            agent.pos.z + Math.cos(agent.yaw) * reach,
            ground
          )
        }
        agent._strikePhase = phase
      } else {
        agent._strikePhase = -1
      }

      if (agent.state === 'at-site' && agent.status === 'celebrating' && agent.hop > 0.18 && !agent._cheered) {
        agent._cheered = true
        this.fx.cheer(agent.pos.x, agent.pos.y, agent.pos.z, ground)
      } else if (agent.hop < 0.05) {
        agent._cheered = false
      }

      if (agent.state === 'at-site' && agent.status === 'sleeping' && Math.random() < dt * 0.35) {
        this.fx.snooze(agent.pos.x + 0.2, agent.pos.y + 1.05, agent.pos.z + 0.15)
      }

      // Boot dust, on the footfall.
      if (full && (agent.walkAmp || 0) > 0.4) {
        const step = Math.sin(agent.phase)
        if (step < -0.9 && !agent._stepped) {
          agent._stepped = true
          this.fx.step(agent.pos.x, agent.pos.y, agent.pos.z, this._dustTint, ground)
        } else if (step > 0) {
          agent._stepped = false
        }
      }

      // The ramp notices anyone stepping on or off it.
      if (agent.state === 'spawning' || (agent.state === 'leaving' && agent.scale < 0.6)) {
        if (Math.random() < dt * 3) this.ceremony.ping()
      }
    }
  }

  _updatePlots(night, elapsed) {
    const urgent = this.urgentPlots
    for (const plot of this.plotOrder) plot.setNight(night, urgent?.has(plot.id) ?? false, elapsed)
  }

  _updateScaffolds() {
    const sites = []
    for (const [id, entry] of this.buildings) {
      // Scaffolding says a thread is running here — the README's own promise. It used to be
      // gated on the building being unfinished as well, which was fine while "unfinished"
      // was most of them and useless the moment buildings stopped standing in a hole.
      if (entry.progress <= 0.03) continue
      if (!this._isActive(id)) continue
      const p = entry.mesh.position
      sites.push({
        x: p.x,
        z: p.z,
        y: p.y,
        radius: (entry.mesh.userData.footprint || 1.4) + 0.35,
        height: Math.max(0.6, entry.mesh.userData.height * entry.progress + 0.5),
      })
    }
    this.scaffolds.update(sites)
  }

  // ── interaction ─────────────────────────────────────────────────────────────────────

  pick(ndcX, ndcY, aspect) {
    return this.astronauts.pick(this.camera, ndcX, ndcY, aspect)
  }

  agentFor(id) {
    return this.astronauts.byId.get(id)
  }

  setUiVisible(visible) {
    this.uiVisible = visible
    this._syncLabels()
  }

  _syncLabels() {
    // Visibility is per-label now; the group only ever hides everything at once.
    this.labelGroup.visible = true
  }

  dispose() {
    this.reflections?.dispose()
    this.fauna?.dispose()
    this.grass?.dispose()
    this.island?.dispose()
    this.rock?.dispose()
    this.sea?.dispose()
    this.sky.dispose()
    this.ceremony.dispose()
    this.astronauts.dispose()
    this.indicators.dispose()
    this.particles.dispose()
    this.scaffolds.dispose()
    disposeTree(this.worldGroup)
    disposeTree(this.plotGroup)
    disposeTree(this.labelGroup)
    this.scene.remove(this.worldGroup, this.plotGroup, this.labelGroup)
  }
}

function disposeTree(root) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return
    o.geometry?.dispose()
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
    else o.material?.dispose()
  })
}

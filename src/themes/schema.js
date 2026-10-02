/**
 * Manifest checks that run at theme load. Every failure names the field, so a broken theme
 * says "kits.base.file" rather than crashing three frames into the first render.
 */
import { crewCharacters } from '../agents/cast.js'
import { BIOMES, WORLD_IDS } from '../worlds/index.js'

/**
 * The kit names the engine hardcodes, and why. `buildings.js` composes every recipe out of
 * `base` and `setting.js` plants every scatter recipe out of `forest`, so a theme that ships
 * neither renders nothing — the contract is worth stating rather than discovering.
 */
export const REQUIRED_KITS = {
  base: 'the engine builds every building from the kit named "base"',
  forest: 'the engine plants every scatter recipe from the kit named "forest"',
}

/**
 * Walk a recipe's steps and check every `stage` it declares.
 *
 * A stage is the fraction of the thread's transcript progress a part waits for, so it has to
 * be a plain number in [0, 1] — the shader compares it against a uniform in that range and a
 * stage of 1.5 is simply a part that is never drawn. Branch steps (`if`) nest more steps, and
 * `ring`/`grid` carry their stage on the inner object, so all three are followed here. The
 * path in the message is the route back to the offending step: `parts[2.then.0]`.
 */
function checkStages(steps, errors, prefix, path = '') {
  if (!Array.isArray(steps)) return
  steps.forEach((step, i) => {
    if (!step || typeof step !== 'object') return
    const here = path ? `${path}.${i}` : `${i}`
    const inner = step.ring || step.grid
    // A ring's or grid's stage lives on the inner object; one written beside `ring:` on the
    // step is silently ignored by the interpreter, so it is an error here rather than a
    // part that never stages.
    if (inner && step.stage !== undefined)
      errors.push(`${prefix}.parts[${here}].stage: put stage inside the ring/grid object, not beside it`)
    const carrier = inner || step
    if (carrier && typeof carrier === 'object' && carrier.stage !== undefined) {
      const s = carrier.stage
      if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > 1)
        errors.push(`${prefix}.parts[${here}].stage: expected a number in [0, 1]`)
    }
    checkStages(step.then, errors, prefix, `${here}.then`)
    checkStages(step.else, errors, prefix, `${here}.else`)
  })
}

/**
 * Every field a *setting* preset carries, and the shape the engine reads it as. A nested
 * object is spelled out key by key: `fog.near` is a number the sky assigns straight to
 * `THREE.Fog`, and a setting that omits it renders a fog plane at `undefined`.
 *
 * `blurb` and `companion.name` are HUD garnish with a fallback and are deliberately absent.
 */
const SETTING_SHAPE = {
  id: 'string',
  name: 'string',
  ground: { low: 'number', high: 'number', tint: 'number' },
  rock: 'number',
  horizon: 'number',
  sky: { top: 'number', bottom: 'number' },
  fog: { color: 'number', near: 'number', far: 'number' },
  sun: { color: 'number', intensity: 'number', night: 'number' },
  ambient: { sky: 'number', ground: 'number', intensity: 'number' },
  atmosphere: 'number',
  craters: 'number',
  roughness: 'number',
  scatter: 'string',
  companion: { color: 'number', size: 'number', glow: 'number' },
  dust: 'number',
}

/**
 * The optional ring of dressing a setting plants past its plots. `recipe` names one of the
 * theme's own `scatter` recipes, `inner`/`outer` are the annulus in world units and `count`
 * the instances at full density — all four are read as numbers straight into the placement
 * loop, so an absent one is a `NaN` radius and a ring that plants nothing.
 */
const RIM_SHAPE = { recipe: 'string', inner: 'number', outer: 'number', count: 'number' }

/**
 * The optional bank down one side of a setting, the land running down into its sea. `axis` is
 * a unit vector in the ground plane and `from` how far along it the coast lies, so the wet half
 * is `x·ax + z·az > from` — a straight shoreline across the picture rather than a ring — and
 * `depth` is how far the ground drops over the bank. The sea itself is the setting's `water`,
 * which a coast needs for its level. Every field is read straight into the terrain sampler, so
 * a missing one is a `NaN` height across half the map rather than a visible mistake — hence
 * the field-by-field check, and `from` and `depth` held finite as well as numeric, because a
 * `NaN` arrives from arithmetic rather than from a typo and `typeof` never catches it.
 */
const COAST_SHAPE = { axis: 'array', from: 'number', depth: 'number' }

/**
 * What a coast may carry on top of that, and what each one costs if it is malformed rather than
 * absent. Every one of these is optional — a coast that omits the lot gets the straight,
 * unpainted bank the engine has always drawn — so they are held against their shapes only
 * when they are present, key by key, rather than being folded into `COAST_SHAPE` where a
 * missing one would be an error.
 *
 * `sand` is the colour blended into the terrain across the beach band. `wobble` bends the
 * shoreline: `amp` in world units, `scale` the frequency the bend is drawn at. Both halves of
 * `wobble` are load-bearing and neither has a default — an `amp` with no `scale` is
 * `fbm(noise, NaN)`, which is a `NaN` waterline across the whole map and a terrain of holes,
 * so a half-written wobble is caught here. `bed` deepens the sea bed under the water by that
 * factor (see `shapeValley`), so it is held finite and at least 1: under 1 it would *raise* the
 * bed toward the surface, and at 0 it would lay the whole sea floor flat on the waterline.
 */
const COAST_EXTRAS = { sand: 'number', wobble: { amp: 'number', scale: 'number' }, bed: 'number' }

/**
 * The optional mountain wall opposite the sea. Same `axis`/`from` half-plane as the coast,
 * pointing the other way: the terrain climbs `height` over the `width` past `from`. That much
 * is the world's.
 *
 * A setting may carry one of these or a non-empty array of them — a range across the top of the
 * frame and another closing a corner are two half-planes, and they add. Each entry is held
 * against this shape in turn, so a list of two with one bad `axis` names which of the two.
 */
const RIDGE_SHAPE = { axis: 'array', from: 'number', width: 'number', height: 'number' }

/**
 * The crags standing on a ridge, which the theme's dressing adds to it: `recipe` names one of
 * the theme's own `scatter` recipes — checked against the manifest like the rim's, because a
 * name that is not there is a wall with nothing on it and no error anywhere — and `count` is
 * how many. Optional on a setting, since a theme may dress a world's ridge with nothing; but
 * the two come together, because a recipe with no count plants `NaN` crags.
 */
const CRAG_SHAPE = { recipe: 'string', count: 'number' }

/**
 * Upstream's sea (merged 2026-09-24 from d05ac2f), the one shape `water` takes: a level
 * and three colours, with the terrain deciding where it is wet — lakes in crater bowls, a coast
 * past a line, an island's shelf, and the valley's sea behind its `coast`: every `water` has
 * this shape, whatever land runs down into it. Everything else his
 * `water.js` reads (`waveHeight`, `sparkle`, `speed`, `opacity`, `glow`, `waveScale`) has a
 * default there, so only these are required.
 */
const PLANET_WATER_SHAPE = { level: 'number', shallow: 'number', deep: 'number', foam: 'number' }

/** How a world bends its height field; see `groundHeight` in `setting.js`. */
const SHAPES = ['plain', 'island', 'coast', 'dunes', 'sky']

/** How a theme lays out its kerb props, when it says (`plots.yard`); see `Plot` in `plots.js`. */
const YARDS = ['reserved']

/** Where a scatter entry may stand, against the water level and the shore band. */
const ZONES = ['land', 'shore', 'water']

/**
 * The one field `checkShape` cannot finish on its own. A two-component ground-plane vector:
 * a third component, a string, or a `null` in it is a `NaN` signed distance everywhere,
 * which is a world with no coast at all and no complaint from anything.
 */
function checkAxis(value, at, errors) {
  // A non-array has already been reported by `checkShape`; say it once.
  if (!Array.isArray(value)) return
  if (value.length !== 2 || !value.every((n) => typeof n === 'number' && Number.isFinite(n)))
    errors.push(`${at}: expected two finite numbers`)
  // The terrain uses the raw dot product, so a vector of length 3 silently triples `from`
  // and `width`, and `[0, 0]` is a coast that never arrives. Neither is normalised for the
  // author: the numbers in the manifest are the numbers on the ground.
  else if (Math.abs(Math.hypot(value[0], value[1]) - 1) > 1e-3) errors.push(`${at}: expected a unit vector`)
}

/**
 * Hold one object against a shape, naming the full path of anything missing or of the wrong
 * type. Nested shapes recurse, so a bad `ground.low` is reported as `ground.low` rather than
 * as a vague complaint about `ground`.
 *
 * @param {object} obj
 * @param {Record<string, string | object>} shape
 * @param {string} path   what to prefix every message with
 * @param {string[]} errors
 */
function checkShape(obj, shape, path, errors) {
  for (const [key, want] of Object.entries(shape)) {
    const at = `${path}.${key}`
    const value = obj?.[key]
    if (value === undefined || value === null) {
      errors.push(`${at}: missing`)
      continue
    }
    if (want === 'array') {
      if (!Array.isArray(value)) errors.push(`${at}: expected an array`)
    } else if (typeof want === 'string') {
      if (typeof value !== want) errors.push(`${at}: expected a ${want}`)
    } else if (typeof value !== 'object') {
      errors.push(`${at}: expected an object`)
    } else {
      checkShape(value, want, at, errors)
    }
  }
}

/** A scatter recipe name, held against the theme's own recipes. */
function checkRecipe(name, m, at, errors) {
  if (typeof name !== 'string') errors.push(`${at}: expected a string`)
  else if (m?.scatter && !m.scatter[name]) errors.push(`${at}: no recipe named "${name}"`)
}

/**
 * Which named atlas a setting wears. `setKitAtlas` falls back to a kit's first declared atlas
 * for a name it does not know, so an unknown name is a season that silently renders as another
 * one — an error here rather than a puzzle on screen.
 */
function checkAtlas(atlas, m, at, errors) {
  const declaring = Object.entries(m?.kits || {}).filter(([, k]) => k?.atlases && typeof k.atlases === 'object')
  if (!declaring.length) errors.push(`${at}: no kit declares atlases`)
  else for (const [kname, k] of declaring) if (!(atlas in k.atlases)) errors.push(`${at}: "${atlas}" is not an atlas of kit "${kname}"`)
}

/** The dressed ring past the plots. Its recipe must exist like `scatter`'s. */
function checkRim(rim, m, at, errors) {
  if (!rim || typeof rim !== 'object') errors.push(`${at}: expected an object`)
  else {
    checkShape(rim, RIM_SHAPE, at, errors)
    if (typeof rim.recipe === 'string' && m?.scatter && !m.scatter[rim.recipe]) errors.push(`${at}.recipe: no recipe named "${rim.recipe}"`)
  }
}

/** How a recipe may fall back when its kit has not loaded; see `SCATTER_STYLE` in `setting.js`. */
const KIT_FALLBACKS = ['whole', 'filter']

/**
 * The style a setting's scatter is planted in (`SCATTER_STYLE` in `setting.js`), on a dressing
 * entry or a resolved setting. Every key is optional, since absent is the village's own, and
 * each is held to its shape only when present: all of them go straight into the placement
 * loop, where a `NaN` budget plants nothing and says nothing, and a `flora` that names no
 * recipe is a world planted as rocks.
 */
function checkScatterStyle(e, at, errors) {
  if (e.budget !== undefined && !(typeof e.budget === 'number' && Number.isFinite(e.budget) && e.budget >= 0))
    errors.push(`${at}.budget: expected a finite number, not negative`)
  if (e.spread !== undefined && e.spread !== 'sqrt' && !(typeof e.spread === 'number' && Number.isFinite(e.spread) && e.spread > 0))
    errors.push(`${at}.spread: expected 'sqrt' or a finite number above 0`)
  if (e.groves !== undefined && typeof e.groves !== 'boolean') errors.push(`${at}.groves: expected a boolean`)
  if (e.retries !== undefined && !(typeof e.retries === 'number' && Number.isFinite(e.retries) && e.retries >= 1))
    errors.push(`${at}.retries: expected a finite number, at least 1`)
  if (e.kitFallback !== undefined && !KIT_FALLBACKS.includes(e.kitFallback))
    errors.push(`${at}.kitFallback: expected one of ${KIT_FALLBACKS.join(', ')}`)
  if (e.flora !== undefined) {
    const f = e.flora
    const keys = f && typeof f === 'object' && !Array.isArray(f) ? Object.keys(f) : null
    if (!keys || keys.length !== 1 || !['is', 'not'].includes(keys[0]) || typeof f[keys[0]] !== 'string')
      errors.push(`${at}.flora: expected {is: recipe} or {not: recipe}`)
  }
}

/**
 * Which arrival a setting uses, and where it stands. Both halves are optional in turn — a
 * setting may move the theme's default ceremony without naming it.
 */
function checkCeremony(c, m, at, errors) {
  if (!c || typeof c !== 'object') {
    errors.push(`${at}: expected an object`)
    return
  }
  if (c.kind !== undefined) {
    // The kinds are the theme's own, because the hook that builds them is code the validator
    // cannot read: a theme lists what it can build in `ceremonies`, and a setting naming
    // anything else is a village with no way in.
    if (typeof c.kind !== 'string') errors.push(`${at}.kind: expected a string`)
    else if (!Array.isArray(m?.ceremonies) || !m.ceremonies.length) errors.push(`${at}.kind: the theme declares no ceremonies`)
    else if (!m.ceremonies.includes(c.kind)) errors.push(`${at}.kind: "${c.kind}" is not in ceremonies`)
  }
  // The lattice cell it stands on, overriding `plots.ceremonyCell`. Axial integers: a
  // fractional q or r rounds to a different cell in `worldToHex` than the one it was placed
  // at, which puts the arrival's own ground on somebody else's plot.
  if (c.cell !== undefined && !(Number.isInteger(c.cell?.q) && Number.isInteger(c.cell?.r))) errors.push(`${at}.cell: expected {q, r}`)
  // A size the theme builds this kind in (`ceremonySizes`); a kind left out is the theme's
  // first. A kind with no sizes, such as a boat, takes none.
  if (c.size !== undefined) {
    const kind = c.kind ?? m?.ceremonies?.[0]
    const sizes = m?.ceremonySizes?.[kind]
    if (typeof c.size !== 'string') errors.push(`${at}.size: expected a name`)
    else if (!Array.isArray(sizes)) errors.push(`${at}.size: "${kind}" comes in no sizes`)
    else if (!sizes.includes(c.size)) errors.push(`${at}.size: "${c.size}" is not a size of ${kind}`)
  }
  // How far a boat's pier runs out and where it berths, overriding the builder's own numbers.
  for (const key of ['pierOut', 'berth'])
    if (c[key] !== undefined && !(typeof c[key] === 'number' && Number.isFinite(c[key]) && c[key] > 0))
      errors.push(`${at}.${key}: expected a finite number above 0`)
}

/**
 * The land and the look a setting or a world carries beyond `SETTING_SHAPE`: its sea, its
 * ridges, its hills and upstream's landform fields. Every one is optional and held to its
 * shape only when present. `eachRidge(ridge, at)` runs on every wall once its own shape has
 * been checked, which is where a setting checks the crags on it and a world refuses them.
 */
function checkLand(s, at, errors, eachRidge) {
  // Optional: the bank down one side of the setting, which a sea lies behind.
  if (s.coast !== undefined) {
    const coast = s.coast
    if (!coast || typeof coast !== 'object' || Array.isArray(coast)) errors.push(`${at}.coast: expected an object`)
    else {
      checkShape(coast, COAST_SHAPE, `${at}.coast`, errors)
      checkAxis(coast.axis, `${at}.coast.axis`, errors)
      for (const key of ['from', 'depth'])
        if (typeof coast[key] === 'number' && !Number.isFinite(coast[key])) errors.push(`${at}.coast.${key}: expected a finite number`)
      // The optional half: each extra held against its own shape only when it is there.
      for (const [key, want] of Object.entries(COAST_EXTRAS)) if (coast[key] !== undefined) checkShape(coast, { [key]: want }, `${at}.coast`, errors)
      if (typeof coast.bed === 'number' && !(Number.isFinite(coast.bed) && coast.bed >= 1))
        errors.push(`${at}.coast.bed: expected a finite number of at least 1`)
      // The bank runs down into the sea, and the sea is where its level comes from.
      if (s.water === undefined) errors.push(`${at}.coast: needs a \`water\` for the sea's level`)
      // Upstream's `shape: 'coast'` sinks the land past its own shoreline; the two do not stack.
      if (s.shape === 'coast') errors.push(`${at}.coast: a world with \`shape: 'coast'\` has its coast already`)
    }
  }
  // Optional: the sea, upstream's level-and-colours water on every world, the valley's behind
  // its `coast` included. The half-plane lives on the `coast`, so a `water` still carrying an
  // `axis` is a setting written for the old shape, and would draw no bank at all.
  if (s.water !== undefined) {
    if (!s.water || typeof s.water !== 'object') errors.push(`${at}.water: expected an object`)
    else {
      if (s.water.axis !== undefined) errors.push(`${at}.water.axis: the half-plane is the setting's \`coast\`, not its \`water\``)
      checkShape(s.water, PLANET_WATER_SHAPE, `${at}.water`, errors)
    }
  }
  // Optional: the mountain wall opposite it, or a list of walls. A lone object keeps the path
  // it always had — `settings[0].ridge.from` — so a setting with one wall reads the same
  // message it did before lists were allowed.
  if (s.ridge !== undefined) {
    if (!s.ridge || typeof s.ridge !== 'object') errors.push(`${at}.ridge: expected an object or an array of them`)
    else if (Array.isArray(s.ridge) && !s.ridge.length) errors.push(`${at}.ridge: expected a non-empty array`)
    else {
      const list = Array.isArray(s.ridge) ? s.ridge : [s.ridge]
      list.forEach((ridge, j) => {
        const here = Array.isArray(s.ridge) ? `${at}.ridge[${j}]` : `${at}.ridge`
        if (!ridge || typeof ridge !== 'object' || Array.isArray(ridge)) {
          errors.push(`${here}: expected an object`)
          return
        }
        checkShape(ridge, RIDGE_SHAPE, here, errors)
        checkAxis(ridge.axis, `${here}.axis`, errors)
        eachRidge(ridge, here)
      })
    }
  }
  // Optional: how hard the far-field hills are driven, as a multiplier on the term that ramps
  // in past the plots. Absent is 1, which is the ground every setting had before it existed.
  //
  // Finite and above zero, not merely a number. `NaN` is a `NaN` height over everything
  // outside the colony — terrain full of holes, scatter at `NaN`, a navigation grid that
  // answers no question correctly — and it arrives from arithmetic rather than from a typo,
  // so `typeof` never catches it. Zero flattens the far field to a table and a negative one
  // turns every hill into a pit, which is a world nobody meant to author.
  if (s.hills !== undefined && !(typeof s.hills === 'number' && Number.isFinite(s.hills) && s.hills > 0))
    errors.push(`${at}.hills: expected a finite number above 0`)
  // Optional: where the far-field hills start and finish ramping in, and the height the colony
  // floor is held up to. Each goes straight into the height field, so each is finite; a ramp
  // that ends where it starts is no ramp but a step, a cliff at `from`, and a floor at or above
  // zero lifts the flat middle the plots stand on rather than filling its hollows.
  if (s.clearing !== undefined) {
    const c = s.clearing
    if (!c || typeof c !== 'object' || Array.isArray(c)) errors.push(`${at}.clearing: expected an object`)
    else {
      for (const key of ['from', 'to', 'floor'])
        if (!(typeof c[key] === 'number' && Number.isFinite(c[key]))) errors.push(`${at}.clearing.${key}: expected a finite number`)
      if (Number.isFinite(c.from) && !(c.from > 0)) errors.push(`${at}.clearing.from: expected a number above 0`)
      if (Number.isFinite(c.from) && Number.isFinite(c.to) && !(c.to > c.from)) errors.push(`${at}.clearing.to: expected a number above from`)
      if (Number.isFinite(c.floor) && !(c.floor < 0)) errors.push(`${at}.clearing.floor: expected a number below 0`)
    }
  }
  // Optional: water that sits in the hollows. The terrain folds the far field above the level
  // and digs every crater down to it, so it needs a `water` to read the level from — without
  // one, the first crater is a `NaN` bowl.
  if (s.lakes !== undefined) {
    if (typeof s.lakes !== 'boolean') errors.push(`${at}.lakes: expected a boolean`)
    else if (s.lakes && typeof s.water?.level !== 'number') errors.push(`${at}.lakes: needs a water level to dig the lakes down to`)
  }
  // Optional: how hard the far field darkens, and between which fractions of the colony radius
  // and the ground. Absent is the village's own; each number goes straight into the colour, so
  // each is finite — a `NaN` there is a far field of `NaN` colour, which no `typeof` catches.
  if (s.farShade !== undefined) {
    checkShape(s, { farShade: { from: 'number', to: 'number', amount: 'number' } }, at, errors)
    for (const key of ['from', 'to', 'amount']) {
      const n = s.farShade?.[key]
      if (typeof n === 'number' && !Number.isFinite(n)) errors.push(`${at}.farShade.${key}: expected a finite number`)
    }
  }
  // Upstream's landform fields (merged 2026-09-24). Each is optional and held to its shape
  // only when present; the ones read straight into arithmetic are the ones checked. An island
  // or a coast sinks the land past its shore into a sea bed, and the sea over it is the
  // `water`: without one the colony stands in a dry pit.
  if (s.shape !== undefined && !SHAPES.includes(s.shape)) errors.push(`${at}.shape: expected one of ${SHAPES.join(', ')}`)
  else if ((s.shape === 'island' || s.shape === 'coast') && s.water === undefined) errors.push(`${at}.shape: '${s.shape}' needs a water to fill its sea`)
  if (s.shore !== undefined) checkShape(s, { shore: { color: 'number', band: 'number' } }, at, errors)
  if (s.clouds !== undefined) checkShape(s, { clouds: { amount: 'number', color: 'number', speed: 'number' } }, at, errors)
  if (s.grade !== undefined) checkShape(s, { grade: { saturation: 'number', warmth: 'number' } }, at, errors)
  if (s.weather !== undefined && !(Array.isArray(s.weather) && s.weather.every((w) => typeof w?.kind === 'string' && typeof w?.rate === 'number')))
    errors.push(`${at}.weather: expected an array of {kind, rate}`)
  for (const key of ['fauna', 'audio', 'grass', 'skyIsland'])
    if (s[key] !== undefined && (!s[key] || typeof s[key] !== 'object' || Array.isArray(s[key]))) errors.push(`${at}.${key}: expected an object`)
}

/**
 * One setting — a world wearing the theme's dressing, as the engine reads it — held against
 * the theme it belongs to. `validateManifest` runs this on every entry of `settings`.
 *
 * @param {object} s
 * @param {object} m     the theme's manifest: its recipes, kits and ceremonies
 * @param {string} [at]  what to prefix every message with
 * @returns {string[]}
 */
export function validateSetting(s, m, at = 'setting') {
  if (!s || typeof s !== 'object') return [`${at}: expected an object`]
  const errors = []
  checkShape(s, SETTING_SHAPE, at, errors)
  if (m?.scatter && s.scatter && !m.scatter[s.scatter]) errors.push(`${at}.scatter: no recipe named "${s.scatter}"`)
  checkScatterStyle(s, at, errors)
  if (s.atlas !== undefined) checkAtlas(s.atlas, m, `${at}.atlas`, errors)
  if (s.rim !== undefined) checkRim(s.rim, m, `${at}.rim`, errors)
  if (s.ceremony !== undefined) checkCeremony(s.ceremony, m, `${at}.ceremony`, errors)
  // The crags on a ridge are the dressing's, so a theme that dresses a world's ridge with
  // nothing leaves both off; either one present asks for the other.
  checkLand(s, at, errors, (ridge, here) => {
    if (ridge.recipe === undefined && ridge.count === undefined) return
    checkShape(ridge, CRAG_SHAPE, here, errors)
    if (typeof ridge.recipe === 'string' && m?.scatter && !m.scatter[ridge.recipe]) errors.push(`${here}.recipe: no recipe named "${ridge.recipe}"`)
  })
  if (s.buildingTint !== undefined && typeof s.buildingTint !== 'number') errors.push(`${at}.buildingTint: expected a number`)
  return errors
}

/**
 * What a theme's dressing may say about a world. The resolver places the same keys
 * (`src/worlds/resolve.js`); anything else in a dressing is a typo that would dress nothing.
 */
const DRESSING_KEYS = [
  'scatter',
  'budget',
  'spread',
  'groves',
  'retries',
  'kitFallback',
  'flora',
  'rim',
  'ridges',
  'atlas',
  'buildingTint',
  'ceremony',
  'drones',
]

/** A world's own required fields: a setting's, less the scatter recipe the dressing names. */
const WORLD_SHAPE = Object.fromEntries(Object.entries(SETTING_SHAPE).filter(([key]) => key !== 'scatter'))

/**
 * A world from the library (`src/worlds/`): everything a setting carries except what a theme
 * dresses it with, plus the `biome` a dressing can address it by. A world carrying a dressed
 * key is an error, because the resolver would pass it through as the world's and the theme
 * could not dress it.
 *
 * @param {object} w
 * @param {string} [at]  what to prefix every message with
 * @returns {string[]}
 */
export function validateWorld(w, at = `worlds.${w?.id}`) {
  if (!w || typeof w !== 'object') return [`${at}: expected an object`]
  const errors = []
  checkShape(w, WORLD_SHAPE, at, errors)
  if (!BIOMES.includes(w.biome)) errors.push(`${at}.biome: expected one of ${BIOMES.join(', ')}`)
  for (const key of DRESSING_KEYS) if (w[key] !== undefined) errors.push(`${at}.${key}: belongs to a theme's dressing, not to the world`)
  if (w.fauna?.drones !== undefined) errors.push(`${at}.fauna.drones: belongs to a theme's dressing, not to the world`)
  checkLand(w, at, errors, (ridge, here) => {
    for (const key of Object.keys(CRAG_SHAPE)) if (ridge[key] !== undefined) errors.push(`${here}.${key}: the crags on a ridge are the dressing's \`ridges\``)
  })
  // Where a dressed key lands in the setting, when not where the resolver would put it. Only
  // a key of the world's own can be named, so no two dressed keys can wait on each other.
  if (w.dressedAfter !== undefined) {
    if (!w.dressedAfter || typeof w.dressedAfter !== 'object' || Array.isArray(w.dressedAfter)) errors.push(`${at}.dressedAfter: expected an object`)
    else
      for (const [key, anchor] of Object.entries(w.dressedAfter)) {
        if (!DRESSING_KEYS.includes(key)) errors.push(`${at}.dressedAfter.${key}: not a dressed key`)
        if (typeof anchor !== 'string' || !Object.hasOwn(w, anchor) || anchor === 'dressedAfter' || anchor === 'biome')
          errors.push(`${at}.dressedAfter.${key}: expected the name of one of the world's own keys`)
      }
  }
  return errors
}

/**
 * A theme's dressing: `{ worlds, biomes, default }`, each entry saying what the theme plants on
 * a world and flies over it. `worlds` is keyed by library ids and `biomes` by biome names, so
 * an entry for a world or a biome that does not exist — one that would never be read — is
 * named.
 *
 * @param {object} d
 * @param {object} m     the theme's manifest: its recipes, kits and ceremonies
 * @param {string} [at]  what to prefix every message with
 * @returns {string[]}
 */
export function validateDressing(d, m, at = 'dressing') {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return [`${at}: expected {worlds, biomes, default}`]
  const errors = []
  const entry = (e, here) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      errors.push(`${here}: expected an object`)
      return
    }
    for (const key of Object.keys(e)) if (!DRESSING_KEYS.includes(key)) errors.push(`${here}.${key}: not something a dressing sets`)
    if (e.scatter !== undefined) checkRecipe(e.scatter, m, `${here}.scatter`, errors)
    checkScatterStyle(e, here, errors)
    // `rim: null` takes an inherited rim away (the resolver leaves the key out), which is how a
    // world with no ground past its plots — a floating island — says it has none.
    if (e.rim !== undefined && e.rim !== null) checkRim(e.rim, m, `${here}.rim`, errors)
    if (e.ridges !== undefined) {
      if (!Array.isArray(e.ridges) || !e.ridges.length) errors.push(`${here}.ridges: expected a non-empty array of {recipe, count}`)
      else
        e.ridges.forEach((r, j) => {
          checkShape(r, CRAG_SHAPE, `${here}.ridges[${j}]`, errors)
          if (typeof r?.recipe === 'string' && m?.scatter && !m.scatter[r.recipe]) errors.push(`${here}.ridges[${j}].recipe: no recipe named "${r.recipe}"`)
        })
    }
    if (e.atlas !== undefined) checkAtlas(e.atlas, m, `${here}.atlas`, errors)
    if (e.buildingTint !== undefined && typeof e.buildingTint !== 'number') errors.push(`${here}.buildingTint: expected a number`)
    if (e.ceremony !== undefined) checkCeremony(e.ceremony, m, `${here}.ceremony`, errors)
    if (e.drones !== undefined && !(e.drones && typeof e.drones === 'object' && (e.drones.count === undefined || typeof e.drones.count === 'number')))
      errors.push(`${here}.drones: expected {count}`)
  }
  for (const [part, names, what] of [
    ['worlds', WORLD_IDS, 'a world in src/worlds'],
    ['biomes', BIOMES, 'a biome'],
  ]) {
    const block = d[part]
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      errors.push(`${at}.${part}: expected an object`)
      continue
    }
    for (const [key, e] of Object.entries(block)) {
      if (!names.includes(key)) errors.push(`${at}.${part}.${key}: not ${what}`)
      entry(e, `${at}.${part}.${key}`)
    }
  }
  entry(d.default, `${at}.default`)
  return errors
}

/**
 * @param {object} m          the theme's manifest
 * @param {object} [features] the theme's `features` block, as declared (`src/core/features.js`);
 *                            what a feature makes required is checked only when it is given
 * @returns {string[]} every failure, each naming its field
 */
export function validateManifest(m, features) {
  const errors = []
  if (!m || typeof m !== 'object') return ['manifest: not an object']

  if (!Array.isArray(m.settings) || !m.settings.length) errors.push('settings: expected a non-empty array')
  else m.settings.forEach((s, i) => errors.push(...validateSetting(s, m, `settings[${i}]`)))

  if (m.worlds !== undefined) {
    if (!Array.isArray(m.worlds) || !m.worlds.length) errors.push('worlds: expected a non-empty array of world ids')
    else
      m.worlds.forEach((id, i) => {
        if (!WORLD_IDS.includes(id)) errors.push(`worlds[${i}]: "${id}" is not a world in src/worlds`)
        else if (m.worlds.indexOf(id) !== i) errors.push(`worlds[${i}]: "${id}" is listed twice`)
      })
  }
  // Optional: what a stored world the theme does not list opens on. It has to be one it lists,
  // or the fallback would itself fall back.
  if (m.defaultWorld !== undefined) {
    if (typeof m.defaultWorld !== 'string') errors.push('defaultWorld: expected a world id')
    else if (!(Array.isArray(m.settings) && m.settings.some((s) => s?.id === m.defaultWorld)))
      errors.push(`defaultWorld: "${m.defaultWorld}" is not a world this theme lists`)
  }
  // Optional: the worlds the settings picker shows. Every listed world stays built; this only
  // decides which ones a person can pick. The default has to be on it, or a hidden world's
  // fallback would itself be hidden.
  if (m.menu !== undefined) {
    if (!Array.isArray(m.menu) || !m.menu.length) errors.push('menu: expected a non-empty array of world ids')
    else {
      const listed = Array.isArray(m.settings) ? m.settings.map((s) => s?.id) : []
      m.menu.forEach((id, i) => {
        if (!listed.includes(id)) errors.push(`menu[${i}]: "${id}" is not a world this theme lists`)
        else if (m.menu.indexOf(id) !== i) errors.push(`menu[${i}]: "${id}" is listed twice`)
      })
      // A default the theme does not list is `defaultWorld`'s own error, said once above.
      if (listed.includes(m.defaultWorld) && !m.menu.includes(m.defaultWorld)) errors.push(`menu: defaultWorld "${m.defaultWorld}" is not on it`)
    }
  }
  if (m.dressing !== undefined) errors.push(...validateDressing(m.dressing, m))

  if (!m.scatter || typeof m.scatter !== 'object') errors.push('scatter: expected an object of recipes')
  else
    for (const [name, list] of Object.entries(m.scatter)) {
      if (!Array.isArray(list)) {
        errors.push(`scatter.${name}: expected an array`)
        continue
      }
      // Which kit an entry is planted from (the forest kit when absent) and which ground it
      // may stand on. Both optional; a kit that is not declared is a part that never loads.
      list.forEach((r, j) => {
        if (r?.kit !== undefined && !(typeof r.kit === 'string' && Object.hasOwn(m.kits || {}, r.kit)))
          errors.push(`scatter.${name}[${j}].kit: "${r.kit}" is not a kit this theme declares`)
        if (r?.zone !== undefined && !ZONES.includes(r.zone)) errors.push(`scatter.${name}[${j}].zone: expected one of ${ZONES.join(', ')}`)
      })
    }

  // Optional: the arrivals this theme's `ceremony` hook can build, by the name a setting asks
  // for. A theme that omits it has one fixed ceremony, which is what the space colony is.
  if (m.ceremonies !== undefined) {
    if (!Array.isArray(m.ceremonies) || !m.ceremonies.length) errors.push('ceremonies: expected a non-empty array')
    else
      m.ceremonies.forEach((k, i) => {
        if (typeof k !== 'string' || !k) errors.push(`ceremonies[${i}]: expected a name`)
      })
  }
  // Optional: the sizes a kind comes in, by kind, each a non-empty list of names.
  if (m.ceremonySizes !== undefined) {
    if (!m.ceremonySizes || typeof m.ceremonySizes !== 'object' || Array.isArray(m.ceremonySizes)) errors.push('ceremonySizes: expected an object')
    else
      for (const [kind, sizes] of Object.entries(m.ceremonySizes)) {
        if (!Array.isArray(m.ceremonies) || !m.ceremonies.includes(kind)) errors.push(`ceremonySizes.${kind}: "${kind}" is not in ceremonies`)
        if (!Array.isArray(sizes) || !sizes.length || sizes.some((s) => typeof s !== 'string' || !s))
          errors.push(`ceremonySizes.${kind}: expected a non-empty array of names`)
      }
  }

  if (!m.kits || typeof m.kits !== 'object' || !Object.keys(m.kits).length) errors.push('kits: expected at least one kit')
  else {
    for (const [name, why] of Object.entries(REQUIRED_KITS)) if (!m.kits[name]) errors.push(`kits.${name}: missing — ${why}`)
    for (const [name, kit] of Object.entries(m.kits)) {
      if (typeof kit.file !== 'string') errors.push(`kits.${name}.file: missing`)
      // Whether `loadKit()` leaves this one alone at boot for `loadLazyKit` to fetch on
      // demand. Optional and off by default, so every kit any theme has ever declared still
      // loads with the rest. A non-boolean is truthy far more often than not — `lazy: 'no'`
      // is a kit that never loads — so the type is held here rather than coerced.
      if (kit.lazy !== undefined && typeof kit.lazy !== 'boolean') errors.push(`kits.${name}.lazy: expected a boolean`)
      // A kit painted with vertex colours rather than an atlas (the space theme's nature kit).
      if (kit.vertexColors !== undefined && typeof kit.vertexColors !== 'boolean') errors.push(`kits.${name}.vertexColors: expected a boolean`)
      if (!kit.atlas || !Number.isInteger(kit.atlas.cols) || !Number.isInteger(kit.atlas.rows))
        errors.push(`kits.${name}.atlas: expected {cols, rows}`)
      if (!kit.cells || typeof kit.cells !== 'object') errors.push(`kits.${name}.cells: expected an object`)
      if (!kit.pbr || typeof kit.pbr !== 'object') errors.push(`kits.${name}.pbr: expected an object`)
      // How hard those cells come up after dark. Optional: a kit that says nothing keeps
      // the engine's own 1.15, which is what the space theme has always computed.
      if (kit.accentGlow !== undefined && typeof kit.accentGlow !== 'number')
        errors.push(`kits.${name}.accentGlow: expected a number`)
      if (!Array.isArray(kit.accentCells)) errors.push(`kits.${name}.accentCells: expected an array`)
      else for (const c of kit.accentCells) if (!(c in (kit.cells || {}))) errors.push(`kits.${name}.accentCells: "${c}" is not a named cell`)
      // Seasonal atlases: a name the theme swaps by, and the glTF image it names. The
      // validator holds the image names against the built glb; here it is only the shape.
      if (kit.atlases !== undefined) {
        if (!kit.atlases || typeof kit.atlases !== 'object' || !Object.keys(kit.atlases).length)
          errors.push(`kits.${name}.atlases: expected an object of image names`)
        else
          for (const [season, img] of Object.entries(kit.atlases))
            if (typeof img !== 'string' || !img) errors.push(`kits.${name}.atlases.${season}: expected an image name`)
      }
      const cells = Number.isInteger(kit.atlas?.cols) && Number.isInteger(kit.atlas?.rows) ? kit.atlas.cols * kit.atlas.rows : null
      for (const [cell, v] of Object.entries(kit.pbr || {})) {
        // The shader sizes its per-cell uniform arrays from the grid, so a key outside it is
        // an override that can never be read — a typo the renderer has no way to report.
        if (cells !== null && !(Number.isInteger(+cell) && +cell >= 0 && +cell < cells))
          errors.push(`kits.${name}.pbr.${cell}: not a cell of a ${kit.atlas.cols}x${kit.atlas.rows} atlas`)
        if (!v) continue
        if (v.emissive !== undefined && typeof v.emissive !== 'number') errors.push(`kits.${name}.pbr.${cell}.emissive: expected a number`)
        if (v.emissiveIntensity !== undefined) {
          if (typeof v.emissiveIntensity !== 'number') errors.push(`kits.${name}.pbr.${cell}.emissiveIntensity: expected a number`)
          // `hasEmissive` keys off the colour alone, so an intensity on its own is inert:
          // the shader never carries the term and the cell the theme thinks glows does not.
          else if (v.emissive === undefined) errors.push(`kits.${name}.pbr.${cell}.emissiveIntensity: needs emissive`)
        }
      }
    }
  }

  // The character ids this crew declares, read again by the stateClips block below.
  const ids = new Set()
  if (!m.crew || typeof m.crew !== 'object') errors.push('crew: missing')
  else {
    if (typeof m.crew.file !== 'string') errors.push('crew.file: missing')
    if (!m.crew.clips || typeof m.crew.clips !== 'object') errors.push('crew.clips: expected an object')
    else {
      for (const [k, c] of Object.entries(m.crew.clips)) {
        if (!c || typeof c.name !== 'string' || typeof c.loop !== 'boolean') errors.push(`crew.clips.${k}: expected {name, loop}`)
        // Optional: a cut of the source clip in baked frames, and a row of `crew.tweaks`.
        if (c?.frames !== undefined && !(Array.isArray(c.frames) && c.frames.length === 2 && c.frames.every(Number.isInteger) && c.frames[0] < c.frames[1]))
          errors.push(`crew.clips.${k}.frames: expected [start, end] in whole frames`)
        if (c?.tweak !== undefined && !(typeof c.tweak === 'string' && m.crew.tweaks?.[c.tweak]))
          errors.push(`crew.clips.${k}.tweak: "${c?.tweak}" is not in crew.tweaks`)
        // Where in a work clip the tool lands, as a fraction of the clip. Optional; a clip
        // without one strikes halfway through.
        if (c && c.strike !== undefined && !(typeof c.strike === 'number' && c.strike >= 0 && c.strike <= 1))
          errors.push(`crew.clips.${k}.strike: expected a number in [0, 1]`)
      }
    }
    for (const role of ['head', 'chest', 'hand']) {
      if (typeof m.crew.attach?.[role] !== 'string') errors.push(`crew.attach.${role}: missing`)
    }
    if (!Array.isArray(m.crew.dropMeshes)) errors.push('crew.dropMeshes: expected an array')
    if (typeof m.crew.headClearance !== 'number') errors.push('crew.headClearance: expected a number')
    // A multi-character crew: one body per character, drawn as its own instanced mesh, and
    // `colourways` columns of the crew atlas each body comes in. Absent means one body.
    if (m.crew.characters !== undefined) {
      if (!Array.isArray(m.crew.characters) || !m.crew.characters.length) errors.push('crew.characters: expected a non-empty array')
      else
        m.crew.characters.forEach((c, i) => {
          if (typeof c?.id !== 'string' || !c.id) errors.push(`crew.characters[${i}].id: expected a string`)
          else if (ids.has(c.id)) errors.push(`crew.characters[${i}].id: duplicate "${c.id}"`)
          else ids.add(c.id)
          if (typeof c?.mesh !== 'string' || !c.mesh) errors.push(`crew.characters[${i}].mesh: expected a string`)
        })
      // `checkKit` and `crew.js` both claim a character's meshes by prefix (`<mesh>` or
      // `<mesh>_<Part>`), so a mesh name that extends another one's with an underscore is
      // ambiguous: the shorter character would silently swallow the longer one's parts.
      m.crew.characters.forEach((a, i) => {
        if (typeof a?.mesh !== 'string' || !a.mesh) return
        m.crew.characters.forEach((b, j) => {
          if (i === j || typeof b?.mesh !== 'string' || !b.mesh) return
          if (b.mesh.startsWith(`${a.mesh}_`))
            errors.push(
              `crew.characters[${j}].mesh: "${b.mesh}" is a prefix-extension of "${a.mesh}" (characters[${i}]) — meshes are matched by prefix`
            )
        })
      })
    }
    if (m.crew.colourways !== undefined && (!Number.isInteger(m.crew.colourways) || m.crew.colourways < 1))
      errors.push('crew.colourways: expected a positive integer')
    // The static nodes the theme's props hook names in the crew glb. The hook itself is
    // code and cannot be read here, so the theme lists them for the validator.
    if (m.crew.propNodes !== undefined && !Array.isArray(m.crew.propNodes)) errors.push('crew.propNodes: expected an array')
  }

  if (!m.buildings || typeof m.buildings !== 'object') errors.push('buildings: missing')
  else {
    if (typeof m.buildings.scale !== 'number') errors.push('buildings.scale: expected a number')
    if (typeof m.buildings.deck !== 'number') errors.push('buildings.deck: expected a number')
    // Opt-in: without it the colony pins every building's stage uniform at 1 and no part of
    // any recipe is ever hidden, whatever stages the recipes happen to carry.
    if (m.buildings.staged !== undefined && typeof m.buildings.staged !== 'boolean')
      errors.push('buildings.staged: expected a boolean')
    if (!m.buildings.kinds || !Object.keys(m.buildings.kinds).length) errors.push('buildings.kinds: expected at least one recipe')
    else
      for (const [k, r] of Object.entries(m.buildings.kinds)) {
        if (typeof r.label !== 'string') errors.push(`buildings.kinds.${k}.label: missing`)
        if (!Array.isArray(r.parts) || !r.parts.length) errors.push(`buildings.kinds.${k}.parts: expected a non-empty array`)
        else checkStages(r.parts, errors, `buildings.kinds.${k}`)
      }
    // Which kinds suit which villager. Optional: a theme without it leaves the recipe seed to
    // pick, which is what every theme did before. Both halves are checked against what the
    // manifest itself declares, so a renamed character or a deleted recipe is caught at load
    // rather than as a plot that silently falls back to the seed.
    if (m.buildings.byCharacter !== undefined) {
      if (!m.buildings.byCharacter || typeof m.buildings.byCharacter !== 'object' || Array.isArray(m.buildings.byCharacter))
        errors.push('buildings.byCharacter: expected an object')
      else {
        const known = new Set(crewCharacters(m.crew).map((c) => c.id))
        const kinds = m.buildings.kinds && typeof m.buildings.kinds === 'object' ? m.buildings.kinds : {}
        for (const [id, list] of Object.entries(m.buildings.byCharacter)) {
          if (!known.has(id)) errors.push(`buildings.byCharacter.${id}: not a declared character`)
          if (!Array.isArray(list) || !list.length) {
            errors.push(`buildings.byCharacter.${id}: expected a non-empty array`)
            continue
          }
          list.forEach((kind, i) => {
            if (typeof kind !== 'string' || !Object.hasOwn(kinds, kind))
              errors.push(`buildings.byCharacter.${id}[${i}]: "${kind}" is not in buildings.kinds`)
          })
        }
      }
    }
  }

  const STATE_KEYS = ['working', 'waiting', 'blocked', 'celebrating', 'sleeping', 'sittingDown', 'resting', 'restingDown', 'idle', 'walk', 'run', 'spawn']
  // A state maps to a clip key, or to `{ default, byCharacter }` when one body works the
  // job differently — the engine resolves it per character through `cast.clipFor`.
  const clipKnown = (k) => Boolean(m.crew?.clips && m.crew.clips[k])
  if (!m.stateClips || typeof m.stateClips !== 'object') errors.push('stateClips: missing')
  else
    for (const k of STATE_KEYS) {
      const entry = m.stateClips[k]
      if (typeof entry === 'string') {
        if (m.crew?.clips && !clipKnown(entry)) errors.push(`stateClips.${k}: "${entry}" is not in crew.clips`)
      } else if (entry && typeof entry === 'object') {
        if (typeof entry.default !== 'string') errors.push(`stateClips.${k}.default: missing`)
        else if (m.crew?.clips && !clipKnown(entry.default)) errors.push(`stateClips.${k}.default: "${entry.default}" is not in crew.clips`)
        for (const [cid, clip] of Object.entries(entry.byCharacter || {})) {
          if (!ids.has(cid)) errors.push(`stateClips.${k}.byCharacter.${cid}: not a declared character`)
          if (typeof clip !== 'string' || (m.crew?.clips && !clipKnown(clip)))
            errors.push(`stateClips.${k}.byCharacter.${cid}: "${clip}" is not in crew.clips`)
        }
      } else errors.push(`stateClips.${k}: missing`)
    }

  if (!m.plots || typeof m.plots !== 'object') errors.push('plots: missing')
  else {
    /**
     * `ceremonyClearance` and `ceremonyApron` are the *ceremony's* numbers — how much ground
     * the arrival blocks the crew out of, and how much scatter it clears — and the colony now
     * reads them off the object the hook returns. A theme with one fixed arrival keeps them
     * here and hands them on (the space ship does exactly that); a theme whose settings choose
     * between arrivals carries them on each one, because a dock and a castle do not cover the
     * same ground, and then there is nothing sensible for this pair to say.
     */
    const oneCeremony = !Array.isArray(m.ceremonies) || !m.ceremonies.length
    const numbers = ['deckTop', 'deckSkirt', 'clutterScale', 'clutterLampScale']
    if (oneCeremony) numbers.push('ceremonyClearance', 'ceremonyApron')
    for (const k of numbers) if (typeof m.plots[k] !== 'number') errors.push(`plots.${k}: expected a number`)
    if (!Array.isArray(m.plots.palette) || !m.plots.palette.length) errors.push('plots.palette: expected a non-empty array')
    if (!m.plots.ceremonyCell || !Number.isInteger(m.plots.ceremonyCell.q) || !Number.isInteger(m.plots.ceremonyCell.r))
      errors.push('plots.ceremonyCell: expected {q, r}')
    if (!Array.isArray(m.plots.clutter)) errors.push('plots.clutter: expected an array')
    // Which clutter prop is the tall one. It used to be the literal node name `lights` in
    // `plots.js`, which quietly scaled nothing at all in a theme whose lamp is called
    // something else.
    if (typeof m.plots.clutterLamp !== 'string') errors.push('plots.clutterLamp: expected the clutter node that takes clutterLampScale')
    else if (Array.isArray(m.plots.clutter) && !m.plots.clutter.includes(m.plots.clutterLamp))
      errors.push(`plots.clutterLamp: "${m.plots.clutterLamp}" is not in plots.clutter`)
    // Whether the engine stands its own procedural lamp post on every cell. Optional and on
    // by default: a theme whose `clutterLamp` is a real light turns it off, everyone else
    // says nothing and keeps the streetlights.
    if (m.plots.lampPosts !== undefined && typeof m.plots.lampPosts !== 'boolean') errors.push('plots.lampPosts: expected a boolean')
    // How the kerb props are laid out. Optional: absent is the yard every theme had, placed by
    // each prop's centre; `'reserved'` is upstream's, where a prop keeps its whole footprint
    // and a walking gap clear, and the buildings are fitted to leave room for it.
    if (m.plots.yard !== undefined && !YARDS.includes(m.plots.yard)) errors.push(`plots.yard: expected one of ${YARDS.join(', ')}`)
    // How much the ground may climb across one lattice cell before a plot is refused it. Optional
    // and `Infinity` when absent, which is the water-only allocator every theme had before — a
    // theme that says nothing here keeps handing out cells on any slope, as it always did.
    //
    // Finite and not negative. `Infinity` is spelled by *omitting* the field, so an explicit one
    // is a theme asking for the rule and then turning it off, which is worth saying out loud;
    // `NaN` fails `Number.isFinite` in `_blockedCells` and silently switches the whole rule and
    // its sampler off, which is the same wrong answer with no message; and a negative threshold
    // is a spread no cell can be under, so every cell on the map is refused and the colony has
    // nowhere to stand.
    if (m.plots.maxTilt !== undefined && !(typeof m.plots.maxTilt === 'number' && Number.isFinite(m.plots.maxTilt) && m.plots.maxTilt >= 0))
      errors.push('plots.maxTilt: expected a finite number of 0 or more')
  }

  if (!m.palette || typeof m.palette.accent !== 'number' || !Array.isArray(m.palette.tones) || typeof m.palette.css !== 'object')
    errors.push('palette: expected {accent, tones, css}')

  if (!m.copy || typeof m.copy !== 'object') errors.push('copy: missing')
  else
    for (const k of ['inhabitant', 'inhabitants', 'shipped', 'empty', 'archiveHint', 'nextHint', 'intro', 'welcome'])
      if (typeof m.copy[k] !== 'string') errors.push(`copy.${k}: missing`)

  // The ghost: how much of a fully faded zone is still drawn. Optional; the engine's 0.25
  // is the standard ghost for a theme that says nothing.
  if (m.fade !== undefined) {
    if (!m.fade || typeof m.fade !== 'object') errors.push('fade: expected an object')
    else if (m.fade.floor !== undefined && !(typeof m.fade.floor === 'number' && m.fade.floor >= 0 && m.fade.floor <= 1))
      errors.push('fade.floor: expected a number in [0, 1]')
  }
  if (m.copy && typeof m.copy === 'object')
    for (const k of ['fadeHint', 'hideHint', 'pinHint', 'soundHint', 'effectsHint'])
      if (m.copy[k] !== undefined && typeof m.copy[k] !== 'string') errors.push(`copy.${k}: expected a string`)

  /**
   * What the colony's own four moments sound like, by registered name. Every call site reads it
   * with no fallback wherever the theme has the `sound` feature, so there it is required, and
   * its shape is held here wherever it is written: an empty `select` is a click that plays
   * `undefined`, and an arrival with neither a `loop` nor an `event` is one that says nothing
   * and reads as working. `arrival` is keyed by the ceremony's `kind`.
   *
   * Only the shape. Whether each name is a registered sound of the kind its use needs, and each
   * arrival key a kind the theme's worlds build, is `tests/theme-sounds.test.mjs`: the registry
   * belongs to the audio engine, which a manifest check has no business loading.
   */
  if (m.sounds === undefined) {
    if (features?.sound) errors.push('sounds: required when the theme declares the sound feature')
  } else if (!m.sounds || typeof m.sounds !== 'object' || Array.isArray(m.sounds)) errors.push('sounds: expected an object')
  else {
    const s = m.sounds
    const isName = (n) => typeof n === 'string' && n.length > 0
    if (!Array.isArray(s.select) || !s.select.length || !s.select.every(isName)) errors.push('sounds.select: expected a non-empty array of names')
    for (const k of ['attention', 'work']) if (!isName(s[k])) errors.push(`sounds.${k}: expected a name`)
    if (!s.arrival || typeof s.arrival !== 'object' || Array.isArray(s.arrival)) errors.push('sounds.arrival: expected an object')
    else
      for (const [kind, a] of Object.entries(s.arrival)) {
        const keys = a && typeof a === 'object' && !Array.isArray(a) ? Object.keys(a) : []
        if (!keys.length || keys.some((k) => k !== 'loop' && k !== 'event')) errors.push(`sounds.arrival.${kind}: expected {loop} or {event}`)
        else for (const k of keys) if (!isName(a[k])) errors.push(`sounds.arrival.${kind}.${k}: expected a name`)
      }
  }

  /**
   * What a ghost town grows over itself. Optional, and absent means no dressing at all — a
   * theme that says nothing here has the ghosts it always had, which is what keeps the space
   * colony and any third-party theme out of this entirely.
   *
   * Only the shape is checked here. Whether the node names are actually in the kit is
   * `tools/validate-kit.mjs`, which has the built glb to hold them against.
   */
  if (m.decay !== undefined) {
    if (!m.decay || typeof m.decay !== 'object' || Array.isArray(m.decay)) errors.push('decay: expected an object')
    else {
      const d = m.decay
      // The kit the node names below are looked up in, and it has to be one this theme ships:
      // `part(name, 'nope')` throws at the first dressed plot, which is a ghost that crashes
      // the frame rather than a ghost that is not dressed.
      if (typeof d.kit !== 'string' || !Object.hasOwn(m.kits || {}, d.kit)) errors.push('decay.kit: expected the name of a kit this theme declares')
      // What grows on the deck. Empty is not "no scatter", it is a ramp with nothing to place
      // and a fade that spends its draws on an empty list, so it is an error rather than a
      // shorthand.
      if (!Array.isArray(d.scatter) || !d.scatter.length || d.scatter.some((n) => typeof n !== 'string' || !n))
        errors.push('decay.scatter: expected a non-empty array of node names')
      // How many a fully faded cell may carry. A fraction or a zero is a count that rounds to
      // nothing and a dressing nobody can see.
      if (d.perCell !== undefined && !(Number.isInteger(d.perCell) && d.perCell > 0)) errors.push('decay.perCell: expected a positive integer')
      // The size range, as a pair. A single number or a three-element list is a `NaN` scale on
      // every instance, which is geometry with no bounding box and nothing drawn.
      if (
        d.scale !== undefined &&
        !(Array.isArray(d.scale) && d.scale.length === 2 && d.scale.every((n) => typeof n === 'number' && Number.isFinite(n)))
      )
        errors.push('decay.scale: expected a pair of numbers')
      if (d.swap !== undefined) {
        if (!d.swap || typeof d.swap !== 'object' || Array.isArray(d.swap)) errors.push('decay.swap: expected an object')
        else
          for (const [from, to] of Object.entries(d.swap)) {
            if (typeof to !== 'string' || !to) errors.push(`decay.swap.${from}: expected a node name`)
            // The swap is applied as the kerb clutter is rebuilt, so a key the clutter list
            // never places is a rule that fires on nothing at all.
            if (Array.isArray(m.plots?.clutter) && !m.plots.clutter.includes(from))
              errors.push(`decay.swap.${from}: "${from}" is not in plots.clutter`)
          }
      }
      // The ruin is a recipe in the same vocabulary a building is, so its stages are held to
      // the same rule — a part staged above 1 is a ruin with a piece that never appears.
      if (d.ruin !== undefined) {
        if (!d.ruin || typeof d.ruin !== 'object' || Array.isArray(d.ruin)) errors.push('decay.ruin: expected an object')
        else if (!Array.isArray(d.ruin.parts) || !d.ruin.parts.length) errors.push('decay.ruin.parts: expected a non-empty array')
        else checkStages(d.ruin.parts, errors, 'decay.ruin')
      }
      // Where on the fade the building becomes the ruin. Zero would swap a working repo's
      // building for rubble the moment it is built, and anything above 1 is a swap that never
      // happens — both are silent, so the open interval is checked.
      if (d.ruinAt !== undefined && !(typeof d.ruinAt === 'number' && d.ruinAt > 0 && d.ruinAt <= 1))
        errors.push('decay.ruinAt: expected a number in (0, 1]')
      // And it is not optional once there is a ruin to place. `ruined(fade, undefined)` is
      // false at every fade, so a theme that writes the recipe and forgets the threshold ships
      // a ruin no building ever falls to — a block of manifest that reads as working and does
      // nothing on screen, which is exactly the failure the schema exists to name.
      if (d.ruin !== undefined && d.ruinAt === undefined) errors.push('decay.ruinAt: required when decay.ruin is declared')
    }
  }

  return errors
}

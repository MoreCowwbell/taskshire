/**
 * A world from the library and a theme's dressing, put together into the setting object the
 * engine reads — the same object a manifest used to write out by hand, key for key.
 *
 * **The dressing** is `{ worlds, biomes, default }`, and each of the three holds entries of the
 * same shape: `scatter` (a recipe name) and the style it is planted in (`budget`, `spread`,
 * `groves`, `retries`, `kitFallback`, `flora` — see `SCATTER_STYLE` in `src/world/setting.js`),
 * `rim`, `ridges` (`[{ recipe, count }]`, the crags for each of the world's ridges by index),
 * `atlas`, `buildingTint`, `ceremony` and `drones`. A world takes each key from the first of
 * its own entry, its biome's entry and the default that has it, so a theme can speak to one
 * world, a family of them, or all at once. A `null` there means *none*: the key is left out of
 * the setting as if no layer had it, which is how a floating island says it has no rim.
 *
 * **Memoised.** One world and one dressing always resolve to the very same object, and so to
 * the same `ceremony` object: `Colony.setSetting` compares that object to decide whether to
 * tear the arrival down and build another, so resolving the same pair twice must never hand
 * it a new one. For the same reason two worlds that take a value from the same dressing entry
 * — both inheriting the default's `ceremony`, say — get the one copy of it, and a switch
 * between them keeps the arrival standing. The caches are keyed by the objects themselves,
 * which is why a dressing is treated as frozen once anything has been resolved against it.
 *
 * **Key order is kept.** The setting's keys come out in the order the hand-written settings
 * had them — the world's own, with each dressed key placed after the key it followed there
 * (`DRESSED_AFTER`), and the scatter style, which no hand-written setting had, right after the
 * recipe — and `fauna.drones` stays the last key of `fauna`. The setting is a deep copy, so
 * changing one never reaches the library, the dressing or another theme's; the only thing it
 * shares is a dressed value with the theme's other worlds that inherit the same one.
 */
import { WORLDS } from './index.js'

/** What a world carries for the library alone. Neither reaches the setting. */
const LIBRARY_ONLY = new Set(['biome', 'dressedAfter'])

/**
 * Each top-level dressed key, and where it lands in the setting: right after the first of
 * these keys the setting has, or at the end if it has none of them. A world whose own
 * setting ran differently says so in `dressedAfter` — the valley's and the mountain's
 * arrivals each sat somewhere of their own.
 */
const DRESSED_AFTER = {
  atlas: ['blurb'],
  buildingTint: ['ground'],
  scatter: ['shape', 'roughness'],
  budget: ['scatter'],
  spread: ['scatter'],
  groves: ['scatter'],
  retries: ['scatter'],
  kitFallback: ['scatter'],
  flora: ['scatter'],
  rim: ['scatter'],
  ceremony: ['rim', 'scatter'],
}

const NONE = Object.freeze({})
/** Per dressing: each world's setting, and each dressed value's one copy by its source object. */
const memo = new WeakMap()

/** A deep copy of plain data, key order kept. */
function copy(value) {
  if (Array.isArray(value)) return value.map(copy)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)]))
  return value
}

/**
 * The dressing one world gets from a theme: each key from the world's own entry, else its
 * biome's, else the theme's default.
 *
 * @param {{ id: string, biome?: string }} world
 * @param {{ worlds?: object, biomes?: object, default?: object } | undefined} dressing
 */
export function dressingFor(world, dressing) {
  const layers = [dressing?.default, dressing?.biomes?.[world.biome], dressing?.worlds?.[world.id]]
  return Object.assign({}, ...layers.filter(Boolean))
}

/** The world's ridge, or list of them, with each one's crags from the dressing by index. */
function ridgeOf(ridge, crags = []) {
  const one = (r, i) => ({ ...copy(r), ...copy(crags[i]) })
  return Array.isArray(ridge) ? ridge.map(one) : one(ridge, 0)
}

/**
 * One world, dressed by one theme.
 *
 * @param {object} world     a library world (`WORLDS[id]`)
 * @param {object} dressing  a theme's `manifest.dressing`
 * @returns {object} the setting — the same object every time for the same two arguments
 */
export function resolveSetting(world, dressing) {
  const key = dressing || NONE
  let cache = memo.get(key)
  if (!cache) memo.set(key, (cache = { byWorld: new WeakMap(), copies: new WeakMap() }))
  const known = cache.byWorld.get(world)
  if (known) return known

  const d = dressingFor(world, dressing)
  // `null` wins over the layers below it and then dresses nothing.
  for (const k of Object.keys(d)) if (d[k] === null) delete d[k]
  // A dressed value, copied once per dressing: every world inheriting it gets the same copy.
  const dressedValue = (value) => {
    if (!value || typeof value !== 'object') return value
    if (!cache.copies.has(value)) cache.copies.set(value, copy(value))
    return cache.copies.get(value)
  }
  const dressed = Object.keys(DRESSED_AFTER).filter((k) => d[k] !== undefined)
  const has = (k) => (Object.hasOwn(world, k) && !LIBRARY_ONLY.has(k)) || dressed.includes(k)
  // Which dressed keys follow which key.
  const after = new Map()
  for (const k of dressed) {
    const anchor = world.dressedAfter?.[k] ?? DRESSED_AFTER[k].find(has)
    if (anchor && has(anchor)) after.set(anchor, [...(after.get(anchor) || []), k])
  }

  const setting = {}
  const place = (k, value) => {
    setting[k] = value
    for (const next of after.get(k) || []) if (!Object.hasOwn(setting, next)) place(next, dressedValue(d[next]))
  }
  for (const [k, value] of Object.entries(world)) {
    if (LIBRARY_ONLY.has(k)) continue
    if (k === 'ridge') place(k, ridgeOf(value, d.ridges))
    else if (k === 'fauna' && d.drones !== undefined) place(k, { ...copy(value), drones: dressedValue(d.drones) })
    else place(k, copy(value))
  }
  // Anything still unplaced — no anchor, or anchors that only name each other — goes last.
  for (const k of dressed) if (!Object.hasOwn(setting, k)) place(k, dressedValue(d[k]))
  // A world with no wildlife of its own still flies the theme's drones.
  if (d.drones !== undefined && !Object.hasOwn(world, 'fauna')) setting.fauna = { drones: dressedValue(d.drones) }

  cache.byWorld.set(world, setting)
  return setting
}

/**
 * The settings a theme lists, in its order: `manifest.settings` is this, over the theme's
 * `worlds` and `dressing`.
 *
 * @param {string[]} ids   world ids from the library
 * @param {object} dressing
 */
export function resolveSettings(ids, dressing) {
  return ids.map((id) => {
    const world = Object.hasOwn(WORLDS, id) ? WORLDS[id] : null
    if (!world) throw new Error(`resolveSettings: no world "${id}" in src/worlds`)
    return resolveSetting(world, dressing)
  })
}

/**
 * What a theme's engine is built with, one switch per system.
 *
 * This replaces the single `planetary` flag, which turned about twelve of upstream's systems on
 * or off together. The theme says what *can* exist here; whether it is on is the user's, through
 * the settings that already exist (`worldCurve`, `colorGrade`, `clouds`, `fauna`, `sound`…).
 *
 * Shared features are the ones both themes will carry once the village catches up. Theme features
 * belong to one cast by nature. What used to ride on a transitional `planetWorlds` feature —
 * upstream's generator, island, building tint and yard rule — is world data and dressing now:
 * the landform's `shape` and `lakes`, the dressing's `buildingTint`, and `plots.yard`.
 */
export const SHARED_FEATURES = Object.freeze(['curve', 'grade', 'occlusion', 'overlay', 'clouds', 'grass', 'water', 'fauna', 'motes', 'sound'])
export const THEME_FEATURES = Object.freeze(['faces', 'visor', 'phoneCheck', 'recentre'])
export const FEATURE_NAMES = Object.freeze([...SHARED_FEATURES, ...THEME_FEATURES])

const KNOWN = new Set(FEATURE_NAMES)

/** A theme's `features` block, every name present, frozen. An unknown key throws. */
export function resolveFeatures(declared = {}) {
  for (const key of Object.keys(declared || {})) {
    if (!KNOWN.has(key)) throw new Error(`unknown feature "${key}"`)
  }
  const out = {}
  for (const name of FEATURE_NAMES) out[name] = Boolean(declared?.[name])
  return Object.freeze(out)
}

let current = resolveFeatures()

/** Called once at boot, before anything reads a feature. */
export function configureFeatures(resolved) {
  current = resolved
}

/** For modules with no theme in hand (`sky.js`, `plots.js`, `buildings.js`). */
export function hasFeature(name) {
  if (!KNOWN.has(name)) throw new Error(`unknown feature "${name}"`)
  return current[name]
}

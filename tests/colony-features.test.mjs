import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Every place `colony.js` builds, rebuilds or runs a feature system does it on that feature's
 * own stream, inside `isolated(featureRng(…), …)`: each three allocation spends four draws, and
 * the global stream is the one the crew is seated from. A colony needs a renderer and the kits,
 * so this reads the source; the whole-page proof is the screenshot harness with
 * `SNAPSHOT_FEATURES_OFF`, where the crew does not move when the features are off.
 *
 * A call counts as wrapped when the `isolated(featureRng(…)` that opens its statement is on the
 * same line or up to six lines above, whitespace ignored. Calls inside the feature's own
 * methods (`_buildIsland` calling `_syncIslandRock`, say) are already on the stream of whoever
 * called the method. A stream colony.js names by a constant is listed by that constant: the
 * floating island's, `ISLAND_STREAM`, keeps the seed it was built on before it followed the
 * world's shape.
 */
const CALLS = {
  'new BuildingSurfaces(': 'fauna',
  'new Fauna(': 'fauna',
  'new SceneryReflections(': 'visor',
  'this._buildIsland()': 'ISLAND_STREAM',
  'this._syncIslandRock()': 'ISLAND_STREAM',
  'this._buildPlanetWater()': 'water',
  'this._buildGrass(': 'grass',
  'this.fauna.setPlanet(': 'fauna',
  'this._syncFaunaSites()': 'fauna',
  'this.fauna.onSettingsChanged(': 'fauna',
  // The clouds rebuild; the constructor's own `this.sky.setSetting(this.setting)` is shared.
  '() => this.sky.setSetting(this.setting)': 'clouds',
  'this._emitMotes(': 'motes',
  'this._updatePlanet(': 'planet-frame',
  'this.reflections.update(': 'visor',
}
/** Methods whose body runs on its caller's stream. */
const OWN = ['_buildIsland', '_syncIslandRock', '_buildPlanetWater', '_buildGrass', '_syncFaunaSites', '_emitMotes', '_updatePlanet']

const source = readFileSync('src/game/colony.js', 'utf8')
const lines = source.split('\n')

/** Which method a line is in, by the last `  name(…) {` definition above it. */
function methodAt(i) {
  for (let j = i; j >= 0; j--) {
    const m = lines[j].match(/^ {2}(?:async )?(\w+)\([^)]*\) \{/)
    if (m) return m[1]
  }
  return null
}

/**
 * Whether the call at `lines[i]` sits inside a still-open `isolated(featureRng('<stream>'), …`
 * (or `featureRng(<CONSTANT>)` for a stream listed by its constant):
 * the wrapper has to open on or up to six lines above, and more parentheses have to be opened
 * than closed between it and the call, or the call came after the wrapper had finished.
 */
function wrapped(i, call, stream) {
  const before = lines.slice(Math.max(0, i - 6), i).join('\n') + '\n' + lines[i].slice(0, lines[i].indexOf(call))
  const opener = /^[A-Z_]+$/.test(stream) ? `isolated(featureRng(${stream}),` : `isolated(featureRng('${stream}'),`
  const flat = before.replace(/\s+/g, '')
  const at = flat.lastIndexOf(opener)
  if (at < 0) return false
  let depth = 0
  for (const ch of flat.slice(at)) depth += ch === '(' ? 1 : ch === ')' ? -1 : 0
  return depth > 0
}

test('every feature system in colony.js is built and run on its own stream', () => {
  const bare = []
  const missing = []
  for (const [call, stream] of Object.entries(CALLS)) {
    let seen = 0
    lines.forEach((line, i) => {
      if (!line.includes(call) || /^\s*(\/\/|\*)/.test(line)) return
      if (OWN.includes(methodAt(i))) return
      seen++
      if (!wrapped(i, call, stream)) bare.push(`${i + 1}: ${line.trim()} (want '${stream}')`)
    })
    if (!seen) missing.push(call)
  }
  assert.deepEqual(bare, [])
  assert.deepEqual(missing, [], 'every listed call is still in colony.js — a renamed one would drop out of this guard')
})

/**
 * No blade stands on the valley's sand. Upstream's grass stops at his shore band, which the
 * valley does not have; its beach is the band `createTerrain` paints, seaward of `shoreReach` and
 * under `level + SAND_RISE`, and `_buildGrass` keeps off it. Run on the colony's own method with a
 * stand-in colony (no plots, no apron), in both themes, since both stand on the same valley.
 */
test("the valley's meadow keeps off its sand, in both themes", async () => {
  const { Colony } = await import('../src/game/colony.js')
  const { SAND_RISE, shoreReach, terrainHeight } = await import('../src/world/setting.js')
  const values = { groundDetail: 'medium', scatterDensity: 1 }
  for (const theme of ['medieval', 'space']) {
    const { manifest } = await import(`../src/themes/${theme}/manifest.js`)
    const valley = manifest.settings.find((s) => s.id === 'valley')
    const colony = Object.create(Colony.prototype)
    Object.assign(colony, { setting: valley, settings: { get: (k) => values[k] }, plotOrder: [], grass: null, worldGroup: { add() {}, remove() {} } })
    colony._buildGrass([])
    const mesh = colony.grass?.mesh
    assert.ok(mesh && mesh.count > 0, `${theme}: the valley grows grass`)
    const [ax, az] = valley.coast.axis
    const top = valley.water.level + SAND_RISE
    const onSand = []
    for (let i = 0; i < mesh.count; i++) {
      const x = mesh.instanceMatrix.array[i * 16 + 12]
      const z = mesh.instanceMatrix.array[i * 16 + 14]
      if (x * ax + z * az >= shoreReach(x, z, valley) && terrainHeight(x, z, valley) < top) onSand.push(`(${x.toFixed(1)}, ${z.toFixed(1)})`)
    }
    assert.deepEqual(onSand.slice(0, 5), [], `${theme}: ${onSand.length} of ${mesh.count} blades on the sand`)
    colony.grass.dispose()
  }
})

/**
 * The page's stream across a terrain build. The valley's old flat sea was built in
 * `_buildTerrain` on the page's own stream, three of three's UUIDs at four draws each, and the
 * build still spends those twelve where it did, so every villager seated after a switch to the
 * valley takes the seat it always had; a world with no `coast`, the forest, spends nothing more
 * than its ground. The colony's own method, on a stand-in colony whose scatter, island and
 * feature systems (each on a stream of its own, or tested elsewhere) are left out; what it
 * spends beyond `createTerrain` is the count.
 */
test('a terrain build spends the old flat sea’s twelve draws on the valley and none on the forest', async () => {
  const THREE = await import('three')
  const { Colony } = await import('../src/game/colony.js')
  const { createTerrain } = await import('../src/world/setting.js')
  const { manifest } = await import('../src/themes/medieval/manifest.js')
  const counted = (fn) => {
    const real = Math.random
    let draws = 0
    Math.random = () => {
      draws++
      return real()
    }
    try {
      fn()
    } finally {
      Math.random = real
    }
    return draws
  }
  const extra = {}
  for (const id of ['valley', 'forest']) {
    const setting = manifest.settings.find((s) => s.id === id)
    const colony = Object.create(Colony.prototype)
    Object.assign(colony, {
      setting,
      settings: { get: (k) => ({ groundDetail: 'medium' })[k] },
      features: {},
      worldGroup: { add() {}, remove() {} },
      ceremony: { group: new THREE.Group() },
      sea: null,
      _dustTint: new THREE.Color(),
      _shapeIsland() {},
      _buildScatter() {},
    })
    const ground = counted(() => createTerrain(setting, 'medium'))
    extra[id] = counted(() => colony._buildTerrain()) - ground
  }
  assert.deepEqual(extra, { valley: 12, forest: 0 })
})

import { test } from 'node:test'
import assert from 'node:assert/strict'

// A localStorage the settings module can use under Node.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
// Real timers stay in place: node:test needs them. The debounced save is exercised through
// `flush()`, which writes synchronously.

const { Settings, RESUME_OPENS, relaysRoster, resumeChoice } = await import('../src/core/settings.js')

test('defaults include theme and setting', () => {
  store.clear()
  const s = new Settings()
  assert.equal(s.get('theme'), 'medieval')
  assert.equal(s.get('setting'), 'forest')
  assert.equal(s.get('planet'), undefined)
})

test('a stored planet migrates to setting once', () => {
  store.clear()
  // A space store: `planet` predates the village, and the default theme is the village now.
  store.set('botcrossing.settings.v1', JSON.stringify({ theme: 'space', planet: 'mars', fov: 40 }))
  const s = new Settings()
  assert.equal(s.get('setting'), 'mars')
  assert.equal(s.get('planet'), undefined)
  assert.equal(s.get('fov'), 40)
})

/**
 * A colony file saved before the rename carries `planet`, and `applyAll` is how a fresh
 * browser adopts one. Migrating only on the localStorage path dropped the key here, which
 * put that colony back on the default world.
 */
test('a colony file with a planet migrates through applyAll too', () => {
  store.clear()
  const s = new Settings()
  const changed = s.applyAll({ theme: 'space', planet: 'terra', fov: 44 })
  assert.equal(s.get('setting'), 'terra')
  assert.equal(s.get('planet'), undefined)
  assert.equal(s.get('fov'), 44)
  assert.equal(changed, 3, 'theme, setting and fov')
  // An explicit `setting` in the same file wins over the legacy key.
  const t = new Settings()
  t.applyAll({ theme: 'space', planet: 'terra', setting: 'mars' })
  assert.equal(t.get('setting'), 'mars')
})

/**
 * Both themes list every world now. A stored world the theme's old list did not hold could
 * only have been showing that theme's first world, so it opens there once rather than on a
 * world it never showed; afterwards a pick sticks. Review focus: a space install storing the
 * fresh-install `forest` opens on the Moon, not on the newly listed Forest.
 */
test('a store from before every world was shared opens where it was', () => {
  const open = (stored) => {
    store.clear()
    store.set('botcrossing.settings.v1', JSON.stringify(stored))
    return new Settings()
  }
  assert.equal(open({ theme: 'space', setting: 'forest' }).get('setting'), 'moon')
  assert.equal(open({ theme: 'space' }).get('setting'), 'moon', 'no world stored is the old default, forest')
  assert.equal(open({ theme: 'space', setting: 'mars' }).get('setting'), 'mars')
  assert.equal(open({ theme: 'medieval', setting: 'valley' }).get('setting'), 'valley')
  assert.equal(open({ theme: 'medieval', setting: 'moon' }).get('setting'), 'forest')
  assert.equal(open({ setting: 'moon' }).get('setting'), 'forest', 'no theme is the village')
  assert.equal(open({ theme: 'space', setting: 'forest' }).get('worldsShared'), true)
})

/**
 * A theme id this build does not have loads as space (`loadTheme` falls back to it), so an old
 * store naming one was showing a space world and migrates as space does.
 */
test('a store naming a theme this build lacks migrates as space', () => {
  const open = (stored) => {
    store.clear()
    store.set('botcrossing.settings.v1', JSON.stringify(stored))
    return new Settings()
  }
  assert.equal(open({ theme: 'underwater', setting: 'forest' }).get('setting'), 'moon')
  assert.equal(open({ theme: 'underwater', setting: 'mars' }).get('setting'), 'mars')
  assert.equal(open({ theme: 'toString', setting: 'valley' }).get('setting'), 'moon', 'not an inherited key')
  const s = new Settings()
  s.applyAll({ theme: 'underwater', setting: 'valley' })
  assert.equal(s.get('setting'), 'moon', 'a colony file too')
})

test('a migrated store that then picks Forest in space keeps it', () => {
  store.clear()
  store.set('botcrossing.settings.v1', JSON.stringify({ theme: 'space', setting: 'forest' }))
  const s = new Settings()
  assert.equal(s.get('setting'), 'moon')
  s.set('setting', 'forest')
  s.flush()
  assert.equal(JSON.parse(store.get('botcrossing.settings.v1')).worldsShared, true)
  assert.equal(new Settings().get('setting'), 'forest')
})

/**
 * Written back at once rather than on the next change: until it is, the store still reads as
 * unmigrated, and a reload inside the 400 ms debounce of a pick would migrate it again.
 */
test('the one-time migration is written back as soon as it runs', () => {
  store.clear()
  store.set('botcrossing.settings.v1', JSON.stringify({ theme: 'space', setting: 'forest' }))
  new Settings()
  const saved = JSON.parse(store.get('botcrossing.settings.v1'))
  assert.equal(saved.setting, 'moon')
  assert.equal(saved.worldsShared, true)
})

test('a store already carrying worldsShared is never migrated', () => {
  store.clear()
  const raw = JSON.stringify({ theme: 'space', setting: 'forest', worldsShared: true })
  store.set('botcrossing.settings.v1', raw)
  assert.equal(new Settings().get('setting'), 'forest')
  assert.equal(store.get('botcrossing.settings.v1'), raw)
})

test('a fresh install is already shared, and a colony file gets the same migration', () => {
  store.clear()
  const s = new Settings()
  assert.equal(s.get('worldsShared'), true)
  s.applyAll({ theme: 'space', setting: 'forest' })
  assert.equal(s.get('setting'), 'moon')
  // Each starts somewhere else, so an adoption that changes nothing would show.
  const t = new Settings()
  t.set('setting', 'sky')
  t.applyAll({ setting: 'moon' })
  assert.equal(t.get('setting'), 'forest')
  const u = new Settings()
  u.set('setting', 'sky')
  u.applyAll({ theme: 'space', setting: 'forest', worldsShared: false })
  assert.equal(u.get('setting'), 'forest', 'the key, not its value, says the file is migrated')
})

test('setting is a world key, theme is not a render key', () => {
  store.clear()
  const s = new Settings()
  let seen = null
  s.onChange((changed, scope) => (seen = { changed: [...changed], scope }))
  s.set('setting', 'terra')
  assert.deepEqual(seen.changed, ['setting'])
  assert.equal(seen.scope.world, true)
  s.set('theme', 'space')
  assert.deepEqual(seen.changed, ['theme'])
  assert.equal(seen.scope.world, false)
  assert.equal(seen.scope.render, false)
})

test('flush writes synchronously', () => {
  store.clear()
  const s = new Settings()
  s.set('theme', 'medieval')
  s.flush()
  assert.equal(JSON.parse(store.get('botcrossing.settings.v1')).theme, 'medieval')
})

test('a stored theme is what the next boot loads', () => {
  // The fallback keeps the stored id rather than resetting it, so a theme that cannot load
  // says so on every boot instead of quietly putting the choice back to space.
  store.clear()
  const s = new Settings()
  s.set('theme', 'medieval')
  s.flush()
  assert.equal(new Settings().get('theme'), 'medieval')
})

test('the active-repos filter is on by default with a 3 / 14 day ramp', () => {
  store.clear()
  const s = new Settings()
  assert.equal(s.get('activeOnly'), true)
  assert.equal(s.get('fadeDays'), 3)
  assert.equal(s.get('hideDays'), 14)
  // Outside every preset: touching one must not flip the preset to custom.
  s.set('fadeDays', 5)
  assert.equal(s.get('preset'), 'balanced')
})

/**
 * Whether a ghost is drawn thin and grey, or keeps its colours and is read as abandoned by
 * what grows over it. Off is the product default, so a fresh install sees the dressing rather
 * than the dither.
 *
 * It is in no scope set on purpose: nothing is rebuilt and nothing is re-laid-out — the colony
 * simply asks every plot and building to write the fade it already holds out again.
 */
test('fadeGhosts is off by default and belongs to no scope', () => {
  store.clear()
  const s = new Settings()
  assert.equal(s.get('fadeGhosts'), false)
  let seen = null
  s.onChange((changed, scope) => (seen = { changed: [...changed], scope }))
  s.set('fadeGhosts', true)
  // Outside every preset, like the rest of the Repos group.
  assert.equal(s.get('preset'), 'balanced')
  assert.deepEqual(seen.changed, ['fadeGhosts'])
  assert.equal(seen.scope.world, false)
  assert.equal(seen.scope.render, false)
  assert.equal(seen.scope.roster, false)
})

test('zone size defaults to seven threads a tile, counting what is open', () => {
  store.clear()
  const s = new Settings()
  assert.equal(s.get('threadsPerTile'), 7)
  assert.equal(s.get('countActive'), true)
  assert.equal(s.get('countIdle'), true)
  assert.equal(s.get('countInactive'), false)
  assert.equal(s.get('countArchived'), false)
})

/**
 * Zone size is the user's own view of the colony, not a quality knob: ticking a state must
 * leave the named preset alone, and it wants its own scope so `main.js` re-lays the roster
 * out without the renderer or the terrain being touched.
 */
test('a zone size key keeps the preset and emits the roster scope', () => {
  store.clear()
  const s = new Settings()
  let seen = null
  s.onChange((changed, scope) => (seen = { changed: [...changed], scope }))
  s.set('countInactive', true)
  assert.equal(s.get('preset'), 'balanced')
  assert.deepEqual(seen.changed, ['countInactive'])
  assert.equal(seen.scope.roster, true)
  assert.equal(seen.scope.world, false)
  assert.equal(seen.scope.render, false)
  s.set('threadsPerTile', 3)
  assert.equal(seen.scope.roster, true)
  s.set('fov', 44)
  assert.equal(seen.scope.roster, false)
})

/**
 * A fresh browser adopts its colony file's settings at boot, before the first poll, while the
 * roster is still empty. Laying that empty roster out would reconcile `seen` against no threads
 * and forget rows the first real scan needs, so every open thread would walk out at once.
 * Nothing re-lays the roster until a scan has landed; after that a world or roster change does.
 */
test('settings re-lay the roster only once a scan has landed', () => {
  store.clear()
  const s = new Settings()
  let scanned = false
  const decisions = []
  s.onChange((changed, scope) => decisions.push(relaysRoster(changed, scope, { scanned })))
  s.applyAll({ theme: 'medieval', setting: 'mountain', countInactive: true, worldsShared: true })
  s.set('hideDays', 30)
  assert.deepEqual(decisions, [false, false], 'nothing before the first scan, roster keys included')
  scanned = true
  decisions.length = 0
  s.set('setting', 'valley')
  s.set('countInactive', false)
  s.set('hideDays', 20)
  s.set('fov', 44)
  assert.deepEqual(decisions, [true, true, true, false])
})

/**
 * The season overrides the setting's own sheet and nothing else, so it must not be a world
 * key: rebuilding the terrain to swap a kit atlas would be a full teardown for one upload.
 */
test('season defaults to auto and is not a world key', () => {
  store.clear()
  const s = new Settings()
  assert.equal(s.get('season'), 'auto')
  let scope
  s.onChange((_, sc) => (scope = sc))
  s.set('season', 'winter')
  assert.equal(scope.world, false)
})

test('Resume opens defaults to the editor window, and belongs to no scope', () => {
  store.clear()
  const s = new Settings()
  assert.equal(s.get('resumeOpens'), 'ide')

  let seen = null
  s.onChange((changed, scope) => {
    seen = { changed: [...changed], scope }
  })
  s.set('resumeOpens', 'copy')

  assert.deepEqual(seen.changed, ['resumeOpens'])
  assert.equal(seen.scope.world, false, 'nothing about the world changes')
  assert.equal(seen.scope.render, false)
  assert.equal(seen.scope.roster, false, 'and no thread joins or leaves the map')
  assert.equal(s.get('preset'), 'balanced', 'it is outside every preset, so it cannot flip one')
})

test('an unknown Resume opens value reads as the default', () => {
  // `'terminal'` is reserved for the in-repo VS Code extension. A colony file from a build that
  // has it must not leave this one with a Resume button that does nothing.
  assert.equal(resumeChoice('terminal'), 'ide')
  assert.equal(resumeChoice(''), 'ide')
  assert.equal(resumeChoice(undefined), 'ide')
  assert.equal(resumeChoice(7), 'ide')
  assert.deepEqual(RESUME_OPENS.map(resumeChoice), RESUME_OPENS)
})

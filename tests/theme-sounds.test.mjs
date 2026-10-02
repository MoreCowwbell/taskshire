/**
 * One sound table per theme (`manifest.sounds`): what the colony's own four moments — a click,
 * somebody needing you, work, an arrival — sound like, by registered name.
 *
 * The call sites read the table and nothing else, so every check that used to be "the literal
 * names a real sound" is made here against the table instead: each name is registered, and of
 * the kind its use needs. That last is not pedantry. The ambience's pool refuses an `event` as
 * a positional source, so an arrival `loop` that named a one-shot would warn once and never
 * sound; and a `select` that named a loop would hum for ever.
 *
 * The space table is today's literals, written down. The click's pick, `pickPhrase`, is held
 * against the pick `main.js` made before there was a table — `1 + floor(r·6)`, bumped to the
 * next on a repeat — so the colony says the same phrase for the same draw it always did.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SOUNDS, isSound, pickPhrase } from '../src/audio/sounds.js'
import { mulberry } from '../src/core/rng.js'
import { manifest as village } from '../src/themes/medieval/manifest.js'
import { manifest as space } from '../src/themes/space/manifest.js'

const THEMES = [
  { name: 'space', manifest: space },
  { name: 'medieval', manifest: village },
]

/** Every arrival kind a theme builds: the village names its own; the space colony has one lander. */
const builds = (m) => m.ceremonies ?? ['ship']

const kindOf = (name) => SOUNDS[name]?.kind

test('every name in either table is registered, and of the kind its use needs', () => {
  for (const { name, manifest } of THEMES) {
    const s = manifest.sounds
    assert.ok(s, `${name}: no sounds table`)
    assert.ok(Array.isArray(s.select) && s.select.length >= 2, `${name}: select needs at least two phrases to never repeat`)
    for (const n of s.select) {
      assert.ok(isSound(n), `${name}: select "${n}" is not registered`)
      assert.equal(kindOf(n), 'event', `${name}: select "${n}"`)
    }
    assert.ok(isSound(s.attention), `${name}: attention "${s.attention}" is not registered`)
    assert.equal(kindOf(s.attention), 'event', `${name}: attention`)
    assert.ok(isSound(s.work), `${name}: work "${s.work}" is not registered`)
    assert.ok(['loop', 'bed'].includes(kindOf(s.work)), `${name}: work "${s.work}" is a ${kindOf(s.work)}, not a loop`)
    for (const [kind, a] of Object.entries(s.arrival)) {
      assert.ok(a.event || a.loop, `${name}: arrival ${kind} names neither an event nor a loop`)
      if (a.event) {
        assert.ok(isSound(a.event), `${name}: arrival ${kind} event "${a.event}" is not registered`)
        assert.equal(kindOf(a.event), 'event', `${name}: arrival ${kind} event`)
      }
      if (a.loop) {
        assert.ok(isSound(a.loop), `${name}: arrival ${kind} loop "${a.loop}" is not registered`)
        assert.ok(['loop', 'bed'].includes(kindOf(a.loop)), `${name}: arrival ${kind} loop "${a.loop}" is a ${kindOf(a.loop)}`)
      }
    }
  }
})

test('every arrival the table names is one the theme builds, and every one it builds is named', () => {
  for (const { name, manifest } of THEMES) {
    const keys = Object.keys(manifest.sounds.arrival).sort()
    for (const k of keys) assert.ok(builds(manifest).includes(k), `${name}: arrival "${k}" is not a ceremony this theme builds`)
    // What the settings actually stand up: a setting with no ceremony of its own is the lander.
    const dressed = [...new Set(manifest.settings.map((s) => s.ceremony?.kind ?? 'ship'))].sort()
    assert.deepEqual(keys, dressed, `${name}: the arrival keys against the kinds its worlds build`)
  }
  assert.deepEqual(Object.keys(village.sounds.arrival).sort(), ['boat', 'castle', 'fortress'])
})

test('every sound any world names is registered, beds as beds and events as events', () => {
  for (const { name, manifest } of THEMES) {
    for (const setting of manifest.settings) {
      const audio = setting.audio
      if (!audio) continue
      for (const b of audio.beds ?? []) {
        assert.ok(isSound(b.sound), `${name}/${setting.id}: bed "${b.sound}" is not registered`)
        assert.equal(kindOf(b.sound), 'bed', `${name}/${setting.id}: bed "${b.sound}"`)
      }
      for (const e of audio.events ?? []) {
        assert.ok(isSound(e.sound), `${name}/${setting.id}: event "${e.sound}" is not registered`)
        assert.equal(kindOf(e.sound), 'event', `${name}/${setting.id}: event "${e.sound}"`)
      }
    }
  }
})

test('the village has no machines: no setting of it flies drones', () => {
  for (const setting of village.settings) assert.equal(setting.fauna?.drones, undefined, `medieval/${setting.id} flies drones`)
})

test('the space table is the names the colony always played, in order', () => {
  assert.deepEqual(space.sounds, {
    select: ['select-1', 'select-2', 'select-3', 'select-4', 'select-5', 'select-6'],
    attention: 'chime-attention',
    work: 'work-hammer',
    arrival: { ship: { loop: 'ship-hum' } },
  })
})

test('the village table is the one decided', () => {
  assert.deepEqual(village.sounds, {
    select: ['pluck-1', 'pluck-2', 'pluck-3', 'pluck-4'],
    attention: 'hand-bell',
    work: 'work-hammer',
    arrival: { castle: { event: 'keep-bell' }, fortress: { event: 'keep-bell' }, boat: { loop: 'hull-creak' } },
  })
})

test('for six phrases pickPhrase is the old pick less one, draw for draw', () => {
  const r = mulberry(0x5eed)
  // The old pick's running state started at 0, a phrase no draw lands on; -1 is its index.
  let old = 0
  let last = -1
  let bumps = 0
  for (let k = 0; k < 10000; k++) {
    const draw = r()
    let n = 1 + Math.floor(draw * 6)
    if (n === old) {
      n = (n % 6) + 1
      bumps++
    }
    old = n
    last = pickPhrase(draw, last, 6)
    assert.equal(last, n - 1, `draw ${k} (${draw})`)
  }
  assert.ok(bumps > 1000, 'the run exercised the bump')
})

test('pickPhrase never says the same thing twice, and says each of them', () => {
  for (let n = 2; n <= 8; n++) {
    const r = mulberry(n * 7919)
    let last = -1
    const said = new Set()
    for (let k = 0; k < 1000; k++) {
      const i = pickPhrase(r(), last, n)
      assert.ok(Number.isInteger(i) && i >= 0 && i < n, `n=${n}: ${i} is not a phrase`)
      assert.notEqual(i, last, `n=${n}: phrase ${i} twice in a row`)
      said.add(i)
      last = i
    }
    assert.equal(said.size, n, `n=${n}: only ${said.size} phrases in 1000 draws`)
  }
  // The edges of the draw: the last phrase's repeat goes round to the first.
  assert.equal(pickPhrase(0.999999, 3, 4), 0)
  assert.equal(pickPhrase(0, 0, 4), 1)
})

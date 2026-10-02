/**
 * The keep bell is news: it rings when somebody new walks out of the arrival, and never else.
 *
 * Two halves meet here. `Astronauts._spawnAgent` calls `onEntrance(agent)` for an agent that
 * walks out — never for one the page has seen before (`entry.known`), which is placed straight on
 * its plot — and `Colony._announceArrival` turns that into the theme's arrival `event` at the
 * ceremony's door, at most once every `BELL_GAP` s of colony time, so a poll that brings eight new
 * threads rings once. The space colony's arrival is a loop (the lander's hum), so it rings
 * nothing at all.
 *
 * Both run through the prototype, as `deck-ground.test.mjs` does: the crew is an `Astronauts`
 * with just the fields spawning reads, and the colony a stand-in carrying the theme, a ceremony
 * with a fixed door and the clock `Colony.update` keeps (`elapsed`, the engine's). The last test
 * builds a real `Colony`, to hold the wiring between the two that only its constructor makes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { Astronauts } from '../src/agents/astronauts.js'
import { crewCharacters } from '../src/agents/cast.js'
import { BELL_GAP, Colony } from '../src/game/colony.js'
import { loadTheme } from '../src/themes/registry.js'
import { manifest as village } from '../src/themes/medieval/manifest.js'
import { manifest as space } from '../src/themes/space/manifest.js'

const DOOR = new THREE.Vector3(6.5, 0.4, -3.25)

/** A colony as far as the arrival bell reads it, with every sound it asks for recorded. */
function colony(manifest, kind) {
  const c = Object.create(Colony.prototype)
  c.theme = { manifest }
  c.ceremony = { kind, door: (out = new THREE.Vector3()) => out.copy(DOOR) }
  c.elapsed = 0
  c._lastBell = -Infinity
  c.played = []
  c.onSound = (name, x, y, z, gain) => c.played.push({ name, x, y, z, gain })
  return c
}

/** A crew as far as `setRoster` and `_spawnAgent` read it, wired to `col` the way `Colony` wires it. */
function crew(manifest, col) {
  const a = Object.create(Astronauts.prototype)
  a.settings = { get: (k) => (k === 'maxAgents' ? 200 : undefined) }
  a.theme = { manifest }
  a.capacity = 200
  a.agents = []
  a.byId = new Map()
  a.world = { door: () => DOOR.clone() }
  a.characters = crewCharacters(manifest.crew)
  a.colourways = manifest.crew.colourways || 1
  a.stateClips = manifest.stateClips
  a.faces = { FACE: { boot: 0 }, FACE_LOOPS: {} }
  a._updateAgent = () => {}
  a.onEntrance = (agent) => col._announceArrival(agent)
  return a
}

const entry = (id, known = false) => ({ id, thread: null, status: 'working', known, site: new THREE.Vector3(12, 0, 4) })
const roster = (ids, known = false) => ids.map((id) => entry(id, known))

test('a new villager walking out of the keep rings the keep bell once, at the door', () => {
  const col = colony(village, 'castle')
  const crowd = crew(village, col)
  crowd.setRoster(roster(['t-1']))
  assert.equal(crowd.agents[0].state, 'spawning', 'it walked out')
  assert.equal(col.played.length, 1)
  const [bell] = col.played
  assert.equal(bell.name, 'keep-bell')
  assert.deepEqual([bell.x, bell.y, bell.z], [DOOR.x, DOOR.y + 1, DOOR.z])
  // The hand bell's 0.9, the level both bells were measured at — not the ambience's default 1.
  assert.equal(bell.gain, 0.9)
})

test('the fortress rings the same bell', () => {
  const col = colony(village, 'fortress')
  crew(village, col).setRoster(roster(['t-1']))
  assert.deepEqual(col.played.map((p) => p.name), ['keep-bell'])
})

test('a thread the page has seen before rings nothing', () => {
  const col = colony(village, 'castle')
  const crowd = crew(village, col)
  crowd.setRoster(roster(['t-1', 't-2', 't-3'], true))
  assert.equal(crowd.agents.length, 3)
  assert.ok(crowd.agents.every((a) => a.state !== 'spawning'), 'they were placed, not walked out')
  assert.deepEqual(col.played, [])
})

test(`eight new threads in one roster ring once, and another ${BELL_GAP} s later rings again`, () => {
  const col = colony(village, 'castle')
  const crowd = crew(village, col)
  const eight = Array.from({ length: 8 }, (_, i) => `t-${i}`)
  crowd.setRoster(roster(eight))
  assert.ok(crowd.agents.filter((a) => a.state === 'spawning').length > 1, 'several walked out together')
  assert.equal(col.played.length, 1, 'one bell for the batch')

  // Still inside the gap: news, but not a second bell.
  col.elapsed = BELL_GAP - 0.1
  crowd.setRoster(roster([...eight, 't-early']))
  assert.equal(crowd.byId.get('t-early').state, 'spawning')
  assert.equal(col.played.length, 1, `no second bell inside ${BELL_GAP} s`)

  col.elapsed = BELL_GAP
  crowd.setRoster(roster([...eight, 't-early', 't-late']))
  assert.equal(col.played.length, 2, 'the gap has passed')
  assert.equal(col.played[1].name, 'keep-bell')
})

test("a thread's helpers walking out ring nothing; the bell is for a new thread", () => {
  const col = colony(village, 'castle')
  const crowd = crew(village, col)
  crowd.setRoster([entry('t-1', true), { ...entry('helper:s-1'), size: 0.5 }, { ...entry('helper:s-2'), size: 0.5 }])
  assert.equal(crowd.byId.get('helper:s-1').state, 'spawning', 'the helper walked out')
  assert.deepEqual(col.played, [], 'a helper rang the keep bell')
  assert.equal(col._lastBell, -Infinity, 'a helper used up the gap')

  crowd.setRoster([entry('t-1', true), { ...entry('helper:s-1'), size: 0.5 }, entry('t-2')])
  assert.deepEqual(col.played.map((p) => p.name), ['keep-bell'], 'a new thread still rings')
})

test('the boat creaks rather than rings, and the space colony rings nothing', () => {
  for (const [manifest, kind] of [
    [village, 'boat'],
    [space, 'ship'],
  ]) {
    const col = colony(manifest, kind)
    crew(manifest, col).setRoster(roster(['t-1', 't-2']))
    col.elapsed = 10
    crew(manifest, col).setRoster(roster(['t-3']))
    assert.deepEqual(col.played, [], `${kind} rang`)
  }
})

test('with nothing listening the table is never read: a theme without sound has none to read', () => {
  // `onSound` is set only where there is an ambience, which only a theme with the `sound`
  // feature has — and only that theme is required to carry a `sounds` table.
  const silent = { ...village }
  delete silent.sounds
  const col = colony(silent, 'castle')
  col.onSound = null
  crew(silent, col).setRoster(roster(['t-1']))
  assert.equal(col._lastBell, -Infinity, 'no bell was counted')
})

test('the hook spends no draw', () => {
  const draws = (withHook) => {
    const col = colony(village, 'castle')
    const crowd = crew(village, col)
    if (!withHook) crowd.onEntrance = null
    const real = Math.random
    let n = 0
    Math.random = function () {
      n++
      return real.apply(this, arguments)
    }
    try {
      crowd.setRoster(roster(['t-1', 't-2', 't-3']))
    } finally {
      Math.random = real
    }
    return n
  }
  assert.equal(draws(true), draws(false))
})

/**
 * Everything above wires the crew to the bell by hand, the way the constructor does; this holds
 * the constructor to it. A whole `Colony` is built under Node with the four things that need a
 * browser or a loaded kit stood in for: `document` and `Path2D` (the face and badge atlases
 * paint on a canvas), the crew's meshes (`Astronauts._buildMeshes` instances the kit's glb) and
 * the terrain (`Colony._buildTerrain`, the ground and everything planted on it). The bell reads
 * none of them — only the theme, the ceremony's door and the colony's clock, all real here.
 */
test('a Colony wires its crew entrances to the arrival bell', async () => {
  const stub = () =>
    new Proxy(function () {}, {
      get: (_, p) => (p === Symbol.toPrimitive ? () => 0 : p === 'width' || p === 'height' ? 64 : stub()),
      apply: () => stub(),
      construct: () => stub(),
      set: () => true,
    })
  const had = { document: globalThis.document, Path2D: globalThis.Path2D }
  const meshes = Astronauts.prototype._buildMeshes
  const terrain = Colony.prototype._buildTerrain
  globalThis.document = stub()
  globalThis.Path2D = stub()
  Astronauts.prototype._buildMeshes = () => {}
  Colony.prototype._buildTerrain = () => {}
  try {
    const theme = await loadTheme(
      { space: () => import('../src/themes/space/index.js'), medieval: () => import('../src/themes/medieval/index.js') },
      'medieval',
      { baseUrl: '/', validate: () => [] }
    )
    const stored = new Map([['setting', 'forest']])
    const settings = { get: (k) => stored.get(k), set: (k, v) => stored.set(k, v), on: () => () => {} }
    const col = new Colony(new THREE.Scene(), settings, new THREE.PerspectiveCamera(), {}, theme)
    assert.equal(col.ceremony.kind, 'castle')
    const played = []
    col.onSound = (name, x, y, z, gain) => played.push({ name, gain })
    col.astronauts.onEntrance?.({ id: 'helper:s-1' })
    assert.deepEqual(played, [], 'a helper rings nothing')
    col.astronauts.onEntrance?.({ id: 't-1' })
    assert.deepEqual(played, [{ name: 'keep-bell', gain: 0.9 }], 'an entrance rings the keep bell')
  } finally {
    Astronauts.prototype._buildMeshes = meshes
    Colony.prototype._buildTerrain = terrain
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete globalThis[k]
      else globalThis[k] = v
    }
  }
})

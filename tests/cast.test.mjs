import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hash, characterFor, colourwayFor, clipFor, crewCharacters, kindForThread, strideRate, strikeCrossed, bonePlan, wornBy } from '../src/agents/cast.js'

const CHARS = [
  { id: 'knight', mesh: 'body_knight' },
  { id: 'engineer', mesh: 'body_engineer' },
  { id: 'mage', mesh: 'body_mage' },
]

test('hash is FNV-1a 32-bit and stable', () => {
  assert.equal(hash(''), 2166136261)
  assert.equal(hash('a'), 0xe40c292c)
  assert.equal(hash('fx-alpha-0'), hash('fx-alpha-0'))
})

test('characterFor is stable per id and covers the list', () => {
  const a = characterFor('fx-alpha-0', CHARS)
  assert.equal(a, characterFor('fx-alpha-0', CHARS))
  assert.ok(CHARS.includes(a))
  const seen = new Set()
  for (let i = 0; i < 200; i++) seen.add(characterFor(`thread-${i}`, CHARS).id)
  assert.equal(seen.size, 3)
})

test('a one-character list always yields that character and colourway 0', () => {
  const one = [{ id: 'crew', mesh: null }]
  for (let i = 0; i < 50; i++) {
    assert.equal(characterFor(`t${i}`, one), one[0])
    assert.equal(colourwayFor(`t${i}`, 1), 0)
  }
})

test('colourwayFor spreads over the count', () => {
  const seen = new Set()
  for (let i = 0; i < 200; i++) seen.add(colourwayFor(`thread-${i}`, 4))
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3])
})

test('clipFor reads a plain key or a byCharacter override', () => {
  const clips = {
    working: { default: 'work', byCharacter: { engineer: 'hammer', mage: 'cast' } },
    idle: 'idle',
  }
  assert.equal(clipFor(clips, 'idle', 'knight'), 'idle')
  assert.equal(clipFor(clips, 'working', 'knight'), 'work')
  assert.equal(clipFor(clips, 'working', 'engineer'), 'hammer')
  assert.equal(clipFor(clips, 'working', undefined), 'work')
  assert.equal(clipFor(clips, 'missing', 'knight'), undefined)
})

test('crewCharacters defaults a single-body crew', () => {
  assert.deepEqual(crewCharacters({ file: 'crew.glb' }), [{ id: 'crew', mesh: null }])
  assert.equal(crewCharacters({ characters: CHARS }), CHARS)
})

/** The crew's own walk speed, so the cases read as "at walking pace" rather than as numbers. */
const WALK = 2.1

test('strideRate takes the same pace in shorter steps as the body gets smaller', () => {
  assert.equal(strideRate(WALK, WALK), 1) // an adult at walking pace plays the clip as authored
  assert.equal(strideRate(WALK, WALK, 0.5), 2) // half the body, twice the steps: a scurry
  assert.equal(strideRate(0.2, WALK), 0.4) // floor: a dawdler still finishes its stride
  assert.equal(strideRate(99, WALK), 2.1) // ceiling: a sprinter's legs do not blur
  // No size is an adult, exactly — which is what keeps the screenshot baselines where they are.
  assert.equal(strideRate(1.3, WALK), strideRate(1.3, WALK, 1))
})

test('strikeCrossed fires once per loop, wrap included', () => {
  assert.equal(strikeCrossed(0.4, 0.55, 0.5), true)
  assert.equal(strikeCrossed(0.55, 0.7, 0.5), false)
  assert.equal(strikeCrossed(0.9, 0.05, 0.5), false) // wrapped past a strike already fired
  assert.equal(strikeCrossed(0.9, 0.05, 0.95), true) // wrapped through a late strike
  assert.equal(strikeCrossed(-1, 0.6, 0.5), true)
  assert.equal(strikeCrossed(0.4, -1, 0.5), false)
})

/** A villager mid-swing: playing its own work clip, so a `when: 'working'` part is on. */
const working = (extra = {}) => ({ clipKey: 'hammer', workClip: 'hammer', character: 'knight', cue: null, ...extra })

test('wornBy: a part with no gates is worn by everybody', () => {
  assert.equal(wornBy({}, working()), true)
  assert.equal(wornBy({}, working({ clipKey: 'idle', character: 'mage', cue: 'helper' })), true)
})

test('wornBy: `when: working` follows the body’s own work clip', () => {
  assert.equal(wornBy({ when: 'working' }, working()), true)
  assert.equal(wornBy({ when: 'working' }, working({ clipKey: 'walk' })), false)
  // A clip key that matches another body's work clip is not this body's.
  assert.equal(wornBy({ when: 'working' }, working({ clipKey: 'cast' })), false)
})

test('wornBy: `character` limits a part to one body', () => {
  assert.equal(wornBy({ character: 'knight' }, working()), true)
  assert.equal(wornBy({ character: 'mage' }, working()), false)
})

test('wornBy: a cue part is worn only by an agent carrying that cue', () => {
  assert.equal(wornBy({ cue: 'helper' }, working()), false, 'a thread’s villager carries no cue')
  assert.equal(wornBy({ cue: 'helper' }, working({ cue: 'helper' })), true)
  assert.equal(wornBy({ cue: 'helper' }, working({ cue: 'something-else' })), false)
  // And the reverse: an agent with a cue still wears everything the rest of the crew wears.
  assert.equal(wornBy({}, working({ cue: 'helper' })), true)
  assert.equal(wornBy({ character: 'knight' }, working({ cue: 'helper' })), true)
})

test('wornBy: the gates only ever narrow, never widen', () => {
  const spec = { when: 'working', character: 'knight', cue: 'helper' }
  assert.equal(wornBy(spec, working({ cue: 'helper' })), true)
  assert.equal(wornBy(spec, working({ cue: 'helper', clipKey: 'walk' })), false)
  assert.equal(wornBy(spec, working({ cue: 'helper', character: 'druid' })), false)
  assert.equal(wornBy(spec, working()), false)
})

const entry = (name, bone) => [name, { userData: { spec: { bone } } }]

/**
 * `_writeMatrices` fetches a bone matrix whenever the bone changes between consecutive parts,
 * so the walk order decides how many fetches a frame costs. The space list as declared runs
 * head, head, chest, head, head, chest, hand, head: six changes over three bones.
 */
test('bonePlan groups parts by bone, in first-seen bone order', () => {
  const plan = bonePlan([
    entry('visor', 'head'), entry('helmet', 'head'), entry('lamp', 'chest'), entry('antenna', 'head'),
    entry('ear', 'head'), entry('pack', 'chest'), entry('tool', 'hand'), entry('face', 'head'),
  ])
  assert.deepEqual(plan.map(([n]) => n), ['visor', 'helmet', 'antenna', 'ear', 'face', 'lamp', 'pack', 'tool'])
  let changes = 0
  for (let i = 1; i < plan.length; i++) if (plan[i][1].userData.spec.bone !== plan[i - 1][1].userData.spec.bone) changes++
  assert.equal(changes, 2)
})

test('bonePlan keeps declaration order inside a bone and returns a new array', () => {
  const src = [entry('a', 'hand'), entry('b', 'head'), entry('c', 'hand')]
  const plan = bonePlan(src)
  assert.deepEqual(plan.map(([n]) => n), ['a', 'c', 'b'])
  assert.notEqual(plan, src)
  assert.deepEqual(src.map(([n]) => n), ['a', 'b', 'c'])
})

test('bonePlan of an empty list is empty', () => {
  assert.deepEqual(bonePlan([]), [])
})

/** Two characters, so a hash lands on one or the other and the lists stay easy to read. */
const PAIR = [{ id: 'a' }, { id: 'b' }]

test('kindForThread is null without a map or without a list for the character', () => {
  assert.equal(kindForThread('t1', undefined, PAIR), null)
  assert.equal(kindForThread('t1', {}, PAIR), null)
})

test('kindForThread picks from the character list, stably', () => {
  const map = { a: ['home', 'mill'], b: ['tower'] }
  for (const id of ['t1', 't2', 'zzz']) {
    const c = characterFor(id, PAIR).id
    const k = kindForThread(id, map, PAIR)
    assert.ok(map[c].includes(k), `${id} -> ${c} -> ${k}`)
    assert.equal(kindForThread(id, map, PAIR), k)
  }
})

test('kindForThread does not follow the character draw bit for bit', () => {
  const map = { a: ['x', 'y'], b: ['x', 'y'] }
  const picks = new Set()
  for (let i = 0; i < 40; i++) picks.add(kindForThread(`t${i}`, map, PAIR))
  assert.equal(picks.size, 2)
})

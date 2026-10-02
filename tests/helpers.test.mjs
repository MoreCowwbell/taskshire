/**
 * The two browser decisions behind the subagent crew, both kept in three-free modules so
 * node can read them: which helpers a thread puts on the map, and whether a scan is fresh
 * enough to apply at all.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HELPER_CUE, HELPER_SIZE, helperEntries, helperId, isHelperId } from '../src/game/helpers.js'

const sub = (id, extra = {}) => ({ id, name: id, agentType: 'coder', description: '', model: 'm', ...extra })
const thread = (state, subagents) => ({ id: 't1', title: 'A thread', state, subagents })
/** Stands in for `_workSite`, which needs a plot and a building; the shape is all that matters. */
const siteFor = (k, n) => ({ k, n })

test('helperEntries: an open thread puts one entry on the map per subagent', () => {
  const t = thread('active', [sub('agent-a'), sub('agent-b')])
  const entries = helperEntries(t, siteFor, 'anchor', 0x336699)

  assert.equal(entries.length, 2)
  assert.deepEqual(
    entries.map((e) => e.id),
    ['helper:agent-a', 'helper:agent-b']
  )
  assert.equal(entries[0].thread, t, 'a helper carries the thread it is helping')
  assert.equal(entries[0].helper.id, 'agent-a')
  assert.equal(entries[0].anchor, 'anchor')
  assert.equal(entries[0].accent, 0x336699)
  // Working by definition: a subagent that has stopped is one that has left.
  assert.deepEqual(
    entries.map((e) => e.status),
    ['working', 'working']
  )
  // The site is asked for once per helper, told how many there are so they can share a ring.
  assert.deepEqual(
    entries.map((e) => e.site),
    [
      { k: 0, n: 2 },
      { k: 1, n: 2 },
    ]
  )
})

test('helpers stand half height, carried on the entry and nowhere else', () => {
  assert.equal(HELPER_SIZE, 0.5)
  const entries = helperEntries(thread('active', [sub('agent-a'), sub('agent-b')]), siteFor, null, 0)
  for (const e of entries) assert.equal(e.size, HELPER_SIZE)
  // A thread's own entry carries no `size` at all — the crew defaults it to 1, so every
  // villager that is not a helper is composed from exactly the numbers it was before.
})

test('every helper wears the cue, and it is the same one in both themes', () => {
  assert.equal(HELPER_CUE, 'helper')
  const entries = helperEntries(thread('active', [sub('agent-a'), sub('agent-b')]), siteFor, null, 0)
  for (const e of entries) assert.equal(e.cue, HELPER_CUE)
  // Beside `size`, not instead of it: half height and the cap are two separate reads.
  for (const e of entries) assert.equal(e.size, HELPER_SIZE)
  // The cue is the same for every kind of subagent — `agentType` is an open set, and the
  // card already names the kind in words.
  const mixed = helperEntries(
    thread('active', [sub('a', { agentType: 'explore' }), sub('b', { agentType: 'reviewer' }), sub('c', { agentType: 'wildly-custom' })]),
    siteFor,
    null,
    0
  )
  assert.deepEqual(new Set(mixed.map((e) => e.cue)), new Set([HELPER_CUE]))
})

test('helperEntries: only active and idle threads have anybody to help', () => {
  const subagents = [sub('agent-a')]
  assert.equal(helperEntries(thread('active', subagents), siteFor, null, 0).length, 1)
  assert.equal(helperEntries(thread('idle', subagents), siteFor, null, 0).length, 1)
  assert.equal(helperEntries(thread('inactive', subagents), siteFor, null, 0).length, 0)
  assert.equal(helperEntries(thread('archived', subagents), siteFor, null, 0).length, 0)
})

test('helperEntries: no subagents asks for nothing at all', () => {
  let asked = 0
  const count = (k, n) => {
    asked++
    return { k, n }
  }
  // The screenshot baselines rest on this: a roster with no helpers must allocate nothing.
  assert.deepEqual(helperEntries(thread('active', []), count, null, 0), [])
  assert.deepEqual(helperEntries(thread('active', undefined), count, null, 0), [])
  assert.deepEqual(helperEntries(null, count, null, 0), [])
  assert.equal(asked, 0)
})

test('helper ids are the subagent id behind a prefix, and nothing else reads as one', () => {
  assert.equal(helperId('agent-a'), 'helper:agent-a')
  assert.equal(isHelperId('helper:agent-a'), true)
  assert.equal(isHelperId('agent-a'), false)
  assert.equal(isHelperId('c60f899b-3082-48e9-b28e-60a3083695a2'), false)
  assert.equal(isHelperId(null), false)
  assert.equal(isHelperId(undefined), false)
})

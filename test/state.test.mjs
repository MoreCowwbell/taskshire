/**
 * The colony file: migration, and the merge that stops two tabs eating each other.
 *
 * These are the pieces where a mistake loses somebody's archive list silently, which is why they
 * were made pure and testable rather than left inline.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mergeState } from '../src/game/merge-state.js'
import { withServer } from './support/with-server.mjs'

// ── the three-way merge ───────────────────────────────────────────────────────

test('an addition from each tab survives the merge', () => {
  const out = mergeState({ archived: ['a'] }, { archived: ['a', 'mine'] }, { archived: ['a', 'theirs'] })
  assert.deepEqual(out.archived.sort(), ['a', 'mine', 'theirs'])
})

test('a removal survives the merge — a plain union would resurrect it', () => {
  const out = mergeState({ archived: ['t1'] }, { archived: [] }, { archived: ['t1', 't2'] })
  assert.deepEqual(out.archived, ['t2'])
})

test('two tabs moving different zones both keep their move', () => {
  const out = mergeState(
    { plots: { a: [[0, 0]], b: [[1, 1]] } },
    { plots: { a: [[9, 9]], b: [[1, 1]] } },
    { plots: { a: [[0, 0]], b: [[7, 7]] } }
  )
  assert.deepEqual(out.plots, { a: [[9, 9]], b: [[7, 7]] })
})

test('a zone this tab never touched is left exactly as the other tab left it', () => {
  // Rebuilt-but-identical arrays must not read as "changed here" — that is what would let a
  // stale copy paste back over a zone somebody else moved.
  const out = mergeState({ plots: { a: [[0, 0]] } }, { plots: { a: [[0, 0]] } }, { plots: { a: [[4, 4]] } })
  assert.deepEqual(out.plots, { a: [[4, 4]] })
})

test('hiding and pinning a repo survive a conflicting save', () => {
  assert.deepEqual(mergeState({ hidden: [] }, { hidden: ['x'] }, { hidden: [] }).hidden, ['x'])
  assert.deepEqual(mergeState({ pinned: [] }, { pinned: [] }, { pinned: ['y'] }).pinned, ['y'])
})

test('clearing a group survives a conflicting save, and so does a repo waking back out of it', () => {
  assert.deepEqual(mergeState({ forgotten: [] }, { forgotten: ['x'] }, { forgotten: [] }).forgotten, ['x'])
  // The removal half matters as much: a repo that woke up here must not be put back on the
  // list by the other tab's copy, or its zone would leave the map again on the next poll.
  assert.deepEqual(mergeState({ forgotten: ['x'] }, { forgotten: [] }, { forgotten: ['x'] }).forgotten, [])
})

test('a pruned seen row stays pruned through a conflicting save', () => {
  // `reconcileSeen` forgetting a thread is a key deletion, and a deletion is the one thing a
  // plain union would undo: the other tab still has the row, so the merge would put it back
  // and the prune would never survive a 409.
  const out = mergeState({ seen: { a: 1 } }, { seen: {} }, { seen: { a: 1, b: 2 } })
  assert.deepEqual(out.seen, { b: 2 })
})

test('settings are not merged field-wise — the last tab to touch a slider wins whole', () => {
  const out = mergeState({ settings: { q: 1 } }, { settings: { q: 3 } }, { settings: { q: 2, planet: 'mars' } })
  assert.deepEqual(out.settings, { q: 3 })
})

// ── the API, against a real socket ────────────────────────────────────────────

// ── the save gate ─────────────────────────────────────────────────────────────

/**
 * The page boots holding an empty archive list and only swaps it for the real one when the
 * read resolves. A save inside that window PUTs the empty list, and the server allows it: the
 * base is still 0, which it reads as a first write. Nothing else catches this — the wipe even
 * hides itself afterwards, because the scan carries each harness's own archived flag and a
 * wiped file reads back populated.
 *
 * So the refusal has to happen before the request leaves, which is what this asserts: not that
 * the save fails, but that nothing was sent at all.
 */
test('a colony that was never read is not saved — the request never leaves', async () => {
  const { saveState } = await import('../src/game/api.js')
  const realFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (...args) => {
    calls++
    return realFetch(...args)
  }
  try {
    await assert.rejects(() => saveState({ archived: [] }), /never read/)
    assert.equal(calls, 0, 'a colony that was never read must not reach the network')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a v1 file has its bare ids prefixed on read, once', async () => {
  await withServer(async ({ call, dir }) => {
    const id = 'fe911daa-2393-4e29-8d36-6e37c328594c'
    await fsp.writeFile(
      path.join(dir, 'colony.json'),
      JSON.stringify({ version: 1, archived: [id], archivedAt: { [id]: 5 }, updatedAt: 1 })
    )
    const state = await (await call('/api/state')).json()
    assert.equal(state.version, 2)
    assert.deepEqual(state.archived, [`claude-code:${id}`])
    assert.deepEqual(Object.keys(state.archivedAt), [`claude-code:${id}`])
  })
})

test('a stale save is refused with the disk state, not silently applied', async () => {
  await withServer(async ({ call, put }) => {
    const seed = await (await put({ archived: ['seed'] })).json()
    assert.equal((await put({ archived: ['ok'], baseUpdatedAt: seed.updatedAt })).status, 200)
    const stale = await put({ archived: ['lost'], baseUpdatedAt: seed.updatedAt })
    assert.equal(stale.status, 409)
    assert.deepEqual((await stale.json()).archived, ['ok'])
    void call
  })
})

test('a save with no base is allowed, so curl and a fresh install both work', async () => {
  await withServer(async ({ put }) => {
    assert.equal((await put({ archived: ['first'] })).status, 200)
  })
})

test('simultaneous saves never 500 — one wins, the rest get a mergeable 409', async () => {
  await withServer(async ({ call, put }) => {
    const seed = await (await put({ archived: ['seed'] })).json()
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => put({ archived: [`t${i}`], baseUpdatedAt: seed.updatedAt }))
    )
    const codes = results.map((r) => r.status)
    assert.equal(codes.filter((c) => c === 200).length, 1, 'exactly one writer wins')
    assert.equal(codes.filter((c) => c === 409).length, 4, 'the rest are told to merge')
    assert.ok(!codes.some((c) => c >= 500), `no crashes, got ${codes}`)
    void call
  })
})

test('archiving is not a server endpoint any more — the colony owns that list', async () => {
  await withServer(async ({ call }) => {
    const res = await call('/api/archive', { method: 'POST', body: JSON.stringify({ id: 'x' }) })
    assert.equal(res.status, 404)
  })
})

test('a cross-origin write is refused even though the host is local', async () => {
  await withServer(async ({ call }) => {
    const res = await fetch(new URL('/api/state', `http://127.0.0.1:0`), { method: 'PUT' }).catch(() => null)
    void res
    const bad = await call('/api/state', { method: 'PUT', body: '{}', headers: { Origin: 'http://evil.com' } })
    assert.equal(bad.status, 403)
  })
})

test('a save that cannot land is a 500, and the server lives to answer the next request', { timeout: 10_000 }, async () => {
  // A directory where the file should be makes the rename fail on every platform — the stand-in
  // for a lock that outlasts the retries. Before the fix this rejection escaped the handler and
  // killed the process, which is how a theme switch took `npm run dev` down.
  await withServer(async ({ call, dir, put }) => {
    await fsp.mkdir(path.join(dir, 'colony.json'))
    const res = await put({ archived: [] })
    assert.equal(res.status, 500)
    assert.equal((await call('/api/state')).status, 200)
  })
})

// ── marking a thread viewed ───────────────────────────────────────────────────

/**
 * The rule `applyThreads` uses. Kept here as well because it is one line in the browser and
 * the whole point of it is the *second* half: viewed is a timestamp, not a flag, so a thread
 * that moves on afterwards starts asking again.
 */
const suppressUnread = (thread, viewedAt) => {
  const at = viewedAt[thread.id]
  return at && thread.lastActivityAt <= at ? { ...thread, unread: false } : thread
}

test('marking a thread viewed stops it asking', () => {
  const t = { id: 'a', unread: true, lastActivityAt: 100 }
  assert.equal(suppressUnread(t, { a: 200 }).unread, false)
})

test('a thread that moves on after you looked asks again', () => {
  const t = { id: 'a', unread: true, lastActivityAt: 300 }
  assert.equal(suppressUnread(t, { a: 200 }).unread, true, 'newer activity beats an older look')
})

test('viewing one thread says nothing about another', () => {
  const t = { id: 'b', unread: true, lastActivityAt: 100 }
  assert.equal(suppressUnread(t, { a: 200 }).unread, true)
})

test('viewedAt survives a merge, so a second tab cannot un-view a thread', () => {
  const merged = mergeState({ viewedAt: {} }, { viewedAt: { a: 5 } }, { viewedAt: { b: 7 } })
  assert.deepEqual(merged.viewedAt, { a: 5, b: 7 })
})

test('viewedAt is carried through the v1 migration with the ids it keys on', async () => {
  await withServer(async ({ call, dir }) => {
    const id = 'fe911daa-2393-4e29-8d36-6e37c328594c'
    await fsp.writeFile(
      path.join(dir, 'colony.json'),
      JSON.stringify({ version: 1, viewedAt: { [id]: 42 }, updatedAt: 1 })
    )
    const state = await (await call('/api/state')).json()
    assert.deepEqual(Object.keys(state.viewedAt), [`claude-code:${id}`])
  })
})

test('the v1 migration prefixes seen and opened too, and leaves a desktop id alone', async () => {
  await withServer(async ({ call, dir }) => {
    const uuid = 'fe911daa-2393-4e29-8d36-6e37c328594c'
    // `local_…` is a desktop record id, not a bare UUID, so `migrateId` must not touch it —
    // the ref rescue in `reconcileArchived` is what matches those, and it matches them bare.
    const desktop = `local_${uuid}`
    await fsp.writeFile(
      path.join(dir, 'colony.json'),
      JSON.stringify({
        version: 1,
        opened: [uuid, desktop],
        seen: { [uuid]: 11, [desktop]: 22 },
        updatedAt: 1,
      })
    )
    const state = await (await call('/api/state')).json()
    assert.deepEqual(state.opened, [`claude-code:${uuid}`, desktop])
    assert.deepEqual(state.seen, { [`claude-code:${uuid}`]: 11, [desktop]: 22 })
  })
})

// ── reconcileArchived ─────────────────────────────────────────────────────────

/** The colony list is the only archive there is, so what it stamps on a thread is the contract. */
async function withState(state, run) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bot-crossing-recon-'))
  process.env.BOT_CROSSING_DATA = dir
  await fsp.writeFile(path.join(dir, 'colony.json'), JSON.stringify({ version: 2, updatedAt: 1, ...state }))
  try {
    const { reconcileArchived } = await import(`../server/api.mjs?${dir}`)
    await run(reconcileArchived)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

test('an archived thread is stamped archived, because the browser keys on state', async () => {
  await withState({ archived: ['claude-code:a'] }, async (reconcileArchived) => {
    const [t] = await reconcileArchived([{ id: 'claude-code:a', harness: 'claude-code', state: 'active' }])
    assert.equal(t.archived, true)
    assert.equal(t.state, 'archived', 'a live archived session must not keep its character')
  })
})

test('a thread nobody archived is returned untouched, object identity included', async () => {
  await withState({ archived: ['claude-code:a'] }, async (reconcileArchived) => {
    const input = { id: 'claude-code:b', harness: 'claude-code', state: 'idle' }
    const [t] = await reconcileArchived([input])
    assert.equal(t, input, 'no copy, so an unchanged poll stays cheap')
    assert.equal(t.state, 'idle')
  })
})

test('an archive follows a thread that re-keys, through the ids inside ref', async () => {
  // Archived while the desktop record was canonical; the transcript has since appeared and the
  // thread now answers to its CLI UUID. The list still holds the old id.
  const uuid = 'fe911daa-2393-4e29-8d36-6e37c328594c'
  await withState({ archived: [`claude-code:local_${uuid}`] }, async (reconcileArchived) => {
    const [t] = await reconcileArchived([
      { id: `claude-code:${uuid}`, harness: 'claude-code', state: 'inactive', ref: { desktopSessionIds: [`local_${uuid}`] } },
    ])
    assert.equal(t.state, 'archived', 'the ref rescue has to try the harness prefix, or it is dead code')
  })
})

test('a v1 archive of a bare desktop id still matches, unprefixed', async () => {
  const uuid = 'fe911daa-2393-4e29-8d36-6e37c328594c'
  await withState({ archived: [`local_${uuid}`] }, async (reconcileArchived) => {
    const [t] = await reconcileArchived([
      { id: `claude-code:${uuid}`, harness: 'claude-code', state: 'inactive', ref: { desktopSessionId: `local_${uuid}` } },
    ])
    assert.equal(t.state, 'archived')
  })
})

test('an empty archive list short-circuits and returns the same array', async () => {
  await withState({ archived: [] }, async (reconcileArchived) => {
    const input = [{ id: 'claude-code:a', harness: 'claude-code', state: 'active' }]
    assert.equal(await reconcileArchived(input), input)
  })
})

// ── what the colony file and its answers give away ────────────────────────────

// Windows has no mode bits to check: the file takes its folder's ACL there instead.
test('colony.json is written readable by its owner only — it names every repo you work in', { skip: process.platform === 'win32' }, async () => {
  await withServer(async ({ put, dir }) => {
    assert.equal((await put({ archived: ['t1'] })).status, 200)
    const mode = (await fsp.stat(path.join(dir, 'colony.json'))).mode & 0o777
    assert.equal(mode, 0o600)
    // And stays so on the next write: a fresh temp file every time, renamed into place.
    assert.equal((await put({ archived: ['t1', 't2'] })).status, 200)
    assert.equal((await fsp.stat(path.join(dir, 'colony.json'))).mode & 0o777, 0o600)
  })
})

test('every JSON answer says it is JSON and nothing else', async () => {
  await withServer(async ({ call }) => {
    const res = await call('/api/state')
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(res.headers.get('cache-control'), 'no-store')
  })
})

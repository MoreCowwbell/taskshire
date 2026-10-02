/**
 * The colony draws a figure only for a thread whose `state` is `active` or `idle`, so every
 * harness has to say which of the four states each thread is in — a thread with `running` and
 * no `state` simply vanishes from the map.
 *
 * Each of the four harnesses that arrived in upstream sync 3 is driven through its own
 * `scanThreads` over a fixture store built here: SQLite databases for OpenCode, Kilo Code and
 * Hermes, a brain folder for Antigravity. Hermes and Antigravity resolve their paths at import,
 * so every env var is set before the dynamic imports below. The colony's own archive list goes
 * through the real `reconcileArchived`, with `BOT_CROSSING_DATA` pointed at a temp folder.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'harness-states-'))
const DATA = path.join(root, 'data')
const OPENCODE_DB = path.join(root, 'opencode', 'opencode.db')
const KILO_DB = path.join(root, 'kilo', 'kilo.db')
const HERMES_HOME = path.join(root, 'hermes')
const ANTIGRAVITY_HOME = path.join(root, 'antigravity')
for (const dir of [DATA, path.dirname(OPENCODE_DB), path.dirname(KILO_DB), HERMES_HOME, ANTIGRAVITY_HOME]) {
  await fsp.mkdir(dir, { recursive: true })
}
Object.assign(process.env, {
  BOT_CROSSING_DATA: DATA,
  OPENCODE_DB,
  KILO_DB,
  HERMES_HOME,
  BOT_CROSSING_ANTIGRAVITY_HOME: ANTIGRAVITY_HOME,
})

const NOW = Date.now()
const MIN = 60 * 1000
const HOURS_AGO = (h) => NOW - h * 60 * MIN
const STATES = new Set(['active', 'idle', 'inactive', 'archived'])

// ── fixture stores ────────────────────────────────────────────────────────────

/**
 * OpenCode and Kilo Code share one schema (Kilo is rebuilt on the OpenCode server), taken from
 * the fixtures in test/harness.test.mjs. Each session is `[id, lastMessage, timeUpdated, archivedAt]`.
 */
function sqliteSessionStore(file, sessions) {
  const db = new DatabaseSync(file)
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, directory TEXT NOT NULL, title TEXT NOT NULL, agent TEXT, model TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER)`)
  db.exec(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  db.exec(`CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  const ins = db.prepare(`INSERT INTO session (id, project_id, parent_id, directory, title, agent, model, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const mins = db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
  const pins = db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
  for (const [id, last, updated, archivedAt] of sessions) {
    ins.run(id, 'global', null, '/tmp/demo', `Thread ${id}`, 'build', null, updated - MIN, updated, archivedAt)
    mins.run(`m_${id}`, id, updated - MIN, updated, JSON.stringify(last))
    pins.run(`p_${id}`, `m_${id}`, id, updated - MIN, updated, JSON.stringify({ type: 'text', text: 'ship it' }))
  }
  db.close()
}

// A turn still open (the assistant has not finished) and a finished one.
const OPEN_TURN = { role: 'assistant', time: { created: NOW - MIN } }
const USER_ASKED = { role: 'user', time: { created: NOW - MIN } }
const DONE_TURN = { role: 'assistant', time: { created: NOW - 2 * MIN, completed: NOW - MIN }, finish: 'stop' }

const OC = {
  midTurn: 'ses_ocmidturn000000000000000000',
  userAsked: 'ses_ocuserasked0000000000000000',
  ended: 'ses_ocended00000000000000000000',
  colonyArchived: 'ses_occolonyarch000000000000000',
  harnessArchived: 'ses_ocharnessarch00000000000000',
  stale: 'ses_ocstale00000000000000000000',
}
sqliteSessionStore(OPENCODE_DB, [
  [OC.midTurn, OPEN_TURN, NOW, null],
  [OC.userAsked, USER_ASKED, NOW, null],
  [OC.ended, DONE_TURN, NOW, null],
  [OC.colonyArchived, OPEN_TURN, NOW, null],
  [OC.harnessArchived, DONE_TURN, NOW, NOW],
  [OC.stale, OPEN_TURN, HOURS_AGO(6), null],
])

const KILO = {
  midTurn: 'ses_kilomidturn0000000000000000',
  ended: 'ses_kiloended000000000000000000',
  colonyArchived: 'ses_kilocolonyarch0000000000000',
  harnessArchived: 'ses_kiloharnessarch000000000000',
  stale: 'ses_kilostale000000000000000000',
}
sqliteSessionStore(KILO_DB, [
  [KILO.midTurn, OPEN_TURN, NOW, null],
  [KILO.ended, DONE_TURN, NOW, null],
  [KILO.colonyArchived, OPEN_TURN, NOW, null],
  [KILO.harnessArchived, DONE_TURN, NOW, NOW],
  [KILO.stale, OPEN_TURN, HOURS_AGO(6), null],
])

/**
 * Hermes: the columns its adapter selects, and nothing else. Times are epoch *seconds*, as the
 * adapter reads them. Each session is `[id, { ended, last, archived, roles }]`.
 */
const HERMES = {
  midTurn: '20260925_100000_midturn',
  toolRunning: '20260925_100000_toolrun',
  waiting: '20260925_100000_waiting',
  fresh: '20260925_100000_fresh',
  ended: '20260925_100000_ended',
  colonyArchived: '20260925_100000_colonyarch',
  harnessArchived: '20260925_100000_harnessarch',
  stale: '20260925_100000_stale',
}
{
  const db = new DatabaseSync(path.join(HERMES_HOME, 'state.db'))
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, model TEXT, source TEXT, cwd TEXT, git_branch TEXT, git_repo_root TEXT, started_at REAL, ended_at REAL, message_count INTEGER, input_tokens INTEGER, output_tokens INTEGER, archived INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, last_activity_at REAL, last_read_at REAL)`)
  db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, active INTEGER DEFAULT 1)`)
  const ins = db.prepare(`INSERT INTO sessions (id, title, model, source, cwd, git_branch, git_repo_root, started_at, ended_at, message_count, input_tokens, output_tokens, archived, hidden, last_activity_at, last_read_at) VALUES (?, ?, 'm', 'cli', '/tmp/demo', '', '/tmp/demo', ?, ?, ?, 0, 0, ?, 0, ?, NULL)`)
  const msg = db.prepare(`INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)`)
  const secs = (ms) => ms / 1000
  const rows = [
    [HERMES.midTurn, { ended: null, last: NOW, roles: ['user'] }],
    [HERMES.toolRunning, { ended: null, last: NOW, roles: ['user', 'assistant', 'tool'] }],
    [HERMES.waiting, { ended: null, last: NOW, roles: ['user', 'assistant'] }],
    [HERMES.fresh, { ended: null, last: NOW, roles: [] }],
    [HERMES.ended, { ended: NOW - MIN, last: NOW - MIN, roles: ['user', 'assistant'] }],
    [HERMES.colonyArchived, { ended: null, last: NOW, roles: ['user'] }],
    [HERMES.harnessArchived, { ended: null, last: NOW, roles: ['user'], archived: 1 }],
    [HERMES.stale, { ended: null, last: HOURS_AGO(6), roles: ['user', 'assistant'] }],
  ]
  for (const [id, s] of rows) {
    ins.run(id, `Thread ${id}`, secs(s.last - MIN), s.ended == null ? null : secs(s.ended), s.roles.length, s.archived || 0, secs(s.last))
    for (const role of s.roles) msg.run(id, role, `${role} says hi`)
  }
  db.close()
}

/** Antigravity: one brain folder per session, UUID-named, holding a JSONL transcript. */
const AG = {
  midTurn: '11111111-1111-4111-8111-111111111111',
  ended: '22222222-2222-4222-8222-222222222222',
  colonyArchived: '33333333-3333-4333-8333-333333333333',
  stale: '44444444-4444-4444-8444-444444444444',
}
async function brainSession(id, records, mtime) {
  const dir = path.join(ANTIGRAVITY_HOME, 'brain', id, '.system_generated', 'logs')
  await fsp.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'transcript.jsonl')
  await fsp.writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  if (mtime) await fsp.utimes(file, new Date(mtime), new Date(mtime))
}
const ASK = { type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '<USER_REQUEST>fix the login bug</USER_REQUEST>', created_at: new Date(NOW - MIN).toISOString() }
await brainSession(AG.midTurn, [ASK])
await brainSession(AG.ended, [ASK, { type: 'PLANNER_RESPONSE', status: 'DONE' }])
await brainSession(AG.colonyArchived, [ASK])
await brainSession(AG.stale, [ASK], HOURS_AGO(6))

// The colony's own archive list: the thread ids exactly as the adapters prefix them.
await fsp.writeFile(
  path.join(DATA, 'colony.json'),
  JSON.stringify({
    version: 2,
    archived: [
      `opencode:${OC.colonyArchived}`,
      `kilocode:${KILO.colonyArchived}`,
      `hermes:main:${HERMES.colonyArchived}`,
      `antigravity:${AG.colonyArchived}`,
    ],
  })
)

// ── imported only now, with every path in place ───────────────────────────────

const { reconcileArchived } = await import('../server/api.mjs')
const bust = `?states=${encodeURIComponent(root)}`
const adapters = {
  opencode: (await import(`../server/harnesses/opencode.mjs${bust}`)).default,
  kilocode: (await import(`../server/harnesses/kilocode.mjs${bust}`)).default,
  hermes: (await import(`../server/harnesses/hermes.mjs${bust}`)).default,
  antigravity: (await import(`../server/harnesses/antigravity.mjs${bust}`)).default,
}

after(() => fsp.rm(root, { recursive: true, force: true }))

/** What the scan hands the page: the adapter's threads, stamped as `scan.mjs` does, then reconciled. */
async function statesOf(harness) {
  const h = adapters[harness]
  const threads = (await h.scanThreads()).map((t) => ({ ...t, harness: h.id, harnessName: h.name }))
  const reconciled = await reconcileArchived(threads)
  return { raw: new Map(threads.map((t) => [t.id, t])), byId: new Map(reconciled.map((t) => [t.id, t])) }
}
const stateOf = async (harness, id) => {
  const t = (await statesOf(harness)).byId.get(id)
  assert.ok(t, `${id} was not scanned`)
  return t.state
}

// ── OpenCode ─────────────────────────────────────────────────────────────────

test('opencode: an assistant turn still open is active', async () => {
  assert.equal(await stateOf('opencode', `opencode:${OC.midTurn}`), 'active')
})

test('opencode: a trailing user message means the model speaks next — active', async () => {
  assert.equal(await stateOf('opencode', `opencode:${OC.userAsked}`), 'active')
})

test('opencode: a finished turn is inactive, never idle — there is no telling an open app from a closed one', async () => {
  assert.equal(await stateOf('opencode', `opencode:${OC.ended}`), 'inactive')
})

test('opencode: a thread on the colony archive list is archived even mid-turn', async () => {
  const { raw, byId } = await statesOf('opencode')
  assert.equal(raw.get(`opencode:${OC.colonyArchived}`).state, 'active', 'the adapter alone sees it working')
  assert.equal(byId.get(`opencode:${OC.colonyArchived}`).state, 'archived')
})

test('opencode: a session archived in OpenCode itself is archived', async () => {
  assert.equal(await stateOf('opencode', `opencode:${OC.harnessArchived}`), 'archived')
})

test('opencode: an open turn untouched for hours is inactive', async () => {
  assert.equal(await stateOf('opencode', `opencode:${OC.stale}`), 'inactive')
})

// ── Kilo Code ────────────────────────────────────────────────────────────────

test('kilocode: an assistant turn still open is active', async () => {
  assert.equal(await stateOf('kilocode', `kilocode:${KILO.midTurn}`), 'active')
})

test('kilocode: a finished turn is inactive', async () => {
  assert.equal(await stateOf('kilocode', `kilocode:${KILO.ended}`), 'inactive')
})

test('kilocode: a thread on the colony archive list is archived even mid-turn', async () => {
  const { raw, byId } = await statesOf('kilocode')
  assert.equal(raw.get(`kilocode:${KILO.colonyArchived}`).state, 'active')
  assert.equal(byId.get(`kilocode:${KILO.colonyArchived}`).state, 'archived')
})

test('kilocode: a session archived in Kilo itself is archived', async () => {
  assert.equal(await stateOf('kilocode', `kilocode:${KILO.harnessArchived}`), 'archived')
})

test('kilocode: an open turn untouched for hours is inactive', async () => {
  assert.equal(await stateOf('kilocode', `kilocode:${KILO.stale}`), 'inactive')
})

// ── Hermes ───────────────────────────────────────────────────────────────────

test('hermes: an open session whose last message is the user is active', async () => {
  assert.equal(await stateOf('hermes', `hermes:main:${HERMES.midTurn}`), 'active')
})

test('hermes: an open session waiting on a tool result is active', async () => {
  assert.equal(await stateOf('hermes', `hermes:main:${HERMES.toolRunning}`), 'active')
})

test('hermes: an open session whose last message is the agent is idle — waiting on the user', async () => {
  assert.equal(await stateOf('hermes', `hermes:main:${HERMES.waiting}`), 'idle')
})

test('hermes: an open session nobody has typed into yet is idle', async () => {
  assert.equal(await stateOf('hermes', `hermes:main:${HERMES.fresh}`), 'idle')
})

test('hermes: an ended session is inactive', async () => {
  assert.equal(await stateOf('hermes', `hermes:main:${HERMES.ended}`), 'inactive')
})

test('hermes: a thread on the colony archive list is archived even mid-turn', async () => {
  const { raw, byId } = await statesOf('hermes')
  assert.equal(raw.get(`hermes:main:${HERMES.colonyArchived}`).state, 'active')
  assert.equal(byId.get(`hermes:main:${HERMES.colonyArchived}`).state, 'archived')
})

test('hermes: a session archived in Hermes itself is archived', async () => {
  assert.equal(await stateOf('hermes', `hermes:main:${HERMES.harnessArchived}`), 'archived')
})

test('hermes: a session never ended but quiet for hours is inactive, not idle — a crash looks the same', async () => {
  const t = (await statesOf('hermes')).byId.get(`hermes:main:${HERMES.stale}`)
  assert.equal(t.running, true, 'running is left as upstream reads it')
  assert.equal(t.state, 'inactive')
})

// ── Antigravity ──────────────────────────────────────────────────────────────

test('antigravity: an open turn is active', async () => {
  assert.equal(await stateOf('antigravity', `antigravity:${AG.midTurn}`), 'active')
})

test('antigravity: a DONE turn is inactive', async () => {
  assert.equal(await stateOf('antigravity', `antigravity:${AG.ended}`), 'inactive')
})

test('antigravity: a thread on the colony archive list is archived even mid-turn', async () => {
  const { raw, byId } = await statesOf('antigravity')
  assert.equal(raw.get(`antigravity:${AG.colonyArchived}`).state, 'active')
  assert.equal(byId.get(`antigravity:${AG.colonyArchived}`).state, 'archived')
})

test('antigravity: an open turn whose transcript went quiet hours ago is inactive', async () => {
  assert.equal(await stateOf('antigravity', `antigravity:${AG.stale}`), 'inactive')
})

// ── all four ─────────────────────────────────────────────────────────────────

test('every thread from every new harness carries one of the four colony states', async () => {
  const expected = { opencode: 6, kilocode: 5, hermes: 8, antigravity: 4 }
  for (const [harness, count] of Object.entries(expected)) {
    const threads = [...(await statesOf(harness)).raw.values()]
    assert.equal(threads.length, count, `${harness} scanned ${threads.length} threads`)
    for (const t of threads) assert.ok(STATES.has(t.state), `${t.id} has state ${t.state}`)
  }
})

/**
 * The harness seam: what an adapter is allowed to hand back, and the two things the colony has
 * historically got wrong about a thread — which repo it belongs to, and whether it is working.
 *
 * Fixture-driven. Nothing here reads a real harness, so it says the same thing on any machine.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import kilocode from '../server/harnesses/kilocode.mjs'
import antigravity from '../server/harnesses/antigravity.mjs'
import opencode from '../server/harnesses/opencode.mjs'

import { HARNESSES } from '../server/harnesses/index.mjs'
import codex from '../server/harnesses/codex.mjs'
import claudeCode from '../server/harnesses/claude-code.mjs'
import { readTail, findExecutable } from '../server/lib/fsutil.mjs'
import { schemeOf } from '../server/lib/xdg.mjs'
import { withEnv, withPlatform, fakeExecutable } from './support/env.mjs'

// ── the contract ──────────────────────────────────────────────────────────────

test('every registered harness implements the interface, and none of them can write', () => {
  for (const h of HARNESSES) {
    assert.match(h.id, /^[a-z0-9-]+$/, `${h.id} is not a kebab-case id`)
    assert.equal(typeof h.name, 'string')
    for (const fn of ['detect', 'scanThreads', 'openThread', 'newSession']) {
      assert.equal(typeof h[fn], 'function', `${h.id} is missing ${fn}()`)
    }
    // The one rule the project will not bend on. An adapter that grows a write is a bug.
    assert.equal(h.setArchived, undefined, `${h.id} must not write to its harness`)
  }
})

test('harness ids are unique, and so are the id prefixes they hand out', () => {
  const ids = HARNESSES.map((h) => h.id)
  assert.equal(new Set(ids).size, ids.length)
})

// ── ids are prefixed, and refs from the page are not trusted ──────────────────

test('a session id that merely stringifies to a UUID is refused', async () => {
  // `RegExp.test` coerces, so an array holding a valid id passes the pattern and then travels on
  // as an array. Both adapters check the type first.
  const uuid = '2df3987c-02d3-405e-b8f5-da30e3835213'
  assert.equal((await claudeCode.openThread({ cliSessionId: [uuid] })).ok, false)
  assert.equal((await claudeCode.openThread({ desktopSessionId: { toString: () => `local_${uuid}` } })).ok, false)
  assert.equal((await codex.openThread({ sessionId: [uuid] })).ok, false)
  assert.equal((await codex.openThread({})).ok, false)
  assert.equal((await codex.openThread(null)).ok, false)
})

test('codex opens through the registered scheme and prefixes its ids', async () => {
  const id = '019cc762-45a2-7112-89cd-cd345c17e834'
  const opened = await codex.openThread({ sessionId: id })
  assert.equal(opened.ok, true)
  assert.equal(schemeOf(opened.url), 'codex')
  assert.equal(opened.url, `codex://threads/${id}`)
})

// ── the CLI alongside the deep link ───────────────────────────────────────────

/**
 * A fake `claude` or `codex` at the front of PATH, which `findExecutable` walks before the
 * install dirs — so it wins even on a machine that has the real one in `/usr/bin`.
 */
async function withFakeCli(name, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bot-crossing-cli-'))
  try {
    const cli = await fakeExecutable(dir, name)
    return await withEnv({ PATH: dir }, () => fn(cli.file))
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

const CLI_UUID = '2df3987c-02d3-405e-b8f5-da30e3835213'
const posixOnly = { skip: process.platform === 'win32' }

test('claude-code offers its CLI command on every platform, not just Linux', posixOnly, async () => {
  await withFakeCli('claude', (bin) =>
    withPlatform('darwin', async () => {
      const opened = await claudeCode.openThread({ cliSessionId: CLI_UUID, cwd: '/tmp/demo' })
      assert.deepEqual(opened.command, { argv: [bin, '--resume', CLI_UUID], cwd: '/tmp/demo' })
      const fresh = await claudeCode.newSession('/tmp/demo')
      assert.deepEqual(fresh.command, { argv: [bin], cwd: '/tmp/demo' })
    })
  )
})

test('codex offers `codex resume <id>` in the thread cwd alongside its deep link', posixOnly, async () => {
  await withFakeCli('codex', async (bin) => {
    const opened = await codex.openThread({ sessionId: SESSION_ID, cwd: '/tmp/demo' })
    assert.equal(opened.url, `codex://threads/${SESSION_ID}`)
    assert.deepEqual(opened.command, { argv: [bin, 'resume', SESSION_ID], cwd: '/tmp/demo' })
    const noCwd = await codex.openThread({ sessionId: SESSION_ID })
    assert.equal(noCwd.command.cwd, '', 'a missing cwd is left for the server to refuse')
    const fresh = await codex.newSession('/tmp/demo')
    assert.deepEqual(fresh.command, { argv: [bin], cwd: '/tmp/demo' })
  })
})

test('codex with no CLI installed offers the deep link alone', posixOnly, async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bot-crossing-nocli-'))
  try {
    const opened = await withEnv({ PATH: dir }, () => codex.openThread({ sessionId: SESSION_ID }))
    assert.deepEqual(opened, { ok: true, url: `codex://threads/${SESSION_ID}`, command: undefined })
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

// ── a Codex install, faked on disk ────────────────────────────────────────────

const line = (type, payload, timestamp = '2026-09-07T12:00:00.000Z') => JSON.stringify({ timestamp, type, payload })

/** One id for every fixture, so a test can name it before the transcript exists. */
const SESSION_ID = '019cc762-45a2-7112-89cd-cd345c17e834'

async function fakeCodex(records) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-fixture-'))
  const day = path.join(home, 'sessions', '2026', '09', '07')
  await fsp.mkdir(day, { recursive: true })
  await fsp.writeFile(path.join(day, `rollout-2026-09-07T12-00-00-${SESSION_ID}.jsonl`), records.join('\n') + '\n')
  return home
}

async function scanWith(home) {
  process.env.CODEX_HOME = home
  const mod = await import(`../server/harnesses/codex.mjs?${home}`)
  return mod.default
}

test('a CLI-only Codex session is found with no database at all', async () => {
  const home = await fakeCodex([
    line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo', git: { branch: 'main' } }),
    line('turn_context', { model: 'gpt-5.3-codex', effort: 'high' }),
    line('response_item', { type: 'message', role: 'user', content: [{ text: 'ship the thing' }] }),
    line('event_msg', { type: 'task_complete' }),
  ])
  const h = await scanWith(home)
  assert.equal(await h.detect(), true)
  const [t] = await h.scanThreads()
  assert.equal(t.id, `codex:${SESSION_ID}`, 'ids are prefixed')
  assert.equal(t.project, 'demo')
  assert.equal(t.model, 'gpt-5.3-codex')
  assert.equal(t.effort, 'high')
  assert.equal(t.gitBranch, 'main')
  assert.equal(t.preview, 'ship the thing')
  assert.ok(t.sizeBytes > 0, 'sizeBytes is transcript bytes, not a token count')
  assert.equal(t.running, false)
  assert.deepEqual(t.ref, { sessionId: SESSION_ID, cwd: '/tmp/demo' }, 'ref carries the cwd the CLI resumes in')
  await fsp.rm(home, { recursive: true, force: true })
})

test('an interrupted turn is not an error — escape must not redden an astronaut', async () => {
  const home = await fakeCodex([
    line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' }),
    line('event_msg', { type: 'task_started' }),
    line('event_msg', { type: 'turn_aborted' }),
  ])
  const h = await scanWith(home)
  const [t] = await h.scanThreads()
  assert.equal(t.hasError, false)
  assert.equal(t.running, false, 'an aborted turn is not still running')
  await fsp.rm(home, { recursive: true, force: true })
})

test('a task started long ago is not still running', async () => {
  const home = await fakeCodex([
    line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' }),
    line('event_msg', { type: 'task_started' }),
  ])
  const day = path.join(home, 'sessions', '2026', '09', '07')
  const [file] = await fsp.readdir(day)
  const old = new Date(Date.now() - 6 * 60 * 60 * 1000)
  await fsp.utimes(path.join(day, file), old, old)
  const h = await scanWith(home)
  const [t] = await h.scanThreads()
  assert.equal(t.running, false, 'Codex writes nothing when killed, so the window has to bound it')
  await fsp.rm(home, { recursive: true, force: true })
})

test('malformed records are skipped rather than throwing the scan away', async () => {
  const home = await fakeCodex([
    'not json at all',
    '{"half": ',
    line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' }),
    line('response_item', { type: 'message', role: 'user', content: 'hello' }),
  ])
  const h = await scanWith(home)
  const threads = await h.scanThreads()
  assert.equal(threads.length, 1)
  assert.equal(threads[0].preview, 'hello')
  await fsp.rm(home, { recursive: true, force: true })
})

test('an absent Codex is simply not detected', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-empty-'))
  const h = await scanWith(home)
  assert.equal(await h.detect(), false)
  assert.deepEqual(await h.scanThreads(), [])
  await fsp.rm(home, { recursive: true, force: true })
})

// ── subagents ─────────────────────────────────────────────────────────────────
// Upstream's two errand cases (030f008) lived here. This fork keeps its own subagent scan —
// meta-file based, `{ id, name, agentType, description, model, startedAt }`, teammates alive
// between turns — tested in `tests/server/claude-code.test.mjs`.

// ── shared helpers ────────────────────────────────────────────────────────────

test('readTail drops the partial line it lands in the middle of', async () => {
  const f = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'tail-')), 'x.jsonl')
  await fsp.writeFile(f, 'first line\nsecond line\nthird line\n')
  assert.equal(await readTail(f, 15), 'third line\n')
  assert.equal(await readTail(f, 1000), 'first line\nsecond line\nthird line\n')
})

test('findExecutable refuses junk, and refuses a directory that sits on PATH', async () => {
  assert.equal(await findExecutable(''), null)
  assert.equal(await findExecutable(null), null)
  assert.equal(await findExecutable('.'), null)
  assert.equal(await findExecutable('definitely-not-a-real-binary-xyz'), null)
})

// ── Cursor, faked on disk ─────────────────────────────────────────────────────

async function fakeCursor(dirName, records) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursor-fixture-'))
  const dir = path.join(home, dirName, 'agent-transcripts', SESSION_ID)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, `${SESSION_ID}.jsonl`), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return home
}

async function cursorWith(home) {
  process.env.BOT_CROSSING_CURSOR_PROJECTS = home
  const mod = await import(`../server/harnesses/cursor.mjs?${home}`)
  return mod.default
}

const askedFor = (text) => ({ role: 'user', message: { content: [{ type: 'text', text }] } })

test('a Cursor transcript yields a thread with the typed query as its title', async () => {
  const home = await fakeCursor('tmp', [
    askedFor('<timestamp>Tuesday, Sep 8, 2026, 4:08 PM (UTC-7)</timestamp>\n<user_query>\nwhat project is this?\n</user_query>'),
    { role: 'assistant', message: { content: [{ type: 'text', text: 'It is…' }] } },
    { type: 'turn_ended', status: 'success' },
  ])
  const h = await cursorWith(home)
  assert.equal(await h.detect(), true)
  const [t] = await h.scanThreads()
  assert.equal(t.id, `cursor:${SESSION_ID}`)
  // Cursor's own wrapper tags are scaffolding, not something a person typed.
  assert.equal(t.title, 'what project is this?')
  assert.equal(t.running, false, 'a closed turn is not running')
  assert.equal(t.hasError, false)
  await fsp.rm(home, { recursive: true, force: true })
})

test('a transcript from before turn_ended existed is not reported as mid-turn', async () => {
  // The older corpus carries no markers at all. Reading "no marker" as "still working" would
  // light up every historical thread on the map.
  const home = await fakeCursor('tmp', [
    askedFor('<user_query>old thread</user_query>'),
    { role: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } },
  ])
  const h = await cursorWith(home)
  const [t] = await h.scanThreads()
  assert.equal(t.running, false)
  await fsp.rm(home, { recursive: true, force: true })
})

test('a failed turn is an error, and an open turn is running', async () => {
  const home = await fakeCursor('tmp', [
    askedFor('<user_query>do it</user_query>'),
    { type: 'turn_ended', status: 'error' },
  ])
  const h = await cursorWith(home)
  const [t] = await h.scanThreads()
  assert.equal(t.hasError, true)
  await fsp.rm(home, { recursive: true, force: true })
})

test('Cursor offers a folder link but never a per-thread one it cannot honour', async () => {
  const home = await fakeCursor('tmp', [askedFor('<user_query>hi</user_query>')])
  const h = await cursorWith(home)
  assert.equal(h.openThread({ sessionId: SESSION_ID }).ok, false)
  const opened = h.newSession('/tmp/some repo')
  assert.equal(opened.ok, true)
  assert.equal(schemeOf(opened.url), 'cursor')
  assert.ok(opened.url.includes('%20'), 'a space in the path is escaped, not left raw')
  assert.equal(h.newSession('relative/path').ok, false)
  await fsp.rm(home, { recursive: true, force: true })
})

test('a Windows folder opens in Cursor, drive letter and all', async () => {
  // Upstream tested `startsWith('/')`, which no Windows path passes, so the whole platform got
  // "not somewhere Cursor can open" for every folder on it. The drive's colon stays bare: a
  // percent-escaped one is not a drive to whatever resolves the URL.
  const home = await fakeCursor('tmp', [askedFor('<user_query>hi</user_query>')])
  const h = await cursorWith(home)
  const win = h.newSession('C:\\Users\\x\\my repo')
  assert.equal(win.ok, true)
  assert.equal(win.url, 'cursor://file/C:/Users/x/my%20repo')
  assert.equal(h.newSession('C:/Users/x').ok, true, 'already slashed is the same path')
  assert.equal(h.newSession('relative\\path').ok, false, 'relative is still refused, either flavour')
  await fsp.rm(home, { recursive: true, force: true })
})

test('a Codex thread carries its folder and the command that reopens it', async () => {
  const home = await fakeCodex([
    line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo', git: { branch: 'main' } }),
    line('response_item', { type: 'message', role: 'user', content: [{ text: 'ship the thing' }] }),
    line('event_msg', { type: 'task_complete' }),
  ])
  const h = await scanWith(home)
  const [t] = await h.scanThreads()

  // The folder rides inside `ref` because that is all `/api/open` is given, and matching an
  // editor window to a thread needs the folder the thread ran in.
  assert.deepEqual(t.ref, { sessionId: SESSION_ID, cwd: '/tmp/demo' })
  assert.equal(t.resume, `codex resume ${SESSION_ID}`)
  assert.equal((await h.openThread(t.ref)).ok, true, 'the deep link still works off the same ref')
  await fsp.rm(home, { recursive: true, force: true })
})

test('a Codex recap is the first ask and the last answer', async () => {
  const home = await fakeCodex([
    line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' }),
    line('response_item', { type: 'message', role: 'user', content: [{ text: 'ship the thing' }] }),
    line('response_item', { type: 'message', role: 'assistant', content: [{ text: 'first pass done' }] }),
    line('response_item', { type: 'function_call', name: 'shell', arguments: '{}' }),
    line('response_item', { type: 'message', role: 'assistant', content: [{ text: 'Shipped, tests green.' }] }),
    line('event_msg', { type: 'task_complete' }),
  ])
  const h = await scanWith(home)
  const [t] = await h.scanThreads()

  assert.deepEqual(await h.recap(t.ref), { first: 'ship the thing', last: 'Shipped, tests green.' })
  await fsp.rm(home, { recursive: true, force: true })
})

test('a Codex recap survives an aborted turn and a malformed line', async () => {
  const home = await fakeCodex([
    line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' }),
    '{"half": ',
    line('response_item', { type: 'message', role: 'user', content: 'what now' }),
    line('response_item', { type: 'message', role: 'assistant', content: [{ text: 'Working on it' }] }),
    line('event_msg', { type: 'turn_aborted' }),
  ])
  const h = await scanWith(home)

  const got = await h.recap({ sessionId: SESSION_ID })
  assert.equal(got.first, 'what now')
  assert.equal(got.last, 'Working on it', 'escape is not the end of what the agent said')
  await fsp.rm(home, { recursive: true, force: true })
})

test('a Codex recap for an id nothing answers to is empty, not a throw', async () => {
  const home = await fakeCodex([line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' })])
  const h = await scanWith(home)

  assert.deepEqual(await h.recap({ sessionId: 'not-a-uuid' }), { first: '', last: '' })
  assert.deepEqual(await h.recap({}), { first: '', last: '' })
  assert.deepEqual(await h.recap({ sessionId: '11111111-2222-3333-4444-555555555555' }), { first: '', last: '' })
  await fsp.rm(home, { recursive: true, force: true })
})

// ── OpenCode, faked on disk ─────────────────────────────────────────────────

const OPENCODE_SESSION = 'ses_eeeeddddccccbbbbaaaa00000000'

async function fakeOpencode() {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'opencode-fixture-'))
  const dbFile = path.join(home, 'opencode.db')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbFile)
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, directory TEXT NOT NULL, title TEXT NOT NULL, agent TEXT, model TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER)`)
  db.exec(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  db.exec(`CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  const now = Date.now()
  const ins = db.prepare(`INSERT INTO session (id, project_id, parent_id, directory, title, agent, model, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  ins.run(OPENCODE_SESSION, 'global', null, '/tmp/demo', 'Fix the thing', 'build', JSON.stringify({ id: 'muse-spark', providerID: 'opencode-go', variant: 'xhigh' }), now - 60000, now, null)
  ins.run('ses_child11111111111111111111111', 'global', OPENCODE_SESSION, '/tmp/demo', 'Do subtask (@general subagent)', 'general', null, now - 50000, now, null)
  const mins = db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
  mins.run('msg_user1', OPENCODE_SESSION, now - 60000, now - 60000, JSON.stringify({ role: 'user', time: { created: now - 60000 } }))
  mins.run('msg_asst1', OPENCODE_SESSION, now - 59000, now - 58000, JSON.stringify({ role: 'assistant', time: { created: now - 59000, completed: now - 58000 }, finish: 'stop' }))
  const pins = db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
  pins.run('prt_user1', 'msg_user1', OPENCODE_SESSION, now - 60000, now - 60000, JSON.stringify({ type: 'text', text: '  ship   the thing  ' }))
  pins.run('prt_asst1', 'msg_asst1', OPENCODE_SESSION, now - 59000, now - 58000, JSON.stringify({ type: 'text', text: 'done' }))
  db.close()
  process.env.OPENCODE_DB = dbFile
  return { home, h: opencode }
}

test('opencode lists only top-level sessions with mapped fields', async () => {
  const { home, h } = await fakeOpencode()
  try {
    assert.equal(await h.detect(), true)
    const threads = await h.scanThreads()
    assert.equal(threads.length, 1)
    const [t] = threads
    assert.equal(t.id, `opencode:${OPENCODE_SESSION}`)
    assert.equal(t.project, 'demo')
    assert.equal(t.projectPath, '/tmp/demo')
    assert.equal(t.cwd, '/tmp/demo')
    assert.equal(t.worktree, '')
    assert.equal(t.title, 'Fix the thing')
    assert.equal(t.preview, 'ship the thing')
    assert.equal(t.model, 'muse-spark')
    assert.equal(t.canOpen, false)
    assert.deepEqual(t.ref, { sessionId: OPENCODE_SESSION, cwd: '/tmp/demo' })
    assert.ok(t.sizeBytes > 0, 'sizeBytes is transcript bytes, not a token count')
  } finally {
    delete process.env.OPENCODE_DB
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('an absent opencode is simply not detected', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'opencode-empty-'))
  process.env.OPENCODE_DB = path.join(home, 'missing.db')
  try {
    assert.equal(await opencode.detect(), false)
    assert.deepEqual(await opencode.scanThreads(), [])
  } finally {
    delete process.env.OPENCODE_DB
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('opencode running is bounded by the activity window and errors come from the last turn only', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'opencode-status-'))
  const dbFile = path.join(home, 'opencode.db')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbFile)
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, directory TEXT NOT NULL, title TEXT NOT NULL, agent TEXT, model TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER)`)
  db.exec(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  db.exec(`CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  const now = Date.now()
  const ins = db.prepare(`INSERT INTO session (id, project_id, parent_id, directory, title, agent, model, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  ins.run('ses_running1111111111111111111111', 'global', null, '/tmp/a', 'Running now', 'build', null, now - 60000, now, null)
  ins.run('ses_stale11111111111111111111111', 'global', null, '/tmp/b', 'Stale open turn', 'build', null, now - 6 * 60 * 60 * 1000, now - 6 * 60 * 60 * 1000, null)
  ins.run('ses_error111111111111111111111111', 'global', null, '/tmp/c', 'Failed turn', 'build', null, now - 60000, now, null)
  const mins = db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
  mins.run('m_run', 'ses_running1111111111111111111111', now - 60000, now, JSON.stringify({ role: 'assistant', time: { created: now - 60000 } }))
  mins.run('m_stale', 'ses_stale11111111111111111111111', now - 6 * 60 * 60 * 1000, now - 6 * 60 * 60 * 1000, JSON.stringify({ role: 'assistant', time: { created: now - 6 * 60 * 60 * 1000 } }))
  mins.run('m_err', 'ses_error111111111111111111111111', now - 60000, now, JSON.stringify({ role: 'assistant', time: { created: now - 60000, completed: now }, finish: 'stop' }))
  const pins = db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
  pins.run('p_run', 'm_run', 'ses_running1111111111111111111111', now, now, JSON.stringify({ type: 'step-start' }))
  pins.run('p_err', 'm_err', 'ses_error111111111111111111111111', now, now, JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'error' } }))
  db.close()
  process.env.OPENCODE_DB = dbFile
  try {
    const byId = new Map((await opencode.scanThreads()).map((t) => [t.id, t]))
    assert.equal(byId.get('opencode:ses_running1111111111111111111111').running, true)
    assert.equal(byId.get('opencode:ses_stale11111111111111111111111').running, false, 'an open turn from hours ago is not still running')
    assert.equal(byId.get('opencode:ses_error111111111111111111111111').hasError, true)
    assert.equal(byId.get('opencode:ses_running1111111111111111111111').hasError, false)
  } finally {
    delete process.env.OPENCODE_DB
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('a turn the user stopped is not an error — denial and abort must not redden an astronaut', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'opencode-denied-'))
  const dbFile = path.join(home, 'opencode.db')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbFile)
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, directory TEXT NOT NULL, title TEXT NOT NULL, agent TEXT, model TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER)`)
  db.exec(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  db.exec(`CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  const now = Date.now()
  const ins = db.prepare(`INSERT INTO session (id, project_id, parent_id, directory, title, agent, model, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  ins.run('ses_denied1111111111111111111111', 'global', null, '/tmp/d', 'Denied turn', 'build', null, now - 60000, now, null)
  ins.run('ses_aborted111111111111111111111', 'global', null, '/tmp/e', 'Aborted turn', 'build', null, now - 60000, now, null)
  ins.run('ses_failed1111111111111111111111', 'global', null, '/tmp/f', 'Failed turn', 'build', null, now - 60000, now, null)
  const mins = db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
  mins.run('m_denied', 'ses_denied1111111111111111111111', now - 60000, now, JSON.stringify({ role: 'assistant', time: { created: now - 60000, completed: now }, finish: 'tool-calls' }))
  mins.run('m_aborted', 'ses_aborted111111111111111111111', now - 60000, now, JSON.stringify({ role: 'assistant', time: { created: now - 60000, completed: now }, finish: 'stop' }))
  mins.run('m_failed', 'ses_failed1111111111111111111111', now - 60000, now, JSON.stringify({ role: 'assistant', time: { created: now - 60000, completed: now }, finish: 'stop' }))
  const pins = db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
  pins.run('p_denied', 'm_denied', 'ses_denied1111111111111111111111', now, now, JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'error', error: 'The user rejected permission to use this specific tool call.' } }))
  pins.run('p_aborted', 'm_aborted', 'ses_aborted111111111111111111111', now, now, JSON.stringify({ type: 'tool', tool: 'read', state: { status: 'error', error: 'Tool execution aborted' } }))
  pins.run('p_failed', 'm_failed', 'ses_failed1111111111111111111111', now, now, JSON.stringify({ type: 'tool', tool: 'write', state: { status: 'error', error: 'SchemaError(Expected string, got object)' } }))
  db.close()
  process.env.OPENCODE_DB = dbFile
  try {
    const byId = new Map((await opencode.scanThreads()).map((t) => [t.id, t]))
    assert.equal(byId.get('opencode:ses_denied1111111111111111111111').hasError, false, 'a rejected permission is the user stopping the turn, not a failure')
    assert.equal(byId.get('opencode:ses_aborted111111111111111111111').hasError, false, 'an aborted call is a cancellation, not a failure')
    assert.equal(byId.get('opencode:ses_failed1111111111111111111111').hasError, true, 'a genuine tool failure still reddens the astronaut')
  } finally {
    delete process.env.OPENCODE_DB
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('a message-level abort is the user stopping, but a provider error is a failure', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'opencode-msgerr-'))
  const dbFile = path.join(home, 'opencode.db')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbFile)
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, directory TEXT NOT NULL, title TEXT NOT NULL, agent TEXT, model TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER)`)
  db.exec(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  db.exec(`CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  const now = Date.now()
  const ins = db.prepare(`INSERT INTO session (id, project_id, parent_id, directory, title, agent, model, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  ins.run('ses_msgabort11111111111111111111', 'global', null, '/tmp/g', 'Aborted message', 'build', null, now - 60000, now, null)
  ins.run('ses_msgapi1111111111111111111111', 'global', null, '/tmp/h', 'Provider failure', 'build', null, now - 60000, now, null)
  const mins = db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
  mins.run('m_abort', 'ses_msgabort11111111111111111111', now - 60000, now, JSON.stringify({ role: 'assistant', time: { created: now - 60000, completed: now }, error: { name: 'MessageAbortedError' } }))
  mins.run('m_api', 'ses_msgapi1111111111111111111111', now - 60000, now, JSON.stringify({ role: 'assistant', time: { created: now - 60000, completed: now }, error: { name: 'APIError' } }))
  db.close()
  process.env.OPENCODE_DB = dbFile
  try {
    const byId = new Map((await opencode.scanThreads()).map((t) => [t.id, t]))
    assert.equal(byId.get('opencode:ses_msgabort11111111111111111111').hasError, false)
    assert.equal(byId.get('opencode:ses_msgabort11111111111111111111').running, false)
    assert.equal(byId.get('opencode:ses_msgapi1111111111111111111111').hasError, true)
  } finally {
    delete process.env.OPENCODE_DB
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('opencode refuses untrusted refs and offers no per-thread link', async () => {  const { home, h } = await fakeOpencode()
  try {
    const uuid = OPENCODE_SESSION
    assert.equal(h.openThread({ sessionId: [uuid] }).ok, false)
    assert.equal(h.openThread({ sessionId: { toString: () => uuid } }).ok, false)
    assert.equal(h.openThread({ sessionId: uuid }).ok, false)
    assert.equal(h.openThread(null).ok, false)
    assert.equal(h.openThread({}).ok, false)
    const opened = await h.newSession('/tmp/some repo')
    assert.equal(opened.ok, true)
    assert.equal(schemeOf(opened.url), 'opencode')
    assert.ok(opened.url.includes('directory='), 'the directory rides along')
    assert.equal((await h.newSession('relative/path')).ok, false)
  } finally {
    delete process.env.OPENCODE_DB
    await fsp.rm(home, { recursive: true, force: true })
  }
})

// ── Antigravity CLI, faked on disk ────────────────────────────────────────────

async function fakeAntigravity(records) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'antigravity-fixture-'))
  const dir = path.join(home, 'brain', SESSION_ID, '.system_generated', 'logs')
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, 'transcript.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return home
}

async function antigravityWith(home) {
  process.env.BOT_CROSSING_ANTIGRAVITY_HOME = home
  const mod = await import(`../server/harnesses/antigravity.mjs?${home}`)
  return mod.default
}

test('an Antigravity transcript yields a thread with prompt and prefixed ID', async () => {
  const home = await fakeAntigravity([
    { type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '<USER_REQUEST>fix the login bug</USER_REQUEST>', created_at: '2026-09-08T10:00:00.000Z' },
    { type: 'PLANNER_RESPONSE', status: 'DONE' },
  ])
  const h = await antigravityWith(home)
  assert.equal(await h.detect(), true)
  const [t] = await h.scanThreads()
  assert.equal(t.id, `antigravity:${SESSION_ID}`)
  assert.equal(t.title, 'fix the login bug')
  assert.equal(t.running, false)
  assert.equal(t.hasError, false)
  await fsp.rm(home, { recursive: true, force: true })
})

test('an open Antigravity turn is reported as running', async () => {
  const home = await fakeAntigravity([
    { type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'implement feature', created_at: new Date().toISOString() },
  ])
  const h = await antigravityWith(home)
  const [t] = await h.scanThreads()
  assert.equal(t.running, true)
  await fsp.rm(home, { recursive: true, force: true })
})

test('Antigravity opens through antigravity:// scheme and handles invalid refs', async () => {
  const home = await fakeAntigravity([])
  const h = await antigravityWith(home)
  const opened = await h.openThread({ sessionId: SESSION_ID })
  assert.equal(opened.ok, true)
  assert.equal(schemeOf(opened.url), 'antigravity')
  assert.equal(opened.url, `antigravity://resume?session=${SESSION_ID}`)
  assert.equal((await h.openThread({})).ok, false)
  assert.equal((await h.newSession('relative/path')).ok, false)
  await fsp.rm(home, { recursive: true, force: true })
})

// ── Claude Code, faked on disk ────────────────────────────────────────────────

/**
 * Both stores under one temp root: the CLI's home (`CLAUDE_CONFIG_DIR`, so `projects/` and
 * `sessions/` sit inside it) and the desktop app's session store (`BOT_CROSSING_CLAUDE_DESKTOP`),
 * with one transcript for SESSION_ID and whatever records and deletion markers a test asks for.
 */
async function fakeClaude({ transcript, records = [], deleted = [] }) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-fixture-'))
  const configDir = path.join(root, 'claude')
  const desktop = path.join(root, 'claude-code-sessions')
  const project = path.join(configDir, 'projects', '-tmp-demo')
  const org = path.join(desktop, 'account', 'org')
  await fsp.mkdir(project, { recursive: true })
  await fsp.mkdir(org, { recursive: true })
  await fsp.writeFile(path.join(project, `${SESSION_ID}.jsonl`), transcript.map((r) => JSON.stringify(r)).join('\n') + '\n')
  for (const r of records) await fsp.writeFile(path.join(org, `${r.sessionId}.json`), JSON.stringify(r))
  // What the app leaves behind when a thread is deleted: the time, under the CLI session's id.
  for (const id of deleted) await fsp.writeFile(path.join(org, `deleted_${id}`), String(Date.now()))
  return { root, configDir, desktop, org }
}

async function claudeWith({ configDir, desktop }) {
  process.env.CLAUDE_CONFIG_DIR = configDir
  process.env.BOT_CROSSING_CLAUDE_DESKTOP = desktop
  const mod = await import(`../server/harnesses/claude-code.mjs?${configDir}`)
  return mod.default
}

const typed = (text) => ({
  type: 'user',
  cwd: '/tmp/demo',
  timestamp: '2026-09-07T12:00:00.000Z',
  message: { role: 'user', content: text },
})

/** Every file under a fixture, with size and mtime — what a read-only scan has to leave alone. */
async function listing(dir) {
  const out = []
  for (const e of await fsp.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue
    const file = path.join(e.parentPath, e.name)
    const st = await fsp.stat(file)
    out.push([path.relative(dir, file), st.size, st.mtimeMs])
  }
  return out.sort()
}

test('a thread deleted in the desktop app is reported archived, not dropped', async () => {
  const fx = await fakeClaude({ transcript: [typed('tidy the ledger')] })
  const h = await claudeWith(fx)
  assert.equal(await h.detect(), true)
  const [before] = await h.scanThreads()
  assert.equal(before.id, `claude-code:${SESSION_ID}`)
  assert.equal(before.source, 'cli', 'with no record, the transcript reads as terminal-started')
  assert.equal(before.archived, false)

  // Deleting in the app removes the record and leaves `deleted_<cliSessionId>`; the transcript stays.
  await fsp.writeFile(path.join(fx.org, `deleted_${SESSION_ID}`), String(Date.now()))
  const files = await listing(fx.root)
  const [after] = await h.scanThreads()
  assert.equal(after.archived, true, 'noticed on the next poll, no restart')
  assert.equal(after.title, 'tidy the ledger', 'still a thread, so the colony sends it home rather than losing it')
  assert.deepEqual(await listing(fx.root), files, 'the marker is read and never tidied — the adapter does not write')
  await fsp.rm(fx.root, { recursive: true, force: true })
})

test('a record the app still holds outranks a leftover deletion marker', async () => {
  // Resuming a deleted transcript makes the app write a fresh record; the marker stays behind.
  const fx = await fakeClaude({
    transcript: [typed('bring it back')],
    records: [
      {
        sessionId: 'local_2df3987c-02d3-405e-b8f5-da30e3835213',
        cliSessionId: SESSION_ID,
        cwd: '/tmp/demo',
        title: 'Back again',
        createdAt: 1,
        lastActivityAt: 2,
        lastFocusedAt: 3,
      },
    ],
    deleted: [SESSION_ID],
  })
  const h = await claudeWith(fx)
  const [t] = await h.scanThreads()
  assert.equal(t.source, 'desktop')
  assert.equal(t.title, 'Back again')
  assert.equal(t.archived, false, 'a record that exists is the newer truth')
  await fsp.rm(fx.root, { recursive: true, force: true })
})

test('a deleted thread resumed from the CLI is live, not archived', async () => {
  // `claude --resume <id>` keeps the id, so the app's marker stays behind with no record to outrank it.
  const fx = await fakeClaude({ transcript: [typed('back from the bin')], deleted: [SESSION_ID] })
  const sessions = path.join(fx.configDir, 'sessions')
  await fsp.mkdir(sessions, { recursive: true })
  // This test's own pid: alive for as long as the scan runs, which is all the registry checks.
  const entry = { sessionId: SESSION_ID, pid: process.pid, status: 'busy' }
  await fsp.writeFile(path.join(sessions, `${process.pid}.json`), JSON.stringify(entry))
  const h = await claudeWith(fx)
  const [t] = await h.scanThreads()
  assert.equal(t.archived, false, 'a live process is newer truth than the marker')
  assert.equal(t.state, 'active', 'so the running session stays on the map')
  await fsp.rm(fx.root, { recursive: true, force: true })
})

/**
 * Kilo Code's store keeps whatever path the machine gave it, so the fixture uses one that is
 * absolute *here* rather than a Windows path pinned in place. The adapter refuses a cwd that is
 * not absolute — correctly — and a hard-coded `C:/…` made that refusal look like a bug on every
 * machine but Windows, which is where this test previously failed.
 */
const KILO_CWD = process.platform === 'win32' ? 'C:/Users/test/demo' : '/Users/test/demo'

// ── Kilo Code, faked on disk ────────────────────────────────────────────

const KILO_SESSION = 'ses_aaaabbbbccccddddeeeeffff0000'

async function fakeKilocode() {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'kilocode-fixture-'))
  const dbFile = path.join(home, 'kilo.db')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbFile)
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, workspace_id TEXT, parent_id TEXT, directory TEXT NOT NULL, path TEXT, title TEXT NOT NULL, agent TEXT, model TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER)`)
  db.exec(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  db.exec(`CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  const now = Date.now()
  const ins = db.prepare(`INSERT INTO session (id, project_id, workspace_id, parent_id, directory, path, title, agent, model, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  ins.run(KILO_SESSION, 'proj1', null, null, KILO_CWD, '', 'Fix the thing', 'orchestrator', JSON.stringify({ id: 'anthropic/claude-opus', providerID: 'kilo', variant: 'xhigh' }), now - 60000, now, null)
  ins.run('ses_child1111111111111111111111', 'proj1', null, KILO_SESSION, KILO_CWD, '', 'Do subtask (@general subagent)', 'general', null, now - 50000, now, null)
  const mins = db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
  mins.run('msg_user1', KILO_SESSION, now - 60000, now - 60000, JSON.stringify({ role: 'user', time: { created: now - 60000 } }))
  mins.run('msg_asst1', KILO_SESSION, now - 59000, now - 58000, JSON.stringify({ role: 'assistant', time: { created: now - 59000, completed: now - 58000 }, finish: 'stop' }))
  const pins = db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
  pins.run('prt_user1', 'msg_user1', KILO_SESSION, now - 60000, now - 60000, JSON.stringify({ type: 'text', text: '  ship   the thing  ' }))
  pins.run('prt_asst1', 'msg_asst1', KILO_SESSION, now - 59000, now - 58000, JSON.stringify({ type: 'text', text: 'done' }))
  db.close()
  process.env.KILO_DB = dbFile
  return { home, h: kilocode }
}

test('kilocode lists only top-level sessions with mapped fields', async () => {
  const { home, h } = await fakeKilocode()
  try {
    assert.equal(await h.detect(), true)
    const threads = await h.scanThreads()
    assert.equal(threads.length, 1)
    const [t] = threads
    assert.equal(t.id, `kilocode:${KILO_SESSION}`)
    assert.equal(t.project, 'demo')
    assert.equal(t.projectPath, KILO_CWD)
    assert.equal(t.cwd, KILO_CWD)
    assert.equal(t.worktree, '')
    assert.equal(t.title, 'Fix the thing')
    assert.equal(t.preview, 'ship the thing')
    assert.equal(t.model, 'anthropic/claude-opus')
    assert.equal(t.canOpen, true, 'the thread opens as its repo folder in VS Code')
    assert.deepEqual(t.ref, { sessionId: KILO_SESSION, cwd: KILO_CWD })
    assert.ok(t.sizeBytes > 0, 'sizeBytes is transcript bytes, not a token count')
  } finally {
    delete process.env.KILO_DB
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('an absent kilocode is simply not detected', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'kilocode-empty-'))
  process.env.KILO_DB = path.join(home, 'missing.db')
  try {
    assert.equal(await kilocode.detect(), false)
    assert.deepEqual(await kilocode.scanThreads(), [])
  } finally {
    delete process.env.KILO_DB
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('kilocode running is bounded by the activity window and errors come from the last turn only', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'kilocode-status-'))
  const dbFile = path.join(home, 'kilo.db')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbFile)
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, workspace_id TEXT, parent_id TEXT, directory TEXT NOT NULL, path TEXT, title TEXT NOT NULL, agent TEXT, model TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER)`)
  db.exec(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  db.exec(`CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  const now = Date.now()
  const ins = db.prepare(`INSERT INTO session (id, project_id, workspace_id, parent_id, directory, path, title, agent, model, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  ins.run('ses_kilorun11111111111111111111', 'p', null, null, '/tmp/a', '', 'Running now', 'orchestrator', null, now - 60000, now, null)
  ins.run('ses_kilostale1111111111111111111', 'p', null, null, '/tmp/b', '', 'Stale open turn', 'orchestrator', null, now - 6 * 60 * 60 * 1000, now - 6 * 60 * 60 * 1000, null)
  ins.run('ses_kiloerr111111111111111111111', 'p', null, null, '/tmp/c', '', 'Failed turn', 'orchestrator', null, now - 60000, now, null)
  const mins = db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
  mins.run('m_run', 'ses_kilorun11111111111111111111', now - 60000, now, JSON.stringify({ role: 'assistant', time: { created: now - 60000 } }))
  mins.run('m_stale', 'ses_kilostale1111111111111111111', now - 6 * 60 * 60 * 1000, now - 6 * 60 * 60 * 1000, JSON.stringify({ role: 'assistant', time: { created: now - 6 * 60 * 60 * 1000 } }))
  mins.run('m_err', 'ses_kiloerr111111111111111111111', now - 60000, now, JSON.stringify({ role: 'assistant', time: { created: now - 60000, completed: now }, finish: 'stop' }))
  const pins = db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
  pins.run('p_run', 'm_run', 'ses_kilorun11111111111111111111', now, now, JSON.stringify({ type: 'step-start' }))
  pins.run('p_err', 'm_err', 'ses_kiloerr111111111111111111111', now, now, JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'error' } }))
  db.close()
  process.env.KILO_DB = dbFile
  try {
    const byId = new Map((await kilocode.scanThreads()).map((t) => [t.id, t]))
    assert.equal(byId.get('kilocode:ses_kilorun11111111111111111111').running, true)
    assert.equal(byId.get('kilocode:ses_kilostale1111111111111111111').running, false, 'an open turn from hours ago is not still running')
    assert.equal(byId.get('kilocode:ses_kiloerr111111111111111111111').hasError, true)
    assert.equal(byId.get('kilocode:ses_kilorun11111111111111111111').hasError, false)
  } finally {
    delete process.env.KILO_DB
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('a turn the user stopped is not an error for kilocode either', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'kilocode-denied-'))
  const dbFile = path.join(home, 'kilo.db')
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbFile)
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, workspace_id TEXT, parent_id TEXT, directory TEXT NOT NULL, path TEXT, title TEXT NOT NULL, agent TEXT, model TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER)`)
  db.exec(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  db.exec(`CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`)
  const now = Date.now()
  const ins = db.prepare(`INSERT INTO session (id, project_id, workspace_id, parent_id, directory, path, title, agent, model, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  ins.run('ses_kilodenied11111111111111111', 'p', null, null, '/tmp/d', '', 'Denied turn', 'orchestrator', null, now - 60000, now, null)
  ins.run('ses_kiloabort1111111111111111111', 'p', null, null, '/tmp/e', '', 'Aborted turn', 'orchestrator', null, now - 60000, now, null)
  const mins = db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
  mins.run('m_denied', 'ses_kilodenied11111111111111111', now - 60000, now, JSON.stringify({ role: 'assistant', time: { created: now - 60000, completed: now }, finish: 'tool-calls' }))
  mins.run('m_abort', 'ses_kiloabort1111111111111111111', now - 60000, now, JSON.stringify({ role: 'assistant', time: { created: now - 60000, completed: now }, error: { name: 'MessageAbortedError' } }))
  const pins = db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
  pins.run('p_denied', 'm_denied', 'ses_kilodenied11111111111111111', now, now, JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'error', error: 'The user rejected permission to use this specific tool call.' } }))
  db.close()
  process.env.KILO_DB = dbFile
  try {
    const byId = new Map((await kilocode.scanThreads()).map((t) => [t.id, t]))
    assert.equal(byId.get('kilocode:ses_kilodenied11111111111111111').hasError, false, 'a rejected permission is the user stopping the turn, not a failure')
    assert.equal(byId.get('kilocode:ses_kiloabort1111111111111111111').hasError, false, 'an aborted message is a cancellation, not a failure')
  } finally {
    delete process.env.KILO_DB
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('kilocode refuses untrusted refs and opens the repo folder in VS Code', async () => {
  const { home, h } = await fakeKilocode()
  try {
    assert.equal(h.openThread({ sessionId: [KILO_SESSION] }).ok, false)
    assert.equal(h.openThread({ sessionId: { toString: () => KILO_SESSION } }).ok, false)
    assert.equal(h.openThread({ sessionId: KILO_SESSION }).ok, false)
    assert.equal(h.openThread(null).ok, false)
    assert.equal(h.openThread({}).ok, false)
    assert.equal(h.openThread({ sessionId: KILO_SESSION, cwd: 'relative/path' }).ok, false)
    // No per-session link exists, so the thread opens as its folder — the
    // Kilo sidebar and its session list are one click from there.
    const opened = h.openThread({ sessionId: KILO_SESSION, cwd: KILO_CWD })
    assert.equal(opened.ok, true)
    assert.equal(schemeOf(opened.url), 'vscode')
    const created = h.newSession('/tmp/some repo')
    assert.equal(created.ok, true)
    assert.equal(schemeOf(created.url), 'vscode')
    assert.ok(created.url.includes('%20'), 'a space in the path is escaped, not left raw')
    assert.equal(h.newSession('relative/path').ok, false)
  } finally {
    delete process.env.KILO_DB
    await fsp.rm(home, { recursive: true, force: true })
  }
})

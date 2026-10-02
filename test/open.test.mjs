/**
 * Opening a thread the way the page asked: the desktop app by default, or a terminal running
 * the harness's own CLI.
 *
 * `present` gets stubbed adapter answers for the branching. The two endpoints go through a real
 * socket once each, with a fake CLI and a fake terminal on disk, because only that proves `via`
 * makes it from the request body to the spawn.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { present } from '../server/api.mjs'
import { withServer } from './support/with-server.mjs'
import { withEnv, withPlatform, fakeExecutable } from './support/env.mjs'

const posixOnly = { skip: process.platform === 'win32' }
const UUID = '2df3987c-02d3-405e-b8f5-da30e3835213'

// ── present, given what an adapter said ───────────────────────────────────────

test('asked for a terminal, present never opens the app instead', async () => {
  const noCommand = await present({ ok: true, url: 'claude://claude.ai/epitaxy/local_x' }, 'terminal')
  assert.equal(noCommand.ok, false)
  assert.match(noCommand.error, /CLI/, 'a missing CLI is named, not papered over with the deep link')

  const noCwd = await present({ ok: true, url: '', command: { argv: ['/bin/true'], cwd: '' } }, 'terminal')
  assert.match(noCwd.error, /no folder on record/)

  const gone = { argv: ['/bin/true'], cwd: '/definitely/not/here' }
  assert.match((await present({ ok: true, url: '', command: gone }, 'terminal')).error, /not on this machine/)
})

// Skipped on a real Windows host: there `openInTerminalWindows` finds `cmd.exe` and really opens
// a console window on `/bin/true` — the test only holds where no Windows terminal is installed.
test('asked for a terminal on Windows, present says so rather than trying', posixOnly, async () => {
  const command = { argv: ['/bin/true'], cwd: os.tmpdir() }
  const shown = await withPlatform('win32', () => present({ ok: true, url: '', command }, 'terminal'))
  assert.equal(shown.ok, false)
  assert.match(shown.error, /Windows/)
})

test("an adapter's own refusal passes through whatever the page asked for", async () => {
  assert.equal((await present({ ok: false, error: 'nope' }, 'terminal')).error, 'nope')
  assert.equal((await present({ ok: false, error: 'nope' }, 'app')).error, 'nope')
})

// No URL, so no `xdg-mime` probe; no cwd, so `runInTerminal` stops at its folder check. Nothing
// spawns either way, and which error comes back says whether the command reached the launcher.
test('on Linux the app path runs only a command the adapter marked safe', async () => {
  const resume = { argv: ['codex', 'resume', UUID], cwd: '' }
  const unmarked = await withPlatform('linux', () => present({ ok: true, url: '', command: resume }))
  assert.equal(unmarked.ok, false)
  assert.doesNotMatch(unmarked.error, /no folder on record/, 'an unchecked resume never reaches the terminal')

  const marked = await withPlatform('linux', () => present({ ok: true, url: '', command: { ...resume, safe: true } }))
  assert.match(marked.error, /no folder on record/, 'a command whose liveness was checked does')

  const asked = await withPlatform('linux', () => present({ ok: true, url: '', command: resume }, 'terminal'))
  assert.match(asked.error, /no folder on record/, 'an explicit terminal request still runs it')
})

// ── the endpoints, against a real socket ──────────────────────────────────────

async function withFakes(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bot-crossing-open-'))
  try {
    const claude = await fakeExecutable(dir, 'claude')
    const kitty = await fakeExecutable(dir, 'kitty')
    const env = { PATH: dir, BOT_CROSSING_TERMINAL: kitty.file, DISPLAY: ':0' }
    return await withEnv(env, () => fn({ dir, claude, kitty }))
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

const post = (call, p, body) => call(p, { method: 'POST', body: JSON.stringify(body) })

test('/api/open with via: terminal resumes the session in its own folder', posixOnly, async () => {
  await withFakes(({ dir, claude, kitty }) =>
    withServer(async ({ call }) => {
      const ref = { cliSessionId: UUID, cwd: dir }
      const res = await post(call, '/api/open', { harness: 'claude-code', ref, via: 'terminal' })
      assert.equal(res.status, 200)
      assert.deepEqual(await res.json(), { ok: true, via: 'terminal' }, 'the page is told a terminal opened')
      assert.deepEqual(await kitty.argv(), [`--directory=${dir}`, claude.file, '--resume', UUID])
    })
  )
})

test('/api/open with via: terminal and no CLI is a 400 that names the CLI', posixOnly, async () => {
  // Codex rather than Claude Code: this machine may well have a real `claude` in an install dir.
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bot-crossing-nocli-'))
  try {
    await withEnv({ PATH: dir }, () =>
      withServer(async ({ call }) => {
        const body = { harness: 'codex', ref: { sessionId: UUID, cwd: dir }, via: 'terminal' }
        const res = await post(call, '/api/open', body)
        assert.equal(res.status, 400)
        assert.match((await res.json()).error, /CLI/)
      })
    )
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

// A platform with no OS opener, so a link that gets as far as `launch()` is answered and dropped:
// nothing spawns, and `ok` says whether the folder made it past the check.
test('Resume hands Cursor and Kilo Code only a real directory from the page', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bot-crossing-cwd-'))
  const repo = path.join(dir, 'repo')
  const file = path.join(dir, 'notes.txt')
  await fsp.mkdir(repo)
  await fsp.writeFile(file, 'not a folder')
  try {
    await withPlatform('freebsd', () =>
      withServer(async ({ call }) => {
        for (const harness of ['cursor', 'kilocode']) {
          const open = (cwd) => post(call, '/api/open', { harness, ref: { sessionId: 'ses_x', cwd } })
          for (const [what, cwd] of [
            // Climbs to `dir`, which exists: refused for the `..`, not for being missing.
            ['a `..` path', `${repo}${path.sep}..`],
            ['a file path', file],
            ['a missing folder', path.join(dir, 'gone')],
          ]) {
            const res = await open(cwd)
            assert.equal(res.status, 400, `${harness}: ${what} is refused`)
            assert.equal((await res.json()).url, undefined, `${harness}: ${what} never becomes a URL`)
          }
          const res = await open(repo)
          assert.equal(res.status, 200, `${harness}: a real directory opens`)
          assert.match((await res.json()).url, /:\/\/file\/.*repo$/)
        }
      })
    )
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('/api/new-session with via: terminal starts the bare CLI in that folder', posixOnly, async () => {
  await withFakes(({ dir, claude, kitty }) =>
    withServer(async ({ call }) => {
      await post(call, '/api/new-session', { harness: 'claude-code', folder: dir, via: 'terminal' })
      assert.deepEqual(await kitty.argv(), [`--directory=${dir}`, claude.file])
    })
  )
})

// ── what a terminal is never handed ───────────────────────────────────────────

/**
 * The terminal launcher accepts only plain folder names: one carrying any of the characters it
 * refuses is turned away even when it is a real directory. The ones Windows allows in a name are
 * made on disk, so the refusal is proved to come from the name and not from the folder being
 * missing. A network path has a refusal of its own.
 */
test('a terminal is handed only a plain local folder name', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bot-crossing-meta-'))
  try {
    const onDisk = []
    for (const ch of [';', '&', '^', '%', '`']) {
      const dir = path.join(root, `repo${ch}calc`)
      await fsp.mkdir(dir)
      onDisk.push(dir)
    }
    const nameOnly = ['|', '"', '\n', '\r'].map((ch) => path.join(root, `repo${ch}calc`))
    const refusals = [
      ...[...onDisk, ...nameOnly].map((cwd) => [cwd, /terminal safely/]),
      ...['\\\\host\\share', '//host/share'].map((cwd) => [cwd, /^Network folders are not opened from here$/]),
    ]
    for (const [cwd, reason] of refusals) {
      const command = { argv: [process.execPath], cwd, safe: true }
      const asked = await present({ ok: true, url: '', command }, 'terminal')
      assert.equal(asked.ok, false, `${JSON.stringify(cwd)} is refused`)
      assert.match(asked.error, reason, `${JSON.stringify(cwd)} is refused for what it is`)
      // Linux's fallback rung reaches the same launcher, and is held to the same rule.
      const fallback = await withPlatform('linux', () => present({ ok: true, url: '', command }))
      assert.match(fallback.error, reason)
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})

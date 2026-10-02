/**
 * A folder the page names by its network location is refused before anything touches the disk.
 *
 * "Before" is the whole point: the refusal is a hardening of the folder check, and it must not
 * wait for a `stat` to say whether the share is there. So these tests do not stop at the 400 —
 * they watch every `fs/promises` call the server makes during the request and assert none of
 * them was handed the network path. The refusal has words of its own, so they check those too.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { withServer } from './support/with-server.mjs'
import { withEnv, fakeExecutable } from './support/env.mjs'

const NETWORK = [
  '\\\\host\\share',
  '//host/share',
  '\\\\host\\share\\repo',
  '\\\\?\\UNC\\host\\share',
  '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo',
  '\\\\wsl$\\Ubuntu\\home\\me\\repo',
]
const WATCHED = ['stat', 'lstat', 'access', 'readdir', 'realpath', 'open', 'opendir']
const REFUSAL = 'Network folders are not opened from here'

/** Every path any watched `fs/promises` call was given while `run` ran. */
async function touchedDuring(run) {
  const seen = []
  const originals = {}
  for (const name of WATCHED) {
    originals[name] = fsp[name]
    fsp[name] = (p, ...rest) => {
      seen.push(String(p))
      return originals[name].call(fsp, p, ...rest)
    }
  }
  try {
    await run()
  } finally {
    Object.assign(fsp, originals)
  }
  return seen
}

const networkTouches = (seen) => seen.filter((p) => /^[\\/]{2}/.test(p) || /host[\\/]share|Ubuntu/.test(p))

const post = (call, p, body) => call(p, { method: 'POST', body: JSON.stringify(body) })

/** A 400 whose reason is the network refusal, not "the folder has gone". */
async function assertRefused(res, what) {
  assert.equal(res.status, 400, `${what}: a 400`)
  assert.equal((await res.json()).error, REFUSAL, `${what}: says why`)
}

test('reveal and new-session refuse a network folder without statting it', async () => {
  await withServer(async ({ call }) => {
    for (const folder of NETWORK) {
      const seen = await touchedDuring(async () => {
        for (const route of ['/api/reveal', '/api/new-session']) {
          await assertRefused(await post(call, route, { folder, harness: 'claude-code' }), `${route} ${folder}`)
        }
      })
      assert.deepEqual(networkTouches(seen), [], `${folder} never reached the disk`)
    }
  })
})

/**
 * A fake `codex` on PATH, so the terminal launcher's own refusal is what answers on any machine
 * — without one, the route stops earlier at "CLI not found" and the launcher is never reached.
 * The fake is never run: the folder is refused first.
 */
test('Resume drops a network ref.cwd without statting it, down either ladder', async () => {
  const bin = await fsp.mkdtemp(path.join(os.tmpdir(), 'bot-crossing-unc-'))
  try {
    await fakeExecutable(bin, 'codex')
    await withEnv({ PATH: bin }, () =>
      withServer(async ({ call }) => {
        for (const cwd of NETWORK) {
          const seen = await touchedDuring(async () => {
            // Cursor with no session id has nothing but the folder to open, so a refused folder is
            // a 400 and nothing is handed to the OS opener.
            const app = await post(call, '/api/open', { harness: 'cursor', ref: { cwd } })
            assert.equal(app.status, 400, `the Resume ladder refuses ${cwd}`)
            const ide = await post(call, '/api/open', { harness: 'cursor', ref: { cwd }, prefer: 'ide' })
            await assertRefused(ide, `the IDE rung, ${cwd}`)
            // The terminal launcher takes its folder from the adapter's command, not from `handBack`.
            const term = await post(call, '/api/open', {
              harness: 'codex',
              ref: { sessionId: '2df3987c-02d3-405e-b8f5-da30e3835213', cwd },
              via: 'terminal',
            })
            await assertRefused(term, `the terminal launcher, ${cwd}`)
          })
          assert.deepEqual(networkTouches(seen), [], `${cwd} never reached the disk`)
        }
      })
    )
  } finally {
    await fsp.rm(bin, { recursive: true, force: true })
  }
})

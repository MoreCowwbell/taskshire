/**
 * The two routes the Resume ladder and the recap ride on, driven through a real server the way
 * `test/state.test.mjs` drives the colony file. The point of testing them here rather than by
 * calling `apiMiddleware` directly is the Origin guard: these are POSTs, and a POST with no
 * Origin is refused on purpose.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { apiMiddleware } from '../../server/api.mjs'

async function withServer(fn) {
  const server = http.createServer((req, res) => apiMiddleware(req, res, () => res.end()))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const call = async (pathname, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }
  try {
    return await fn(call)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

test('open with no preference still means the app, and says so when it cannot', async () => {
  await withServer(async (call) => {
    // No desktop record and no CLI id: the adapter has nothing to offer, which is a 400 with
    // the adapter's own sentence — the shape this route has always had.
    const { status, body } = await call('/api/open', { harness: 'claude-code', ref: {} })
    assert.equal(status, 400)
    assert.equal(body.ok, false)
    assert.ok(body.error, 'the reason reaches the page')
    assert.equal(body.did, undefined, 'nothing happened, so nothing is claimed')
  })
})

test('open preferring the editor never falls back to the desktop app', async () => {
  await withServer(async (call) => {
    // A cwd no window can have open — and, since the page's folder is statted before any window
    // is looked at, one nothing on this machine has at all. The desktop app is deliberately not
    // a fallback for the editor choice, so this must fail rather than launching anything.
    const ref = { desktopSessionId: 'local_2df3987c-02d3-405e-b8f5-da30e3835213', cwd: '/nowhere/at/all' }
    const { status, body } = await call('/api/open', { harness: 'claude-code', ref, prefer: 'ide' })
    assert.equal(status, 400)
    assert.equal(body.ok, false)
    assert.match(body.error, /folder/i)
    assert.equal(body.did, undefined, 'nothing happened, so nothing is claimed')
  })
})

test('a cwd that is not a folder is refused before any window is matched', async () => {
  // Matching a window is string work that never touches the disk, so `within()` would happily
  // say a *file* inside an open workspace root belongs to that window — and the OS opener would
  // then be sent at `vscode://file/…/that-file`, which opens the file instead of raising the
  // folder. The stat in front of the match is what refuses both of these, and resolving is also
  // what collapses the `..`, so a URL can only ever be built from a real directory.
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'botcrossing-open-'))
  const file = path.join(dir, 'transcript.jsonl')
  await fsp.writeFile(file, 'not a folder')
  try {
    await withServer(async (call) => {
      for (const cwd of [file, path.join(dir, 'nested', '..', 'transcript.jsonl')]) {
        const { status, body } = await call('/api/open', { harness: 'claude-code', ref: { cwd }, prefer: 'ide' })
        assert.equal(status, 400, cwd)
        assert.equal(body.ok, false)
        assert.match(body.error, /not on this machine/i, 'refused by the stat, not by the absence of a window')
        assert.equal(body.url, undefined, 'nothing was handed to the opener')
      }
    })
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('an unknown harness is an error, not a crash', async () => {
  await withServer(async (call) => {
    const { status, body } = await call('/api/open', { harness: 'nope', ref: {}, prefer: 'app' })
    assert.equal(status >= 400, true)
    assert.equal(body.ok ?? false, false)
  })
})

test('recap answers a harness that has none with two empty strings', async () => {
  await withServer(async (call) => {
    for (const harness of ['cursor', 'nope', '']) {
      const { status, body } = await call('/api/recap', { harness, ref: { sessionId: 'x' } })
      assert.equal(status, 200, 'no recap is not a failure the user should see')
      assert.deepEqual(body, { ok: true, first: '', last: '' })
    }
  })
})

test('a new conversation in the editor is refused for a folder that is gone, before anything opens', async () => {
  await withServer(async (call) => {
    // Only the refusal is driven here: a folder that exists would really open an editor window
    // on the machine running the tests.
    const { status, body } = await call('/api/new-session', { folder: '/nowhere/at/all', harness: 'claude-code', prefer: 'ide' })
    assert.equal(status, 400)
    assert.match(body.error, /not on this machine/i)
  })
})

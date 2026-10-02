/**
 * The page's own headers, from the server that actually serves it. `serve.mjs` listens at
 * import, so it runs as a child on a port of its own rather than being imported here — and the
 * child is only trusted to be up once it prints its `Taskshire → http://…` line.
 *
 * Ported from upstream PR #66, with the refusals this fork added on top.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SERVE = path.join(here, '..', 'server', 'serve.mjs')

/** A request with exactly these headers — `fetch` will not let a test forge `Host`. */
function raw(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, headers }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function withServe(run) {
  const port = 20000 + Math.floor(Math.random() * 20000)
  // A data folder of its own, so nothing here can read or write the real colony file.
  const data = await fsp.mkdtemp(path.join(os.tmpdir(), 'bot-crossing-serve-'))
  const child = spawn(process.execPath, [SERVE], {
    env: { ...process.env, PORT: String(port), BOT_CROSSING_HOST: '127.0.0.1', BOT_CROSSING_DATA: data },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('serve.mjs did not start')), 8000)
      child.stdout.on('data', (d) => {
        if (String(d).includes('Taskshire')) {
          clearTimeout(timer)
          resolve()
        }
      })
      child.on('exit', (code) => reject(new Error(`serve.mjs exited ${code}`)))
    })
    return await run({ port, get: (p, headers) => raw(port, p, { Host: `127.0.0.1:${port}`, ...headers }), child })
  } finally {
    child.kill()
    await fsp.rm(data, { recursive: true, force: true })
  }
}

function assertHardened(res, what) {
  const csp = res.headers['content-security-policy'] || ''
  assert.match(csp, /(^|; )default-src 'self'(;|$)/, `${what}: default-src`)
  assert.equal(res.headers['x-content-type-options'], 'nosniff', `${what}: nosniff`)
  assert.equal(res.headers['x-frame-options'], 'DENY', `${what}: no framing`)
  assert.equal(res.headers['referrer-policy'], 'no-referrer', `${what}: no referrer`)
}

test('the page ships a policy that only lets it do what it does', async () => {
  await withServe(async ({ get }) => {
    const res = await get('/')
    // A checkout with no dist/ built answers 404 — with the same headers, which is the point.
    assert.ok([200, 404].includes(res.status), `status ${res.status}`)
    const csp = res.headers['content-security-policy'] || ''
    assert.match(csp, /(^|; )default-src 'self'(;|$)/)
    assert.match(csp, /(^|; )script-src 'self'(;|$)/, 'no inline script, no third party')
    assert.match(csp, /(^|; )style-src-attr 'unsafe-inline'(;|$)/, 'style attributes are set from code')
    assert.match(csp, /(^|; )img-src 'self' data: blob:(;|$)/, 'textures and the screenshot')
    assert.match(csp, /(^|; )media-src 'self' blob:(;|$)/, 'audio from /assets')
    assert.match(csp, /(^|; )connect-src 'self' blob:(;|$)/, "GLTFLoader fetches a model's textures back as blob: URLs")
    assert.match(csp, /(^|; )frame-ancestors 'none'(;|$)/)
    assert.match(csp, /(^|; )form-action 'none'(;|$)/)
    assert.match(csp, /(^|; )object-src 'none'(;|$)/)
    assert.doesNotMatch(csp, /unsafe-eval/)
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/)
    assertHardened(res, 'a hit')
  })
})

test('a refusal and a miss carry the same headers as a hit', async () => {
  await withServe(async ({ get }) => {
    // A miss falls back to index.html (SPA) — 200 with a dist/, 404 without — and the policy is on it either way.
    assertHardened(await get('/definitely-not-here.txt'), 'a miss')
    const climb = await get('/..%2f..%2fetc%2fpasswd')
    assert.ok([403, 200].includes(climb.status), 'never a file from outside dist/')
    assertHardened(climb, 'a climb')
  })
})

test('a rebound Host gets no bundle, and is told so with the same headers', async () => {
  await withServe(async ({ get }) => {
    for (const p of ['/', '/index.html', '/assets/whatever.js']) {
      const res = await get(p, { Host: 'evil.example' })
      assert.equal(res.status, 403, `${p} is refused to a rebound name`)
      assertHardened(res, `a rebound ${p}`)
    }
    // The API has its own guard and its own JSON answer, which says nosniff too.
    const api = await get('/api/state', { Host: 'evil.example' })
    assert.equal(api.status, 403)
    assert.equal(api.headers['x-content-type-options'], 'nosniff')
  })
})

test('a malformed escape is a 400, and the server is still there for the next request', async () => {
  await withServe(async ({ get, child }) => {
    for (const p of ['/%', '/%E0%A4%A', '/assets/%zz.js']) {
      const bad = await get(p)
      assert.equal(bad.status, 400, `${p} is a bad request`)
      assertHardened(bad, `a bad ${p}`)
    }
    assert.equal(child.exitCode, null, 'the process is still running')
    const next = await get('/')
    assert.ok([200, 404].includes(next.status), `the next request answers, got ${next.status}`)
    assertHardened(next, 'the next request')
  })
})

// A request target the URL parser rejects (`//[` reads as a host that never closes its bracket)
// throws before any of the handler's own checks run — the stand-in for whatever fails next.
test('a request that throws inside the handler is answered with a 500', async () => {
  await withServe(async ({ get, child }) => {
    const res = await get('//[')
    assert.equal(res.status, 500)
    assertHardened(res, 'a 500')
    assert.equal(child.exitCode, null, 'the process is still running')
    assert.ok([200, 404].includes((await get('/')).status), 'and answers the next request')
  })
})

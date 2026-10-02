/**
 * Who the API answers: its own page on this machine, and nobody else — not a rebound name, not
 * a page on another local port, not a cross-site request, and not a body a hostile page could
 * send without a preflight.
 *
 * `fetch` fills in headers of its own, so the requests that forge them go through `http.request`,
 * where what is written is what arrives.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

import { withServer } from './support/with-server.mjs'

/** A request with exactly these headers and nothing added. */
function raw(port, { method = 'GET', path = '/api/state', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    // A request nobody answers is a failure, not a test that never ends.
    req.setTimeout(5000, () => req.destroy(new Error(`no answer to ${method} ${path}`)))
    req.end(body)
  })
}

test('a page on another localhost port is not this page, however local it is', async () => {
  await withServer(async ({ port }) => {
    const other = port === 9999 ? 9998 : 9999
    const res = await raw(port, {
      method: 'PUT',
      headers: { Host: `127.0.0.1:${port}`, Origin: `http://localhost:${other}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(res.status, 403)
    // The same host:port the request was sent to is this page, and is let through.
    const own = await raw(port, {
      method: 'PUT',
      headers: { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(own.status, 200)
  })
})

test('same hostname, same port, different spelling of localhost is another origin too', async () => {
  await withServer(async ({ port }) => {
    const res = await raw(port, {
      method: 'POST',
      path: '/api/recap',
      headers: { Host: `127.0.0.1:${port}`, Origin: `http://localhost:${port}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(res.status, 403)
  })
})

test('an Origin that does not parse is nobody’s page', async () => {
  await withServer(async ({ port }) => {
    const res = await raw(port, {
      method: 'POST',
      path: '/api/recap',
      headers: { Host: `127.0.0.1:${port}`, Origin: 'http://[not a host', 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(res.status, 403)
  })
})

test('a body that is not JSON is a 415, before anything reads it', async () => {
  await withServer(async ({ call, port }) => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const res = await call('/api/recap', {
        method: 'POST',
        body: '{}',
        headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': type },
      })
      assert.equal(res.status, 415, `${type} is refused`)
    }
    const put = await call('/api/state', {
      method: 'PUT',
      body: '{}',
      headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'text/plain' },
    })
    assert.equal(put.status, 415)
  })
})

test('the page’s own JSON requests still get the answers they always did', async () => {
  await withServer(async ({ call, put, port }) => {
    assert.equal((await put({ archived: ['a'] })).status, 200)
    // A parameter on the media type is still JSON.
    const charset = await call('/api/state', {
      method: 'PUT',
      body: JSON.stringify({ archived: ['b'] }),
      headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'Application/JSON; charset=utf-8' },
    })
    assert.equal(charset.status, 200)
    // A folder that is not there is the route's own 400, not the guard's 403 or 415.
    const reveal = await call('/api/reveal', { method: 'POST', body: JSON.stringify({ folder: 'relative' }) })
    assert.equal(reveal.status, 400)
  })
})

test('a cross-site or same-site request is refused even as a GET with no Origin', async () => {
  await withServer(async ({ port }) => {
    const host = { Host: `127.0.0.1:${port}` }
    assert.equal((await raw(port, { headers: { ...host, 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
    // Another localhost port is `same-site`, not `same-origin`, and is refused just the same.
    assert.equal((await raw(port, { headers: { ...host, 'Sec-Fetch-Site': 'same-site' } })).status, 403)
    // The page's own reads say same-origin, and a typed URL says none: both still answer.
    assert.equal((await raw(port, { headers: { ...host, 'Sec-Fetch-Site': 'same-origin' } })).status, 200)
    assert.equal((await raw(port, { headers: { ...host, 'Sec-Fetch-Site': 'none' } })).status, 200)
    assert.equal((await raw(port, { headers: host })).status, 200)
  })
})

/**
 * Mounted the way Vite's connect stack mounts it: a plain server that calls the middleware with a
 * `next` and ignores the promise it returns. A request target the URL parser rejects is answered
 * as a bad request there, and the server goes on answering.
 */
test('mounted connect-style, a target that does not parse is a 400 and the next request answers', async () => {
  const { apiMiddleware } = await import('../server/api.mjs')
  const rejections = []
  const onRejection = (err) => rejections.push(err)
  process.on('unhandledRejection', onRejection)
  const server = http.createServer((req, res) => {
    apiMiddleware(req, res, () => res.writeHead(200, { 'Content-Type': 'text/plain' }).end('the page'))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  try {
    for (const target of ['//[', '//x:99999/']) {
      const bad = await raw(port, { path: target, headers: { Host: `127.0.0.1:${port}` } })
      assert.equal(bad.status, 400, `${target} is a bad request`)
      assert.equal(bad.headers['content-type'], 'application/json')
    }
    const next = await raw(port, { path: '/', headers: { Host: `127.0.0.1:${port}` } })
    assert.equal(next.status, 200)
    assert.equal(next.body, 'the page', 'a request past the API still reaches the next handler')
    await new Promise((r) => setImmediate(r))
    assert.deepEqual(rejections, [], 'nothing was left unhandled')
  } finally {
    process.off('unhandledRejection', onRejection)
    server.close()
  }
})

test('a rebound Host is refused on the API', async () => {
  await withServer(async ({ port }) => {
    assert.equal((await raw(port, { headers: { Host: 'evil.example' } })).status, 403)
  })
})

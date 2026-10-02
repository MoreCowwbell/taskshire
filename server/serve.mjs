import http from 'node:http'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiMiddleware, isLocalHost } from './api.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(here, '..', 'dist')
const PORT = Number(process.env.PORT) || 5274
const HOST = process.env.BOT_CROSSING_HOST || '127.0.0.1'

/**
 * What the page is allowed to do, said once by the server so a slip in the page cannot widen it.
 *
 * The colony draws text it did not write — thread titles are people's prompts, previews are
 * their first messages — and every place that text reaches `innerHTML` escapes it. This is the
 * backstop for the day one does not: a script that is not the bundle does not run, the page
 * cannot be framed, and nothing on it can post a form or fetch anywhere but here. Everything
 * listed is something the page actually does — one module script, style attributes set from
 * code, textures and the screenshot as data: and blob: URLs, models and audio from `/assets`.
 * `connect-src` allows blob: because three's GLTFLoader unpacks a model's embedded textures
 * into blob: URLs and fetches them back — without it every tree on the map is white. Nothing
 * inline, no workers, no third party. The dev server (`vite`) is not this file and keeps its HMR.
 *
 * Ported from upstream PR #66, and sent on every answer this file writes — a hit, a miss, a
 * refusal and an error alike — because a header that only rides on the happy path is one a
 * crafted URL can step around.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** Resolve inside dist/ only — a request can never climb out with `..`. Takes a decoded path. */
function resolveInDist(decoded) {
  const rel = decoded.replace(/^\/+/, '')
  const file = path.resolve(DIST, rel || 'index.html')
  return file === DIST || file.startsWith(DIST + path.sep) ? file : null
}

/**
 * The path as the browser meant it, or null. `decodeURIComponent` throws on a malformed escape
 * (`GET /%`); the caller answers null with a 400, as a hardening of request handling, rather than
 * letting the throw leave the handler.
 */
function decodedPath(pathname) {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return null
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost')

  if (url.pathname.startsWith('/api/')) {
    return await apiMiddleware(req, res, null)
  }

  // The API's DNS-rebinding check, applied to the bundle too. A page whose name was rebound to
  // 127.0.0.1 after it loaded is same-origin with us as far as its browser knows, so without
  // this it could fetch `index.html` and the scripts and read whatever the build inlined.
  if (!isLocalHost(req)) {
    res.writeHead(403, SECURITY_HEADERS).end('Forbidden')
    return
  }

  const decoded = decodedPath(url.pathname)
  if (decoded === null) {
    res.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' }).end('Bad request')
    return
  }

  let file = resolveInDist(decoded)
  if (!file) {
    res.writeHead(403, SECURITY_HEADERS).end('Forbidden')
    return
  }
  try {
    if ((await fsp.stat(file)).isDirectory()) file = path.join(file, 'index.html')
  } catch {
    file = path.join(DIST, 'index.html') // SPA fallback
  }

  try {
    const body = await fsp.readFile(file)
    const type = TYPES[path.extname(file)] || 'application/octet-stream'
    const cache = file.includes(`${path.sep}assets${path.sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache'
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': cache })
    res.end(body)
  } catch {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' }).end('Not found')
  }
}

/**
 * Whatever goes wrong inside one request stays inside that request. An `async` handler that
 * throws is an unhandled rejection, which Node does not leave to carry on, so the handler is
 * wrapped as a hardening: anything that slips past its own checks is a 500 here, and the server
 * keeps answering the next request.
 */
const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res)
  } catch (err) {
    console.error(`serve: ${req.method} ${req.url} failed: ${err && err.message ? err.message : err}`)
    if (!res.headersSent) res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' }).end('Server error')
    else res.destroy()
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Taskshire → http://${HOST}:${PORT}`)
})

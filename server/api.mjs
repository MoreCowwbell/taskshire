import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isAbsoluteFolder } from './lib/fsutil.mjs'
import { ideTarget } from './ide.mjs'
import { schemeHasHandler, schemeOf } from './lib/xdg.mjs'
import { openInTerminal } from './lib/terminal.mjs'
import {
  defaultHarness,
  harnessStatus,
  newSession as harnessNewSession,
  openThread as harnessOpenThread,
  recap as harnessRecap,
  scanThreads,
} from './scan.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.BOT_CROSSING_DATA || path.join(here, '..', 'data')
const STATE_FILE = path.join(DATA_DIR, 'colony.json')

const STATE_VERSION = 2

/**
 * v1 keyed everything on a bare session id, because Claude Code was the only harness and its
 * ids are UUIDs. Adapters now prefix (`claude-code:…`, `codex:…`) so two harnesses can never
 * name the same thread, which means a v1 file's archive list no longer matches anything.
 *
 * Only Claude Code ever wrote a bare id, so the rewrite is unambiguous. One shot, on read.
 */
const BARE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const migrateId = (id) => (BARE_UUID.test(id) ? `claude-code:${id}` : id)

function migrate(raw) {
  if (Number(raw.version) >= 2) return raw
  const keys = (o) => Object.fromEntries(Object.entries(asObject(o)).map(([k, v]) => [migrateId(k), v]))
  return {
    ...raw,
    archived: asArray(raw.archived).map(migrateId),
    archivedAt: keys(raw.archivedAt),
    opened: asArray(raw.opened).map(migrateId),
    seen: keys(raw.seen),
    viewedAt: keys(raw.viewedAt),
  }
}

/**
 * Colony state is only ever the things the *game* invents — which plot a project got,
 * what a thread's building looks like, what you archived, which repos you took off the map.
 * The threads themselves stay
 * read-only: this file is the only thing Bot Crossing writes, anywhere.
 */
const emptyState = () => ({
  version: STATE_VERSION,
  archived: [],
  archivedAt: {},
  // Repos you never want to see, repos that never fade, and repos you cleared out of the
  // Gone group — by repo name, the same key the layout is stored under. The last of those
  // empties itself: the page drops a name the day a thread opens in that folder again.
  hidden: [],
  pinned: [],
  forgotten: [],
  opened: [],
  plots: {},
  seen: {},
  viewedAt: {},
  settings: null,
  updatedAt: 0,
})

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const asArray = (v) => (Array.isArray(v) ? v : [])

export async function readState() {
  try {
    const raw = migrate(JSON.parse(await fsp.readFile(STATE_FILE, 'utf8')))
    return {
      version: STATE_VERSION,
      archived: asArray(raw.archived),
      archivedAt: asObject(raw.archivedAt),
      hidden: asArray(raw.hidden),
      pinned: asArray(raw.pinned),
      forgotten: asArray(raw.forgotten),
      opened: asArray(raw.opened),
      plots: asObject(raw.plots),
      seen: asObject(raw.seen),
      viewedAt: asObject(raw.viewedAt),
      settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : null,
      updatedAt: Number(raw.updatedAt) || 0,
    }
  } catch {
    return emptyState()
  }
}

/**
 * The browser owns this file and PUTs it whole; writes are serialised through one chain, and
 * each gets its own temp file.
 *
 * Both halves matter and neither is theoretical. A shared `colony.json.tmp` means two saves
 * landing together race on the rename and one throws ENOENT — a 500 the page has no idea what
 * to do with, so the save is simply lost. And read-then-write is not atomic across an `await`,
 * so without the chain two callers can both pass the version check below before either writes.
 */
let writeQueue = Promise.resolve()
let tmpSeq = 0
const serialise = (fn) => (writeQueue = writeQueue.then(fn, fn))

/**
 * On Windows a rename onto a file someone else has open fails with EPERM, EACCES or EBUSY, and
 * someone usually does: Dropbox, the indexer or an antivirus scanner opens `colony.json` for a
 * moment after every save. The handle is gone within milliseconds, so wait it out rather than
 * lose the save — the same back-off graceful-fs uses, capped near a second.
 */
const LOCKED = new Set(['EPERM', 'EACCES', 'EBUSY'])
async function renameRetrying(from, to) {
  for (let wait = 10; ; wait *= 2) {
    try {
      return await fsp.rename(from, to)
    } catch (err) {
      if (process.platform !== 'win32' || !LOCKED.has(err.code) || wait > 640) throw err
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

export async function writeState(next) {
  const state = {
    version: STATE_VERSION,
    archived: asArray(next.archived),
    archivedAt: asObject(next.archivedAt),
    hidden: asArray(next.hidden),
    pinned: asArray(next.pinned),
    forgotten: asArray(next.forgotten),
    opened: asArray(next.opened),
    plots: asObject(next.plots),
    seen: asObject(next.seen),
    viewedAt: asObject(next.viewedAt),
    settings: next.settings && typeof next.settings === 'object' ? next.settings : null,
    updatedAt: Date.now(),
  }
  await fsp.mkdir(DATA_DIR, { recursive: true })
  const tmp = `${STATE_FILE}.${process.pid}.${++tmpSeq}.tmp`
  try {
    // colony.json names the repos you work in and where they are: the owner's business, not
    // every account on the machine's. A fresh file per write, so the mode always applies. Windows
    // has no mode bits and ignores it; the file inherits its folder's ACL there instead.
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
    await renameRetrying(tmp, STATE_FILE)
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
  return state
}

/**
 * Hand a `harness://…` deep link, or a folder, to whatever opens things on this OS. The
 * opener gets an argument list, never a shell string.
 *
 * Only `present()` calls this, and no harness knowledge ever reaches it: an adapter says what it
 * wants opened and this decides how, which is the seam that keeps `server/harnesses/` swappable.
 *
 * macOS's `open(1)` does both jobs, and `xdg-open` is the Linux equivalent. On Windows the
 * equivalent is ShellExecute, reached through `rundll32 url.dll,FileProtocolHandler`: a
 * registered protocol URL goes to its app and a folder opens in Explorer, with the argument
 * passed through untouched. Two more obvious routes were tried and rejected — `explorer.exe
 * <url>` silently drops any URL that carries a query string, so `code/new?folder=…` never
 * arrived, and `cmd /c start` parses its own argument line, where the `%3A%5C` escapes in that
 * same link are exactly what it expands.
 *
 * The spawn is guarded because the opener may simply not be installed — a headless Linux box
 * has no `xdg-open` — and an unhandled `error` event on a child process takes the whole server
 * down. Failing quietly is right here: there is nothing the page could do with the error, and
 * the scan path must never depend on whether presentation worked.
 *
 * `rundll32` is named by its full System32 path rather than by name. A bare name is looked up
 * in the server's own working directory and along PATH before System32, so a `rundll32.exe`
 * dropped in either would be handed every folder and link the page ever opens.
 */
const OPENERS = {
  darwin: ['open'],
  win32: [path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe'), 'url.dll,FileProtocolHandler'],
  linux: ['xdg-open'],
}

function launch(target) {
  const opener = OPENERS[process.platform]
  if (!opener) return
  const [cmd, ...args] = opener
  const child = spawn(cmd, [...args, target], { stdio: 'ignore', detached: true })
  // Guarded so a box without the opener fails quietly rather than taking the server down
  // with an unhandled event — but said once on the console, or "nothing happened" is all
  // the user ever learns.
  child.on('error', (err) => console.warn(`open: ${cmd} failed for ${target}: ${err.message}`))
  child.unref()
}

/**
 * Re-exported, not defined here any more: the harness adapters need the same guard, and a
 * server module importing `api.mjs` for it would have the seam pointing the wrong way. The
 * existing importers of this name keep working.
 */
export { isAbsoluteFolder }

/**
 * A folder is openable only if it is still on this machine and still a directory. Paths
 * arrive from the page, which got them from a scan that may be minutes old — a repo that
 * has since been moved or deleted must fail here rather than hand the opener a dead path.
 * Absolute is judged by `isAbsoluteFolder` rather than a leading `/`, which no Windows path has.
 *
 * A path that starts with two slashes or backslashes is refused before anything touches the disk:
 * that is `\\host\share` or `//host/share`, and the `\\?\` and `\\.\` device forms that begin the
 * same way. The colony opens folders on this machine and nothing else, and this is a hardening of
 * that rule: a network location is never looked up at all, so the refusal does not wait for
 * `stat` to say whether it is there.
 *
 * A scan can hand the page one of these. `stripLongPathPrefix` turns Codex's `\\?\C:\…` cwds into
 * `C:\…`, but a `\\?\UNC\…` one into `\\server\share`, and a thread run inside WSL is recorded
 * under `\\wsl.localhost\` or `\\wsl$\`. Those are refused all the same, on purpose, and the page
 * is told so in words of their own (`NETWORK_REFUSAL`) rather than that the folder has gone.
 */
const isNetworkPath = (folder) => typeof folder === 'string' && /^[\\/]{2}/.test(folder)

const NETWORK_REFUSAL = 'Network folders are not opened from here'

async function resolveFolder(folder) {
  if (!isAbsoluteFolder(folder) || isNetworkPath(folder)) return null
  const dir = path.resolve(folder)
  const stat = await fsp.stat(dir).catch(() => null)
  return stat && stat.isDirectory() ? dir : null
}

/**
 * `command.cwd` came from the page — inside `ref`, or as the folder itself — so it gets the same
 * check as any other folder the page names. There is no fallback directory on purpose:
 * `claude --resume` looks a session up under the folder it ran in, and a terminal that opens on
 * "No conversation found" and closes is worse than an error toast.
 *
 * It is also the one place every terminal launch passes through — both `via: 'terminal'` routes
 * and Linux's fallback rung — so the folder is held to a stricter rule here than anywhere else,
 * before anything touches the disk: a hardening that accepts only plain folder names. A name
 * carrying `;`, `&`, `|`, `^`, `%`, `"`, a backtick or a line break is refused on every platform,
 * since those are characters the terminals this launches treat as more than text, and no real
 * checkout needs them. A network path is refused for the reason `resolveFolder` gives.
 */
const TERMINAL_UNSAFE = /[;&|^%"`\r\n]/

async function runInTerminal(command) {
  if (!command.cwd) return { ok: false, error: 'That thread has no folder on record to resume in' }
  if (isNetworkPath(command.cwd)) return { ok: false, error: NETWORK_REFUSAL }
  if (typeof command.cwd !== 'string' || TERMINAL_UNSAFE.test(command.cwd)) {
    return { ok: false, error: 'That folder’s name cannot be handed to a terminal safely' }
  }
  const cwd = await resolveFolder(command.cwd)
  if (!cwd) return { ok: false, error: 'The folder that thread ran in is not on this machine any more' }
  // A folder that exists but cannot be entered fails inside every terminal alike, and the
  // terminal gets the blame; say what is actually wrong instead.
  const enterable = await fsp.access(cwd, fsp.constants.X_OK).then(() => true, () => false)
  if (!enterable) return { ok: false, error: 'The folder that thread ran in cannot be entered' }
  const opened = await openInTerminal(command.argv, cwd)
  return opened.ok ? { ok: true, via: 'terminal' } : opened
}

/**
 * Show a harness's answer to "open this" — `{ ok, url, command }` — the way the page asked for
 * it, and say truthfully whether anything happened.
 *
 * A caller asking for a terminal never gets the desktop app instead, even when the CLI is missing:
 * an app window appearing after asking for a terminal reads as the request being ignored, where
 * an error toast reads as something to fix. This fork's page never asks for one — its single
 * Resume opens setting is `ide | app | copy` — so `via: 'terminal'` is reachable only by calling
 * the endpoint directly; upstream's launcher is kept for that and for the next merge.
 *
 * Otherwise macOS and Windows hand the URL to the opener: a scheme the harness's app registers is
 * always answered there, so nothing is probed. Linux is the platform where the URL may have
 * nowhere to go — the desktop app is optional and often absent, and `xdg-open` on a scheme nobody
 * claims exits quietly, which used to reach the page as "Opened". So there the scheme is checked
 * first; failing that, the harness's own CLI runs in a terminal, from the `command` the adapter
 * offered alongside the URL; failing that, the page is told so.
 *
 * That terminal rung runs a command only when the adapter marked it `safe`: it checked that no
 * process still holds the session (`resumeOffer`), or the command starts a new one. A running
 * thread must never be handed a second resume, and an adapter that cannot tell — Codex and
 * Antigravity offer `resume <id>` with no liveness check — leaves its command unmarked, so on this
 * path it is not run and `handBack` falls back to the IDE window. Unmarked commands still run for
 * an explicit `via: 'terminal'`, which the page never sends.
 */
export async function present(result, via = 'app') {
  // Only the reason reaches the page: a failure may still carry the adapter's command. `live`
  // is the one extra fact worth forwarding — the browser writes a different toast for a session
  // that is already running than for one that simply cannot be opened.
  if (!result || !result.ok) {
    return { ok: false, error: result?.error || 'Nothing to open', ...(result?.live ? { live: true } : {}) }
  }

  if (via === 'terminal') {
    if (!result.command) {
      return {
        ok: false,
        error:
          'That harness’s CLI was not found on this machine — install it, or open the thread in the desktop app',
      }
    }
    return runInTerminal(result.command)
  }

  // Upstream fronts the terminal window of a live `pid` here. This fork does not: a session that
  // is already running is refused by the adapter (`live`), and the IDE rung raises the VS Code
  // window the repo is open in — see `handBack`. `server/lib/windows.mjs` is kept, unimported.

  if (process.platform !== 'linux') {
    if (!result.url) return { ok: false, error: 'That harness has no deep link to open on this platform' }
    launch(result.url)
    // A note is the adapter saying it opened *something* — the repo rather than the thread.
    return { ok: true, url: result.url, note: result.note }
  }

  if (result.url && (await schemeHasHandler(result.url))) {
    launch(result.url)
    return { ok: true, url: result.url }
  }
  if (result.command?.safe === true) return runInTerminal(result.command)
  const scheme = schemeOf(result.url)
  return {
    ok: false,
    error: scheme
      ? `Nothing on this machine opens ${scheme}:// links, and there is no CLI command to run instead`
      : 'Nothing on this machine can open that',
  }
}

const viaOf = (body) => (body?.via === 'terminal' ? 'terminal' : 'app')

/**
 * Mark the threads the colony has retired.
 *
 * Nothing is written anywhere. Bot Crossing used to set `isArchived` on the desktop app's own
 * session record, and it did land on disk — but the app serves from the copy it loaded at
 * launch, so the thread stayed put in its own list until the next restart, and the app would
 * rewrite the record from memory whenever it touched the thread. Papering over that took a
 * re-assert on every poll, a `ps` sweep to guess whether the app had re-read the file, and a
 * *pending* state for the gap between the two — a lot of machinery for something that still
 * looked broken to anyone with the app open.
 *
 * So the colony keeps its own list and that is all it does. Archiving in the harness's own UI
 * still sends the astronaut home, because the scan reads that flag; archiving here is the
 * colony's own business. Nothing outside `data/colony.json` is ever written.
 */
export async function reconcileArchived(threads) {
  const state = await readState()
  if (!state.archived.length) return threads
  const wanted = new Set(state.archived)

  /**
   * An archive is remembered by the thread id the page saw, but that id is only the *canonical*
   * one. A thread the desktop app knows and the CLI has not written a transcript for is keyed on
   * its desktop record; the moment a transcript appears it re-keys to that session's UUID, and a
   * list keyed on the old string stops matching. The thread quietly comes back, which reads as
   * the archive having failed.
   *
   * So the ids inside `ref` count too. They are opaque to everything else here — this only ever
   * asks whether a string it already holds appears among them.
   *
   * Each is tried bare *and* behind the thread's own harness prefix, because the two sides are
   * keyed differently: the list holds canonical ids (`claude-code:<uuid>`) while `ref` holds the
   * harness's raw session ids. Without the prefixed try this whole rescue is dead code. The bare
   * try still earns its place — `migrateId` only rewrites something shaped like a bare UUID, so a
   * v1 file's desktop id (`local_…`) was left alone and matches here exactly as it always did.
   */
  const archived = (thread) => {
    if (wanted.has(thread.id)) return true
    const ref = thread.ref
    if (!ref || typeof ref !== 'object') return false
    const match = (v) =>
      typeof v === 'string' && v && (wanted.has(v) || wanted.has(`${thread.harness}:${v}`))
    for (const value of Object.values(ref)) {
      if (Array.isArray(value)) {
        for (const v of value) if (match(v)) return true
      } else if (match(value)) return true
    }
    return false
  }

  // `state` is the browser's only liveness signal, so the colony's own archive list has to
  // move it too — a thread archived here but still holding a live process would otherwise
  // come back `active` and keep its character.
  return threads.map((t) => (archived(t) ? { ...t, archived: true, state: 'archived' } : t))
}

function send(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
    // An answer carries thread titles and folder names; it is JSON and must never be sniffed
    // into anything a browser would render.
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(payload)
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

// The machine's own LAN addresses count as local too, so the colony can be
// served to the home network with BOT_CROSSING_HOST set. Harmless when bound
// to loopback (those hosts can't reach the server anyway), and the Host +
// Origin pairing still stops DNS rebinding and CSRF exactly as before.
for (const addrs of Object.values(os.networkInterfaces())) {
  for (const a of addrs || []) {
    if (a && a.family === 'IPv4' && !a.internal && a.address) LOCAL_HOSTS.add(a.address)
  }
}

/** Hostname out of a `Host:` or `Origin:` value, with the port and any brackets stripped. */
function hostnameOf(value) {
  if (!value) return ''
  const raw = String(value).includes('://') ? value : `http://${value}`
  try {
    return new URL(raw).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return ''
  }
}

/**
 * The DNS-rebinding half of the guard below, on its own: was this request addressed to this
 * machine by a name this machine answers to? Exported because the static half of `serve.mjs`
 * needs the same answer — a rebound page that can fetch the bundle as a same-origin resource
 * can read everything the build inlined, and that is every repo name on the map.
 */
export function isLocalHost(req) {
  return LOCAL_HOSTS.has(hostnameOf(req.headers.host))
}

/**
 * Only a page this server itself served may drive it. Three checks, against three different
 * attacks, all of which a localhost server with an `open`-the-desktop-app button is a
 * genuinely attractive target for:
 *
 *   - **Host** stops DNS rebinding. Binding to 127.0.0.1 is not on its own enough: an
 *     attacker who points `evil.com` at 127.0.0.1 reaches us *as a same-origin page*, and
 *     can then read every response. The rebound request still carries `Host: evil.com`.
 *   - **Origin** stops CSRF, and it is compared whole — hostname *and* port — against the
 *     `Host` the request was sent to. It used to be the hostname alone, which meant a page on
 *     any other localhost port (a dev server, a notebook, a report opened through some
 *     throwaway file server) counted as this one. A web origin includes its port; "a page this
 *     server itself served" is literally `Origin` naming the same host:port as `Host`. An
 *     `Origin` that does not even parse is nobody's page and is refused.
 *   - **Sec-Fetch-Site** stops the one thing the other two let through: a GET from another
 *     page carries no `Origin`, and while the page that sent it can never read the answer, it
 *     can make this server rescan every transcript on the machine as often as it likes. The
 *     colony's own page stamps `same-origin` on everything it sends, and a URL typed into the
 *     address bar says `none`; anything else — `cross-site`, and `same-site` too, which is what
 *     a page on another localhost port sends — is refused. A request with no such header (an
 *     older browser, `curl`) is left to the other two checks. Only the API is held to it;
 *     navigating to the page itself from a link is still fine.
 *
 * A state-changing request with no `Origin` at all is refused: browsers always send one on
 * POST/PUT, so its absence means the caller is not the page. That does mean a bare `curl`
 * POST is rejected; pass `-H 'Origin: http://localhost:5274'` if you are scripting this — and
 * `-H 'Content-Type: application/json'` with it, for the reason `apiMiddleware` gives.
 */
function isLocalRequest(req) {
  if (!isLocalHost(req)) return false
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false

  const origin = req.headers.origin
  if (origin && origin !== 'null') {
    let host
    try {
      host = new URL(origin).host
    } catch {
      return false
    }
    return host.toLowerCase() === String(req.headers.host || '').toLowerCase()
  }
  return req.method === 'GET' || req.method === 'HEAD'
}

/**
 * The media type of the body, parameters and case aside: `application/json; charset=utf-8` is
 * `application/json`.
 */
const mediaTypeOf = (req) => String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()

function readJsonBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/**
 * What the server actually did. `present()` answers with a `url` when it handed something to
 * the OS opener and without one when it ran the adapter's command in a terminal, so this reads
 * the truth off the result rather than guessing from what was asked.
 */
const didWhat = (asked, shown) => (shown.url ? (asked === 'ide' ? 'focused-ide' : 'opened-app') : 'ran-command')

/**
 * The folder a thread ran in, as the page named it — or null. `resolveFolder`'s check plus a
 * refusal of any `..` segment: a scan records the folder a thread ran in, never a path that climbs
 * out of one, so a `..` was written by something other than the scan. Nothing here touches the
 * disk before `resolveFolder` has turned a network path away.
 */
async function threadFolder(cwd) {
  if (typeof cwd !== 'string' || cwd.split(/[\\/]/).includes('..')) return null
  return resolveFolder(cwd)
}

/**
 * The Resume ladder's server half: try what the page asked for, then the one fallback that does
 * not need a clipboard, and say which of the two happened.
 *
 * `prefer: 'app'` is the default and is what this route did before there was a choice, so a
 * caller that knows nothing about the setting behaves exactly as it used to.
 *
 * The desktop app is deliberately **not** a fallback for `'ide'`: opening it moves the thread
 * into an application the user did not pick, and that is a bigger thing to do unasked than
 * leaving the clipboard to the page. `'copy'` never reaches here at all — the clipboard is the
 * browser's, and it is the rung below both of these.
 */
async function handBack(harness, pageRef, prefer) {
  // `ref.cwd` came from the page, so it gets the same check every other folder the page names
  // gets — absolute, free of `..`, statted, and required to still be a directory — once, here,
  // before either rung sees it. Matching a window is string work that never touches the disk, and
  // the Cursor and Kilo Code adapters build `cursor://file/…` / `vscode://file/…` from the folder,
  // so without this a page could name a *file* inside an open workspace root and have the OS
  // opener sent at it, which opens the file rather than raising the folder. A folder that fails
  // is dropped rather than refused: a deep link by session id needs no folder, and a thread
  // whose worktree is gone still opens in its app. The resolved path replaces the page's, and
  // URLs are built from it, for the same reason: a lock file holds folders, and `C:\repo\` is not
  // the string any of them will ever be.
  const dir = await threadFolder(pageRef?.cwd)
  const ref = pageRef && typeof pageRef === 'object' ? { ...pageRef, cwd: dir || '' } : pageRef

  const focus = async () => {
    if (!dir) {
      const error = isNetworkPath(pageRef?.cwd)
        ? NETWORK_REFUSAL
        : 'The folder that thread ran in is not on this machine any more'
      return { ok: false, error }
    }
    const target = await ideTarget(dir)
    if (!target.ok) return target
    const shown = await present(target)
    return shown.ok ? { ...shown, did: didWhat('ide', shown), ideName: target.ideName } : shown
  }

  if (prefer === 'ide') return focus()

  const shown = await present(await harnessOpenThread(harness, ref))
  if (shown.ok) return { ...shown, did: didWhat('app', shown) }
  const focused = await focus()
  // When neither worked, the app's own reason is the more useful of the two: "no desktop
  // record" says what to do about it, "no window has that folder open" does not.
  // `instead` is why the app was not what opened: a thread started in a terminal has no desktop
  // record, and without the reason the page would toast a window as if it had been asked for one.
  return focused.ok ? { ...focused, instead: shown.error } : shown
}

/**
 * Connect-style middleware: handles /api/*, passes everything else through.
 *
 * The request target is parsed inside a `try`, because the URL parser rejects some targets a
 * client can still send (`//[` names a host that never closes its bracket). A connect stack does
 * nothing with the promise this returns, so a rejection here would escape every handler; a
 * target that does not parse is a 400 like any other bad request.
 */
export async function apiMiddleware(req, res, next) {
  let url
  try {
    url = new URL(req.url, 'http://localhost')
  } catch {
    return send(res, 400, { error: 'Bad request' })
  }
  if (!url.pathname.startsWith('/api/')) return next ? next() : send(res, 404, { error: 'Not found' })

  if (!isLocalRequest(req)) {
    return send(res, 403, { error: 'Taskshire only answers its own page on this machine' })
  }

  // Every body this server reads is JSON, and the page has always said so. A `text/plain` (or
  // form) body is the one shape a hostile page can send without a CORS preflight, so refusing
  // anything else here means a cross-origin write has to survive a preflight this server never
  // answers — a second wall behind the Origin check rather than the only one.
  if ((req.method === 'POST' || req.method === 'PUT') && mediaTypeOf(req) !== 'application/json') {
    return send(res, 415, { error: 'Taskshire only reads JSON bodies' })
  }

  try {
    if (url.pathname === '/api/threads' && req.method === 'GET') {
      const threads = await reconcileArchived(await scanThreads())
      // A harness that is present but cannot read its own store says so here, rather than
      // appearing healthy in the list while quietly contributing nothing.
      const warnings = (await harnessStatus()).filter((h) => h.detected && h.error).map((h) => h.error)
      return send(res, 200, { threads, scannedAt: Date.now(), warnings })
    }

    if (url.pathname === '/api/harnesses' && req.method === 'GET') {
      return send(res, 200, { harnesses: await harnessStatus() })
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      return send(res, 200, await readState())
    }

    /**
     * Optimistic concurrency, so a second tab cannot paste over the first one's work.
     *
     * `baseUpdatedAt` is the version the caller last agreed with. If the file no longer carries
     * it, the caller's whole-file body describes a colony that no longer exists — so the disk
     * state comes back with a 409 and the page merges against it. Merging here was the other
     * option and it is the wrong place: the server has no idea which of two `plots` layouts a
     * person actually dragged.
     *
     * The test is inequality rather than "older than", because a colony file also moves
     * *backwards* — restored from a backup, edited by hand — and a page open across that holds
     * a base newer than disk, which sails through a greater-than check and pastes the
     * pre-restore colony straight back.
     *
     * A missing or zero base is a first write and is allowed: nothing to lose on a fresh
     * install, and it keeps the endpoint drivable from `curl`.
     */
    if (url.pathname === '/api/state' && req.method === 'PUT') {
      const body = await readJsonBody(req)
      const base = Number(body.baseUpdatedAt) || 0
      // Awaited, not returned bare: a bare returned promise skips the catch below, and a failed
      // save became an unhandled rejection that took the whole dev server down.
      return await serialise(async () => {
        const current = await readState()
        if (base && current.updatedAt !== base) return send(res, 409, current)
        return send(res, 200, await writeState(body))
      })
    }

    if (url.pathname === '/api/open' && req.method === 'POST') {
      const body = await readJsonBody(req)
      // `via: 'terminal'` is upstream's launcher, which the page never asks for; everything the
      // page sends goes down the Resume ladder.
      const shown =
        viaOf(body) === 'terminal'
          ? await present(await harnessOpenThread(body.harness, body.ref), 'terminal')
          : await handBack(body.harness, body.ref, body.prefer)
      return send(res, shown.ok ? 200 : 400, shown)
    }

    /**
     * What a thread was about. A read and nothing else: no write, no subprocess, no clipboard.
     *
     * POST rather than GET because `ref` is an opaque object and belongs in a body, which is how
     * every other ref-carrying route already takes it; the Host and Origin guard above covers it
     * either way. A transcript being written right now is a normal thing to trip over, so a
     * failure is two empty strings and a 200 — the page hides the line rather than showing a red
     * toast about somebody else's file.
     */
    if (url.pathname === '/api/recap' && req.method === 'POST') {
      const { harness, ref } = await readJsonBody(req)
      try {
        const { first, last } = await harnessRecap(harness, ref)
        return send(res, 200, { ok: true, first, last })
      } catch {
        return send(res, 200, { ok: true, first: '', last: '' })
      }
    }

    if ((url.pathname === '/api/new-session' || url.pathname === '/api/reveal') && req.method === 'POST') {
      const body = await readJsonBody(req)
      const { prefer } = body
      const dir = await resolveFolder(body.folder)
      if (!dir) {
        const error = isNetworkPath(body.folder) ? NETWORK_REFUSAL : 'That folder is not on this machine any more'
        return send(res, 400, { ok: false, error })
      }

      if (url.pathname === '/api/reveal') {
        launch(dir)
        return send(res, 200, { ok: true })
      }
      // The Resume opens setting decides this too. `'ide'` raises the window the repo is open in
      // — or opens one, on its workspace when it has one — and the thread is started there by
      // hand. The desktop app is not a fallback for it, for the reason `handBack` gives.
      if (prefer === 'ide') {
        const target = await ideTarget(dir)
        const shown = await present(target)
        return send(res, shown.ok ? 200 : 400, shown.ok ? { ...shown, did: didWhat('ide', shown), ideName: target.ideName } : shown)
      }
      const harness = body.harness || (await defaultHarness())
      if (viaOf(body) === 'terminal') {
        const shown = await present(await harnessNewSession(harness, dir), 'terminal')
        return send(res, shown.ok ? 200 : 400, shown)
      }
      const shown = await present(await harnessNewSession(harness, dir))
      return send(res, shown.ok ? 200 : 400, shown.ok ? { ...shown, did: didWhat('app', shown) } : shown)
    }

    return send(res, 404, { error: 'Unknown endpoint' })
  } catch (err) {
    return send(res, 500, { error: String(err && err.message ? err.message : err) })
  }
}

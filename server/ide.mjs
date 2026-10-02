/**
 * Which editor windows are open, and which one a folder belongs to.
 *
 * VS Code's Claude Code extension writes one lock file per window to
 * `~/.claude/ide/<port>.lock`, and that is the only record on this machine of which windows
 * are open on which folders. Read-only bookkeeping, like everything else here.
 *
 * Harness-agnostic on purpose: a window has no opinion about which harness is running inside
 * it, so a Codex thread and a Claude Code thread in the same repo want the same window. This
 * module imports nothing from `server/harnesses/`, and nothing there imports it — putting the
 * reader in the Claude Code adapter because the extension happens to write the file would
 * make every future adapter import that adapter to raise a window.
 *
 * The lock also carries an `authToken`: a credential for the extension's own websocket. Three
 * fields are copied out of the parsed record and the rest is dropped on the floor. No route
 * returns a lock, nothing logs one, and no error message carries a file's contents.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { canonicalPath, exists, findExecutable, isAbsoluteFolder, listDirs, listFiles } from './lib/fsutil.mjs'

/** One file per open window, named for the port the extension is listening on. */
const IDE_LOCKS = path.join(os.homedir(), '.claude', 'ide')

/** The folder each editor keeps under the per-user application data directory, by scheme. */
const DATA_DIRS = { vscode: 'Code', cursor: 'Cursor', windsurf: 'Windsurf' }

/** Where an editor remembers every workspace it has opened: one folder each, a `workspace.json` inside. */
function workspaceStorage(scheme) {
  const name = DATA_DIRS[scheme]
  if (!name) return ''
  const home = os.homedir()
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support')
        : process.env.XDG_CONFIG_HOME || path.join(home, '.config')
  return path.join(base, name, 'User', 'workspaceStorage')
}

/**
 * Editors whose URL scheme we know. An `ideName` that is not in here is not a window this can
 * raise, so its thread falls down the ladder rather than being sent at a scheme nothing on the
 * machine answers.
 *
 * `Visual Studio Code` is verified against a real install. The two forks register their own
 * handler the same way and are **unverified**; a new editor is a row in this table and nothing
 * else.
 */
const SCHEMES = {
  'Visual Studio Code': 'vscode',
  Cursor: 'cursor', // unverified
  Windsurf: 'windsurf', // unverified
}

/**
 * Does this pid exist? `EPERM` is a process that exists and belongs to somebody else, which is
 * alive for our purposes — unlike `scanLiveSessions`, which only ever probes pids it owns.
 */
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}

/** Is `dir` this folder, or inside it? Canonical on both sides, so neither flavour surprises us. */
function within(dir, folder) {
  const a = canonicalPath(dir)
  const b = canonicalPath(folder)
  if (!a || !b) return false
  return a === b || a.startsWith(b + path.sep)
}

/**
 * Every window with a live lock in `dir`. Exported with the directory as an argument so the
 * tests can point it at a temp folder; `ideWindows()` is the one callers use.
 *
 * Every lock is skipped rather than trusted where it cannot answer for itself: unparseable,
 * half-written, no pid to probe, a pid nothing owns, an editor we have no scheme for, or no
 * folders at all. A session being written right now is a normal thing to trip over.
 */
export async function readLocks(dir) {
  const out = []
  for (const file of await listFiles(dir, (n) => n.endsWith('.lock'))) {
    let record
    let mtime = 0
    try {
      const [text, stat] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)])
      record = JSON.parse(text)
      mtime = stat.mtimeMs
    } catch {
      continue
    }
    const scheme = SCHEMES[record?.ideName]
    if (!scheme) continue
    const pid = Number(record?.pid)
    if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) continue
    // Usually an array. A single-root window has been seen writing the bare string.
    const raw = record.workspaceFolders
    const folders = (Array.isArray(raw) ? raw : [raw]).filter((f) => typeof f === 'string' && f)
    if (!folders.length) continue
    // Only these three fields leave this loop.
    out.push({ port: Number(path.basename(file, '.lock')) || 0, folders, ideName: record.ideName, scheme, mtime })
  }
  return out
}

export const ideWindows = () => readLocks(IDE_LOCKS)

/**
 * Which window a folder belongs to.
 *
 * The longest matching root wins, so a window opened on a worktree beats one opened on the repo
 * that contains it. A folder can be open in several windows at once — three of six here — so
 * ties go to the window that lists it first (its own project's window, rather than one that
 * borrows it as a side folder), then to the most recently touched lock, and then to the lowest
 * port, which keeps the answer stable between polls and between test runs.
 */
export function matchWindow(windows, dir) {
  const hits = []
  for (const win of windows) {
    let depth = 0
    let index = 0
    win.folders.forEach((folder, i) => {
      const len = canonicalPath(folder).length
      if (within(dir, folder) && len > depth) [depth, index] = [len, i]
    })
    if (depth) hits.push({ win, depth, index })
  }
  hits.sort((a, b) => b.depth - a.depth || a.index - b.index || b.win.mtime - a.win.mtime || a.win.port - b.win.port)
  return hits[0]?.win || null
}

/**
 * A `.code-workspace` file is JSON with comments and trailing commas, and VS Code writes both.
 * Walked a character at a time because a `//` or a `,}` inside a string is a path, not syntax.
 */
export function parseJsonc(text) {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === '\\') out += text[++i] ?? ''
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 1
    } else if (ch === ',' && /^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*[}\]]/.test(text.slice(i + 1))) {
      // a trailing comma: dropped
    } else {
      out += ch
    }
  }
  return JSON.parse(out)
}

/**
 * Every workspace file the editor remembers, with its folders resolved the way the editor
 * resolves them: relative to the workspace file, not to anybody's cwd.
 *
 * The lock file lists a window's folders and never says which `.code-workspace` put them there,
 * and that file is the only thing the URL handler will match a multi-root window on. Sent at a
 * folder instead, the editor finds no window "on that folder" and opens it in whichever window
 * was last active — closing the workspace that was there, and every session in it.
 *
 * Exported with the directory as an argument, like `readLocks`, for the same reason.
 */
export async function readWorkspaces(dir) {
  const seen = new Map()
  for (const sub of await listDirs(dir)) {
    try {
      const record = path.join(sub, 'workspace.json')
      const [text, stat] = await Promise.all([fsp.readFile(record, 'utf8'), fsp.stat(record)])
      const uri = JSON.parse(text)?.workspace
      if (typeof uri !== 'string' || !uri.startsWith('file://')) continue
      const file = fileURLToPath(uri)
      // An unsaved multi-root workspace is a `workspace.json` under the editor's own data folder,
      // and the URL handler tells a workspace from a file by this extension alone: sent one of
      // those, it opens the JSON as text in a new window.
      if (path.extname(file).toLowerCase() !== '.code-workspace') continue
      const key = canonicalPath(file)
      if (seen.has(key) && seen.get(key).mtime >= stat.mtimeMs) continue
      const parsed = parseJsonc(await fsp.readFile(file, 'utf8'))
      const folders = (Array.isArray(parsed?.folders) ? parsed.folders : [])
        .map((f) => (typeof f?.path === 'string' && f.path ? path.resolve(path.dirname(file), f.path) : ''))
        .filter(Boolean)
      if (folders.length) seen.set(key, { file, folders, mtime: stat.mtimeMs })
    } catch {
      /* a workspace that was deleted, moved, or is mid-write — not one we can open */
    }
  }
  return [...seen.values()]
}

const folderSet = (folders) => [...new Set(folders.map(canonicalPath))].sort().join('\n')

/** The workspace file a window was opened from: the one whose folders are exactly the window's. */
export function workspaceOfWindow(workspaces, win) {
  if (win.folders.length < 2) return null
  const want = folderSet(win.folders)
  const hits = workspaces.filter((ws) => folderSet(ws.folders) === want)
  hits.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file))
  return hits[0] || null
}

/**
 * With no window open: the workspace this folder is usually opened through. The deepest root
 * wins, then the workspace that lists it first (its own project, rather than one borrowing it as
 * a side folder), then the most recently used.
 */
export function workspaceForFolder(workspaces, dir) {
  const hits = []
  for (const ws of workspaces) {
    let depth = 0
    let index = 0
    ws.folders.forEach((folder, i) => {
      const len = canonicalPath(folder).length
      if (within(dir, folder) && len > depth) [depth, index] = [len, i]
    })
    if (depth) hits.push({ ws, depth, index })
  }
  hits.sort((a, b) => b.depth - a.depth || a.index - b.index || b.ws.mtime - a.ws.mtime)
  return hits[0]?.ws || null
}

/**
 * `vscode://file` + an absolute path: POSIX separators, the drive letter inside the URL's path
 * rather than in its authority, every other segment percent-encoded. The drive colon is left
 * alone, which is the form VS Code's own handler writes.
 */
export function fileUrl(scheme, dir) {
  const posix = String(dir).replace(/\\/g, '/')
  const rooted = posix.startsWith('/') ? posix : `/${posix}`
  const encoded = rooted
    .split('/')
    .map((seg, i) => (i === 1 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/')
  return `${scheme}://file${encoded}`
}

/**
 * Raise the window that has `dir` open — in the `{ ok, url, command }` shape an adapter's
 * `openThread` returns, so `present()` in `server/api.mjs` does the OS-specific half and
 * nothing here launches anything itself.
 *
 * The URI is preferred over the `code` CLI: both end in the same window resolution inside VS
 * Code, but the URI needs nothing on `PATH` and travels through the opener `present()` already
 * uses. The CLI rides along as `command` for Linux, where the scheme may genuinely have no
 * handler — plain `code <dir>`, never `--reuse-window`, which points the *last active* window
 * at a different folder instead of raising the one that already has it.
 */
export async function ideTarget(dir) {
  if (!isAbsoluteFolder(dir)) return { ok: false, error: 'That thread has no folder on record' }
  const win = matchWindow(await ideWindows(), dir)
  const target = win ? await openWindowTarget(win, dir) : await newWindowTarget(dir)
  if (!target) return { ok: false, error: 'No editor window has that folder open' }

  let command
  if (process.platform === 'linux') {
    const bin = await findExecutable('code')
    if (bin) command = { argv: [bin, target.open], cwd: dir }
  }
  // `windowId=_blank` is the handler's "never reuse a window" switch. A window already on the
  // target is still raised — that check runs first — so all this changes is the miss: a new
  // window, instead of the last active one being pointed somewhere else.
  return { ok: true, url: `${fileUrl(target.scheme, target.open)}?windowId=_blank`, command, ideName: target.ideName }
}

/**
 * What raises a window that is open: its workspace file if it came from one, else the root it
 * has open — never the thread's own folder, which may be a subfolder no window is "on".
 */
async function openWindowTarget(win, dir) {
  const ws = workspaceOfWindow(await readWorkspaces(workspaceStorage(win.scheme)), win)
  const root = win.folders
    .filter((folder) => within(dir, folder))
    .sort((a, b) => canonicalPath(b).length - canonicalPath(a).length)[0]
  return { scheme: win.scheme, ideName: win.ideName, open: ws?.file || root }
}

/**
 * No window has the folder — the thread ran somewhere else, or its window has been closed. Open
 * a new one, on the workspace the folder belongs to when there is one. Only for an editor that
 * has left a storage folder behind: a scheme nothing answers is a dialog on Windows, not an error.
 */
async function newWindowTarget(dir) {
  for (const [ideName, scheme] of Object.entries(SCHEMES)) {
    const storage = workspaceStorage(scheme)
    if (!(await exists(storage))) continue
    const ws = workspaceForFolder(await readWorkspaces(storage), dir)
    return { scheme, ideName, open: ws?.file || dir }
  }
  return null
}

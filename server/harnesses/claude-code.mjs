/**
 * Harness adapter: Claude Code (Anthropic) — the desktop app and the CLI together.
 *
 * Everything that knows the shape of Claude Code's own files lives in this one module.
 * `server/scan.mjs` never reaches past the adapter interface, so adding another harness
 * means writing a sibling of this file rather than editing the scanner. The contract is
 * written down in `server/harnesses/README.md`.
 *
 * Read-only, without exception. Nothing here writes to Claude Code's files — see the note on
 * archiving in `server/harnesses/README.md`.
 *
 * Two stores, deliberately merged rather than picked between:
 *   - the desktop app keeps one JSON record per thread (title, cwd, model, timestamps), and
 *     leaves a marker behind for each thread deleted in it
 *   - the CLI keeps the raw transcript, which is the only source for terminal-started work
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { exists, findExecutable, jsonLines, listDirs, listFiles, num, readHead, readTail } from '../lib/fsutil.mjs'
import { oneLine } from '../lib/text.mjs'

const HOME = os.homedir()

/**
 * Where the Claude desktop app keeps its data: Electron's `userData` for an app named
 * "Claude", which lands somewhere different on each OS.
 *
 * macOS and Windows are both verified against a real install. Linux is a best guess at the
 * usual Electron userData location and has not been checked on a machine that has the app.
 */
function desktopDataDir() {
  switch (process.platform) {
    case 'win32':
      return windowsDataDir()
    case 'linux':
      return path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'Claude')
    default:
      return macDataDir()
  }
}

/**
 * macOS has two answers as well, because the app ships under two Electron app names: the
 * classic `Claude`, and `Claude-3p`, which is what a current install writes to. Both can be
 * present at once — an older install leaves an empty `Claude` behind, and an empty directory
 * is indistinguishable from the app never having been installed. Hard-coding `Claude` there
 * means every desktop thread is missed, and the colony falls back to drawing the CLI
 * transcript alone: no title, no model, and no desktop record for `Open` to navigate to
 * (upstream then falls back to `claude://resume`, which imports; this fork never builds that
 * link).
 *
 * So pick whichever one actually holds session records, the same rule windowsDataDir uses
 * below — and, like it, resolved once at import, so installing the app under the colony
 * wants a restart to be noticed.
 */
function macDataDir() {
  const support = path.join(HOME, 'Library', 'Application Support')
  const candidates = [path.join(support, 'Claude-3p'), path.join(support, 'Claude')]
  return candidates.find((dir) => existsSync(path.join(dir, 'claude-code-sessions'))) || candidates[1]
}

/**
 * Windows has two answers, because the app ships two ways.
 *
 * The classic installer writes to `%APPDATA%\Claude`, which is what Electron's `userData` means
 * everywhere else. Installed from the Microsoft Store the app is an MSIX package, and MSIX
 * *redirects* what a packaged app believes is `%APPDATA%` into its own private
 * `…\Packages\<family>\LocalCache\Roaming`. The app is installed, running and writing session
 * records — and `%APPDATA%\Claude` does not exist at all.
 *
 * The package folder is globbed rather than named: its suffix is a hash of the publisher, and
 * hard-coding that buys a constant which is right until it is not, and then wrong in a way that
 * looks exactly like the app having been uninstalled.
 *
 * Resolved once, at import. Installing the app while the colony is running therefore wants a
 * restart to be noticed — a knowing trade, since the alternative is globbing `Packages` on every
 * scan to catch something that happens once.
 */
function windowsDataDir() {
  const roaming = path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Claude')
  const local = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')
  const candidates = [roaming]
  try {
    for (const entry of readdirSync(path.join(local, 'Packages'), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('Claude_')) {
        candidates.push(path.join(local, 'Packages', entry.name, 'LocalCache', 'Roaming', 'Claude'))
      }
    }
  } catch {
    /* no Packages directory — this machine has no Store apps at all */
  }
  // Whichever actually holds the records. Falling back to the unpackaged path keeps every
  // caller working against a real path when neither exists, which `detect()` reads as "no app".
  return candidates.find((dir) => existsSync(path.join(dir, 'claude-code-sessions'))) || roaming
}

/**
 * Both roots take an override, which is how the tests fake an install without touching a real
 * one. `CLAUDE_CONFIG_DIR` is the CLI's own: a shell that sets it has its transcripts written
 * there, so the variable that moves the CLI's home moves where the colony looks for it too.
 * `BOT_CROSSING_CLAUDE_DESKTOP` names the session store itself, the sibling of Cursor's
 * `BOT_CROSSING_CURSOR_PROJECTS`.
 */
/** Where the Claude desktop app keeps one JSON record per thread. */
const DESKTOP_SESSIONS =
  process.env.BOT_CROSSING_CLAUDE_DESKTOP || path.join(desktopDataDir(), 'claude-code-sessions')
/** The CLI's home: `~/.claude`, unless the CLI itself has been told otherwise. */
const CLI_HOME = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude')
/** Where the CLI keeps the raw transcript: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl */
const CLI_PROJECTS = path.join(CLI_HOME, 'projects')
/** One file per live CLI process: {pid, sessionId, cwd, ...}. Stale files outlive their pid. */
const CLI_LIVE = path.join(CLI_HOME, 'sessions')

const HEAD_BYTES = 192 * 1024
/** Enough of a subagent's tail to reach its last whole record; they are written one line each. */
const TAIL_BYTES = 64 * 1024
/**
 * A subagent killed mid-run never writes its closing record, so silence is the only thing
 * left to read it by. Twenty minutes is long enough that a subagent waiting on a slow tool
 * is still counted as working, and short enough that a corpse leaves within one coffee.
 */
export const SUBAGENT_QUIET_MS = 20 * 60 * 1000

/**
 * Which entrypoints are a person at a keyboard. Anything else — `sdk-py`, `sdk-ts` and
 * whatever the next plugin brings — is a program driving Claude Code, and its transcripts
 * are machine exhaust rather than work the user would recognise as a session of theirs.
 */
const HUMAN_ENTRYPOINTS = ['cli', 'claude-vscode']

/**
 * Every id this adapter hands out is prefixed. `server/harnesses/README.md` asks for ids unique
 * across harnesses, and while two UUIDs will not collide, the colony keys its archive list and
 * saved layout on this string — so it is worth being unambiguous rather than merely lucky.
 */
const ID = (raw) => `claude-code:${raw}`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DESKTOP_ID = /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The type check matters wherever an id came back from the page: `RegExp.test` stringifies, so a
// one-element array holding a valid id would pass the pattern and then travel on as an array.
const isCliId = (v) => typeof v === 'string' && UUID.test(v)
const isDesktopId = (v) => typeof v === 'string' && DESKTOP_ID.test(v)

function firstText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') return part
      if (part && part.type === 'text' && typeof part.text === 'string') return part.text
    }
  }
  return ''
}

/** Strip <system-reminder>/<command-*> noise the CLI wraps around prompts. */
function cleanPrompt(s) {
  return String(s)
    .replace(/<([a-z][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Pull whatever a transcript knows about itself: title, cwd, branch, start time, and who
 * started it. Mirrors the CLI's own title precedence: custom > ai > summary > first prompt.
 *
 * `entrypoint` and `sidechain` are what tell a session someone opened from one a program
 * spawned. Both are written on the head records, so the head read already has them.
 */
function readTranscriptMeta(records) {
  const meta = {
    customTitle: '',
    aiTitle: '',
    summary: '',
    firstPrompt: '',
    cwd: '',
    gitBranch: '',
    startedAt: 0,
    entrypoint: '',
    sidechain: false,
    stub: true,
  }
  // Only the opening `user` record answers "is this a sidechain": later ones belong to
  // whatever the session went on to do.
  let seenUser = false
  for (const r of records) {
    // A file that never says when, where or what is not a thread. The CLI writes a one-line
    // `bridge-session` record for a remote session and nothing else; it used to claim a plot.
    if (r.timestamp || r.cwd || r.message || r.type === 'summary') meta.stub = false
    if (!meta.entrypoint && r.entrypoint) meta.entrypoint = String(r.entrypoint)
    if (!seenUser && r.type === 'user') {
      seenUser = true
      meta.sidechain = r.isSidechain === true
    }
    if (!meta.customTitle && r.customTitle) meta.customTitle = r.customTitle
    if (!meta.aiTitle && r.aiTitle) meta.aiTitle = r.aiTitle
    if (!meta.summary && r.type === 'summary' && r.summary) meta.summary = r.summary
    if (!meta.cwd && r.cwd) meta.cwd = r.cwd
    if (!meta.gitBranch && r.gitBranch && r.gitBranch !== 'HEAD') meta.gitBranch = r.gitBranch
    if (!meta.startedAt && r.timestamp) {
      const t = Date.parse(r.timestamp)
      if (!Number.isNaN(t)) meta.startedAt = t
    }
    if (!meta.firstPrompt && r.type === 'user' && r.message) {
      const text = cleanPrompt(firstText(r.message.content))
      if (text && !text.startsWith('<')) meta.firstPrompt = text
    }
  }
  return meta
}

/**
 * Was this transcript written by a program rather than by a person?
 *
 * Two kinds: a session an SDK started (the security-guidance plugin's hooks alone account
 * for 239 of one repo's 263 transcripts), and a sidechain — a subagent's own conversation.
 * Neither is a thread the user opened, so neither ever leaves the server. A missing
 * entrypoint is old or hand-written data and stays: the filter only drops what it recognises.
 */
function isAutomatedTranscript(meta) {
  return Boolean(meta.sidechain) || Boolean(meta.entrypoint && !HUMAN_ENTRYPOINTS.includes(meta.entrypoint))
}

/**
 * Last segment of a path, tolerant of either separator. A record is always written by the
 * machine it belongs to, but the tests feed both flavours through and a mixed-separator path
 * is a normal thing to see on Windows, where `C:/repo` and `C:\repo` are the same folder.
 */
const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''

/**
 * A path on its way out to the browser, left as the harness wrote it bar one thing: Windows
 * records whichever case the shell had for the drive letter, so the same repo arrives as both
 * `C:\repo` and `c:\repo` and claims two plots. The drive letter is the one part of a Windows
 * path that is reliably case-insensitive, so it is the only part normalised.
 */
function nativePath(p) {
  const s = String(p || '')
  return process.platform === 'win32' ? s.replace(/^([a-z]):/, (_, drive) => `${drive.toUpperCase()}:`) : s
}

/** Canonical form for *comparison only* — never for anything handed back to the browser. */
function canonical(p) {
  if (!p) return ''
  const native = String(p).replace(/[\\/]+/g, path.sep)
  const normal = path.normalize(native).replace(new RegExp(`\\${path.sep}+$`), '')
  return process.platform === 'win32' ? normal.toLowerCase() : normal
}

/**
 * `/repo/.claude/worktrees/feature-abc` -> project `/repo`, worktree `feature-abc`.
 * Either separator: on Windows the same cwd arrives as `C:\repo\.claude\worktrees\…`.
 *
 * The prefix comes back in native separators, since it is the project path a caller will
 * compare and hand on — the no-match case is the raw `cwd`, which is already native.
 */
const WORKTREE = /[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/
function splitWorktree(cwd) {
  const native = String(cwd || '').replace(/[\\/]+/g, path.sep)
  const m = WORKTREE.exec(native)
  if (!m) return { root: cwd, worktree: '' }
  return { root: native.slice(0, m.index), worktree: m[1] }
}

/**
 * Which repo a thread belongs to, and which checkout of it.
 *
 * A worktree session records both halves: `originCwd` is the repo it was started from and
 * `cwd` is the checkout it is actually working in. That pairing is how the desktop app
 * describes a worktree on every platform, so it is tried first — the older
 * `<repo>/.claude/worktrees/<name>` path marker only ever matched the macOS layout, and
 * never matches Windows, where worktrees live under `~/.claude-worktrees/<project>/<name>`.
 *
 * Paths go back to the browser exactly as the harness wrote them, native separators and all.
 */
function projectOf(cwd, originCwd) {
  const dir = cwd || ''
  const origin = originCwd || ''
  if (origin && dir && canonical(origin) !== canonical(dir)) {
    return { projectPath: origin, project: baseName(origin) || origin, worktree: baseName(dir) }
  }
  const { root, worktree } = splitWorktree(dir)
  const projectPath = origin || root || dir
  return { projectPath, project: baseName(projectPath) || projectPath || 'unknown', worktree }
}

/**
 * Best-effort reverse of the encoding used for project folder names: `-Users-you-Some-Dir`
 * on macOS, `C--Users-you-Some-Dir` on Windows, where the drive's colon became a dash too.
 *
 * Neither form is reversible outright: separators, hyphens and underscores (and on Windows
 * the drive colon) all fold into the same `-`, so `C--Users-x-a-b` is `C:\Users\x\a\b`,
 * `C:\Users\x\a-b` or `C:\Users\x\a_b`. The only honest way back is to try the readings
 * against the disk, separator first at every `-` since that is what most of them are, and
 * keep the first path that exists. Nothing matching leaves a POSIX name as the blind
 * reverse it always was and a Windows name alone. This is a last resort either way — the
 * `cwd` recorded inside the transcript, or in a sibling transcript of the same folder, is
 * what every caller reaches for first.
 */
function decodeProjectDir(name, existsSync = fs.existsSync) {
  let root
  let sep
  let tokens
  if (name.startsWith('-')) {
    root = ''
    sep = '/'
    tokens = name.slice(1).split('-')
  } else {
    const m = /^([A-Za-z])--(.+)$/.exec(name)
    if (!m) return name
    root = `${m[1].toUpperCase()}:`
    sep = '\\'
    tokens = m[2].split('-')
  }
  const JOINERS = ['-', '_', '.', ' ']

  // Depth-first over the readings of each `-`. A prefix that is not on disk cannot lead to
  // a path that is, so a new segment is only opened under a prefix that exists.
  const walk = (i, segments) => {
    const here = `${root}${sep}${segments.join(sep)}`
    if (i === tokens.length) return existsSync(here) ? here : null
    if (existsSync(here)) {
      const found = walk(i + 1, [...segments, tokens[i]])
      if (found) return found
    }
    const last = segments[segments.length - 1]
    for (const j of JOINERS) {
      const found = walk(i + 1, [...segments.slice(0, -1), `${last}${j}${tokens[i]}`])
      if (found) return found
    }
    return null
  }
  const found = walk(1, [tokens[0]])
  if (found) return found
  return sep === '/' ? '/' + name.slice(1).replace(/-/g, '/') : name
}

/** Index every CLI transcript on disk, keyed by session id. */
async function scanTranscripts() {
  const byId = new Map()
  for (const projectDir of await listDirs(CLI_PROJECTS)) {
    for (const file of await listFiles(projectDir, (n) => n.endsWith('.jsonl'))) {
      const id = path.basename(file, '.jsonl')
      let stat
      try {
        stat = await fsp.stat(file)
      } catch {
        continue
      }
      byId.set(id, { id, file, projectDir, size: stat.size, mtime: stat.mtimeMs })
    }
  }
  return byId
}

/** Transcript metadata is expensive to parse, so keep it until the file changes. */
const metaCache = new Map()
async function transcriptMeta(entry) {
  const cached = metaCache.get(entry.id)
  if (cached && cached.mtime === entry.mtime) return cached.meta
  let meta
  try {
    meta = readTranscriptMeta(jsonLines(await readHead(entry.file, HEAD_BYTES)))
  } catch {
    meta = readTranscriptMeta([])
  }
  metaCache.set(entry.id, { mtime: entry.mtime, meta })
  return meta
}

/**
 * Is this subagent still running?
 *
 * Nothing in `~/.claude/sessions/` or in the parent transcript records a subagent's end, so
 * the tail of its own transcript is the only source. Measured across 29 subagent folders:
 *
 *   - a finished subagent's last message record is an `assistant` one carrying
 *     `stop_reason: "end_turn"` — its final report, no tool use after it
 *   - a running one's last message record is an `assistant` mid tool-use (`stop_reason: null`)
 *     or a `user` tool result; a subagent that has only just started has no message at all
 *   - a subagent picked back up with SendMessage appends a fresh `user` record *after* its
 *     `end_turn`, and is running again — which is why this reads the last message record of
 *     either role rather than the last assistant one
 *
 * Records with no `message.role` (attachments, bookkeeping) say nothing either way and are
 * skipped. `mtime` is the file's; a transcript nothing has been appended to for
 * `SUBAGENT_QUIET_MS` counts as finished, which is the only way a killed subagent ever leaves.
 */
export function subagentRunning(records, { mtime = 0, now = Date.now() } = {}) {
  let last = null
  for (const r of records) {
    const role = r?.message?.role
    if (role === 'assistant' || role === 'user') last = r
  }
  if (last?.message?.role === 'assistant' && last.message.stop_reason === 'end_turn') return false
  return now - mtime <= SUBAGENT_QUIET_MS
}

/** How much of a transcript's end is read for its last line, and how long that line may be. */
const RECAP_TAIL_BYTES = 64 * 1024
const RECAP_CHARS = 140

/**
 * The last thing the agent actually said, out of a window of records.
 *
 * Tool calls, thinking blocks and tool results are not speech — the line worth reading is the
 * last `text` block of the last assistant record that has one, which is the sentence the agent
 * finished on. An assistant message can hold several blocks (thinking, then text, then a tool
 * call), so it is the last text block *of that record* that is taken.
 *
 * Not put through `cleanPrompt`: that strips anything tag-shaped, which is right for a prompt
 * carrying `<system-reminder>` injections and wrong for an answer that mentions some markup.
 */
export function lastAgentText(records) {
  for (let i = records.length - 1; i >= 0; i--) {
    const content = records[i]?.message?.role === 'assistant' ? records[i].message.content : null
    if (!content) continue
    const blocks =
      typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
    for (let j = blocks.length - 1; j >= 0; j--) {
      const b = blocks[j]
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) return b.text
    }
  }
  return ''
}

/**
 * The transcript for a session id, found under this adapter's own store — one `stat` per project
 * folder, no listing.
 *
 * The id is the only thing taken from `ref`, and it has already been checked against the UUID
 * pattern, so the path is built out of our own root and a known-shaped filename. A transcript
 * *path* from the page would be faster and would also let any page — or a page that reached us
 * through a rebound hostname — name any file on the disk and read 140 characters of it back out
 * of the response.
 */
async function findTranscript(sessionId, root) {
  for (const dir of await listDirs(root)) {
    const file = path.join(dir, `${sessionId}.jsonl`)
    if (await exists(file)) return file
  }
  return ''
}

/** Kept against mtime *and* size: a coarse filesystem clock can date an append to the read before it. */
const recapCache = new Map()

/**
 * The two lines the UI shows for a thread: what you asked first, and what the agent said last.
 *
 * Read on selection rather than in the scan. The scan runs on every poll over every transcript
 * on the machine — 263 of them in one repo here — and adding a tail read per thread per poll to
 * show a line the user reads one thread at a time is the wrong trade. The head is already read
 * and already cached for the title, so `first` comes from the same parser the scan uses.
 *
 * `root` is the store, and is an argument so the tests can point at one of their own.
 */
async function recap(ref, root = CLI_PROJECTS) {
  const id = isCliId(ref?.cliSessionId) ? ref.cliSessionId : ''
  if (!id) return { first: '', last: '' }
  const file = await findTranscript(id, root)
  if (!file) return { first: '', last: '' }

  let stat
  try {
    stat = await fsp.stat(file)
  } catch {
    return { first: '', last: '' }
  }
  const cached = recapCache.get(id)
  if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached.recap

  let first = ''
  let last = ''
  try {
    first = readTranscriptMeta(jsonLines(await readHead(file, HEAD_BYTES))).firstPrompt
    last = lastAgentText(jsonLines(await readTail(file, RECAP_TAIL_BYTES)))
    // A final message longer than the window leaves `readTail` with no whole record at all —
    // the trap `subagentEnded` documents — so a tail holding no assistant text, on a file bigger
    // than the window, is read once more four times as wide before the answer is believed.
    if (!last && stat.size > RECAP_TAIL_BYTES) {
      last = lastAgentText(jsonLines(await readTail(file, RECAP_TAIL_BYTES * 4)))
    }
  } catch {
    /* mid-write, or gone between the stat and the read — the page hides the line */
  }

  const out = { first: oneLine(first, RECAP_CHARS), last: oneLine(last, RECAP_CHARS) }
  recapCache.set(id, { mtime: stat.mtimeMs, size: stat.size, recap: out })
  return out
}

/**
 * Is this a teammate rather than a one-shot subagent?
 *
 * The two are spawned by the same machinery and write the same files, and the meta beside
 * the transcript is what tells them apart. A `Task` subagent is dispatched, reports, and is
 * gone — its `end_turn` is the end of it. A teammate joins the session's team, is addressed
 * by name with `SendMessage`, and goes quiet between turns exactly as a person does: it has
 * reported, it is still there, and the next message wakes the same agent with its context
 * intact. `~/.claude/teams/<team>/config.json` holds the roster, but a member is never taken
 * off it, so the roster cannot say who is still around — only this flag and the clock can.
 *
 * Read off `taskKind`, which is written once when the teammate joins. `teamName` and `name`
 * ride along with it and are not asked for: a second condition here would only find new ways
 * to disagree with the first.
 */
const isTeammate = (meta) => meta?.taskKind === 'in_process_teammate'

/**
 * Has this subagent written its closing report?
 *
 * Asked of one-shot subagents only — a teammate between turns has written one and is still
 * there, so `scanSubagents` never puts the question to it.
 *
 * The window is the last thing in the file, so on the usual transcript one read answers it.
 * A final report longer than the window is the case that needs the second: `readTail` drops
 * the partial line it opens on, so a 100 kB `end_turn` message leaves no whole record at all,
 * and a tail with nothing in it reads as "only just started" — which would keep a finished
 * subagent standing on the plot for the whole quiet window. So a tail that holds no message
 * record at all, on a file bigger than the window, is read once more four times as wide
 * before the answer is believed.
 */
async function subagentEnded(file, size, mtimeMs) {
  let records = jsonLines(await readTail(file, TAIL_BYTES))
  if (!records.some((r) => r?.message?.role) && size > TAIL_BYTES) {
    records = jsonLines(await readTail(file, TAIL_BYTES * 4))
  }
  // `now: mtimeMs` so only the end_turn half of the rule is decided here — the quiet cutoff
  // moves with the clock rather than with the file, and is applied by the caller.
  return !subagentRunning(records, { mtime: mtimeMs, now: mtimeMs })
}

/**
 * The subagents a live session is running right now, as thread-shaped records the browser
 * can stand on the plot.
 *
 * Only the decision is cached, not the tail: a 64 kB window per subagent parsed into objects
 * and held for every session would cost more memory than it saves, and the decision itself
 * only changes when the file does. Keyed on size as well as mtime, because a filesystem with
 * a coarse timestamp can date an append to the same tick as the read before it.
 *
 * The order of the checks is the whole cost of this function on a busy folder: a session
 * that has run thirty subagents holds thirty transcripts that will never change again, and
 * each of them should cost one `stat` per poll and nothing else. So the quiet cutoff comes
 * first and throws out all but the handful still warm; the meta and the cached end_turn
 * decision are only ever paid for those.
 */
const subagentCache = new Map()

async function scanSubagents(entry, now = Date.now()) {
  const dir = path.join(entry.projectDir, entry.id, 'subagents')
  const out = []
  for (const metaFile of await listFiles(dir, (n) => n.startsWith('agent-') && n.endsWith('.meta.json'))) {
    const id = path.basename(metaFile, '.meta.json')
    const jsonl = path.join(dir, `${id}.jsonl`)
    let stat
    try {
      stat = await fsp.stat(jsonl)
    } catch {
      continue // a meta with no transcript beside it is not a subagent yet
    }
    if (now - stat.mtimeMs > SUBAGENT_QUIET_MS) continue

    let meta
    try {
      meta = JSON.parse(await fsp.readFile(metaFile, 'utf8'))
    } catch {
      continue // mid-write, or hand-edited — skip it this pass
    }

    // A teammate is not asked whether it has reported: it is alive between turns, and the
    // silence rule above is the only thing that retires it.
    if (!isTeammate(meta)) {
      const cached = subagentCache.get(jsonl)
      let ended
      if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) {
        ended = cached.ended
      } else {
        try {
          ended = await subagentEnded(jsonl, stat.size, stat.mtimeMs)
        } catch {
          continue
        }
        subagentCache.set(jsonl, { mtime: stat.mtimeMs, size: stat.size, ended })
      }
      if (ended) continue
    }

    out.push({
      id,
      name: meta.name || meta.agentType || id,
      agentType: meta.agentType || '',
      description: meta.description || '',
      model: meta.model || '',
      startedAt: stat.birthtimeMs || stat.mtimeMs,
    })
  }
  out.sort((a, b) => a.startedAt - b.startedAt)
  return out
}

/**
 * Sessions with a CLI process actually alive right now, keyed by session id. The registry
 * keeps files for processes that have exited, so every pid is probed before it counts.
 *
 * The whole record is kept, not just the id: `status` is what separates a session that is
 * working from one waiting on you, and `name` is the title the user gave that terminal.
 *
 * The registry lives in the same place on every platform and `process.kill(pid, 0)` is a
 * real existence check on Windows too, so nothing here shells out to `ps`.
 */
async function scanLiveSessions() {
  const live = new Map()
  for (const file of await listFiles(CLI_LIVE, (n) => n.endsWith('.json'))) {
    let record
    try {
      record = JSON.parse(await fsp.readFile(file, 'utf8'))
    } catch {
      continue
    }
    if (!record.sessionId || !record.pid) continue
    try {
      process.kill(record.pid, 0) // signal 0 only tests for existence
      live.set(record.sessionId, record)
    } catch {
      /* process is gone */
    }
  }
  return live
}

/**
 * The one place a thread's lifecycle state is decided.
 *
 * A live process is the whole of "is this session open" — no recency window, because an
 * open terminal nobody has typed in for a day is still open, and that is exactly the thread
 * the user wants to find. What the session is *doing* comes from the registry's own status:
 * `busy` and `shell` are work, `idle` means it wants input. An unknown status is treated as
 * work rather than as a question, since a spurious `?` is the more misleading of the two.
 *
 * Archived wins over everything: a live archived session is a contradiction the user
 * resolves by unarchiving, not one this function should guess its way out of.
 */
export function threadState({ live, status, archived }) {
  if (archived) return 'archived'
  if (!live) return 'inactive'
  return status === 'idle' ? 'idle' : 'active'
}

/**
 * What deleting a thread in the desktop app leaves behind, in the folder its record was in:
 * `deleted_<cliSessionId>`, holding the deletion time in epoch ms. The record goes; the CLI
 * transcript does not. Without the marker that transcript is indistinguishable from a thread
 * started in a terminal, so a thread you had got rid of walked straight back onto the map as one.
 */
const DELETED_MARKER = /^deleted_(.+)$/
const isRecord = (name) => name.startsWith('local_') && name.endsWith('.json')

/** Every thread the desktop app has a record for, and the ids of the ones it has deleted. */
async function scanDesktopSessions() {
  const records = []
  const deleted = new Set()
  for (const account of await listDirs(DESKTOP_SESSIONS)) {
    for (const org of await listDirs(account)) {
      for (const file of await listFiles(org, (n) => isRecord(n) || DELETED_MARKER.test(n))) {
        const marker = DELETED_MARKER.exec(path.basename(file))
        if (marker) {
          // Only the name is read. When it was deleted is not something the map shows.
          if (isCliId(marker[1])) deleted.add(marker[1])
          continue
        }
        try {
          records.push(JSON.parse(await fsp.readFile(file, 'utf8')))
        } catch {
          /* a session mid-write — skip this pass */
        }
      }
    }
  }
  return { records, deleted }
}

/**
 * Two desktop records can point at one transcript — resuming a thread that is already
 * open makes the app write a second, untitled record. Keep the richer of the two.
 */
function mergeThread(existing, next) {
  const better = (a, b) => (a && a !== 'Untitled thread' ? a : b || a)
  // The titled record is the real thread; an untitled twin is the import ghost. Point
  // the canonical id at the real one, but keep both so archiving covers the ghost too.
  const keepExisting = existing.titled || !next.titled
  return {
    ...existing,
    ...next,
    title: better(existing.title, next.title),
    titled: existing.titled || next.titled,
    preview: existing.preview || next.preview,
    desktopSessionId: keepExisting ? existing.desktopSessionId : next.desktopSessionId,
    desktopSessionIds: [...new Set([...existing.desktopSessionIds, ...next.desktopSessionIds])],
    bridgeSessionId: existing.bridgeSessionId || next.bridgeSessionId,
    model: existing.model || next.model,
    effort: existing.effort || next.effort,
    gitBranch: existing.gitBranch || next.gitBranch,
    cwd: existing.cwd || next.cwd,
    createdAt: Math.min(existing.createdAt || Infinity, next.createdAt || Infinity) || 0,
    lastActivityAt: Math.max(existing.lastActivityAt || 0, next.lastActivityAt || 0),
    lastFocusedAt: Math.max(existing.lastFocusedAt || 0, next.lastFocusedAt || 0),
    hasError: existing.hasError || next.hasError,
    starred: existing.starred || next.starred,
    routine: existing.routine || next.routine,
    prState: existing.prState || next.prState,
    archived: existing.archived && next.archived,
    hasTranscript: existing.hasTranscript || next.hasTranscript,
  }
}

/**
 * Fold the adapter's private bookkeeping into the shape the rest of the app sees.
 * The session ids stay, but behind `ref` — an opaque blob the browser hands straight
 * back on open/archive, so nothing outside this file has to know what a Claude session
 * id looks like.
 *
 * `canOpen` is a desktop record and nothing else, because opening is the only thing the
 * app can do without changing anything. A terminal thread gets `resume` instead: the
 * command to paste, not a link, since the only deep link that resumes one imports it.
 * `sessionId` is the same id `resume` embeds, on its own — the answer to "what is this
 * thread's session id" for anything in the browser that wants the id rather than the command.
 */
export function toThread(t) {
  const {
    desktopSessionId, desktopSessionIds, cliSessionId, bridgeSessionId,
    titled, transcriptFile, recordActivityAt, ...rest
  } = t
  return {
    ...rest,
    canOpen: isDesktopId(desktopSessionId),
    resume: isCliId(cliSessionId) ? `claude --resume ${cliSessionId}` : '',
    // The id on its own. `ref` is opaque by contract and `resume` is a
    // shell command, so neither can answer "what is this thread's session id" in the browser
    // without something parsing something it was promised it would never have to.
    sessionId: isCliId(cliSessionId) ? cliSessionId : '',
    // The cwd rides along because resuming from a terminal has to happen in the folder the
    // session ran in — the worktree, not the repo root.
    ref: { desktopSessionId, desktopSessionIds, cliSessionId, cwd: t.cwd || '' },
  }
}

/**
 * Unread = the thread moved on after you last looked at it; never opened counts as unread.
 *
 * It rests entirely on `lastFocusedAt`, and two kinds of thread cannot answer it:
 *   - terminal-only threads, which have no desktop record and so no focus history at all
 *   - desktop records written by a build that does not track focus — every record the
 *     Windows app writes is one of these, `lastFocusedAt` absent rather than zero
 *
 * Without that timestamp "have you seen this?" is unknowable, and unknowable is not the same
 * as unread: guessing true would leave every Windows thread holding a `?` forever.
 */
function computeUnread(thread) {
  if (!thread.desktopSessionIds.length) return false
  if (!thread.lastFocusedAt) return false
  return thread.lastActivityAt > thread.lastFocusedAt
}

async function scanThreads() {
  const [{ records: desktop, deleted }, transcripts, live] = await Promise.all([
    scanDesktopSessions(),
    scanTranscripts(),
    scanLiveSessions(),
  ])
  const byId = new Map()
  const add = (thread) => {
    const existing = byId.get(thread.id)
    byId.set(thread.id, existing ? mergeThread(existing, thread) : thread)
  }
  const claimed = new Set()

  for (const s of desktop) {
    const cliSessionId = s.cliSessionId || ''
    const entry = cliSessionId ? transcripts.get(cliSessionId) : null
    if (entry) claimed.add(cliSessionId)

    const cwd = nativePath(s.cwd || s.originCwd || '')
    const { projectPath, project, worktree } = projectOf(cwd, nativePath(s.originCwd))
    const meta = entry ? await transcriptMeta(entry) : null
    // A running session's registry name is what the user called that terminal, and it is
    // the freshest title anything has — ahead of a record written when the thread began.
    const reg = cliSessionId ? live.get(cliSessionId) : null

    add({
      id: ID(cliSessionId || s.sessionId),
      cliSessionId,
      desktopSessionId: s.sessionId || '',
      desktopSessionIds: s.sessionId ? [s.sessionId] : [],
      titled: Boolean(s.title),
      bridgeSessionId: (s.bridgeSessionIds && s.bridgeSessionIds[0]) || '',
      title: reg?.name || s.title || meta?.customTitle || meta?.aiTitle || meta?.summary || meta?.firstPrompt || 'Untitled thread',
      preview: meta?.firstPrompt ? meta.firstPrompt.slice(0, 240) : '',
      project,
      projectPath,
      worktree,
      cwd,
      gitBranch: meta?.gitBranch || '',
      model: s.model || '',
      effort: s.effort || '',
      createdAt: num(s.createdAt) || meta?.startedAt || 0,
      // The desktop record's own stamp lags: the app writes it when the thread is focused, so a
      // session running in a terminal — or in a window you are not looking at — reads as hours
      // old while its transcript is being written to right now. The later of the two is true.
      lastActivityAt: Math.max(
        num(s.lastActivityAt) || num(s.lastFocusedAt) || num(s.createdAt) || 0,
        entry?.mtime || 0
      ),
      // Kept apart from the above. "Unread" compares against when you last *looked*, and both
      // sides have to come from the app's own bookkeeping: measure a transcript mtime against
      // `lastFocusedAt` instead and every background write puts a `?` over half the colony.
      recordActivityAt: num(s.lastActivityAt) || num(s.lastFocusedAt) || num(s.createdAt) || 0,
      lastFocusedAt: num(s.lastFocusedAt),
      hasError: Boolean(s.error),
      starred: s.isStarred === true,
      routine: s.scheduledTaskId || '',
      prState: s.prState || '',
      archived: s.isArchived === true || s.isArchived === 'True',
      hasTranscript: Boolean(entry),
      sizeBytes: entry?.size || 0,
      transcriptFile: entry?.file || '',
      source: 'desktop',
    })
  }

  // A transcript's folder *is* its cwd, encoded, so every transcript in a folder shares one.
  // A head that opens with a queued prompt the size of a diff can push the cwd line past
  // what is read; a sibling that has it answers for the whole folder.
  const cwdByDir = new Map()
  for (const entry of transcripts.values()) {
    if (cwdByDir.has(entry.projectDir)) continue
    const meta = await transcriptMeta(entry)
    if (meta.cwd) cwdByDir.set(entry.projectDir, meta.cwd)
  }

  // Transcripts with no desktop record — threads started straight from the terminal, and threads
  // the app has since deleted.
  for (const [id, entry] of transcripts) {
    if (claimed.has(id)) continue
    const meta = await transcriptMeta(entry)
    if (meta.stub || isAutomatedTranscript(meta)) continue
    const cwd = nativePath(meta.cwd || cwdByDir.get(entry.projectDir) || decodeProjectDir(path.basename(entry.projectDir)))
    const { projectPath, project, worktree } = projectOf(cwd, '')
    const reg = live.get(id)
    add({
      id: ID(id),
      cliSessionId: id,
      desktopSessionId: '',
      desktopSessionIds: [],
      titled: Boolean(meta.customTitle || meta.aiTitle),
      bridgeSessionId: '',
      title: reg?.name || meta.customTitle || meta.aiTitle || meta.summary || meta.firstPrompt || 'Untitled thread',
      preview: meta.firstPrompt ? meta.firstPrompt.slice(0, 240) : '',
      project,
      projectPath,
      worktree,
      cwd,
      gitBranch: meta.gitBranch,
      model: '',
      effort: '',
      createdAt: meta.startedAt || entry.mtime,
      lastActivityAt: entry.mtime,
      lastFocusedAt: 0,
      hasError: false,
      starred: false,
      routine: '',
      prState: '',
      // Deleted in the app, and reported the way an archive made there is. `archived` is the
      // read-only field an adapter has for "gone from the harness's own UI", and the colony sends
      // the astronaut home for it exactly as it does for an archive of its own — rather than the
      // thread simply vanishing from one scan to the next. Only a transcript with no record left
      // qualifies: resuming a deleted thread makes the app write a fresh record while the marker
      // stays behind, and a record that exists is the newer truth. A live process is newer truth
      // too: `claude --resume <id>` keeps the id, so the marker outlives the deletion it recorded,
      // and since archived beats live in `threadState` the running session would vanish with no
      // way to unarchive it from the colony.
      archived: deleted.has(id) && !reg,
      hasTranscript: true,
      sizeBytes: entry.size,
      transcriptFile: entry?.file || '',
      source: 'cli',
    })
  }

  const now = Date.now()

  /**
   * Drop the app's empty bookkeeping records.
   *
   * Resuming a thread makes the desktop app write a second record for the same conversation, and
   * one of the two carries the title and the transcript link while the other carries nothing.
   * With no `cliSessionId` on the empty one there is no key to merge the pair on, so it survives
   * as a thread of its own: an untitled entry with no transcript behind it, standing on the map
   * as a nameless twin of a thread you have already dealt with.
   *
   * A record with no transcript, no title and no live process is not a conversation. The age
   * check keeps a genuinely new session — opened seconds ago, nothing written yet — out of it.
   */
  const NEW_SESSION_MS = 10 * 60 * 1000
  const threads = [...byId.values()].filter(
    (t) =>
      t.hasTranscript ||
      t.titled ||
      (t.cliSessionId && live.has(t.cliSessionId)) ||
      now - (t.lastActivityAt || t.createdAt || 0) < NEW_SESSION_MS
  )

  for (const thread of threads) {
    thread.unread = computeUnread(thread)
    const record = thread.cliSessionId ? live.get(thread.cliSessionId) : null
    thread.state = threadState({ live: Boolean(record), status: record?.status, archived: thread.archived })
    // Helpers only stand under an open session, so only an open one is asked. Every thread
    // carries the field either way, so nothing downstream has to test for its absence — and
    // nothing a subagent has is ever a thread, an archive target or a registry lookup.
    const entry = thread.cliSessionId ? transcripts.get(thread.cliSessionId) : null
    thread.subagents =
      entry && (thread.state === 'active' || thread.state === 'idle') ? await scanSubagents(entry, now) : []
  }
  return threads.map(toThread)
}

/**
 * Where the `claude` CLI is, for a machine that has it but no desktop app to answer the deep
 * link, or a page that would rather have a terminal. PATH first, then the places its installers
 * put it — never inside an application bundle.
 */
const CLI_DIRS = [
  path.join(HOME, '.local', 'bin'),
  path.join(HOME, '.claude', 'local'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
]
const cliBinary = () => findExecutable('claude', CLI_DIRS)

/**
 * Whether a terminal resume may be offered for this session, and what to say when nothing can
 * be offered at all. Pure, so the live-session rule is tested without a registry on disk.
 *
 * The rule: a session whose process is alive must never have a second `claude --resume` started
 * against it. Two CLIs appending to one transcript is exactly the damage the banned
 * `claude://resume` link does, and `present()` on Linux will happily open a terminal and run
 * whatever `command` an adapter hands it — so the guard has to live here, where the answer is
 * built, rather than in the caller. The command is marked `safe` because liveness was checked
 * here; `present()` runs nothing unmarked unless a terminal was asked for outright.
 */
export function resumeOffer({ url, live, bin, cliSessionId, cwd, platform = process.platform }) {
  const command =
    !live && platform === 'linux' && bin && cliSessionId
      ? { argv: [bin, '--resume', cliSessionId], cwd: typeof cwd === 'string' ? cwd : '', safe: true }
      : undefined

  if (!url && !command) {
    return live
      ? { ok: false, error: 'That session is already running in a terminal', live: true }
      : { ok: false, error: 'No desktop record — resume it from a terminal' }
  }
  return { ok: true, url, command }
}

/**
 * Hands the thread back to Claude Code. `epitaxy/<local_…>` *navigates* the desktop app to a
 * thread it already has, which changes nothing on disk — and that is the only link this adapter
 * will ever open.
 *
 * There is a second one, `claude://resume?session=<uuid>`, and it must never be used: it
 * *imports* the transcript, spawning a duplicate untitled session and rewriting the .jsonl
 * underneath the real one. A thread with no desktop record is resumed from a terminal instead,
 * via the `claude --resume …` command carried on `thread.resume` — unless its process is still
 * alive, in which case there is nothing to resume and the page is told so.
 *
 * The registry is re-read here rather than trusted from the page: liveness is the server's to
 * know, and the read is a handful of small files.
 */
async function openThread(ref) {
  const { desktopSessionId, cliSessionId, cwd } = ref || {}
  const url = isDesktopId(desktopSessionId) ? `claude://claude.ai/epitaxy/${desktopSessionId}` : ''
  const id = isCliId(cliSessionId) ? cliSessionId : ''
  const live = id ? (await scanLiveSessions()).has(id) : false
  // Skipped for a live session too: the walk for a binary we are not allowed to run is waste.
  const bin = !live && process.platform === 'linux' && id ? await cliBinary() : null
  return resumeOffer({ url, live, bin, cliSessionId: id, cwd })
}

/**
 * A brand new thread rooted in a repo — the same `code/new?folder=` deep link Finder's
 * "New Claude Code Session Here" quick action uses. Nothing is resumed and nothing is
 * written: the desktop app just opens an empty session with that folder as its workspace.
 */
async function newSession(dir) {
  const url = `claude://code/new?${new URLSearchParams({ folder: dir })}`
  const bin = await cliBinary()
  const command = bin ? { argv: [bin], cwd: dir } : undefined
  return { ok: true, url, command }
}

/** Pure helpers, exported for the tests in `tests/server/`. Not part of the harness contract. */
export {
  projectOf,
  computeUnread,
  decodeProjectDir,
  readTranscriptMeta,
  isAutomatedTranscript,
  scanSubagents,
  recap,
}

export default {
  id: 'claude-code',
  name: 'Claude Code',
  /** Only claim this machine if one of the two stores is actually there. */
  detect: async () => (await exists(DESKTOP_SESSIONS)) || (await exists(CLI_PROJECTS)),
  scanThreads,
  openThread,
  newSession,
  recap,
  paths: { DESKTOP_SESSIONS, CLI_PROJECTS, CLI_LIVE },
}

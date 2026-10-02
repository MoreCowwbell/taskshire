# Harness adapters

A **harness** is whatever runs the agent threads you want to see as bots — Claude Code,
Codex CLI, OpenCode, and so on. Taskshire does not care which one you use: it asks every
harness present on the machine for its threads and draws whatever comes back.

Adding one is meant to be **one new file in this directory**, plus one line in `index.mjs`.
Nothing in `server/scan.mjs`, `server/api.mjs`, or anywhere under `src/` should need to change.
If you find yourself editing those to land a harness, that is a bug in this seam — please say so
in the PR, because the next person will hit it too.

## The shape of it

```js
// server/harnesses/my-harness.mjs
export default {
  id: 'my-harness',              // stable, kebab-case, used as a key — never change it later
  name: 'My Harness',            // what a human sees in the UI
  detect,                        // () => Promise<boolean>
  scanThreads,                   // () => Promise<Thread[]>
  openThread,                    // (ref) => Promise<{ ok, url, command? }> | { ok: false, error }
  newSession,                    // (dir) => Promise<{ ok, url, command? }> | { ok: false, error }
  recap,                         // optional (ref) => Promise<{ first, last }>
  diagnostic,                    // optional () => Promise<string>
}
```

Then, in `index.mjs`:

```js
import myHarness from './my-harness.mjs'
export const HARNESSES = [claudeCode, myHarness]
```

### `detect()`

Is this harness on this machine at all? Usually just "does its data directory exist". Cheap —
it runs on every scan, so that installing a harness while the colony is open is noticed on the
next poll. Returning `false` means the harness is skipped entirely, and no bot for it
ever appears.

### `scanThreads()`

The real work: return one `Thread` per session the harness knows about.

Throwing is survivable — the scanner logs it and carries on with the other harnesses, so one
broken adapter costs you its own threads and nothing else. Prefer that over returning junk.

### `openThread(ref)` / `newSession(dir)`

Return `{ ok: true, url }` and the server hands that URL to the OS opener — `open(1)` on macOS,
`rundll32 url.dll,FileProtocolHandler` on Windows, `xdg-open` on Linux, picked in
`present()` in `server/api.mjs`. Both may be async — an adapter that has to look for a CLI on
disk cannot answer synchronously. `openThread` gets the `ref` from the thread it belongs to;
`newSession` gets an absolute directory that the server has already checked still exists — in
either path flavour, so use `isAbsoluteFolder` from `../lib/fsutil.mjs` to test it, never
`startsWith('/')`, which says no to every Windows path there is.

Add `command: { argv, cwd }` — the harness's own CLI resuming the same thread, with an absolute `argv[0]` —
when the CLI is installed, and the server runs it in a terminal for a machine with no desktop app or a person who asked for one.
Never spawn it yourself.

If your harness has no deep link, return `{ ok: false, error: '…' }` and say why — the UI
shows the message rather than pretending the click worked.

**`openThread` must never import.** Only return a URL that navigates to a session the harness
already holds. Claude Code offers `claude://resume?session=<uuid>` for a transcript the desktop
app has never seen, and it duplicates the session and rewrites the `.jsonl` underneath the
original — so the adapter refuses it and hands back an error instead. If the only way in
costs the user a copy of their own work, that is not an open: put the command on `resume` and
let them run it themselves.

### `recap(ref)` — optional

The first thing the human asked and the last thing the agent said, as
`{ first, last }`. Each one line, whitespace collapsed, capped at 140 characters —
`oneLine` in `../lib/text.mjs` does all three. Omit the method and your harness simply has no
recap: the page hides the line rather than showing an empty one.

It is called **on selection**, not from the scan, and that is the whole reason it is a separate
method: the scan runs on every poll over every transcript on the machine, and reading a tail per
thread per poll to show one thread's line is the wrong trade. Cache against mtime *and* size,
like `transcriptMeta` does.

**Find your own file.** The session id inside `ref` is all you may use. Deriving the path from a
transcript *path* carried on `ref` would work and would be faster, and it would also let any page
— or a page that reached us through a rebound hostname — name any file on the disk and read a
couple of hundred characters of it back out of the response. The Claude Code adapter stats one
candidate per project folder; the Codex one walks its own dated folders and memoises the index.

Read-only, like everything else, and survivable: a half-written transcript is two empty strings,
never a throw.

### There is no `setArchived`, and that is deliberate

Taskshire does not write to a harness. Not the transcripts, not the session records, not one
flag. Archiving is recorded in `data/colony.json` and nowhere else: the thread leaves the map and
the bot walks back to the ship.

It used to write one flag — `isArchived` on Claude Code's own session record — and that write
genuinely landed on disk. It just did not *mean* anything: the desktop app serves from the copy it
loaded at launch, so the thread stayed in its list until the app restarted, and the app rewrote the
record from memory the next time it touched the thread. Holding that together took a re-assert on
every scan, a `ps` sweep to guess whether the app had re-read the file, and a *pending* state for
the gap between them. All of that is gone, and the scan no longer starts a subprocess at all.

Archiving in the harness's own UI still works and is still the right way to do it — your adapter
reports it through the `archived` field and the bot goes home on the next poll.

## The `Thread` your adapter returns

Only `id` is truly required, but the colony gets duller the more you leave out — `project` is
what earns a repo its own zone, and `lastActivityAt` is what sorts the whole map.

| Field | Type | What it means |
| --- | --- | --- |
| `id` | string | **Always prefixed** with your harness id, e.g. `my-harness:1234`. Unique across every harness, and a bare UUID is no longer enough — the colony file is keyed on this |
| `title` | string | Thread title. `'Untitled thread'` if the harness has none |
| `preview` | string | First prompt, trimmed — shown on the thread card |
| `project` | string | Repo/folder **name**. This is what claims a hex zone |
| `projectPath` | string | Absolute path to the repo root |
| `worktree` | string | Worktree name, or `''` |
| `cwd` | string | Where the thread is actually working |
| `gitBranch` | string | Branch name, or `''` |
| `model` / `effort` | string | Shown on the thread card |
| `createdAt` | number | Epoch ms |
| `lastActivityAt` | number | Epoch ms. Sorts the colony and drives the "asleep for 3 days" behaviour |
| `lastFocusedAt` | number | Epoch ms, `0` if unknowable |
| `state` | string | `active` (open and working) / `idle` (open, wants input) / `inactive` (process gone) / `archived`. **Only `active` and `idle` get a character** |
| `unread` | boolean | Moved on since you last looked — the astronaut stops and holds a `?` |
| `hasError` | boolean | Errored — the astronaut slumps, red eyes |
| `starred` / `routine` / `prState` | | Optional extras; `prState: 'MERGED'` triggers the confetti |
| `archived` | boolean | Archived in the harness's own records. Read-only — reporting it is all an adapter does |
| `sizeBytes` | number | Transcript size. **This is how finished a building looks**, on a log scale |
| `subagents` | array | Helpers running under this thread *right now*, `{ id, name, agentType, description, model, startedAt }` each. Always present, `[]` for anything that is not `active` or `idle`. A running one is a transcript whose last message record is not an `assistant` `end_turn` and that has been appended to within the last 20 minutes — except for a named teammate, which is alive between turns and so leaves on the 20 minutes of silence alone |
| `source` | string | Free-form, for your own bookkeeping (the Claude adapter uses `desktop` / `cli`) |
| `canOpen` | boolean | Whether this thread can be opened. The UI greys the button out |
| `resume` | string | Shell command that reopens this thread in a terminal, or `''`. The UI copies it when it cannot open the thread any other way. Text only — it is never executed from the scan, and only Linux's terminal fallback ever runs an adapter's `command` |
| `sessionId` | string | The id a person types to resume this thread (what `resume` embeds), or `''`. The UI shows and copies it, so unlike `ref` it is not opaque |
| `ref` | object | **Opaque.** Whatever *you* need to find this thread again |

`canOpen` means **an app can jump straight to this thread without changing anything**. In the
Claude Code adapter that is a desktop record and nothing else; a terminal-only thread reports
`canOpen: false` and offers `resume` instead. Do not widen it to "we could get there somehow" —
see the `openThread` rule below.

### How each harness fills `state`

`running` is what a harness's transcript says; `state` is what the colony draws, and a thread
without one never gets a character. Only a harness that can see a session is still open may call
it `idle` — the rest cannot tell a terminal waiting at its prompt from a closed one, and a figure
must not stand on a plot for a terminal that is gone. Anything on the colony's own archive list
becomes `archived` in `reconcileArchived` (`server/api.mjs`), whatever the adapter said.

- **claude-code** — `threadState()` over `~/.claude/sessions`: a live session record is `active`,
  or `idle` when its status says it is waiting, no record is `inactive`, and archived is `archived`.
- **codex** — mid-turn (`task_started` within 30 minutes) is `active`, archived in Codex is
  `archived`, everything else `inactive`: there is no session registry to ask.
- **cursor** — mid-turn is `active`, everything else `inactive`, for the same reason as Codex.
- **opencode** — an open last turn updated within 30 minutes is `active`, `time_archived` is
  `archived`, everything else `inactive`: the database does not record whether the app is open.
- **antigravity** — an open last turn in a transcript written within 30 minutes is `active`,
  everything else `inactive`; it has no archive flag and no record of an open CLI.
- **hermes** — the one other harness that records a session ending: `ended_at` still null and
  activity within 30 minutes is `active` when the user or a tool spoke last and `idle` when the
  agent did; ended, or open but quiet past the window (a killed process never stamps `ended_at`),
  is `inactive`; `archived = 1` is `archived`.
- **kilocode** — as OpenCode, whose server it is built on.

### About `ref`

`ref` is the whole reason the browser does not know what a session id looks like. Your adapter
puts whatever it needs in there, the page hands it straight back when it opens a thread, and
nothing between the two ever inspects it.

Keep it small and keep it serialisable — it makes a round trip through JSON on every action.
Do not put a file handle, a class instance, or a secret in it.

## Ground rules

- **Read-only. No exceptions.** `data/colony.json` is the only file Taskshire writes,
  anywhere. A harness's transcripts and records are somebody's actual work; the colony is a
  viewer, not an editor. If an adapter seems to need a write, it does not — say so in an issue.
- **Never run anything out of another application's bundle.** Not to read from it, not to
  execute it. Only files under the user's own home directory. Opening a thread goes through a
  URL the OS resolves, or a command the user already has on `PATH`.
- **Never block the scan.** It runs on a poll. Cache anything expensive against file mtime —
  see `transcriptMeta` in `claude-code.mjs`, which is what keeps a 12MB transcript from being
  reparsed every few seconds.
- **Read heads, not whole files.** `readHead` in `../lib/fsutil.mjs` pulls the first chunk and
  drops a trailing partial line, so `JSON.parse` never sees half a record.
- **Expect malformed data.** A session being written *right now* is a normal thing to trip
  over. Skip that record and move on; do not throw the pass away.
- **Never widen `id` collisions.** The colony keys its archive list and saved layout on `id`.
  Two harnesses handing back the same id would merge two unrelated threads into one bot.

## Starting points

Verified on a real machine:

- **Claude Code** — desktop records in
  `~/Library/Application Support/Claude/claude-code-sessions/<account>/<org>/local_*.json` on
  macOS, `%APPDATA%\Claude\claude-code-sessions\…` on Windows and
  `$XDG_CONFIG_HOME/Claude/claude-code-sessions/…` on Linux, same nesting and same keys
  whichever it is; CLI transcripts in `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`;
  live processes in `~/.claude/sessions/*.json`. On macOS a current install writes to
  `Claude-3p` rather than `Claude`, and whichever of the two holds session records is used. In
  the same folder as the records the app leaves a `deleted_<cliSessionId>` marker for every
  thread deleted in it, holding the deletion time in epoch ms — the record goes, the CLI
  transcript stays, and the marker is all that tells a deleted thread from one started in a
  terminal, so the adapter reports it as `archived`. `CLAUDE_CONFIG_DIR` (the CLI's own override
  for `~/.claude`) and `BOT_CROSSING_CLAUDE_DESKTOP` (the session store) point both roots
  elsewhere, which is how `test/harness.test.mjs` fakes an install. Implemented in
  `claude-code.mjs`.

  Two things differ per platform and are worth knowing before you copy this adapter. The
  Windows records carry no `lastFocusedAt`, so "unread" is unknowable there rather than true.
  And the `<encoded-cwd>` folder name is lossy on Windows — `C:\Users\x\a_b` becomes
  `C--Users-x-a-b`, with the drive colon and both separators folded into the same `-` — so
  decoding it means guessing: `decodeProjectDir` tries the readings against the disk and keeps
  the first that exists. It is a last resort either way; the `cwd` recorded inside the
  transcript, or in a sibling transcript of the same folder, is the one that can be trusted.
- **Codex CLI** — transcripts in `~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl`,
  with records shaped `{ timestamp, type, payload }`, and one row per thread in
  `~/.codex/state_<n>.sqlite`. Implemented in `codex.mjs`, which reads the database through
  `node:sqlite` and falls back to the transcripts alone when it cannot.
  Its `ref` carries `{ sessionId, cwd }`: the folder is what an editor window is matched
  against, so an adapter that leaves it out loses the "raise the window" half of Resume.

For anything else, the fastest way in is usually to start a throwaway session in that harness
and watch which files change:

```bash
find ~ -maxdepth 4 -newermt '-2 minutes' -type f 2>/dev/null | grep -iv Library/Caches
```

## Checking your work

`npm test` covers the pure decisions the Claude Code adapter makes — which repo a thread belongs
to, and whether it counts as unread — on both platform layouts. Everything below is what the
adapter was verified against by hand, and what a new one should clear too:

1. `node --check server/harnesses/my-harness.mjs`
2. With the app running, `GET /api/harnesses` lists every registered harness and whether
   `detect()` found it. If yours is missing or `detected: false`, stop here — nothing else
   will work until it shows up:

   ```bash
   curl -s localhost:5274/api/harnesses
   ```
3. Scan straight from node and look at the result — the number should match what the harness
   itself reports, and no field should be `undefined`:

   ```bash
   node -e 'import("./server/scan.mjs").then(async m => {
     const t = (await m.scanThreads()).filter(x => x.harness === "my-harness")
     console.log(t.length, "threads"); console.dir(t[0], { depth: 4 })
   })'
   ```
4. `npm run dev`, then confirm the bots appear on the right plots, the thread card fills
   in, and Open does what you expect.
5. Archive one thread here and confirm the harness's own files are untouched — archiving is the
   colony's own bookkeeping and must never write to your harness.

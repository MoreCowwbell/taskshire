/**
 * The two pieces of the Claude Code adapter that are pure decisions rather than disk reads:
 * which repo a thread belongs to, and whether it counts as unread. Both had a macOS-shaped
 * assumption baked in, so both are checked against records from either platform.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  SUBAGENT_QUIET_MS,
  scanSubagents,
  computeUnread,
  decodeProjectDir,
  isAutomatedTranscript,
  lastAgentText,
  projectOf,
  readTranscriptMeta,
  recap,
  resumeOffer,
  subagentRunning,
  threadState,
  toThread,
} from '../../server/harnesses/claude-code.mjs'

test('worktree split: a Windows record names the worktree through originCwd', () => {
  const cwd = 'C:\\Users\\dev\\.claude-worktrees\\bot-crossing\\fix-windows-port'
  const originCwd = 'C:\\Users\\dev\\code\\bot-crossing'
  const got = projectOf(cwd, originCwd)

  assert.equal(got.projectPath, originCwd, 'the repo, not the checkout, is the project')
  assert.equal(got.project, 'bot-crossing')
  assert.equal(got.worktree, 'fix-windows-port')
  assert.ok(!got.projectPath.includes('/'), 'native separators survive the round trip')
})

test('worktree split: the macOS path marker still works as the fallback', () => {
  const got = projectOf('/Users/dev/code/bot-crossing/.claude/worktrees/feature-abc', '')

  assert.equal(got.project, 'bot-crossing')
  assert.equal(got.worktree, 'feature-abc')
  assert.equal(got.projectPath, path.join('/Users/dev/code/bot-crossing'))
})

test('worktree split: originCwd equal to cwd is not a worktree', () => {
  const dir = process.platform === 'win32' ? 'C:\\Users\\dev\\code\\bot-crossing' : '/Users/dev/code/bot-crossing'
  const got = projectOf(dir, dir)

  assert.equal(got.worktree, '')
  assert.equal(got.projectPath, dir)
  assert.equal(got.project, 'bot-crossing')
})

test('worktree split: a plain checkout keeps its own path', () => {
  const got = projectOf('C:\\Users\\dev\\code\\bot-crossing', '')

  assert.equal(got.projectPath, 'C:\\Users\\dev\\code\\bot-crossing')
  assert.equal(got.project, 'bot-crossing')
  assert.equal(got.worktree, '')
})

test('unread: a desktop thread that moved on since you last looked', () => {
  assert.equal(computeUnread({ desktopSessionIds: ['local_1'], lastActivityAt: 200, lastFocusedAt: 100 }), true)
  assert.equal(computeUnread({ desktopSessionIds: ['local_1'], lastActivityAt: 100, lastFocusedAt: 200 }), false)
})

test('unread: no focus history means unknowable, not unread', () => {
  // Every record the Windows desktop app writes is this shape — no `lastFocusedAt` at all.
  const windowsRecord = { desktopSessionIds: ['local_1'], lastActivityAt: 200, lastFocusedAt: undefined }
  assert.equal(computeUnread(windowsRecord), false)
  assert.equal(computeUnread({ desktopSessionIds: ['local_1'], lastActivityAt: 200, lastFocusedAt: 0 }), false)
})

test('unread: a terminal-only thread is never unread', () => {
  assert.equal(computeUnread({ desktopSessionIds: [], lastActivityAt: 200, lastFocusedAt: 100 }), false)
})

/**
 * A transcript's project folder is its cwd with every non-alphanumeric character turned into
 * `-`. Separators, hyphens and underscores (and on Windows the drive colon) all become the
 * same `-`, so the only honest way back is to try readings against the disk. `existsSync` is
 * injected so the tests never touch a real filesystem.
 */
test('decodeProjectDir: the POSIX form probes the disk, and falls back to the blind reverse', () => {
  const disk = new Set(['/Users', '/Users/dev', '/Users/dev/code', '/Users/dev/code/bot-crossing'])
  assert.equal(decodeProjectDir('-Users-dev-code-bot-crossing', (p) => disk.has(p)), '/Users/dev/code/bot-crossing')
  assert.equal(decodeProjectDir('-Users-dev-code-bot-crossing', () => false), '/Users/dev/code/bot/crossing')
})

test('decodeProjectDir: a Windows form is resolved by probing, hyphens and underscores included', () => {
  const disk = new Set([
    'C:\\Users',
    'C:\\Users\\dev',
    'C:\\Users\\dev\\Garden_Planner',
    'C:\\Users\\dev\\bot-crossing',
    'C:\\Users\\dev\\bot-crossing\\a-b_c',
  ])
  const existsSync = (p) => disk.has(p)
  assert.equal(decodeProjectDir('C--Users-dev-Garden-Planner', existsSync), 'C:\\Users\\dev\\Garden_Planner')
  assert.equal(decodeProjectDir('C--Users-dev-bot-crossing', existsSync), 'C:\\Users\\dev\\bot-crossing')
  assert.equal(decodeProjectDir('C--Users-dev-bot-crossing-a-b-c', existsSync), 'C:\\Users\\dev\\bot-crossing\\a-b_c')
  // The drive letter is folded to upper case, the one part of the path that is safe to touch.
  assert.equal(decodeProjectDir('c--Users-dev-bot-crossing', existsSync), 'C:\\Users\\dev\\bot-crossing')
})

test('decodeProjectDir: a Windows form nothing on disk matches is left alone', () => {
  assert.equal(decodeProjectDir('C--Users-gone-repo', () => false), 'C--Users-gone-repo')
  assert.equal(decodeProjectDir('plain', () => true), 'plain')
})

/**
 * A `bridge-session` file is one line of bookkeeping the CLI writes for a remote session:
 * no cwd, no message, no timestamp. It is not a thread, and used to claim a plot under the
 * encoded folder name because it had nothing better to offer.
 */
test('readTranscriptMeta: a bridge-session stub is flagged, a real transcript is not', () => {
  const stub = readTranscriptMeta([{ type: 'bridge-session', sessionId: 'x', bridgeSessionId: 'cse_1' }])
  assert.equal(stub.stub, true)
  const real = readTranscriptMeta([
    { type: 'bridge-session', sessionId: 'x' },
    { type: 'user', timestamp: '2026-09-01T00:00:00Z', cwd: 'C:\\repo', message: { content: 'hi' } },
  ])
  assert.equal(real.stub, false)
  assert.equal(real.cwd, 'C:\\repo')
  // A queued prompt with no cwd yet is still a thread: the cwd line is simply further down.
  const queued = readTranscriptMeta([{ type: 'queue-operation', timestamp: '2026-09-01T00:00:00Z', content: 'x' }])
  assert.equal(queued.stub, false)
})

/**
 * The state table. A live process is the whole of "open"; the registry's own status says
 * whether that session is working or waiting; archived overrides both.
 */
test('threadState: registry status → state, archived wins', () => {
  assert.equal(threadState({ live: true, status: 'busy' }), 'active')
  assert.equal(threadState({ live: true, status: 'shell' }), 'active')
  assert.equal(threadState({ live: true, status: undefined }), 'active')
  assert.equal(threadState({ live: true, status: 'idle' }), 'idle')
  assert.equal(threadState({ live: false, status: 'busy' }), 'inactive')
  assert.equal(threadState({ live: false }), 'inactive')
  assert.equal(threadState({ live: true, status: 'busy', archived: true }), 'archived')
})

test('readTranscriptMeta captures entrypoint and sidechain', () => {
  const m = readTranscriptMeta([
    { type: 'user', entrypoint: 'sdk-py', isSidechain: false, timestamp: '2026-09-01T00:00:00Z', message: { content: 'x' } },
  ])
  assert.equal(m.entrypoint, 'sdk-py')
  assert.equal(m.sidechain, false)
  const s = readTranscriptMeta([{ type: 'user', isSidechain: true, timestamp: '2026-09-01T00:00:00Z', message: { content: 'x' } }])
  assert.equal(s.sidechain, true)
})

/**
 * Only what the filter recognises as a program is dropped. A transcript with no entrypoint
 * at all is older data, not machine exhaust, and stays a thread.
 */
/**
 * A subagent's own transcript tail is the only record of whether it is still going: nothing
 * in the session registry or the parent transcript says when one ends.
 */
const NOW = Date.UTC(2026, 8, 11, 12, 0, 0)
const fresh = { mtime: NOW - 30_000, now: NOW }
const assistant = (stop) => ({ type: 'assistant', message: { role: 'assistant', stop_reason: stop } })
const user = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result' }] } })

test('subagentRunning: a closing end_turn is the end of it', () => {
  assert.equal(subagentRunning([user(), assistant('end_turn')], fresh), false)
})

test('subagentRunning: mid tool-use, a trailing tool result, and a bare start are all running', () => {
  assert.equal(subagentRunning([user(), assistant(null)], fresh), true)
  assert.equal(subagentRunning([assistant(null), user()], fresh), true)
  assert.equal(subagentRunning([], fresh), true)
  // Records with no message of their own — attachments, bookkeeping — say nothing either way.
  assert.equal(subagentRunning([{ type: 'attachment' }], fresh), true)
})

test('subagentRunning: a subagent sent a new message is running again', () => {
  assert.equal(subagentRunning([assistant('end_turn'), user()], fresh), true)
})

test('subagentRunning: nothing appended for the quiet window counts as finished', () => {
  const quiet = { mtime: NOW - SUBAGENT_QUIET_MS - 1, now: NOW }
  assert.equal(subagentRunning([user(), assistant(null)], quiet), false)
  assert.equal(subagentRunning([], quiet), false)
  // Right on the line is still running: the cutoff is the point it has been silent *past*.
  assert.equal(subagentRunning([user()], { mtime: NOW - SUBAGENT_QUIET_MS, now: NOW }), true)
})

/**
 * `scanSubagents` over a real folder: the layout is
 * `<projectDir>/<sessionId>/subagents/agent-<id>.{jsonl,meta.json}`, and a subagent is listed
 * only while its own transcript says it is still going.
 */
async function withSubagents(files, fn) {
  const projectDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'botcrossing-subagents-'))
  const entry = { id: 'session-1', projectDir }
  const dir = path.join(projectDir, entry.id, 'subagents')
  await fsp.mkdir(dir, { recursive: true })
  for (const [name, contents] of Object.entries(files)) await fsp.writeFile(path.join(dir, name), contents)
  try {
    return await fn(entry, dir)
  } finally {
    await fsp.rm(projectDir, { recursive: true, force: true })
  }
}

const line = (record) => JSON.stringify(record) + '\n'
const REPORT = line({ type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn' } })
const TOOL_RESULT = line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result' }] } })

test('scanSubagents: a finished subagent is not listed, and is listed again when it is sent more work', async () => {
  await withSubagents(
    {
      'agent-x.meta.json': JSON.stringify({ name: 'helper-x', agentType: 'coder', description: 'do a thing', model: 'm' }),
      'agent-x.jsonl': TOOL_RESULT + REPORT,
    },
    async (entry, dir) => {
      assert.deepEqual(await scanSubagents(entry), [], 'an end_turn report is the end of it')

      // Picked back up: a fresh user record after the report, and it is running again. The
      // append may well land in the same timestamp tick as the read above, so this is also
      // what pins the cache on size rather than mtime alone.
      await fsp.appendFile(path.join(dir, 'agent-x.jsonl'), TOOL_RESULT)
      const again = await scanSubagents(entry)
      assert.equal(again.length, 1)
      assert.equal(again[0].id, 'agent-x')
      assert.equal(again[0].name, 'helper-x')
      assert.equal(again[0].agentType, 'coder')
      assert.equal(again[0].description, 'do a thing')
      assert.equal(again[0].model, 'm')
      assert.ok(again[0].startedAt > 0)
    }
  )
})

test('scanSubagents: a teammate that has reported is still standing there', async () => {
  // Same transcript as the test above, ending on its closing report. What makes the two
  // differ is the one field in the meta: a `Task` subagent's report is the end of it, and a
  // teammate's is the end of a turn — the orchestrator can send it more work by name.
  await withSubagents(
    {
      'agent-mate.meta.json': JSON.stringify({ name: 'slice1', taskKind: 'in_process_teammate', agentType: 'coder' }),
      'agent-mate.jsonl': TOOL_RESULT + REPORT,
      'agent-oneshot.meta.json': JSON.stringify({ name: 'researcher', toolUseId: 'toolu_1' }),
      'agent-oneshot.jsonl': TOOL_RESULT + REPORT,
    },
    async (entry) => {
      const listed = await scanSubagents(entry)
      assert.deepEqual(
        listed.map((s) => s.name),
        ['slice1'],
        'the teammate stays, the one-shot subagent leaves on its report'
      )
    }
  )
})

test('scanSubagents: a teammate leaves on silence like everybody else', async () => {
  await withSubagents(
    {
      'agent-mate.meta.json': JSON.stringify({ name: 'slice1', taskKind: 'in_process_teammate' }),
      'agent-mate.jsonl': TOOL_RESULT + REPORT,
    },
    async (entry) => {
      assert.equal((await scanSubagents(entry)).length, 1)
      // Nothing appended for the quiet window: the team may still list it, but a teammate
      // nobody has spoken to for twenty minutes is not somebody to draw on the plot.
      assert.deepEqual(await scanSubagents(entry, Date.now() + SUBAGENT_QUIET_MS + 1000), [])
    }
  )
})

test('scanSubagents: the name falls back to the agent type, then to the id', async () => {
  await withSubagents(
    {
      'agent-named.meta.json': JSON.stringify({ name: 'a name', agentType: 'coder' }),
      'agent-named.jsonl': TOOL_RESULT,
      'agent-typed.meta.json': JSON.stringify({ agentType: 'reviewer' }),
      'agent-typed.jsonl': TOOL_RESULT,
      'agent-bare.meta.json': JSON.stringify({}),
      'agent-bare.jsonl': TOOL_RESULT,
    },
    async (entry) => {
      const byId = new Map((await scanSubagents(entry)).map((s) => [s.id, s]))
      assert.equal(byId.size, 3)
      assert.equal(byId.get('agent-named').name, 'a name')
      assert.equal(byId.get('agent-typed').name, 'reviewer')
      assert.equal(byId.get('agent-bare').name, 'agent-bare')
      // A meta that says nothing leaves the rest of the fields empty rather than undefined.
      assert.equal(byId.get('agent-bare').agentType, '')
      assert.equal(byId.get('agent-bare').model, '')
    }
  )
})

test('scanSubagents: a closing report longer than the tail window is still read as finished', async () => {
  // The window is 64 kB. A final record bigger than that fills it end to end, so the first
  // read drops the partial line it opens on and comes back with nothing at all — which,
  // unwidened, reads as a subagent that has only just started.
  const huge = line({ type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn', pad: 'x'.repeat(100_000) } })
  await withSubagents(
    { 'agent-verbose.meta.json': JSON.stringify({ name: 'verbose' }), 'agent-verbose.jsonl': TOOL_RESULT + huge },
    async (entry) => assert.deepEqual(await scanSubagents(entry), [])
  )
})

test('scanSubagents: a transcript nothing has touched for the quiet window is gone', async () => {
  await withSubagents(
    { 'agent-killed.meta.json': JSON.stringify({ name: 'killed' }), 'agent-killed.jsonl': TOOL_RESULT },
    async (entry) => {
      assert.equal((await scanSubagents(entry)).length, 1)
      // A killed subagent never writes its report; silence is all that is left to read it by.
      assert.deepEqual(await scanSubagents(entry, Date.now() + SUBAGENT_QUIET_MS + 1000), [])
    }
  )
})

test('scanSubagents: a meta with no transcript beside it is not a subagent', async () => {
  await withSubagents({ 'agent-ghost.meta.json': JSON.stringify({ name: 'ghost' }) }, async (entry) =>
    assert.deepEqual(await scanSubagents(entry), [])
  )
})

test('isAutomatedTranscript: only cli / claude-vscode / unknown survive', () => {
  assert.equal(isAutomatedTranscript({ entrypoint: 'cli' }), false)
  assert.equal(isAutomatedTranscript({ entrypoint: 'claude-vscode' }), false)
  assert.equal(isAutomatedTranscript({ entrypoint: '' }), false)
  assert.equal(isAutomatedTranscript({}), false)
  assert.equal(isAutomatedTranscript({ entrypoint: 'sdk-py' }), true)
  assert.equal(isAutomatedTranscript({ entrypoint: 'sdk-ts' }), true)
  assert.equal(isAutomatedTranscript({ entrypoint: 'cli', sidechain: true }), true)
})

test('toThread hands the session id to the browser, or nothing at all', () => {
  const base = {
    id: 'cc-1',
    project: 'bot-crossing',
    desktopSessionIds: [],
    lastActivityAt: 1,
    lastFocusedAt: 0,
    cwd: '/code/bot-crossing',
  }
  const cli = toThread({ ...base, cliSessionId: '9f1c7a10-3b6e-4b2f-8c1d-0a2b3c4d5e6f', desktopSessionId: '' })

  assert.equal(cli.sessionId, '9f1c7a10-3b6e-4b2f-8c1d-0a2b3c4d5e6f', 'the id itself, not the command')
  assert.equal(cli.resume, 'claude --resume 9f1c7a10-3b6e-4b2f-8c1d-0a2b3c4d5e6f')
  assert.equal(cli.canOpen, false)

  // A desktop record opens; there is no terminal command and so nothing to copy either.
  const desktop = toThread({ ...base, cliSessionId: '', desktopSessionId: 'local_abc123' })
  assert.equal(desktop.sessionId, '', 'no id rather than a half-truth')
  assert.equal(desktop.resume, '')

  // Junk that merely looks like an id is refused by the same guard as `resume`.
  assert.equal(toThread({ ...base, cliSessionId: 'not-a-uuid', desktopSessionId: '' }).sessionId, '')
  // `ref` stays opaque, and keeps carrying what the adapter itself needs.
  assert.equal(cli.ref.cliSessionId, '9f1c7a10-3b6e-4b2f-8c1d-0a2b3c4d5e6f')
})

const CLI_ID = '2df3987c-02d3-405e-b8f5-da30e3835213'

test('resumeOffer: a live session is never handed a terminal command', () => {
  const got = resumeOffer({
    url: '',
    live: true,
    bin: '/usr/local/bin/claude',
    cliSessionId: CLI_ID,
    cwd: '/repos/alpha',
    platform: 'linux',
  })

  assert.equal(got.ok, false, 'two CLIs appending to one transcript is the damage claude://resume does')
  assert.equal(got.live, true, 'the page needs this to write the right toast')
  assert.match(got.error, /already running/i)
})

test('resumeOffer: a live session with a desktop record still opens the app', () => {
  const got = resumeOffer({
    url: 'claude://claude.ai/epitaxy/local_x',
    live: true,
    bin: '/usr/local/bin/claude',
    cliSessionId: CLI_ID,
    cwd: '/repos/alpha',
    platform: 'linux',
  })

  assert.equal(got.ok, true, 'navigating the app to a thread it already has changes nothing')
  assert.equal(got.command, undefined, 'and it still gets no second resume')
})

test('resumeOffer: a dead session on Linux gets the command, elsewhere it gets the error', () => {
  const args = { url: '', live: false, bin: '/usr/local/bin/claude', cliSessionId: CLI_ID, cwd: '/repos/alpha' }

  const linux = resumeOffer({ ...args, platform: 'linux' })
  assert.equal(linux.ok, true)
  assert.deepEqual(
    linux.command,
    { argv: ['/usr/local/bin/claude', '--resume', CLI_ID], cwd: '/repos/alpha', safe: true },
    'marked safe: liveness was checked, so present() may run it unasked'
  )

  const mac = resumeOffer({ ...args, platform: 'darwin' })
  assert.equal(mac.ok, false, 'macOS and Windows always have the deep link, so there is nothing to run')
  assert.match(mac.error, /No desktop record/)
  assert.equal(mac.live, undefined)
})

test('resumeOffer: no binary on PATH is the same as nothing to run', () => {
  const got = resumeOffer({ url: '', live: false, bin: null, cliSessionId: CLI_ID, cwd: '/x', platform: 'linux' })
  assert.equal(got.ok, false)
})

test('lastAgentText: the line worth reading is the last text block the agent wrote', () => {
  const records = [
    { type: 'user', message: { role: 'user', content: 'do the thing' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'starting' }] } },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'not speech' },
          { type: 'text', text: 'Both halves are in.' },
          { type: 'tool_use', name: 'Bash', input: {} },
        ],
      },
    },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
  ]

  assert.equal(lastAgentText(records), 'Both halves are in.')
})

test('lastAgentText: a string message, and a transcript with nothing said at all', () => {
  assert.equal(lastAgentText([{ type: 'assistant', message: { role: 'assistant', content: 'plain' } }]), 'plain')
  assert.equal(lastAgentText([]), '')
  assert.equal(
    lastAgentText([{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use' }] } }]),
    '',
    'a turn that only called a tool said nothing'
  )
})

// ── the recap, over a transcript store of our own ─────────────────────────────

const SESSION = 'aa11bb22-cc33-dd44-ee55-ff6677889900'
const rec = (o) => JSON.stringify(o) + '\n'

async function withStore(body, fn) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'botcrossing-recap-'))
  const projectDir = path.join(root, '-repos-alpha')
  await fsp.mkdir(projectDir, { recursive: true })
  await fsp.writeFile(path.join(projectDir, `${SESSION}.jsonl`), body)
  try {
    return await fn(root)
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
}

test('recap: the first request without its wrapper, and the last thing the agent said', async () => {
  const body =
    rec({
      type: 'user',
      cwd: '/repos/alpha',
      entrypoint: 'cli',
      timestamp: '2026-09-16T10:00:00Z',
      message: { role: 'user', content: '<system-reminder>ignore me</system-reminder> Write spec 4' },
    }) +
    rec({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Spec written.' }] } })

  await withStore(body, async (root) => {
    const got = await recap({ cliSessionId: SESSION }, root)
    assert.equal(got.first, 'Write spec 4', 'the prose, not the injected tag')
    assert.equal(got.last, 'Spec written.')
  })
})

test('recap: both lines are one line, capped at 140 characters', async () => {
  const long = 'x'.repeat(400)
  const body =
    rec({ type: 'user', timestamp: '2026-09-16T10:00:00Z', message: { role: 'user', content: `ask\n\n  ${long}` } }) +
    rec({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `said\n${long}` }] } })

  await withStore(body, async (root) => {
    const got = await recap({ cliSessionId: SESSION }, root)
    assert.equal(got.first.length, 140)
    assert.equal(got.last.length, 140)
    assert.ok(got.first.endsWith('…'), 'the cap says it bit')
    assert.ok(!got.first.includes('\n'), 'one line')
    assert.ok(got.last.startsWith('said x'), 'whitespace collapsed, not stripped')
  })
})

test('recap: a closing message longer than the tail window is still found', async () => {
  // The window opens mid-record, `readTail` drops the partial line it lands in, and a 64 kB
  // window over a 300 kB final message would otherwise hold no whole record at all.
  const filler = rec({ type: 'user', message: { role: 'user', content: 'x'.repeat(200 * 1024) } })
  const body =
    rec({ type: 'user', timestamp: '2026-09-16T10:00:00Z', message: { role: 'user', content: 'the ask' } }) +
    filler +
    rec({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'the last word' }] } })

  await withStore(body, async (root) => {
    const got = await recap({ cliSessionId: SESSION }, root)
    assert.equal(got.last, 'the last word')
  })
})

test('recap: nothing to read is two empty strings, never a throw', async () => {
  await withStore(rec({ type: 'user', message: { role: 'user', content: 'only me' } }), async (root) => {
    assert.deepEqual(await recap({ cliSessionId: 'not-a-uuid' }, root), { first: '', last: '' })
    assert.deepEqual(await recap({}, root), { first: '', last: '' })
    assert.deepEqual(await recap({ cliSessionId: '11111111-2222-3333-4444-555555555555' }, root), {
      first: '',
      last: '',
    })
    const got = await recap({ cliSessionId: SESSION }, root)
    assert.equal(got.last, '', 'a thread the agent has not answered yet has no last line')
  })
})

/**
 * The editor-window reader. Everything here is either pure or runs over a temp directory of
 * lock files, because the real ones live in `~/.claude/ide` and belong to whoever is running
 * the tests.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  fileUrl,
  matchWindow,
  parseJsonc,
  readLocks,
  readWorkspaces,
  workspaceForFolder,
  workspaceOfWindow,
} from '../../server/ide.mjs'

const WIN = process.platform === 'win32'
/** A path in this platform's flavour, so `canonicalPath` is exercised the way it ships. */
const P = (...segs) => (WIN ? path.win32.join('C:\\repos', ...segs) : path.posix.join('/repos', ...segs))

async function withLocks(files) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'botcrossing-ide-'))
  for (const [name, body] of Object.entries(files)) {
    await fsp.writeFile(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body))
  }
  return dir
}

const lock = (folders, extra = {}) => ({
  pid: process.pid,
  workspaceFolders: folders,
  ideName: 'Visual Studio Code',
  transport: 'ws',
  runningInWindows: WIN,
  authToken: 'shhh-this-must-never-leave-the-server',
  ...extra,
})

test('a lock is read for its folders, and never for its token', async () => {
  const dir = await withLocks({ '5001.lock': lock([P('alpha')]) })
  const [win] = await readLocks(dir)

  assert.equal(win.port, 5001)
  assert.equal(win.ideName, 'Visual Studio Code')
  assert.equal(win.scheme, 'vscode')
  assert.deepEqual(win.folders, [P('alpha')])
  assert.ok(!('authToken' in win), 'the websocket credential never leaves the reader')
  assert.equal(JSON.stringify(win).includes('shhh'), false)
  await fsp.rm(dir, { recursive: true, force: true })
})

test('workspaceFolders as a plain string reads the same as a one-element array', async () => {
  const dir = await withLocks({
    '5002.lock': lock(P('alpha')),
    '5003.lock': lock([P('alpha')]),
  })
  const wins = await readLocks(dir)

  assert.equal(wins.length, 2)
  assert.deepEqual([...new Set(wins.map((w) => w.folders.join('|')))], [P('alpha')])
  await fsp.rm(dir, { recursive: true, force: true })
})

test('a lock that cannot be trusted is skipped, and the rest of the pass survives', async () => {
  const dir = await withLocks({
    '5010.lock': '{"pid": 1, "ide', // half-written
    '5011.lock': 'not json at all',
    '5012.lock': lock([P('alpha')], { pid: undefined }), // nothing to probe
    '5013.lock': lock([P('alpha')], { ideName: 'Emacs' }), // no scheme we know
    '5014.lock': lock([P('alpha')], { pid: 2 ** 30 }), // a pid nothing owns
    '5015.lock': lock([]), // a window on no folder
    '5016.lock': lock([P('good')]),
  })
  const wins = await readLocks(dir)

  assert.deepEqual(
    wins.map((w) => w.port),
    [5016]
  )
  await fsp.rm(dir, { recursive: true, force: true })
})

test('a missing lock directory is no windows rather than a throw', async () => {
  assert.deepEqual(await readLocks(path.join(os.tmpdir(), 'botcrossing-ide-nope')), [])
})

test('the forks get their own scheme', async () => {
  const dir = await withLocks({
    '5020.lock': lock([P('alpha')], { ideName: 'Cursor' }),
    '5021.lock': lock([P('beta')], { ideName: 'Windsurf' }),
  })
  const wins = await readLocks(dir)

  assert.deepEqual(
    wins.map((w) => w.scheme).sort(),
    ['cursor', 'windsurf']
  )
  await fsp.rm(dir, { recursive: true, force: true })
})

test('a thread matches the window holding its folder, and nothing else', () => {
  const wins = [
    { port: 1, folders: [P('alpha')], mtime: 100, scheme: 'vscode' },
    { port: 2, folders: [P('beta')], mtime: 200, scheme: 'vscode' },
  ]

  assert.equal(matchWindow(wins, P('alpha'))?.port, 1, 'the folder itself')
  assert.equal(matchWindow(wins, P('alpha', 'src', 'ui'))?.port, 1, 'a folder inside it')
  assert.equal(matchWindow(wins, P('alphabet')), null, 'a sibling whose name merely starts the same')
  assert.equal(matchWindow(wins, P()), null, 'a parent that merely contains it')
  assert.equal(matchWindow(wins, ''), null)
})

test('the most specific window wins, then the freshest, then the lowest port', () => {
  const worktree = P('alpha', '.claude', 'worktrees', 'fix')
  const wins = [
    { port: 9, folders: [P('alpha')], mtime: 900, scheme: 'vscode' },
    { port: 4, folders: [P('alpha'), worktree], mtime: 100, scheme: 'vscode' },
  ]
  assert.equal(matchWindow(wins, worktree)?.port, 4, 'the worktree beats the repo that contains it')

  const tied = [
    { port: 7, folders: [P('alpha')], mtime: 100, scheme: 'vscode' },
    { port: 3, folders: [P('alpha')], mtime: 500, scheme: 'vscode' },
  ]
  assert.equal(matchWindow(tied, P('alpha'))?.port, 3, 'the most recently touched window')

  const dead = [
    { port: 7, folders: [P('alpha')], mtime: 500, scheme: 'vscode' },
    { port: 3, folders: [P('alpha')], mtime: 500, scheme: 'vscode' },
  ]
  assert.equal(matchWindow(dead, P('alpha'))?.port, 3, 'stable between polls')
})

test('a Windows lock and a Windows cwd match through the drive letter case', { skip: !WIN }, () => {
  const wins = [{ port: 1, folders: ['c:\\Users\\dev\\repo'], mtime: 1, scheme: 'vscode' }]
  assert.equal(matchWindow(wins, 'C:\\Users\\dev\\repo\\src')?.port, 1)
})

test('the file URL keeps the drive colon and encodes the rest', () => {
  assert.equal(fileUrl('vscode', 'C:\\Users\\dev\\My Repo'), 'vscode://file/C:/Users/dev/My%20Repo')
  assert.equal(fileUrl('vscode', '/Users/dev/My Repo'), 'vscode://file/Users/dev/My%20Repo')
  assert.equal(fileUrl('cursor', '/Users/dev/a#b'), 'cursor://file/Users/dev/a%23b')
})

test('a window that lists the folder first beats one that borrows it', () => {
  const wins = [
    { port: 1, folders: [P('farm'), P('skills')], mtime: 900, scheme: 'vscode' },
    { port: 2, folders: [P('skills')], mtime: 100, scheme: 'vscode' },
  ]
  assert.equal(matchWindow(wins, P('skills'))?.port, 2)
})

test('a workspace file is read with its comments and trailing commas', () => {
  const parsed = parseJsonc('{ // why\n "folders": [ { "path": "a//b,}" }, ], /* x */ "settings": { "k": 1, }, }')
  assert.deepEqual(parsed, { folders: [{ path: 'a//b,}' }], settings: { k: 1 } })
  // A real comma, followed by a comment that merely contains a closing bracket.
  assert.deepEqual(parseJsonc('{ "a": 1, // note }\n "b": [2, // see [x]\n 3] }'), { a: 1, b: [2, 3] })
})

test('remembered workspaces resolve their folders against the workspace file', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'botcrossing-ws-'))
  const file = path.join(root, 'spaces', 'alpha.code-workspace')
  await fsp.mkdir(path.join(root, 'spaces'))
  await fsp.writeFile(file, `{ "folders": [ { "path": ${JSON.stringify(P('alpha'))} }, { "path": "../data" }, ], }`)
  const untitled = path.join(root, 'spaces', 'workspace.json')
  await fsp.writeFile(untitled, `{ "folders": [ { "path": ${JSON.stringify(P('alpha'))} }, { "path": ${JSON.stringify(P('beta'))} } ] }`)
  const storage = path.join(root, 'workspaceStorage')
  for (const [id, body] of Object.entries({
    a1: { workspace: pathToFileURL(file).href },
    b2: { folder: 'file:///somewhere/else' }, // a single-folder window: not a workspace
    c3: { workspace: 'file:///gone/missing.code-workspace' },
    d4: { workspace: pathToFileURL(untitled).href }, // unsaved: the handler would open it as text
  })) {
    await fsp.mkdir(path.join(storage, id), { recursive: true })
    await fsp.writeFile(path.join(storage, id, 'workspace.json'), JSON.stringify(body))
  }

  const spaces = await readWorkspaces(storage)
  assert.equal(spaces.length, 1)
  assert.deepEqual(spaces[0].folders, [P('alpha'), path.join(root, 'data')])
  assert.deepEqual(await readWorkspaces(path.join(root, 'nope')), [])
  await fsp.rm(root, { recursive: true, force: true })
})

test('a multi-root window is matched to the workspace with exactly its folders', () => {
  const spaces = [
    { file: 'one.code-workspace', folders: [P('alpha'), P('data')], mtime: 1 },
    { file: 'two.code-workspace', folders: [P('alpha'), P('data'), P('extra')], mtime: 9 },
  ]
  const win = (folders) => ({ folders })
  assert.equal(workspaceOfWindow(spaces, win([P('data'), P('alpha')]))?.file, 'one.code-workspace')
  assert.equal(workspaceOfWindow(spaces, win([P('alpha'), P('other')])), null)
  assert.equal(workspaceOfWindow(spaces, win([P('alpha')])), null, 'a single-folder window is on its folder')
})

test('with no window open, the folder finds the workspace that is its own', () => {
  const spaces = [
    { file: 'farm.code-workspace', folders: [P('farm'), P('alpha')], mtime: 9 },
    { file: 'alpha.code-workspace', folders: [P('alpha'), P('data')], mtime: 1 },
  ]
  assert.equal(workspaceForFolder(spaces, P('alpha', 'src'))?.file, 'alpha.code-workspace')
  assert.equal(workspaceForFolder(spaces, P('beta')), null)
})

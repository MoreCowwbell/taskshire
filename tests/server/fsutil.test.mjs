/**
 * `readTail` is what lets the adapter ask a 4 MB subagent transcript how it ended without
 * reading it. The one rule that matters is which partial line it drops: the *leading* one,
 * since the window it opens almost always lands in the middle of a record.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { jsonLines, readTail, stripLongPathPrefix } from '../../server/lib/fsutil.mjs'

async function withFile(contents, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'botcrossing-tail-'))
  const file = path.join(dir, 'transcript.jsonl')
  await fsp.writeFile(file, contents)
  try {
    return await fn(file)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

test('readTail: a file shorter than the window comes back whole', async () => {
  const text = '{"a":1}\n{"a":2}\n'
  await withFile(text, async (file) => {
    assert.equal(await readTail(file, 64 * 1024), text)
    assert.deepEqual(jsonLines(await readTail(file, 64 * 1024)), [{ a: 1 }, { a: 2 }])
  })
})

test('readTail: the leading partial line is dropped', async () => {
  const text = '{"first":"a record long enough to be cut in half"}\n{"last":1}\n'
  await withFile(text, async (file) => {
    // A window that starts inside the first record keeps only the whole lines after it.
    assert.equal(await readTail(file, 20), '{"last":1}\n')
    assert.deepEqual(jsonLines(await readTail(file, 20)), [{ last: 1 }])
  })
})

test('readTail: a window holding no whole line at all is empty rather than half a record', async () => {
  await withFile('{"one":"enormous single record"}\n', async (file) => {
    assert.equal(await readTail(file, 8), '')
    assert.deepEqual(jsonLines(await readTail(file, 8)), [])
  })
})

test('readTail: an empty file is empty', async () => {
  await withFile('', async (file) => assert.equal(await readTail(file, 1024), ''))
})

test('stripLongPathPrefix drops the extended-length prefix Codex records on Windows', () => {
  assert.equal(stripLongPathPrefix(String.raw`\\?\C:\Users\me\repo`), String.raw`C:\Users\me\repo`)
  assert.equal(stripLongPathPrefix(String.raw`\\?\UNC\server\share\repo`), String.raw`\\server\share\repo`)
  assert.equal(stripLongPathPrefix(String.raw`C:\Users\me\repo`), String.raw`C:\Users\me\repo`)
  assert.equal(stripLongPathPrefix('/home/me/repo'), '/home/me/repo')
  assert.equal(stripLongPathPrefix(''), '')
})

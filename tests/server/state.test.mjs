/**
 * The two override lists ride in the colony file next to the archive list. An old file
 * without them must load with both empty, and a round trip must keep them whole.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bot-crossing-state-'))
process.env.BOT_CROSSING_DATA = dir
const { readState, writeState } = await import('../../server/api.mjs')

test('a colony file from before the lists loads with both empty', async () => {
  await fsp.writeFile(path.join(dir, 'colony.json'), JSON.stringify({ version: 1, archived: ['t1'], plots: { a: [[0, 0]] } }))
  const s = await readState()
  assert.deepEqual(s.archived, ['t1'])
  assert.deepEqual(s.hidden, [])
  assert.deepEqual(s.pinned, [])
  assert.deepEqual(s.forgotten, [])
})

test('hidden, pinned and cleared survive a round trip and reject non-arrays', async () => {
  await writeState({
    archived: [],
    hidden: ['scratch', '.claude'],
    pinned: ['notes-vault'],
    forgotten: ['old-spike', 'scratch'],
    plots: {},
  })
  const s = await readState()
  assert.deepEqual(s.hidden, ['scratch', '.claude'])
  assert.deepEqual(s.pinned, ['notes-vault'])
  assert.deepEqual(s.forgotten, ['old-spike', 'scratch'])
  await writeState({ hidden: 'nope', pinned: { a: 1 }, forgotten: 7 })
  const again = await readState()
  assert.deepEqual(again.hidden, [])
  assert.deepEqual(again.pinned, [])
  assert.deepEqual(again.forgotten, [])
})

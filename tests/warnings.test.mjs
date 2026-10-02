/**
 * The scan's warnings, said once each.
 *
 * The whole value of this file is the second assertion in most of these: the page polls every
 * fifteen seconds and a broken harness stays broken, so "which ones are new" is the only
 * question worth asking, and getting it wrong is a red box that never goes away.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { unseenWarnings } from '../src/game/warnings.js'

test('a server that sends no warnings at all is not an error', () => {
  // An older server answers `/api/threads` without the field, and `res.warnings` is undefined.
  assert.deepEqual(unseenWarnings(undefined, new Set()), [])
  assert.deepEqual(unseenWarnings(null, new Set()), [])
  assert.deepEqual(unseenWarnings('a warning', new Set()), [])
})

test('two harnesses failing the same way have one thing to tell you', () => {
  assert.deepEqual(unseenWarnings(['same', 'same'], new Set()), ['same'])
})

test('a warning already toasted is not toasted again on the next poll', () => {
  const shown = new Set()
  assert.deepEqual(unseenWarnings(['codex is unhappy'], shown), ['codex is unhappy'])
  assert.deepEqual(unseenWarnings(['codex is unhappy'], shown), [], 'the poll after says nothing')
})

test('a second harness breaking later is still heard', () => {
  const shown = new Set()
  unseenWarnings(['first'], shown)
  assert.deepEqual(unseenWarnings(['first', 'second'], shown), ['second'])
})

test('blanks and non-strings are dropped rather than toasted empty', () => {
  const shown = new Set()
  assert.deepEqual(unseenWarnings(['', '   ', null, 42, { error: 'x' }, 'real'], shown), ['real'])
  assert.deepEqual([...shown], ['real'], 'and none of the junk is remembered as said')
})

test('the set gains exactly what was returned, so the caller need not track it', () => {
  const shown = new Set(['old'])
  const out = unseenWarnings(['old', 'new'], shown)
  assert.deepEqual(out, ['new'])
  assert.deepEqual([...shown].sort(), ['new', 'old'])
})

test('the message is passed through as the server wrote it', () => {
  // No prefix, no harness name bolted on: the text already names the harness, and a toast that
  // says "Warning: warning" reads as a bug.
  const message = 'Codex: node:sqlite needs Node 22.13 or newer — reading the transcripts instead'
  assert.deepEqual(unseenWarnings([message], new Set()), [message])
})

test('a stray space at the other end is not a second warning', () => {
  const shown = new Set()
  assert.deepEqual(unseenWarnings(['codex is unhappy '], shown), ['codex is unhappy'])
  assert.deepEqual(unseenWarnings([' codex is unhappy'], shown), [])
})

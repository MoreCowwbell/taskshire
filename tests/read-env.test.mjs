import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { readEnv } from '../tools/read-env.mjs'

/** Writes one throwaway `.env` and reads it back. */
function envFrom(text) {
  const file = join(mkdtempSync(join(tmpdir(), 'botcrossing-env-')), '.env')
  writeFileSync(file, text)
  return readEnv(file)
}

test('a missing file is not an error', () => {
  const env = readEnv(join(tmpdir(), 'no-such-directory-9f2a', '.env'))
  assert.equal(env.ASSETS_SRC, undefined)
  assert.ok(Object.keys(env).length > 0) // process.env still comes through
})

test('comments, blanks and quotes', () => {
  const env = envFrom('# a comment\n\nA=one\nB="two"\nC=\'three\'\n')
  assert.equal(env.A, 'one')
  assert.equal(env.B, 'two')
  assert.equal(env.C, 'three')
})

test('an unquoted value ends at a trailing comment', () => {
  const env = envFrom('A=./packs # where the zips were unpacked\nB="./packs # kept"\n')
  assert.equal(env.A, './packs')
  // Inside quotes a `#` is just a character, which is how a path may contain one.
  assert.equal(env.B, './packs # kept')
})

test('CRLF line endings read the same as LF', () => {
  const env = envFrom('A=one\r\nB=two\r\n')
  assert.equal(env.A, 'one')
  assert.equal(env.B, 'two')
})

test('a leading ~ expands to the home directory', () => {
  const env = envFrom('A=~/data/Garden_Planner\nB=~\nC=~notauser/x\nD=./x/~/y\n')
  assert.equal(env.A, join(homedir(), 'data/Garden_Planner'))
  assert.equal(env.B, homedir())
  // `~user` is someone else's home and not ours to guess; a `~` mid-path is a directory.
  assert.equal(env.C, '~notauser/x')
  assert.equal(env.D, './x/~/y')
})

test('process.env wins over the file', () => {
  process.env.BOTCROSSING_TEST_KEY = 'from the shell'
  try {
    assert.equal(envFrom('BOTCROSSING_TEST_KEY=from the file\n').BOTCROSSING_TEST_KEY, 'from the shell')
  } finally {
    delete process.env.BOTCROSSING_TEST_KEY
  }
})

/**
 * The guard that decides whether a folder the page sent is worth handing to the OS opener.
 * It used to be `startsWith('/')`, which rejects every path on Windows.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { isAbsoluteFolder } from '../../server/api.mjs'

test('absolute folders are accepted, in either path flavour', () => {
  assert.equal(isAbsoluteFolder('C:\\Users\\x'), true)
  assert.equal(isAbsoluteFolder('C:/Users/x'), true)
  assert.equal(isAbsoluteFolder('/Users/x'), true)
  assert.equal(isAbsoluteFolder('\\\\server\\share\\repo'), true)
})

test('relative and non-string folders are rejected', () => {
  assert.equal(isAbsoluteFolder('relative/x'), false)
  assert.equal(isAbsoluteFolder('relative\\x'), false)
  assert.equal(isAbsoluteFolder('..\\..\\etc'), false)
  assert.equal(isAbsoluteFolder(''), false)
  assert.equal(isAbsoluteFolder(undefined), false)
  assert.equal(isAbsoluteFolder(null), false)
  assert.equal(isAbsoluteFolder({ toString: () => '/Users/x' }), false)
})

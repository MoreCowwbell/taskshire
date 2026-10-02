/**
 * The contact sheets' file server: a request path decoded without throwing, and resolved only
 * while it stays inside the tree it was asked of.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { decodedPath, within } from '../tools/contact-sheets/serve-path.mjs'

const ROOT = path.resolve('packs')

test('within: a path under the root resolves to the file', () => {
  assert.equal(within(ROOT, 'a/b.glb'), path.join(ROOT, 'a', 'b.glb'))
  assert.equal(within(ROOT, 'a/../b.glb'), path.join(ROOT, 'b.glb'), 'a `..` that stays inside is fine')
  assert.equal(within(ROOT, ''), ROOT, 'the root itself is inside')
})

test('within: anything that climbs out is refused', () => {
  assert.equal(within(ROOT, '../secret.txt'), null)
  assert.equal(within(ROOT, 'a/../../secret.txt'), null)
  assert.equal(within(ROOT, '..'), null)
  assert.equal(within(ROOT, `..${path.sep}..${path.sep}secret.txt`), null, "the platform's own separator too")
})

test('within: a sibling that shares the prefix is not inside', () => {
  assert.equal(within(ROOT, '../packs-private/x.glb'), null)
})

test('within: an absolute path is read as one under the root, never instead of it', () => {
  const abs = within(ROOT, '/etc/passwd')
  assert.equal(abs, path.join(ROOT, 'etc', 'passwd'))
})

test('decodedPath: decodes the path, drops the query, and returns null for broken escapes', () => {
  assert.equal(decodedPath('/src/a%20b.glb?x=1'), '/src/a b.glb')
  assert.equal(decodedPath('/src/%2e%2e%2fsecret'), '/src/../secret')
  assert.equal(decodedPath('/src/%E0%A4%A'), null)
  assert.equal(decodedPath('/src/%'), null)
  assert.equal(decodedPath('/src/a%00.glb'), null, 'a NUL would make fs throw')
})

test('the two together: an encoded climb decodes and is then refused', () => {
  const u = decodedPath('/src/%2e%2e%2f%2e%2e%2fsecret.txt')
  assert.equal(within(ROOT, u.slice(5)), null)
})

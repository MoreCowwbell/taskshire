/**
 * The repo list's Archive section: which threads it lists, and in what order. The rows
 * themselves are DOM and live in the page smoke.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { archiveRows } from '../src/ui/hud-data.js'

const t = (id, over = {}) => ({ id, title: `T ${id}`, project: 'repo', state: 'archived', lastActivityAt: 0, ...over })

test('only archived threads are listed, from every repo', () => {
  const rows = archiveRows([
    t('a', { project: 'one' }),
    t('b', { state: 'inactive' }),
    t('c', { project: 'two' }),
    t('d', { state: 'active' }),
  ])
  assert.deepEqual(rows.map((r) => [r.id, r.project]).sort(), [
    ['a', 'one'],
    ['c', 'two'],
  ])
})

test('most recently archived first; unstamped ones last, by recent activity', () => {
  const rows = archiveRows(
    [t('old'), t('none-early', { lastActivityAt: 1 }), t('new'), t('none-late', { lastActivityAt: 5 })],
    { old: 100, new: 200 }
  )
  assert.deepEqual(
    rows.map((r) => r.id),
    ['new', 'old', 'none-late', 'none-early']
  )
  assert.equal(rows.find((r) => r.id === 'none-late').at, null)
})

test('a thread with no title or project still gets a row that says so', () => {
  const [row] = archiveRows([{ id: 'x', state: 'archived' }])
  assert.equal(row.title, 'Untitled thread')
  assert.equal(row.project, 'unknown')
})

/**
 * The repo list's filter rule. One function, because it is the only part of the View section
 * that can be checked without a browser — the rest is DOM and lives in the page smoke.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { matchesRepoFilter } from '../src/ui/hud-data.js'

test('an empty query matches every repo', () => {
  assert.equal(matchesRepoFilter('Garden_Planner', ''), true)
  assert.equal(matchesRepoFilter('Garden_Planner', '   '), true)
  assert.equal(matchesRepoFilter('Garden_Planner', null), true)
  assert.equal(matchesRepoFilter('Garden_Planner', undefined), true)
})

test('matching is case-insensitive, anywhere in the name', () => {
  assert.equal(matchesRepoFilter('Garden_Planner', 'plan'), true)
  assert.equal(matchesRepoFilter('Garden_Planner', 'GARDEN'), true)
  assert.equal(matchesRepoFilter('Garden_Planner', 'ner'), true)
  assert.equal(matchesRepoFilter('Garden_Planner', 'bot'), false)
})

test('the query is trimmed, because a trailing space is a typo and not a filter', () => {
  assert.equal(matchesRepoFilter('ledger_app', '  LEDGER '), true)
})

test('punctuation is a character and never a pattern', () => {
  assert.equal(matchesRepoFilter('bot-crossing', '-cross'), true)
  assert.equal(matchesRepoFilter('bot-crossing', '.*'), false)
  assert.equal(matchesRepoFilter('bot-crossing', 'b.t'), false)
})

test('a nameless row matches nothing but the empty query', () => {
  assert.equal(matchesRepoFilter(null, 'a'), false)
  assert.equal(matchesRepoFilter(undefined, ''), true)
})

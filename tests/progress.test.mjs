import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PROGRESS_SNAP, nextProgress } from '../src/game/colony.js'

/**
 * A building's reveal, one frame at a time.
 *
 * The damp is fine; the old write floor was not. `Math.abs(next - progress) > 0.0005` skipped
 * the write once the step got small, and the step is proportional to the distance left — so on
 * a 144 Hz screen a retiring building froze at 0.0403, above the 0.02 that deletes it, and the
 * stump stayed for the life of the page. Anything faster than 71.1 Hz did it.
 */
const FAST = 1 / 144
const SIXTY = 1 / 60

/** Frames to get from `from` to within `to`, walking the real step function. */
function framesTo(from, target, dt, done) {
  let p = from
  for (let i = 1; i <= 2000; i++) {
    p = nextProgress(p, target, dt)
    if (done(p)) return i
  }
  return null
}

test('a retiring building reaches the removal threshold at 144 Hz', () => {
  // 0.0403 is exactly where the old floor stranded it.
  const frames = framesTo(0.0403, 0, FAST, (p) => p <= 0.02)
  assert.ok(frames, 'it never got there')
  assert.ok(frames < 200, `took ${frames} frames`)
})

test('and at 60 Hz, as it always did', () => {
  assert.ok(framesTo(0.0403, 0, SIXTY, (p) => p <= 0.02))
})

test('a rising building finishes exactly rather than creeping at 1', () => {
  const frames = framesTo(0.9597, 1, FAST, (p) => p === 1)
  assert.ok(frames, 'it never landed on the target')
  // And a building that has landed is a building nothing writes again: the caller's guard is
  // `next !== progress`, so returning the target unchanged is what switches the writes off.
  assert.equal(nextProgress(1, 1, FAST), 1)
  assert.equal(nextProgress(0, 0, FAST), 0)
})

test('the snap only fires inside its own epsilon', () => {
  const half = nextProgress(0.5, 1, FAST)
  assert.ok(half > 0.5 && half < 1 - PROGRESS_SNAP, `a long way out does not snap: ${half}`)
  assert.equal(nextProgress(1 - PROGRESS_SNAP / 2, 1, FAST), 1)
  assert.equal(nextProgress(PROGRESS_SNAP / 2, 0, FAST), 0)
  assert.equal(PROGRESS_SNAP, 0.005)
})

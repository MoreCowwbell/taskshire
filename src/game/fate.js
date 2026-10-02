/**
 * What the map does with a repo that has gone quiet.
 *
 * The colony used to show every repo that had ever had a thread, at full strength, forever.
 * This decides, per repo, whether it is on the map at all and how far it has faded toward
 * leaving — from the newest live thread's timestamp and three settings, plus three lists the
 * user keeps by hand. Pure, so it can be tested without a browser and reasoned about as a
 * table: the first matching row wins, exactly like `statusFor`.
 *
 *   hidden                              → gone
 *   active / idle / errored thread      → full
 *   forgotten                           → gone
 *   pinned                              → full
 *   filter off                          → full
 *   age ≥ hideDays                      → gone
 *   age ≥ fadeDays                      → fading, 0 at fadeDays → 1 at hideDays
 *   otherwise                           → full
 *
 * `hidden` is checked before the wake rule on purpose: a repo you hid is one you do not want
 * to see, and a stray session in that folder must not bring it back.
 *
 * `forgotten` is checked after it, which is the whole difference between the two lists. It
 * holds the repos cleared out of Gone — folders that died months ago and that nobody wants
 * a row about. A dead folder never wakes, so it stays gone for good; the day a thread opens
 * in one of them again its zone comes back, and the caller drops it from the list. That is
 * what makes clearing the whole group safe in one go. It outranks `pinned` and the filter
 * switch too: turning the filter off is a way of looking at the map, not an undo for a
 * cleanup that was asked for.
 */

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Which states size a plot and get a building. Read once per poll.
 *
 * Separate from the wake rule on purpose: what puts a zone on the map (anything open or
 * broken) and what decides how much ground it needs (whatever the user ticked) are two
 * different questions, and tying them together would make a repo of closed sessions either
 * invisible or permanently sprawling.
 */
export function countedStates(settings) {
  const s = new Set()
  if (settings.get('countActive')) s.add('active')
  if (settings.get('countIdle')) s.add('idle')
  if (settings.get('countInactive')) s.add('inactive')
  if (settings.get('countArchived')) s.add('archived')
  return s
}

export const isCounted = (thread, counted) => counted.has(thread.state)

/**
 * @param {Array<object>} threads  every thread except archived — filtered upstream
 * @param {{ now: number, activeOnly: boolean, fadeDays: number, hideDays: number,
 *           hidden: Iterable<string>, pinned: Iterable<string>,
 *           forgotten?: Iterable<string> }} opts
 * @returns {Map<string, { show: boolean, fade: number, age: number }>}
 */
export function zoneFate(threads, { now, activeOnly, fadeDays, hideDays, hidden, pinned, forgotten }) {
  const hiddenSet = hidden instanceof Set ? hidden : new Set(hidden || [])
  const pinnedSet = pinned instanceof Set ? pinned : new Set(pinned || [])
  const forgottenSet = forgotten instanceof Set ? forgotten : new Set(forgotten || [])
  // Never a zero-length ramp: the sliders keep these apart too, but a hand-edited
  // localStorage must not turn the fade into a division by zero.
  const fadeMs = Math.max(0, fadeDays) * DAY_MS
  const hideMs = Math.max(hideDays, fadeDays + 1) * DAY_MS

  const newest = new Map()
  const awake = new Set()
  for (const thread of threads) {
    const key = thread.project || 'unknown'
    const at = Number(thread.lastActivityAt) || 0
    if (!newest.has(key) || at > newest.get(key)) newest.set(key, at)
    if (thread.state === 'active' || thread.state === 'idle' || thread.hasError) awake.add(key)
  }

  const out = new Map()
  for (const [key, at] of newest) {
    const age = at > 0 ? now - at : Infinity
    let show = true
    let fade = 0
    if (hiddenSet.has(key)) {
      show = false
      fade = 1
    } else if (awake.has(key)) {
      // full strength — and, for a forgotten repo, the one thing that brings it back
    } else if (forgottenSet.has(key)) {
      show = false
      fade = 1
    } else if (pinnedSet.has(key) || !activeOnly) {
      // full strength
    } else if (age >= hideMs) {
      show = false
      fade = 1
    } else if (age >= fadeMs) {
      fade = (age - fadeMs) / (hideMs - fadeMs)
    }
    out.set(key, { show, fade, age })
  }
  return out
}

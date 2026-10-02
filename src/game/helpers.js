/**
 * Helpers: the subagents a thread is running right now, as roster entries.
 *
 * A helper is a villager like any other — same crew, half the size — standing on its parent's
 * plot for as long as the subagent lives. What makes it a helper is only its id, which is
 * the subagent's own behind a prefix, so nothing that keys on a thread id can ever pick one
 * up by accident: not the archive list, not the saved layout, not the harness.
 *
 * Half size is carried on the roster entry, as `size`, and nowhere else (owner's call,
 * 2026-09-12; a body of its own in the crew sheet was considered and turned down — the point
 * is that a helper is the same villager, only smaller). The crew reads `size` off the entry
 * and draws that body at that scale; it is the *only* thing that makes one smaller, so
 * `isHelperId` never has to be asked inside `src/agents/`, which must not import the colony.
 * A thread entry carries no `size` at all and the crew defaults it to 1, so every villager
 * that is not a helper is composed from exactly the numbers it was before.
 *
 * `cue` is the second such field (2026-09-13) and works exactly the same way: it names what a
 * helper wears on its head, the theme decides what that is, and a thread entry carries none.
 *
 * Deliberately free of three.js, and of the colony: the site is whatever the caller hands
 * back from `siteFor`, so this file is a pure list transformation the node tests can read.
 */

export const HELPER_PREFIX = 'helper:'

/** How tall a helper stands against its parent. Half: unmistakable at the isometric rest distance. */
export const HELPER_SIZE = 0.5

/**
 * The one thing a helper wears that nobody else does, named on the entry beside `size`.
 *
 * Half height alone asks you to judge a body against the one next to it, which is a
 * comparison and not a glance. The cue is the second thing the roster says and the crew
 * reads: a theme's props hook declares `cues: { helper: () => [...] }` and the engine builds
 * those parts the first time an agent carrying this cue spawns — a coloured cap on the crown
 * in the village, a beacon on the helmet in the colony. Same field, same meaning in both, and
 * a thread's own entry carries no `cue` at all, so it is gated out of every cue part there is.
 *
 * A string rather than a boolean because the engine keys the props hook's `cues` table by it,
 * so a second kind of cue costs a name here and a factory there and nothing in `src/agents/`.
 */
export const HELPER_CUE = 'helper'

export const helperId = (subagentId) => HELPER_PREFIX + subagentId

export const isHelperId = (id) => typeof id === 'string' && id.startsWith(HELPER_PREFIX)

/** Only an open session has anybody on the map for a helper to stand beside. */
const HAS_CREW = new Set(['active', 'idle'])

/**
 * One thread's helpers, in the order the server sorted them (oldest first).
 *
 * `siteFor(k, n)` is asked once per helper — and never at all for a thread with none, which
 * is what keeps a roster with no subagents byte-for-byte the roster it was: no vector, no
 * random draw, nothing allocated on the path to a frame.
 *
 * A helper's status is `working` by definition rather than through `statusFor`: a subagent
 * that has stopped is a subagent that has left.
 */
export function helperEntries(thread, siteFor, anchor, accent) {
  if (!thread || !HAS_CREW.has(thread.state)) return []
  const subagents = Array.isArray(thread.subagents) ? thread.subagents : []
  return subagents.map((helper, k) => ({
    id: helperId(helper.id),
    thread,
    helper,
    status: 'working',
    site: siteFor(k, subagents.length),
    anchor,
    accent,
    size: HELPER_SIZE,
    cue: HELPER_CUE,
  }))
}

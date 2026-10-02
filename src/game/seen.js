/**
 * Which threads the colony has met, and forgetting the ones it will not meet again.
 *
 * `state.seen` decides one thing: whether a thread open at page load walks out of the ship. A
 * thread already on the books is simply already outside, and without that every reload staged
 * a hundred-astronaut entrance at the ramp. `nextArrivals` narrows it for a session that closed and came back. Nothing reads the *value* — only the keys — which
 * is why nobody noticed that `applyThreads` added a row per thread it had ever met and removed
 * none of them, for the life of the machine.
 *
 * So the value gets a meaning here: "last seen in a scan", refreshed at most once a day. That
 * is what lets an entry be dropped safely — a thread absent from every scan for `hideDays` is
 * a transcript that has been deleted, and a deleted transcript does not come back.
 *
 * The refresh is throttled on purpose. Stamping every present thread on every poll would mean
 * a save every fifteen seconds forever; at a day's granularity a normal poll changes nothing
 * and queues nothing, which is why this returns the same object back when it has no work.
 *
 * Presence is judged on the whole scan, not on what is on the map: archived, inactive and
 * hidden-repo threads are all in the list `applyThreads` gets, so none of them is forgotten
 * for being out of sight. And an adapter that threw for one poll, a drive that was not mounted
 * this morning, a harness undetected for an afternoon all leave every stamp less than a day
 * old — well inside the shortest window the slider offers.
 *
 * Pure and browser-free, like `merge-state.js`, for the same reason: getting it wrong costs
 * somebody an entrance they should not have seen, or a row that never goes away.
 */
import { DAY_MS } from './fate.js'

/** How stale a present thread's stamp has to be before it is worth another save. */
export const SEEN_REFRESH_MS = DAY_MS

/**
 * @param {object} seen `state.seen` — id to last-seen epoch ms
 * @param {Iterable<string>} presentIds every thread id in this scan
 * @param {{ now: number, hideDays: number }} opts `hideDays` is the Repos slider, 2–90
 * @returns {{ seen: object, changed: boolean }} the same object when nothing changed
 */
export function reconcileSeen(seen, presentIds, { now, hideDays }) {
  const current = seen && typeof seen === 'object' && !Array.isArray(seen) ? seen : {}
  // The slider's own floor, applied again here: a hand-edited colony file must not be able to
  // set a window short enough to forget a thread that was in this morning's scan.
  const hideMs = Math.max(Number(hideDays) || 0, 2) * DAY_MS
  const present = presentIds instanceof Set ? presentIds : new Set(presentIds)

  let next = null
  const copy = () => (next ??= { ...current })

  for (const id of present) {
    const stamp = Number(current[id]) || 0
    if (now - stamp < SEEN_REFRESH_MS) continue
    copy()[id] = now
  }
  for (const id of Object.keys(current)) {
    if (present.has(id)) continue
    // A garbage value reads as epoch zero, which is older than any window — the row is junk
    // and dropping it is the point of this pass.
    if (now - (Number(current[id]) || 0) < hideMs) continue
    delete copy()[id]
  }

  return next ? { seen: next, changed: true } : { seen: current, changed: false }
}

/**
 * Which open threads may appear on their plot rather than walk out of the ship.
 *
 * `state.seen` alone answers "has the colony met this thread", which is the right question for
 * a thread that has been open all along and the wrong one for a session that closed and was
 * resumed: every closed session is on the books too, so resuming one popped its villager
 * straight onto the tile. So a second list is kept for the life of the page — the threads it
 * has watched sitting closed (inactive or archived) — and an open thread on that list is
 * coming back, which is an entrance:
 *
 *   known  = open, already met before this scan, and not seen closed since the page loaded
 *   walks  = never met (it started while nobody was looking), or seen closed and now open
 *
 * A returning thread stays on the list until it actually has a villager, so one that reopens
 * behind a hidden repo, a faded one or the crew cap still walks out on the day it appears. A
 * thread that stayed open throughout is never on it, so a villager it only now gets (a repo
 * unhidden, a setting changed) is placed, the way it always was. And a scan that came back
 * empty only fails to add anything: nothing is taken off by one bad answer.
 *
 * @param {Set<string>} closedHere the previous answer's list; an empty set on the first scan
 * @param {object} scan
 * @param {Iterable<string>} scan.open ids that are active or idle in this scan
 * @param {Iterable<string>} scan.closed ids that are inactive or archived in this scan
 * @param {Set<string>} scan.seen the keys of `state.seen`, read before this scan was reconciled
 * @param {(id: string) => boolean} scan.hasVillager whether the id already has one on the map
 * @returns {{ known: Set<string>, closedHere: Set<string> }}
 */
export function nextArrivals(closedHere, { open, closed, seen, hasVillager }) {
  const next = new Set(closedHere)
  for (const id of closed) next.add(id)
  const openIds = [...open]
  // Back on the map already — the entrance, if there was one, has happened.
  for (const id of openIds) if (next.has(id) && hasVillager(id)) next.delete(id)
  const known = new Set(openIds.filter((id) => seen.has(id) && !next.has(id)))
  return { known, closedHere: next }
}

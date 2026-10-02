/**
 * Which of a scan's warnings the page has not said out loud yet.
 *
 * `/api/threads` carries a `warnings` array — one line per harness that is present on the
 * machine but cannot read its own store, so it appears healthy in the list while quietly
 * contributing nothing. A harness does not get better between polls: the same line comes back
 * every fifteen seconds, and toasting it every time would be a permanent red box rather than a
 * warning. So it is said once and remembered.
 *
 * Remembered in the page, per distinct message text, for the life of the page — not on disk,
 * and not per harness. The text is what the user reads, so the text is what "already said this"
 * has to key on; two harnesses that fail the same way have one thing to tell you. A reload
 * starts over, which is the right amount of forgetting: if it is still broken you are told
 * again, and if it fixed itself you never hear about it.
 *
 * Pure and browser-free, so the dedupe can be tested without a DOM.
 *
 * @param {unknown} list the server's `warnings`, or whatever an older server sent instead
 * @param {Set<string>} shown every message this page has already toasted; added to here
 * @returns {string[]} the ones to toast now, in the order the server wrote them
 */
export function unseenWarnings(list, shown) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const entry of list) {
    // A blank or a non-string is a bug at the other end, not a warning — toasting an empty
    // box would say nothing and toasting `[object Object]` would say worse than nothing.
    if (typeof entry !== 'string') continue
    const text = entry.trim()
    if (!text) continue
    // Keyed and toasted on the trimmed text, so a stray space at the other end is not a
    // second warning and the box never carries it.
    if (shown.has(text)) continue
    shown.add(text)
    out.push(text)
  }
  return out
}

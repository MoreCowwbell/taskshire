/**
 * Text on its way to the page, shared by the adapters that read transcripts.
 *
 * Nothing in here knows about a particular harness. It lives beside `fsutil.mjs` rather than
 * inside it because trimming a sentence is not a filesystem concern.
 */

/**
 * One line, at most `max` characters, with an ellipsis when the cap bit.
 *
 * Capping happens on the server so the browser never holds more transcript than it puts on
 * screen. Whitespace is collapsed rather than stripped: a prompt written as a bulleted list has
 * to read as a sentence in a 320 px panel.
 */
export function oneLine(value, max) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  return text.slice(0, max - 1).trimEnd() + '…'
}

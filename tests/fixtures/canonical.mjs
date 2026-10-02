import { createHash } from 'node:crypto'

/**
 * A setting as one string that depends on what it says and not on how it was written down.
 *
 * Keys are sorted at every level, so two objects that hold the same values in a different
 * order agree. That is deliberate and it is the whole difference from `JSON.stringify`: the
 * golden's `settings` entry answers "does this world still carry the same data", and a
 * setting assembled from pieces in another order still does. Whether the *order* survived
 * is a separate question with its own check.
 *
 * Everything else is JSON's own rule, so the string is reproducible by anyone with a JSON
 * library: a key whose value is `undefined` is left out, a non-finite number is `null`, and a
 * function — no setting holds one today — is its source text.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (typeof value === 'function') return JSON.stringify(String(value))
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** SHA-256, hex, of a setting's `canonicalJson`. */
export function settingHash(setting) {
  return createHash('sha256').update(canonicalJson(setting)).digest('hex')
}

/**
 * The two checks between a request line and a file on disk, for the contact sheets' throwaway
 * file server.
 *
 * The server hands out two trees — the unzipped packs under ASSETS_SRC, and three.js from
 * node_modules — by joining the rest of the URL onto the tree's root. A joined `..` walks right
 * back out of it, and `%2e%2e%2f` decodes to one, so on its own that join serves any file the
 * user can read. Loopback and a random port keep the audience small; this keeps the answer
 * honest: a path that resolves outside its root is not in the tree, so it is a 404.
 *
 * Kept apart from `contact-sheets.mjs`, which launches a browser the moment it is imported, so
 * the node tests can reach these without the packs, the port or Chromium.
 */
import path from 'node:path'

/**
 * The request's path, percent-decoded — or null when the escapes are malformed (`%E0%A4%A`) or
 * decode to a NUL, which no file is named with and which makes `fs` throw rather than answer.
 */
export function decodedPath(url) {
  let decoded
  try {
    decoded = decodeURIComponent(String(url).split('?')[0])
  } catch {
    return null
  }
  return decoded.includes('\0') ? null : decoded
}

/**
 * `rel` under `root`, resolved — or null when it resolves anywhere else. `path.join` rather
 * than `path.resolve` for the first step, so a `rel` that is itself absolute (`/etc/passwd`,
 * `C:\x`) is still read as a path under the root and cannot replace it.
 */
export function within(root, rel) {
  const base = path.resolve(root)
  const file = path.resolve(path.join(base, rel))
  return file === base || file.startsWith(base + path.sep) ? file : null
}

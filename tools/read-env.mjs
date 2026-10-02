/**
 * The smallest `.env` reader that does the job, so the packer can find the raw art packs
 * without the project taking a dependency for one key.
 *
 * `KEY=value` lines only; `#` comments and blank lines are skipped. A value may be quoted,
 * in which case everything after the closing quote is ignored; an unquoted value ends at the
 * first ` #`, so `ASSETS_SRC=./packs # the unzipped packs` is a path and not a sentence. A
 * leading `~` is expanded against the home directory, because the example file suggests
 * `~/data/...` and nothing else on this path would ever expand it. Anything already in
 * `process.env` wins, so a one-off run can override the file.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * `~`, `~/x` and (on Windows) `~\x` are a home-relative path; `~user` is not ours to guess
 * and is left alone.
 *
 * @param {string} value
 * @returns {string}
 */
function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

/**
 * @param {string} path  the `.env` file to read; missing is not an error
 * @returns {Record<string, string>}
 */
export function readEnv(path = '.env') {
  const out = {}
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i)
      if (!m) continue
      const raw = m[2]
      const quoted = raw.match(/^(['"])(.*?)\1/)
      // An unquoted value ends at the first whitespace-preceded `#`; a quoted one ends at
      // its closing quote, so a `#` inside quotes is part of the value.
      const value = quoted ? quoted[2] : raw.replace(/\s+#.*$/, '').trim()
      out[m[1]] = expandHome(value)
    }
  }
  return { ...out, ...process.env }
}

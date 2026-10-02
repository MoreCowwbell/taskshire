import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

/**
 * `build-kit.mjs` takes `out` and `generated[].module` as repo-relative strings and used to
 * resolve them against the process cwd, so the packer only worked from the repo root. With
 * no source pack it keeps an existing `out` and exits 0 — which it can only do if `out` was
 * resolved against the root, since the temp cwd has no `public/`.
 */
test('build-kit resolves out against the repo root, not the cwd', () => {
  const cfg = { src: resolve(tmpdir(), 'no-such-pack-' + process.pid), out: 'public/assets/medieval/medieval.glb' }
  const r = spawnSync(process.execPath, [resolve(ROOT, 'tools/build-kit.mjs'), JSON.stringify(cfg)], {
    cwd: tmpdir(),
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /keeping the existing/)
})

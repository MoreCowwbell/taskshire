/**
 * The production build's chunk graph. `main.js` awaits its theme at module scope, so a lazy
 * theme chunk that imports the entry chunk back can never evaluate: the entry waits on the
 * theme, the theme waits on the entry, and `npm start` sits on "Scanning for agent threads…"
 * forever. The dev server serves modules one by one and never shows it, so only a real build
 * can.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

test('no chunk imports the entry chunk back, and the medieval theme stays lazy', { timeout: 180_000 }, async () => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskshire-build-'))
  try {
    await build({ root: ROOT, logLevel: 'silent', build: { outDir, emptyOutDir: true, copyPublicDir: false } })

    const html = await fs.readFile(path.join(outDir, 'index.html'), 'utf8')
    const entry = html.match(/<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/)?.[1]
    assert.ok(entry, 'the built page names its entry script')

    const dir = path.join(outDir, 'assets')
    const chunks = (await fs.readdir(dir)).filter((f) => f.endsWith('.js'))
    const source = Object.fromEntries(
      await Promise.all(chunks.map(async (f) => [f, await fs.readFile(path.join(dir, f), 'utf8')]))
    )

    for (const f of chunks) {
      if (f === entry) continue
      assert.ok(!source[f].includes(`./${entry}`), `${f} imports the entry chunk ${entry}`)
    }

    const medieval = chunks.filter((f) => source[f].includes('assets/medieval'))
    assert.equal(medieval.length, 1, 'the medieval theme is in exactly one chunk')
    assert.notEqual(medieval[0], entry, 'the medieval theme is not in the entry chunk')
    const lazy = new RegExp(`import\\("\\./${medieval[0].replace(/[.]/g, '\\.')}"\\)`)
    assert.ok(chunks.some((f) => lazy.test(source[f])), 'the medieval chunk is loaded by a dynamic import')
  } finally {
    await fs.rm(outDir, { recursive: true, force: true })
  }
})

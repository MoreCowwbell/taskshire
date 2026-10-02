/**
 * Pixel-diff two PNGs. Decoding happens inside a Playwright page so this needs no image
 * library: both files are drawn to canvases and compared byte for byte.
 *
 * Usage as a module: `await diffPng(browser, a, b, outDiff)` → { total, differing }.
 * Usage from the CLI: `node tools/visual/diff.mjs a.png b.png [diff.png]`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

export async function diffPng(browser, aPath, bPath, diffPath = null) {
  const page = await browser.newPage()
  const a = readFileSync(aPath).toString('base64')
  const b = readFileSync(bPath).toString('base64')
  const result = await page.evaluate(
    async ([a, b, wantDiff]) => {
      const load = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = reject
          img.src = `data:image/png;base64,${b64}`
        })
      const [ia, ib] = await Promise.all([load(a), load(b)])
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { total: ia.width * ia.height, differing: ia.width * ia.height, sizeMismatch: true }
      }
      const draw = (img) => {
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0)
        return ctx.getImageData(0, 0, img.width, img.height)
      }
      const da = draw(ia)
      const db = draw(ib)
      const out = wantDiff ? new ImageData(ia.width, ia.height) : null
      let differing = 0
      for (let i = 0; i < da.data.length; i += 4) {
        const same =
          da.data[i] === db.data[i] &&
          da.data[i + 1] === db.data[i + 1] &&
          da.data[i + 2] === db.data[i + 2] &&
          da.data[i + 3] === db.data[i + 3]
        if (!same) differing++
        if (out) {
          out.data[i] = same ? da.data[i] >> 2 : 255
          out.data[i + 1] = same ? da.data[i + 1] >> 2 : 0
          out.data[i + 2] = same ? da.data[i + 2] >> 2 : 0
          out.data[i + 3] = 255
        }
      }
      let diffPng = null
      if (out) {
        const c = document.createElement('canvas')
        c.width = ia.width
        c.height = ia.height
        c.getContext('2d').putImageData(out, 0, 0)
        diffPng = c.toDataURL('image/png').split(',')[1]
      }
      return { total: ia.width * ia.height, differing, diffPng }
    },
    [a, b, Boolean(diffPath)]
  )
  await page.close()
  if (diffPath && result.diffPng) writeFileSync(diffPath, Buffer.from(result.diffPng, 'base64'))
  delete result.diffPng
  return result
}

if (process.argv[1] && process.argv[1].endsWith('diff.mjs')) {
  const [a, b, out] = process.argv.slice(2)
  if (!a || !b) {
    console.error('usage: diff.mjs <a.png> <b.png> [diff.png]')
    process.exit(2)
  }
  const browser = await chromium.launch()
  const r = await diffPng(browser, a, b, out || null)
  await browser.close()
  console.log(`${r.differing} / ${r.total} pixels differ`)
  process.exit(r.differing ? 1 : 0)
}

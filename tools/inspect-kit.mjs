/**
 * Prints what a built glb contains: named nodes and the atlas cells each one samples, plus
 * the skeleton's bones and its clips. The quickest way to answer "what is this part called"
 * when writing a recipe, and the first thing to run when `validate-kit` says a node is missing.
 *
 * Usage: inspect-kit.mjs <file.glb> [cols] [rows]
 */
import { readKit } from './kit-read.mjs'

const [glb, cols, rows] = process.argv.slice(2)
if (!glb) {
  console.error('usage: inspect-kit.mjs <file.glb> [cols] [rows]')
  process.exit(2)
}
const k = await readKit(glb, { cols: Number(cols) || 8, rows: Number(rows) || 4 })
console.log(
  `${glb}: ${k.nodes.size} nodes, ${k.bones.length} bones, ${k.clips.length} clips, atlas ${k.atlas ? `${k.atlas.width}x${k.atlas.height}` : 'none'}`
)
for (const [name, n] of [...k.nodes].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${name.padEnd(28)} cells ${n.cells.join(',')}`)
}
if (k.textures.length) console.log(`textures (${k.textures.length}): ${k.textures.map((t) => t || '<unnamed>').join(' ')}`)
// In a kit glb every node is static and already listed above; in a crew glb the handful of
// unskinned nodes are the hand tools, and those are worth naming.
console.log(`statics (${k.statics.length})${k.statics.length && k.statics.length <= 12 ? `: ${k.statics.join(' ')}` : ''}`)
if (k.bones.length) console.log(`bones: ${k.bones.join(' ')}`)
if (k.clips.length) console.log(`clips: ${k.clips.join(' ')}`)

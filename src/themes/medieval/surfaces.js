import * as THREE from 'three'
import { mulberry } from '../../core/rng.js'
import { atlasTexture, hasPart, part } from '../../world/kit.js'

/**
 * The two surfaces a village plot is drawn with: the green it stands on and the stone kerb
 * that edges it.
 *
 * The kerb is drawn here rather than shipped for the reason the space theme's is: it takes
 * each repo's accent colour, and a painted texture cannot.
 *
 * The green is the pack's own. `deckGeometry` hands the engine the KayKit `hex_grass` tile —
 * one per cell, seams and bevels left visible, because that join *is* the pack's look — and
 * `deck()` paints it out of the same gradient atlas every building on it is painted from. So
 * the ground and the houses standing on it change season together, in one texture upload.
 * The one thing laid over the grass is `deckTint: 'glaze'` — a light lean toward the repo's
 * accent, so neighbouring plots read as different zones without losing their green.
 *
 * The one thing the atlas cannot give is relief — it is flat paint, a swatch per material —
 * so a height field is drawn here and laid on as a normal map on a *second* UV channel: the
 * tile's own UVs point at its swatch and must not be touched, so `uv1` is a world-planar
 * projection laid over the top purely for the grass to catch a shadow on.
 *
 * Both come with a normal map derived from their own height field, which is what makes the
 * difference between a picture of grass and grass: the turf catches a shadow on one side as
 * the sun crosses, and the cobbles of the kerb pick out a highlight along their top edge.
 */

/**
 * World units one tile of the grass relief covers — the number the deck's `uv1` projection
 * divides by, and the one the engine's prism fallback unwraps against.
 *
 * **12, chosen by eye against 4 and 24.** It used to be 4, which was right while the deck's
 * detail was in the albedo: the pattern was a colour and a colour survives being small. Over
 * flat atlas paint the only detail left is the relief, and a clump is two pixels of a 512px
 * sheet — at 4 world units a repeat that is a fraction of a screen pixel at the camera's own
 * height, mipmapped away to nothing. Measured on a clean patch of deck as the spread of the
 * green channel: the old painted deck 6.15, and the kit deck 2.19 at 4, 3.02 at 12, 3.93 at
 * 24. 12 reads as close-cropped turf and leaves the kerb and the bevel the strongest lines on
 * the plot; 24 is tussocky and starts to show the worn scuffs as patches.
 */
export const DECK_TEXTURE_SCALE = 12

/**
 * How hard the grass relief reads, as the strength its height field is Sobelled at.
 *
 * **0.55, down from the disc field's 0.9.** The old field put its whole signal in step edges —
 * a disc wrote an absolute grey over the base, so every one of them was a plateau with a hard
 * rim — and a Sobel needs no help finding a rim. This field carries its slope in the swell
 * instead, where the gradient is already smooth and already correct, and 0.9 over a stroke
 * field reads as wire wool rather than as turf.
 *
 * It is the theme's own knob on purpose: `normalScale` on the deck material is set in
 * `world/plots.js` and shared with the space colony, and one theme's grass is no reason to
 * move an engine-wide number.
 */
export const RELIEF_STRENGTH = 0.55

/**
 * The swell's two octaves, as lattice size and amplitude in grey levels.
 *
 * ±21 between them about the middle of the range, which never leaves 107…149 and so never
 * clips. The coarse lattice is 8 across, about a plot and a half at `DECK_TEXTURE_SCALE` 12,
 * which is the scale ground actually rises and falls at; the fine one breaks the coarse one's
 * own smoothness without being small enough to mip away.
 */
const SWELL_CELLS = 8
const SWELL_AMP = 14
const SWELL_FINE_CELLS = 16
const SWELL_FINE_AMP = 7

/**
 * Blade strokes per pixel of side, and how far a blade may lean off its patch's own direction.
 *
 * Six, against the discs' three, because a stroke covers a fraction of the area a disc of the
 * same length does — 3072 of them on a 512 sheet. The jitter is ±0.45 rad: enough that a patch
 * is not combed, little enough that it is still a patch.
 */
const BLADES_PER_PX = 6
const BLADE_JITTER = 0.9

const smoothstep = (t) => t * t * (3 - 2 * t)

/** A tiling lattice of `cells × cells` random values, drawn from `rand` in row-major order. */
function lattice(cells, rand) {
  const v = new Float32Array(cells * cells)
  for (let i = 0; i < v.length; i++) v[i] = rand()
  return v
}

/**
 * One smoothstepped sample of a tiling lattice, at `u`/`w` in 0…1.
 *
 * Wrapped on both axes, which is what makes the sheet tile: at u 1 the sample reads the same
 * lattice column it reads at u 0, so the sheet joins itself and a plot of seven hex cells is
 * one meadow rather than seven repeats. Smoothstep rather than linear because a linear lattice
 * has a crease along every cell boundary and a Sobel finds creases.
 *
 * Exported only so `tests/surfaces.test.mjs` can hold the wrap and the bound without a canvas,
 * the same arrangement `towerOutFor` in `keep.js` has. Nothing outside this file calls it.
 */
export function sampleLattice(v, cells, u, w) {
  const x = u * cells
  const y = w * cells
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = smoothstep(x - x0)
  const ty = smoothstep(y - y0)
  const at = (i, j) => v[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx
  return top + (bottom - top) * ty
}

/**
 * Where a mark near an edge has to be drawn again so the sheet still tiles: nothing for a mark
 * the border cannot reach, and the far side for one it would cut in half.
 *
 * Exported for the test, like `sampleLattice`.
 */
export function wrapOffsets(v, size, margin) {
  if (v < margin) return [0, size]
  if (v > size - margin) return [0, -size]
  return [0]
}

/** The pack's ground tile, and the only part this file asks the kit for. */
const TILE_PART = 'hex_grass'
/**
 * The tile's circumradius as the pack authors it: 1.1547, with its corners on ±Z — a
 * *pointy-top* hexagon, where the plot lattice is flat-top. Everything here that is a
 * proportion of the tile is measured in these units and scaled by the engine's own radius.
 */
const TILE_RADIUS = 1.1547
/**
 * How far the tile's chamfer reaches in from the full radius, in the pack's units.
 *
 * The top face stops at 1.0970 and the bevel falls away from there to the full 1.1547 at
 * y −0.05. A kerb bar laid across that bevel leans outward and loses its footing, so the
 * kerb is inset by this much — scaled — plus the gap the engine already left.
 */
const CHAMFER = 0.05

/** The kit deck's maps, and the drawn fallback's, each built at most once. */
let kitDeck = null
let paintedDeck = null
/** The albedo and Sobel-normal canvases the relief is drawn on, shared by both. */
let sheets = null
let kerb = null

/**
 * One cell of the plot deck, as the pack's own grass tile.
 *
 * The engine calls this once per lattice cell while it builds a plot, hands it the cell's
 * plot-local centre, and merges, tints, fades and disposes whatever comes back. Returning
 * null puts it back on its own hex prism, which is what happens before the kit has loaded
 * and in the tests.
 *
 * Four things are done to the pack's tile and each of them is load-bearing:
 *
 * 1. **Turned a quarter.** The pack authors a pointy-top hexagon and the plot lattice is
 *    flat-top, so without this every cell sits a half-step out of phase with its neighbours
 *    and with the six kerb bars around it.
 * 2. **Scaled uniformly** to the engine's tile radius, so the chamfer keeps its proportions:
 *    a bevel scaled only in x and z would come out as a knife edge.
 * 3. **The bottom ring pulled up** to the engine's own floor. The tile is authored a full
 *    unit deep — six and a half at plot scale — and a slab that deep would surface through
 *    the terrain a hundred units away. Only the vertices on the very bottom move: the
 *    chamfer band and the straight side above it keep their shape, and because the sides
 *    stay vertical the normals are still right.
 * 4. **A second UV set.** The tile's own UVs point at its swatch in the gradient atlas and
 *    cannot be touched; `uv1` is the world-planar projection the relief normal map reads,
 *    the same one `planarUv` gives the engine's prism, so the clumps run continuously across
 *    a plot instead of repeating per cell.
 *
 * @param {{tile: number, top: number, skirt: number, x: number, z: number, textureScale: number}} cell
 * @returns {THREE.BufferGeometry | null}
 */
export function deckGeometry({ tile, top, skirt, x, z, textureScale }) {
  if (!hasPart(TILE_PART)) return null

  const geo = part(TILE_PART)
  geo.rotateY(Math.PI / 2)
  const s = tile / TILE_RADIUS
  geo.scale(s, s, s)

  const pos = geo.attributes.position
  const floor = -(top + skirt)
  // Half the scaled depth: below it there is nothing but the bottom ring, well clear of the
  // chamfer, which after scaling sits a third of a unit down.
  const underside = -0.5 * s
  const uv1 = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < underside) pos.setY(i, floor)
    uv1[i * 2] = (pos.getX(i) + x) / textureScale
    uv1[i * 2 + 1] = (pos.getZ(i) + z) / textureScale
  }
  pos.needsUpdate = true
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2))
  // Both, and after the edit: `part()` computed them on the tile as the pack authored it,
  // and a stale sphere six units too deep is a tile the frustum culls while you look at it.
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

/**
 * The village green's maps: the pack's atlas for colour, this file's clumps for relief.
 *
 * The atlas is the shared texture object every kit material in the theme holds, so the deck
 * follows a season change with the buildings on it — `setKitAtlas` swaps the image in place
 * and nothing here has to hear about it. It is flat paint, one gradient swatch per material,
 * which is why the relief is still worth drawing: a hexagon of unbroken colour under a single
 * directional light reads as felt, and the same normal map that made the painted green look
 * like grass does the same job over the swatch.
 *
 * `channel = 1` is the whole reason `deckGeometry` writes a second UV set: channel 0 is the
 * tile's own unwrap and points at a swatch a few pixels across.
 *
 * With no kit behind it — a load that failed, or a test — the old drawn green is handed back
 * instead, on channel 0, because the engine is drawing its own prism and there is no `uv1`
 * on it to read. Each is built at most once.
 */
export function deckSurface(size = 512) {
  // The *tile*, not the atlas, and the same test `deckGeometry` makes — the two have to pick
  // the same path or a kit that loaded without its ground tile would pair a channel-1 normal
  // map with the engine's prism, which carries no `uv1` at all.
  if (hasPart(TILE_PART)) return (kitDeck ??= { map: atlasTexture(), normalMap: reliefNormal(size, 1) })
  return (paintedDeck ??= {
    map: texture(relief(size).albedo.el, THREE.SRGBColorSpace),
    normalMap: reliefNormal(size, 0),
    // The albedo doubles as the roughness map — three reads its green channel — so a worn
    // patch comes out a shade smoother than the grass around it.
    roughnessMap: texture(relief(size).albedo.el, THREE.NoColorSpace),
  })
}

/** The relief normal map, as a texture reading whichever UV set the deck it is on carries. */
function reliefNormal(size, channel) {
  const t = texture(relief(size).normal.el, THREE.NoColorSpace)
  t.channel = channel
  return t
}

/**
 * The swell: two octaves of tiling value noise, written straight into the height canvas.
 *
 * Arithmetic rather than canvas shapes on purpose. It is pixel-exact on every platform, it owes
 * nothing to how a rasteriser antialiases, and it is one pass over the sheet at boot. This is
 * the part the discs were actually trying to do — broad rise and fall across a whole plot, the
 * thing that makes a hexagon of flat paint read as ground — and the part they got as craters.
 *
 * No clamp: `SWELL_AMP + SWELL_FINE_AMP` is 21 about a middle of 128, so the grey never leaves
 * 107…149.
 */
function drawSwell(target, coarse, fine, size) {
  const img = target.ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const w = (y + 0.5) / size
      const v = Math.round(
        128 +
          (sampleLattice(coarse, SWELL_CELLS, u, w) - 0.5) * 2 * SWELL_AMP +
          (sampleLattice(fine, SWELL_FINE_CELLS, u, w) - 0.5) * 2 * SWELL_FINE_AMP
      )
      const i = (y * size + x) * 4
      img.data[i] = v
      img.data[i + 1] = v
      img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
  target.ctx.putImageData(img, 0, 0)
}

/**
 * Blade strokes over the swell, and the one thing that makes them not craters: they are drawn
 * at a tenth of an alpha, so a stroke *adds* to the ground under it instead of replacing it
 * with an absolute grey. A disc that wrote `#9a9a9a` over `#808080` was a flat-topped plateau
 * with a hard rim; folded in at 0.1 a stroke has no rim of its own and the Sobel reads it as a
 * lean in the ground. Nothing in this field has a step edge in it anywhere.
 *
 * The lean comes from the coarse swell lattice rather than from `rand`, because grass in a lawn
 * leans in patches and blades at uniformly random angles read as static rather than as turf.
 * Half stand up and half sit down, as the clumps did, so the field has a lit side and a shaded
 * one rather than reading as a field of identical marks.
 */
function drawBlades(target, coarse, rand, size) {
  const ctx = target.ctx
  const unit = size / 256
  ctx.lineCap = 'round'
  for (let i = 0; i < size * BLADES_PER_PX; i++) {
    const x = rand() * size
    const y = rand() * size
    const len = (3 + rand() * 5) * unit
    const wide = (0.8 + rand() * 0.7) * unit
    const lean = sampleLattice(coarse, SWELL_CELLS, x / size, y / size) * Math.PI + (rand() - 0.5) * BLADE_JITTER
    ctx.strokeStyle = rand() > 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
    ctx.lineWidth = wide
    const dx = Math.cos(lean) * len * 0.5
    const dy = Math.sin(lean) * len * 0.5
    const margin = len * 0.5 + wide
    for (const ox of wrapOffsets(x, size, margin)) {
      for (const oy of wrapOffsets(y, size, margin)) {
        ctx.beginPath()
        ctx.moveTo(x + ox - dx, y + oy - dy)
        ctx.lineTo(x + ox + dx, y + oy + dy)
        ctx.stroke()
      }
    }
  }
}

/**
 * The grass relief: a mottled albedo, and — separately now — a soft swell with blade strokes
 * on it, Sobelled into a normal map.
 *
 * Authored to tile, so a plot of seven hex cells reads as one meadow rather than seven repeats
 * of the same patch, and drawn from fixed seeds, so every plot in the colony (and every
 * screenshot of it) gets the same one.
 *
 * The albedo is only *used* when there is no kit to paint the tile. It used to be drawn off the
 * same single random sequence as the height field, one loop, so that a clump of colour stood
 * exactly where a clump of relief did; there are no clumps in the relief any more and that
 * coupling has nothing left to mean, so the height field takes streams of its own below. The
 * consequence is that this sheet's marks shift a little, and nothing renders it: it is the
 * no-kit fallback, and the kit loads in the browser and in the visual harness alike. It is
 * drawn *pale* on purpose — that path is the old `deckTint: 'ground'` green and the setting's
 * ground colour used to multiply through it, and a mid-green grass sheet under a snow tint
 * comes out grey-green with no tint value that fixes it.
 */
function relief(size) {
  if (sheets) return sheets

  const albedo = canvas(size)
  const height = canvas(size)
  const a = albedo.ctx

  a.fillStyle = '#9aae7b'
  a.fillRect(0, 0, size, size)

  // Clumps of colour. Three per pixel of side is enough to break the flat field without
  // turning the whole sheet into noise at the distance a plot is actually looked at.
  const rand = mulberry(0x9ea55)
  for (let i = 0; i < size * 3; i++) {
    const x = rand() * size
    const y = rand() * size
    const r = (0.8 + rand() * 2.2) * (size / 256)
    const g = 150 + Math.round((rand() - 0.5) * 44)
    a.fillStyle = `rgba(${g - 30},${g + 18},${g - 52},0.5)`
    dot(a, x, y, r)
  }

  // Worn patches: a few pale scuffs where a village green would actually be walked bare, so
  // a plot is not one unbroken sheet of the same green.
  for (let i = 0; i < 6; i++) {
    a.fillStyle = 'rgba(190,170,110,0.18)'
    dot(a, rand() * size, rand() * size, (6 + rand() * 10) * (size / 256))
  }

  // The coarse lattice is used twice — as the swell's own first octave and as the direction
  // the blades on it lean — which is what makes a patch of turf lean with the ground under it
  // rather than across it.
  const flow = lattice(SWELL_CELLS, mulberry(0x81ade))
  drawSwell(height, flow, lattice(SWELL_FINE_CELLS, mulberry(0x5be11)), size)
  drawBlades(height, flow, mulberry(0x1eaf5), size)

  sheets = { albedo, normal: normalCanvas(height, RELIEF_STRENGTH) }
  return sheets
}

/**
 * The kerb that edges a plot: a low course of cobbles in the repo's colour.
 *
 * Same two-band layout the space kerb uses, and for the same reason — a box hands all six
 * faces the same UV square, so the cobbles are drawn once on the top band and every other
 * face is sent to a patch of plain colour further down the sheet.
 *
 * The emissive map is solid black. A village does not have runway lighting, so the accent
 * here is a colour rather than a light, and the kerb goes dark with everything else at dusk.
 */
export function kerbSurface(size = 128) {
  if (kerb) return kerb

  const h = size / 2
  const albedo = canvas(size, h)
  const glow = canvas(size, h)
  const height = canvas(size, h)
  const band = h / 2

  albedo.ctx.fillStyle = '#d8d3c6'
  albedo.ctx.fillRect(0, 0, size, h)
  glow.ctx.fillStyle = '#000000'
  glow.ctx.fillRect(0, 0, size, h)
  height.ctx.fillStyle = '#808080'
  height.ctx.fillRect(0, 0, size, h)

  // Cobbles across the top band, each a shade off its neighbour and each raised, so the
  // gaps between them cut a shadow line along the top of the kerb.
  const rand = mulberry(0x5701e)
  const stones = 7
  const pitch = size / stones
  for (let i = 0; i < stones; i++) {
    const w = pitch * (0.82 + rand() * 0.1)
    const x = i * pitch + (pitch - w) / 2
    albedo.ctx.fillStyle = `rgb(${205 + Math.round(rand() * 25)},${198 + Math.round(rand() * 20)},${180 + Math.round(rand() * 20)})`
    albedo.ctx.fillRect(x, band * 0.12, w, band * 0.76)
    height.ctx.fillStyle = '#c8c8c8'
    height.ctx.fillRect(x, band * 0.1, w, band * 0.8)
  }

  // The plain patch every face except the top points at: near-white, so the accent comes
  // through at full strength, and flat, so the normal map leaves the sides alone.
  albedo.ctx.fillStyle = '#e2ded2'
  albedo.ctx.fillRect(0, band, size, h - band)
  height.ctx.fillStyle = '#808080'
  height.ctx.fillRect(0, band, size, h - band)

  kerb = {
    map: texture(albedo.el, THREE.SRGBColorSpace),
    emissiveMap: texture(glow.el, THREE.SRGBColorSpace),
    normalMap: normalFrom(height, 1.0),
  }
  return kerb
}

/**
 * Where on the kerb texture a face should look, given which way it points.
 *
 * `top` is the cobbled band; everything else lands on the plain patch.
 */
export const KERB_UV = {
  top: { v0: 0.04, v1: 0.46 },
  side: { u: 0.5, v: 0.75 },
}

// ── drawing helpers ───────────────────────────────────────────────────────────────────

function canvas(w, h = w) {
  const el = document.createElement('canvas')
  el.width = w
  el.height = h
  return { el, ctx: el.getContext('2d', { willReadFrequently: true }) }
}

function dot(ctx, x, y, r) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function texture(el, colorSpace) {
  const t = new THREE.CanvasTexture(el)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.colorSpace = colorSpace
  t.anisotropy = 8
  return t
}

/** The same Sobel, as a texture. Everything but the deck wants one straight away. */
function normalFrom(src, strength) {
  return texture(normalCanvas(src, strength).el, THREE.NoColorSpace)
}

/**
 * Sobel a height field into a tangent-space normal map, on a canvas of its own.
 *
 * Sampling wraps at the edges, because a normal map whose borders do not agree puts a hard
 * seam down every tile boundary — which on a green built out of tiles is every seam there
 * is.
 *
 * The canvas rather than the texture, because the deck may need the same field twice on two
 * different UV channels and a `channel` belongs to a texture, not to the pixels.
 */
function normalCanvas({ ctx, el }, strength) {
  const w = el.width
  const h = el.height
  const src = ctx.getImageData(0, 0, w, h).data
  const out = ctx.createImageData(w, h)
  const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) - (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) - (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
      const nx = dx * strength
      const ny = dy * strength
      const len = Math.hypot(nx, ny, 1)
      const i = (y * w + x) * 4
      out.data[i] = ((nx / len) * 0.5 + 0.5) * 255
      out.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255
      out.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5
      out.data[i + 3] = 255
    }
  }

  const dest = canvas(w, h)
  dest.ctx.putImageData(out, 0, 0)
  return dest
}

/**
 * How far the kerb bar stands in from the tile's edge: the engine's own 0.05 gap, plus the
 * width of the chamfer at whatever radius the plot lattice is cut to.
 *
 * A function rather than a number because `surfaces()` runs at boot, long before
 * `configurePlots` has told anything here what a tile is — and the answer is a proportion of
 * the tile, not a fixed distance. At the engine's 7.5392 it comes to 0.377: the bevel, and
 * then the hair of daylight the kerb has always kept. Laid any further out the bar hangs over
 * the slope and the cobbles tilt; any further in and the plot reads as a rug on a table.
 */
export const kerbInset = (tile) => 0.05 + CHAMFER * (tile / TILE_RADIUS)

/** Surfaces hook: the pack's grass tile, and the stone kerb laid on its flat top. */
export function surfaces() {
  return {
    deck: deckSurface,
    kerb: kerbSurface,
    deckTextureScale: DECK_TEXTURE_SCALE,
    kerbUv: KERB_UV,
    // The tile arrives already the colour the pack painted it, and the seasons come with the
    // atlas rather than with a multiply — so all it takes is a light glaze of the repo's
    // accent, the way the space deck carries it, without turning the meadow into a rug.
    deckTint: 'glaze',
    deckGeometry,
    kerbInset,
  }
}

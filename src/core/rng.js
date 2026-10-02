/** mulberry32 — a tiny seeded PRNG. Everything placed deterministically in the colony uses it. */
export function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * One seeded stream per feature, so a system that is switched on spends its own draws and
 * never the page's `Math.random`, which the crew is seated from. Seeded from the name (FNV-1a),
 * so the stream is the same every run and different per feature.
 */
const streams = new Map()
export function featureRng(name) {
  let rng = streams.get(name)
  if (!rng) {
    let h = 0x811c9dc5
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193)
    rng = mulberry(h >>> 0)
    streams.set(name, rng)
  }
  return rng
}

/** Tests only: start every feature stream from its seed again. */
export function resetFeatureRngs() {
  streams.clear()
}

/**
 * Run `fn` with `Math.random` pointed at `rng`, synchronously, and put it back.
 *
 * This is for draws we cannot reach: three's `generateUUID` spends four `Math.random()` draws
 * on every geometry, material, texture and render target it constructs. A feature's allocations
 * wrapped in this leave the global stream exactly where it was. Synchronous only: work in a
 * promise continuation runs after the swap is undone and must wrap itself.
 */
export function isolated(rng, fn) {
  const prev = Math.random
  Math.random = rng
  try {
    return fn()
  } finally {
    Math.random = prev
  }
}

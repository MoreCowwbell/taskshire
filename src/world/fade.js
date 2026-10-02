/**
 * The ghost look, as one uniform per zone.
 *
 * A repo that has gone quiet fades toward leaving the map. The fade is a screen-door dither
 * rather than real transparency: a 4×4 Bayer threshold against `gl_FragCoord`, discarding a
 * growing share of a surface's pixels. That keeps depth sorting and shadows intact — the same
 * discard goes in the depth material — and works on any material without a second pass.
 *
 * At `uFade == 0` the threshold is 1.0 and no Bayer value reaches it, so a full-strength
 * zone draws the very same pixels it always did. That is what keeps the space baseline
 * frozen while every material in the colony carries this chunk.
 */

const DEFAULT_FLOOR = 0.25

/** The share of pixels a fully faded zone keeps. One value per boot; a theme switch reloads. */
export const fadeFloorUniform = { value: DEFAULT_FLOOR }

export function configureFade(spec) {
  fadeFloorUniform.value = typeof spec?.floor === 'number' ? spec.floor : DEFAULT_FLOOR
}

/**
 * Whether a ghost is drawn *as* a ghost — dithered thin and drained of its colour — or keeps
 * everything it had and is read as abandoned by what grows over it instead. Off by default
 * (2026-09-12, `feature/ghost-decay`): the owner's call is that a quiet repo should look
 * left alone rather than half-deleted, so the thinning is now something you ask for.
 */
let GHOSTS = false

/** Set by `main.js` at boot and by the colony whenever the setting is toggled. */
export function setFadeGhosts(on) {
  GHOSTS = Boolean(on)
}

/**
 * How much of a zone's fade the *look* is allowed to see.
 *
 * Two readers, and only these two: the Bayer discard's `uFade`, and the lerps toward
 * `GHOST_GREY` that drain a deck, a kerb and a roof's accent. With the setting off this is
 * flat 0, so every one of them writes exactly the value it wrote before the switch existed —
 * `ghostAmount(0) === 0` is what keeps a page with no ghost on it byte-identical.
 *
 * Everything else about a ghost still reads the *true* fade: the lights go out, the torches
 * stop guttering and the villagers are gone whatever this says, because those are facts about
 * the repo rather than a way of drawing it.
 */
export const ghostAmount = (fade) => (GHOSTS ? fade : 0)

/** `float botBayer( vec2 )` — the 4×4 ordered-dither threshold at a fragment, in (0, 1). */
export const BAYER_GLSL = `
         float botBayer( vec2 p ) {
           ivec2 c = ivec2( mod( p, 4.0 ) );
           const float m[16] = float[16](
             0.0, 8.0, 2.0, 10.0,
             12.0, 4.0, 14.0, 6.0,
             3.0, 11.0, 1.0, 9.0,
             15.0, 7.0, 13.0, 5.0 );
           return ( m[ c.x + c.y * 4 ] + 0.5 ) / 16.0;
         }`

/** The discard, as a line for any fragment shader that has `uFade` and `uFadeFloor` in scope. */
export const FADE_DISCARD = `if ( botBayer( gl_FragCoord.xy ) >= mix( 1.0, uFadeFloor, uFade ) ) discard;`

/**
 * Give any material the dither.
 *
 * Only the dither: lights-out lives with each material's own emissive chunk, where the terms
 * it has to reach are already in scope — the buildings in `decorate`, the clutter in
 * `decorateCellEmissive`.
 *
 * Composes with whatever `onBeforeCompile` the material already has, the way
 * `decorateCellEmissive` does, and extends the program cache key so a material with this
 * chunk never shares a program with one without.
 */
/**
 * Give a material a per-vertex *window*: the band of decay it is drawn in.
 *
 * The kerb clutter of a ghost town is three populations merged into one geometry — the props
 * the yard always had, the emptied twins that replace some of them, and what grows up through
 * the deck — and which of them is on screen depends on how far the zone has gone. A window per
 * vertex is what lets all three share one mesh and one draw call: `aReveal` is `(show, hide)`
 * and a fragment survives only while `uDecay` is inside it, so a crate's closed half hides at
 * the same instant its open half appears, with no rebuild and no second material.
 *
 * `(-1, 2)` is "always", since `uDecay` only ever runs 0..1 — which is what every part that
 * has nothing to do with the decay carries. A sapling is `(at, 2)` and the crate it replaces
 * `(-1, at)`, so at `uDecay == 0` exactly the original yard draws: `0 <= 0` discards every
 * prop whose window opens at zero, and the ramp goes up from there.
 *
 * The discard goes in the depth material too, or a ghost's shadows keep the shape of a yard
 * that is no longer standing. Composes over any existing `onBeforeCompile` and extends the
 * cache key, exactly as `decorateFade` does — the clutter material wears all three.
 *
 * (2026-09-12, `feature/ghost-decay`.)
 */
export function decorateReveal(material, decayUniform) {
  const prev = material.onBeforeCompile
  material.onBeforeCompile = (shader) => {
    prev?.(shader)
    shader.uniforms.uDecay = decayUniform
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec2 aReveal;
         varying vec2 vReveal;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vReveal = aReveal;`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uDecay;
         varying vec2 vReveal;`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         if ( uDecay <= vReveal.x || uDecay > vReveal.y ) discard;`
      )
  }
  const prevKey = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `${prevKey()}|reveal`
  return material
}

export function decorateFade(material, fadeUniform) {
  const prev = material.onBeforeCompile
  material.onBeforeCompile = (shader) => {
    prev?.(shader)
    shader.uniforms.uFade = fadeUniform
    shader.uniforms.uFadeFloor = fadeFloorUniform
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uFade;
         uniform float uFadeFloor;${BAYER_GLSL}`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         ${FADE_DISCARD}`
      )
  }
  const prevKey = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `${prevKey()}|fade`
  return material
}

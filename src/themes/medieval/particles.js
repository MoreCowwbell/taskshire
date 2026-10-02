import * as THREE from 'three'
import { mulberry } from '../../core/rng.js'

/**
 * Particle recipes for the medieval village: wood chips off a swung tool, boot dust in a
 * warmer key, festival confetti, the same sleep bubbles the colony has always had, and the
 * weather — snow in the mountains, fireflies everywhere else.
 *
 * Same contract as `src/themes/space/particles.js`: the pool and its two draw calls are the
 * engine's, and only what is thrown lives here.
 *
 * The ambient hook takes two arguments the space one never asked for: `lamps`, the world
 * positions of the kerb torches, and `night`, the sky's own night factor. Both are appended
 * to the call rather than folded into `setting`, so `space`'s three-parameter hook goes on
 * ignoring them and its pixels do not move. They are what let the fireflies and the torch
 * flicker come out after dark instead of drifting through the middle of the afternoon.
 *
 * Every throw here draws from the hook's own seeded stream rather than `Math.random`. The
 * snapshot harness replaces `Math.random` with one mulberry32 stream and hands the same one
 * to `generateUUID`, which takes four draws per geometry, material and texture — so adding a
 * single mesh to an early shot used to shift the weather in every shot after it, and a page
 * of baselines rewrote itself over a change that touched none of them. A private stream costs
 * the shared one nothing and pins the snow, embers, fireflies and chips to the frame number.
 * It pins only the weather: the crew is placed from the shared stream, upstream of here, so
 * where the villagers sit still moves when an earlier shot allocates. The seed being fixed
 * rather than drawn also means the live browser plays the same snowfall, the same embers and
 * the same fireflies on every load, which costs a village nothing: weather nobody is comparing
 * against a baseline only has to look like weather.
 */

/** Fresh-cut pine, roughly. Each chip shifts a little off this so a swing is not eight clones. */
const CHIP = new THREE.Color(0.72, 0.52, 0.3)

/** The village accent, its terracotta and its green — the same three the plots are painted from. */
const CONFETTI = [new THREE.Color(0xffc86a), new THREE.Color(0xa8452f), new THREE.Color(0x4f8a4a)]

/** Boot dust here is drier and warmer than a moon's: the tint is knocked this way per channel. */
const DUST_WARM = { r: 1.0, g: 0.95, b: 0.85 }

export function particles(pool) {
  const full = () => pool.settings.get('particles') === 'full'
  /** The weather's own draws — see the note above on why they are not `Math.random`'s. */
  const rand = mulberry(0x5eed)
  /**
   * The flicker's own clock, kept here rather than on the pool: `pool.ambientTimer` is the
   * weather's, and a village wants its torches guttering on a beat of their own regardless of
   * whether it is snowing.
   */
  let torchTimer = 0

  const fx = {
    /**
     * Chips off the tool: sawdust, splinters, a spray of soil under a shovel. Thrown from the
     * hands like the welding sparks were, but as dust rather than glow — a chip is matter and
     * should not light the wall behind it.
     */
    work(x, y, z, ground = 0) {
      if (!pool.enabled) return
      const n = full() ? 3 : 1
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2
        const s = 0.5 + rand() * 1.1
        const v = (rand() - 0.5) * 0.12
        pool.dust.spawn(
          x + (rand() - 0.5) * 0.18,
          y + (rand() - 0.5) * 0.12,
          z + (rand() - 0.5) * 0.18,
          Math.cos(a) * s,
          0.8 + rand(),
          Math.sin(a) * s,
          CHIP.r + v,
          CHIP.g + v,
          CHIP.b + v,
          0.05 + rand() * 0.04,
          0.4 + rand() * 0.4,
          1.4,
          2.2,
          ground
        )
      }
    },

    /** A puff kicked up by a boot — half the size of a spacesuit's and warmer with it. */
    step(x, y, z, tint, ground = 0) {
      if (!pool.enabled) return
      const a = rand() * Math.PI * 2
      pool.dust.spawn(
        x,
        y + 0.03,
        z,
        Math.cos(a) * 0.28,
        0.24 + rand() * 0.2,
        Math.sin(a) * 0.28,
        tint.r * DUST_WARM.r,
        tint.g * DUST_WARM.g,
        tint.b * DUST_WARM.b,
        0.06 + rand() * 0.07,
        0.5 + rand() * 0.4,
        2.4,
        0.12,
        ground
      )
    },

    /** Confetti for a finished thread, cycled through the village's three colours. */
    cheer(x, y, z, ground = 0) {
      if (!pool.enabled) return
      const n = full() ? 14 : 6
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2
        const s = 0.6 + rand() * 1.6
        const color = CONFETTI[i % CONFETTI.length]
        pool.glow.spawn(
          x,
          y + 0.8,
          z,
          Math.cos(a) * s,
          2.4 + rand() * 2.4,
          Math.sin(a) * s,
          color.r * (1.4 + rand()),
          color.g * (1.4 + rand()),
          color.b * (1.4 + rand()),
          0.07 + rand() * 0.07,
          1.1 + rand() * 0.9,
          0.7,
          0.8,
          ground
        )
      }
    },

    /** Sleepy `z` bubbles — the same ones, a nap is a nap. */
    snooze(x, y, z) {
      if (!pool.enabled) return
      pool.glow.spawn(x, y, z, 0.12, 0.42, 0.05, 0.55, 0.6, 1.1, 0.075, 1.9, 0.35, -0.02)
    },

    /**
     * One ember off a torch. The flame itself is geometry with an emissive cell — solid, and
     * therefore perfectly still — so what sells it as *burning* is a single mote lifting off
     * it and going out. Short-lived and barely moving: a plume would read as a chimney.
     *
     * `y` is the flame, not the ground, so the caller adds the torch's height.
     *
     * The colour is the other half of `FLAME` in `src/themes/medieval/torch.mjs` — the flame
     * is `FLAME.emissive` (`#ff8a2a`) at `FLAME.intensity` (1.6) on cell `FLAME.cell`, and
     * this mote is that swatch tuned by eye to sit on top of it. It is written out rather
     * than computed from `FLAME` because the two live in different colour spaces: the flame
     * is an sRGB swatch that three converts to linear working space, while these three go
     * straight into the pool's additive vertex colour. Converting `#ff8a2a` and scaling it by
     * 1.6 gives (1.6, 0.41, 0.04) — a mote far redder than the flame it comes off. So the
     * pairing is a tuned one, and moving `FLAME.emissive` means re-tuning these by eye.
     */
    torch(x, y, z) {
      if (!pool.enabled) return
      pool.glow.spawn(
        x + (rand() - 0.5) * 0.06,
        y,
        z + (rand() - 0.5) * 0.06,
        (rand() - 0.5) * 0.12,
        0.75 + rand() * 0.25,
        (rand() - 0.5) * 0.12,
        // FLAME.emissive at FLAME.intensity, warmed by eye — see the note above.
        1.6,
        0.78,
        0.22,
        0.05 + rand() * 0.03,
        0.4 + rand() * 0.15,
        1.2,
        -0.15
      )
    },

    /**
     * The weather, spawned in a ring around the camera so it is always where you are looking
     * without simulating the whole valley. Snow above the treeline; fireflies below it. And,
     * on its own clock, an ember off one of the kerb torches.
     *
     * @param {number} dt seconds since the last frame
     * @param {import('three').Camera} camera what the ring is spawned around
     * @param {object} setting the world's own settings entry; `dust` is the weather rate
     * @param {{x: number, y: number, z: number}[]} [lamps] world positions of the lit torches
     * @param {number} [night] the sky's night factor, 0 at noon and 1 after dark
     */
    ambient(dt, camera, setting, lamps, night = 0) {
      if (!pool.enabled) return

      // The torches. One ember at a time, over a torch picked at random, and only once the
      // light has gone — an ember against a bright sky is a speck, and the flame's own
      // emissive cell is doing the work by day anyway.
      if (lamps?.length && night > 0.25) {
        torchTimer -= dt
        if (torchTimer <= 0) {
          // An ember lives about half a second, so these are the intervals that keep one in
          // the air most of the time without ever making a plume of it.
          torchTimer = full() ? 0.4 : 0.8
          const lamp = lamps[Math.floor(rand() * lamps.length)]
          fx.torch(lamp.x, lamp.y, lamp.z)
        }
      }

      if (!setting.dust) return
      pool.ambientTimer -= dt
      if (pool.ambientTimer > 0) return

      const snow = setting.id === 'mountain'
      const rate = snow ? (full() ? 0.05 : 0.14) : full() ? 0.16 : 0.4
      pool.ambientTimer = rate / setting.dust

      const a = rand() * Math.PI * 2
      if (snow) {
        const r = 8 + rand() * 22
        pool.dust.spawn(
          camera.position.x + Math.cos(a) * r,
          6 + rand() * 6,
          camera.position.z + Math.sin(a) * r,
          (rand() - 0.5) * 0.4,
          -0.35,
          (rand() - 0.5) * 0.4,
          0.94,
          0.96,
          1.0,
          0.1 + rand() * 0.06,
          6 + rand() * 3,
          0.05,
          0.01
        )
        return
      }

      // Fireflies: near the ground, barely moving, and additive so they read as light. Now
      // that the hook is handed a night factor they keep the hours they should — out at dusk,
      // gone by mid-morning — rather than drifting through a bright afternoon as sparks.
      if (night <= 0.3) return
      const r = 6 + rand() * 20
      pool.glow.spawn(
        camera.position.x + Math.cos(a) * r,
        0.3 + rand() * 1.1,
        camera.position.z + Math.sin(a) * r,
        (rand() - 0.5) * 0.3,
        0.05 + rand() * 0.12,
        (rand() - 0.5) * 0.3,
        0.9,
        1.0,
        0.45,
        0.05,
        2 + rand() * 2,
        0.9,
        -0.01
      )
    },
  }

  return fx
}

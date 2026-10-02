import * as THREE from 'three'

/**
 * Particle recipes for the space colony: welding sparks, boot dust, confetti, sleep bubbles,
 * motes of light and each world's weather. The pool they draw from is the engine's; only what
 * is thrown is here.
 */

/**
 * The kinds of weather a world can ask for (upstream a1af059). `every` is seconds between
 * spawns at rate 1 on the full particle tier; `velocity` is [vx, vy, vz, horizontal jitter,
 * vertical jitter]; `gravity` is a share of GRAVITY, negative to rise; `glow` puts a kind in
 * the additive pool so it reads as light rather than matter.
 */
const WEATHER = {
  dust: { every: 0.045, height: [0.4, 5.4], velocity: [1.6, 0.1, 0.7, 1.4, 0], color: [0.78, 0.55, 0.4], size: [0.16, 0.24], life: [3, 6], drag: 0.12, gravity: 0.02 },
  sand: { every: 0.04, height: [0.2, 3.2], velocity: [2.4, 0.15, 0.4, 1.6, 0.1], color: [0.95, 0.8, 0.55], size: [0.12, 0.22], life: [2.5, 5], drag: 0.1, gravity: 0.03 },
  ash: { every: 0.06, height: [1, 7], velocity: [0.5, -0.1, 0.3, 0.8, 0.1], color: [0.45, 0.42, 0.4], size: [0.1, 0.2], life: [4, 8], drag: 0.15, gravity: 0.02 },
  pollen: { every: 0.09, height: [0.4, 4], velocity: [0, 0.2, 0, 0.5, 0.25], color: [0.85, 0.9, 0.55], size: [0.07, 0.11], life: [3, 6], drag: 0.12, gravity: -0.02 },
  petals: { every: 0.05, height: [2.5, 7], velocity: [0.7, -0.25, 0.3, 0.9, 0.2], color: [1.0, 0.7, 0.82], size: [0.13, 0.2], life: [5, 9], drag: 0.22, gravity: 0.06 },
  leaves: { every: 0.07, height: [2.5, 6.5], velocity: [0.8, -0.3, 0.2, 1.0, 0.25], color: [0.9, 0.45, 0.18], size: [0.14, 0.22], life: [4, 8], drag: 0.2, gravity: 0.08 },
  snow: { every: 0.03, height: [4, 9], velocity: [0.35, -0.55, 0.15, 0.6, 0.15], color: [1, 1, 1], size: [0.11, 0.18], life: [6, 11], drag: 0.05, gravity: 0.08 },
  spray: { every: 0.1, height: [0.1, 1.2], velocity: [0.3, 0.9, 0.2, 0.8, 0.4], color: [0.95, 0.98, 1.0], size: [0.1, 0.18], life: [1.2, 2.4], drag: 0.6, gravity: 0.25, overWater: true },
  embers: { every: 0.07, height: [0.1, 1.5], velocity: [0.2, 1.1, 0.1, 0.8, 0.5], color: [2.6, 1.1, 0.25], size: [0.06, 0.1], life: [2, 4.5], drag: 0.3, gravity: -0.04, glow: true },
  fireflies: { every: 0.12, height: [0.4, 2.2], velocity: [0, 0.05, 0, 0.5, 0.2], color: [1.6, 2.4, 0.7], size: [0.06, 0.09], life: [3, 6], drag: 0.6, gravity: -0.01, glow: true, nightOnly: true },
}
export function particles(pool) {
  const sparks = new THREE.Color(0x9fe8c0)
  const confetti = new THREE.Color(0xffc86a)
  const full = () => pool.settings.get('particles') === 'full'

  return {
    /** Welding sparks from an astronaut's hands. `ground` is what the welder is standing on. */
    work(x, y, z, ground = 0) {
      if (!pool.enabled) return
      const n = full() ? 3 : 1
      const color = sparks
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2
        const s = 0.9 + Math.random() * 2.4
        pool.glow.spawn(
          x + (Math.random() - 0.5) * 0.16,
          y + (Math.random() - 0.5) * 0.12,
          z + (Math.random() - 0.5) * 0.16,
          Math.cos(a) * s * 0.5,
          1.1 + Math.random() * 2.2,
          Math.sin(a) * s * 0.5,
          color.r * 2.4,
          color.g * 2.2,
          color.b * 1.6,
          0.055 + Math.random() * 0.05,
          0.35 + Math.random() * 0.5,
          1.6,
          1,
          ground
        )
      }
    },

    /** A puff kicked up by a boot. `ground` is the surface the boot landed on. */
    step(x, y, z, tint, ground = 0) {
      if (!pool.enabled) return
      const a = Math.random() * Math.PI * 2
      pool.dust.spawn(
        x,
        y + 0.03,
        z,
        Math.cos(a) * 0.28,
        0.24 + Math.random() * 0.2,
        Math.sin(a) * 0.28,
        tint.r,
        tint.g,
        tint.b,
        0.12 + Math.random() * 0.14,
        0.5 + Math.random() * 0.4,
        2.4,
        0.12,
        ground
      )
    },

    /** Confetti for a finished thread. `ground` is what the celebrating agent is standing on. */
    cheer(x, y, z, ground = 0) {
      if (!pool.enabled) return
      const n = full() ? 14 : 6
      const color = confetti
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2
        const s = 0.6 + Math.random() * 1.6
        pool.glow.spawn(
          x,
          y + 0.8,
          z,
          Math.cos(a) * s,
          2.4 + Math.random() * 2.4,
          Math.sin(a) * s,
          color.r * (1.4 + Math.random()),
          color.g * (1.4 + Math.random()),
          color.b * (1.4 + Math.random()),
          0.07 + Math.random() * 0.07,
          1.1 + Math.random() * 0.9,
          0.7,
          0.8,
          ground
        )
      }
    },

    /**
     * A mote of light: the slow glowing specks that hang around a lamp, a doorway, the
     * lander's beacon, or — on a living world after dark — the fireflies over the yard.
     */
    mote(x, y, z, color, size = 0.06, life = 4) {
      if (!pool.enabled) return
      const a = Math.random() * Math.PI * 2
      pool.glow.spawn(
        x,
        y,
        z,
        Math.cos(a) * 0.18,
        0.06 + Math.random() * 0.14,
        Math.sin(a) * 0.18,
        color.r,
        color.g,
        color.b,
        size * (0.7 + Math.random() * 0.6),
        life * (0.7 + Math.random() * 0.6),
        0.9,
        -0.006
      )
    },

    /** Sleepy `z` bubbles. */
    snooze(x, y, z) {
      if (!pool.enabled) return
      pool.glow.spawn(x, y, z, 0.12, 0.42, 0.05, 0.55, 0.6, 1.1, 0.075, 1.9, 0.35, -0.02)
    },

    /**
     * Weather — whatever this world has drifting through its air: dust on Mars, pollen and
     * fireflies on Terra, petals, snow, embers, sea spray (upstream a1af059). Spawned in a
     * ring around the camera so it is always where you are looking without simulating the
     * whole world. A setting lists the kinds it wants with a rate, and some only come out at
     * night; one with only the old `dust` number gets dust at that rate.
     *
     * `lamps` is the village's hook argument and is not read here; `groundAt(x, z)`, when the
     * colony hands it over, lets things that live near the ground hug it.
     */
    ambient(dt, camera, setting, lamps = null, night = 0, groundAt = null) {
      if (!pool.enabled) return
      const weather = setting.weather || (setting.dust ? [{ kind: 'dust', rate: setting.dust }] : null)
      if (!weather?.length) return
      const tiers = full() ? 1 : 0.42
      const timers = pool._weatherTimers || (pool._weatherTimers = new Map())

      for (const entry of weather) {
        const kind = WEATHER[entry.kind]
        if (!kind) continue
        // Fireflies only come out after dark; snow and the rest fall regardless.
        const strength = kind.nightOnly ? night * night : 1
        if (strength <= 0.02) continue
        let t = (timers.get(entry.kind) ?? 0) - dt
        if (t > 0) {
          timers.set(entry.kind, t)
          continue
        }
        timers.set(entry.kind, kind.every / (Math.max(0.01, entry.rate) * tiers * strength))

        const a = Math.random() * Math.PI * 2
        const r = 8 + Math.random() * 36
        const x = camera.position.x + Math.cos(a) * r
        const z = camera.position.z + Math.sin(a) * r
        const ground = groundAt ? groundAt(x, z) : 0
        // Things that live near the ground hug it; things that fall start high.
        const y = ground + kind.height[0] + Math.random() * (kind.height[1] - kind.height[0])
        const sea = setting.sea ?? setting.water
        if (kind.overWater !== undefined && groundAt && sea && sea.level !== undefined) {
          // Spray belongs over the sea; petals and snow do not care.
          const wet = ground < sea.level
          if (wet !== kind.overWater) continue
        }
        const target = kind.glow ? pool.glow : pool.dust
        const c = kind.color
        const v = kind.velocity
        target.spawn(
          x,
          y,
          z,
          v[0] + (Math.random() - 0.5) * v[3],
          v[1] + (Math.random() - 0.5) * v[4],
          v[2] + (Math.random() - 0.5) * v[3],
          c[0] * (0.9 + Math.random() * 0.2),
          c[1] * (0.9 + Math.random() * 0.2),
          c[2] * (0.9 + Math.random() * 0.2),
          kind.size[0] + Math.random() * (kind.size[1] - kind.size[0]),
          kind.life[0] + Math.random() * (kind.life[1] - kind.life[0]),
          kind.drag,
          kind.gravity,
          ground
        )
      }
    },
  }
}

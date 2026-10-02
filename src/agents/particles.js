import * as THREE from 'three'
import { curveInstalled, curveUniforms } from '../core/curve.js'

/**
 * The pool every little bit is thrown into — sparks, boot dust, confetti, weather haze. What
 * gets thrown is the theme's (`hooks.particles`); this file is only the machinery under it.
 *
 * One pool, two draw calls. Particles live in flat typed arrays and are swap-removed on
 * death, so the buffer stays contiguous and the GPU only ever sees the live prefix — no
 * per-particle objects, no allocation during play, and turning particles off in the
 * settings genuinely stops all of it rather than just hiding the result.
 */

const GRAVITY = -3.6

/** How far above whatever it landed on a particle settles, so it skitters on top of it. */
const SETTLE = 0.04

class Pool {
  constructor(capacity, blending) {
    this.capacity = capacity
    this.count = 0

    this.position = new Float32Array(capacity * 3)
    this.velocity = new Float32Array(capacity * 3)
    this.color = new Float32Array(capacity * 3)
    this.size = new Float32Array(capacity)
    this.life = new Float32Array(capacity) // remaining, in seconds
    this.maxLife = new Float32Array(capacity)
    this.drag = new Float32Array(capacity)
    this.gravity = new Float32Array(capacity)
    // Recorded per particle rather than assumed: a plot's deck is a raised slab, so the
    // height a spark bounces off depends entirely on where it was thrown from.
    this.floor = new Float32Array(capacity)
    this.alpha = new Float32Array(capacity)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.position, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.color, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1))
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1))
    geo.setDrawRange(0, 0)
    this.geometry = geo

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending,
      vertexColors: true,
      fog: true,
      // A theme with `curve` bends the world (`core/curve.js`); particles are authored in world
      // space, so the bend goes straight on the position. Anywhere the curve is not installed
      // the projection is the one these were always drawn with.
      uniforms: curveInstalled()
        ? { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 1 } }]), ...curveUniforms }
        : THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 1 } }]),
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          ${curveInstalled() ? 'vec4 mvPosition = viewMatrix * vec4( bcBend( position ), 1.0 );' : 'vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );'}
          // Perspective-correct point size, clamped so a particle right under the camera
          // cannot blow up into a full-screen quad.
          gl_PointSize = clamp( aSize * uScale * ( 260.0 / -mvPosition.z ), 1.0, 90.0 );
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length( d );
          if ( r > 0.5 ) discard;
          // Soft core with a fast falloff — reads as a spark rather than a disc.
          float a = pow( 1.0 - r * 2.0, 1.6 ) * vAlpha;
          gl_FragColor = vec4( vColor, a );
          #include <fog_fragment>
        }
      `,
    })

    this.points = new THREE.Points(geo, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
  }

  /** `ground` is the surface this particle was thrown off — a deck, or the terrain. */
  spawn(x, y, z, vx, vy, vz, r, g, b, size, life, drag = 1.2, gravity = 1, ground = 0) {
    // A full pool drops the newest particle rather than stalling or growing.
    if (this.count >= this.capacity) return false
    const i = this.count++
    const i3 = i * 3
    this.position[i3] = x
    this.position[i3 + 1] = y
    this.position[i3 + 2] = z
    this.velocity[i3] = vx
    this.velocity[i3 + 1] = vy
    this.velocity[i3 + 2] = vz
    this.color[i3] = r
    this.color[i3 + 1] = g
    this.color[i3 + 2] = b
    this.size[i] = size
    this.life[i] = life
    this.maxLife[i] = life
    this.drag[i] = drag
    this.gravity[i] = gravity
    this.floor[i] = ground + SETTLE
    this.alpha[i] = 1
    return true
  }

  update(dt) {
    const { position, velocity, life, maxLife, drag, gravity, floor, alpha } = this
    let i = 0
    while (i < this.count) {
      life[i] -= dt
      if (life[i] <= 0) {
        // Swap-remove: move the last live particle into this slot and shrink.
        const last = --this.count
        if (last !== i) {
          const a = i * 3
          const b = last * 3
          for (let k = 0; k < 3; k++) {
            position[a + k] = position[b + k]
            velocity[a + k] = velocity[b + k]
            this.color[a + k] = this.color[b + k]
          }
          this.size[i] = this.size[last]
          life[i] = life[last]
          maxLife[i] = maxLife[last]
          drag[i] = drag[last]
          gravity[i] = gravity[last]
          floor[i] = floor[last]
          alpha[i] = alpha[last]
        }
        continue // re-test the particle just swapped in
      }

      const i3 = i * 3
      const d = Math.max(0, 1 - drag[i] * dt)
      velocity[i3] *= d
      velocity[i3 + 1] = velocity[i3 + 1] * d + GRAVITY * gravity[i] * dt
      velocity[i3 + 2] *= d
      position[i3] += velocity[i3] * dt
      position[i3 + 1] += velocity[i3 + 1] * dt
      position[i3 + 2] += velocity[i3 + 2] * dt

      // Bounce once off the ground so sparks skitter instead of sinking through it. Against
      // the surface the particle came off, not against y=0 — sparks struck on a plot fall to
      // that plot's deck, and a fixed world floor would drop them through it.
      if (position[i3 + 1] < floor[i] && velocity[i3 + 1] < 0) {
        position[i3 + 1] = floor[i]
        velocity[i3 + 1] *= -0.32
        velocity[i3] *= 0.6
        velocity[i3 + 2] *= 0.6
      }

      const t = life[i] / maxLife[i]
      // Fade in fast, out slow — a linear fade reads as a pop.
      alpha[i] = t > 0.85 ? (1 - t) / 0.15 : t / 0.85
      i++
    }

    this.geometry.setDrawRange(0, this.count)
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.color.needsUpdate = true
    this.geometry.attributes.aSize.needsUpdate = true
    this.geometry.attributes.aAlpha.needsUpdate = true
  }

  clear() {
    this.count = 0
    this.geometry.setDrawRange(0, 0)
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}

export class Particles {
  constructor(scene, settings) {
    this.scene = scene
    this.settings = settings
    this.enabled = settings.particleBudget > 0

    const budget = Math.max(64, settings.particleBudget)
    // Sparks and confetti are additive so they read as light; dust is alpha-blended so it
    // reads as matter. That distinction is the whole reason there are two pools.
    this.glow = new Pool(Math.ceil(budget * 0.6), THREE.AdditiveBlending)
    this.dust = new Pool(Math.ceil(budget * 0.4), THREE.NormalBlending)
    scene.add(this.glow.points, this.dust.points)

    this.ambientTimer = 0
    this.setEnabled(this.enabled)
  }

  setEnabled(on) {
    this.enabled = on
    this.glow.points.visible = on
    this.dust.points.visible = on
    if (!on) {
      this.glow.clear()
      this.dust.clear()
    }
  }

  onSettingsChanged(changed) {
    if (changed.has('particles')) this.setEnabled(this.settings.particleBudget > 0)
  }

  update(dt) {
    if (!this.enabled) return
    this.glow.update(dt)
    this.dust.update(dt)
  }

  get liveCount() {
    return this.glow.count + this.dust.count
  }

  dispose() {
    this.scene.remove(this.glow.points, this.dust.points)
    this.glow.dispose()
    this.dust.dispose()
  }
}

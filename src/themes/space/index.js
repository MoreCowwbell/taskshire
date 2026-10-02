import { manifest } from './manifest.js'
import { ceremony } from './ship.js'
import { surfaces } from './surfaces.js'
import { faces } from './faces.js'
import { particles } from './particles.js'
import { props } from './props.js'

export default {
  id: 'space',
  name: 'Space colony',
  /**
   * Every engine system (`src/core/features.js`): upstream's water, wildlife, drones, meadow
   * grass, ambient audio, world curve, colour grade, contact occlusion and the overlay pass
   * (merged 2026-09-24 from d05ac2f), and the crew's faces, visors and phone check. His worlds'
   * landforms, tint and yard are world data, dressing and `plots.yard`, not features. A theme
   * gets only what it declares here; each system builds and draws on its own random stream, so
   * switching one on moves nobody seated from the global one.
   */
  features: {
    curve: true, grade: true, occlusion: true, overlay: true, clouds: true, grass: true,
    water: true, fauna: true, motes: true, sound: true,
    faces: true, visor: true, phoneCheck: true, recentre: true,
  },
  manifest,
  hooks: { ceremony, surfaces, faces, particles, props },
}

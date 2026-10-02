import { loadTheme as load, resolveThemeId as resolve, DEFAULT_THEME } from './registry.js'
import { validateManifest } from './schema.js'
import defaultTheme from './space/index.js'

/**
 * Every theme in the build: the name the settings panel shows, and a loader for
 * `src/themes/<id>/index.js`.
 *
 * The default is imported statically. `loadTheme` needs it on every path (it is the
 * fallback), so nothing is saved by fetching it, and `main.js` awaits this at module scope:
 * a network round trip there lands the first `pageshow` — and with it the engine's first
 * wake render — after the roster instead of before it, which moves every crew placement.
 *
 * Every other theme is lazy — its `index.js` pulls its hooks and with them three, and a
 * picker is not worth loading every theme in the build for. Which is why `name` is written
 * out here as a plain string instead of read off the module: the picker shows real names
 * without importing anything. Adding a theme is a directory *and* a line in this table.
 */
const THEMES = {
  [DEFAULT_THEME]: { name: defaultTheme.name, load: async () => ({ default: defaultTheme }) },
  medieval: { name: 'Medieval village', load: () => import('./medieval/index.js') },
}

const LOADERS = Object.fromEntries(Object.entries(THEMES).map(([id, t]) => [id, t.load]))

export const THEME_IDS = Object.keys(THEMES).sort((a, b) =>
  a === DEFAULT_THEME ? -1 : b === DEFAULT_THEME ? 1 : a.localeCompare(b)
)

/** What the settings panel calls each theme, without loading any of them. */
export const THEME_NAMES = Object.fromEntries(THEME_IDS.map((id) => [id, THEMES[id].name]))

export const resolveThemeId = (id) => resolve(id, THEME_IDS)

export const loadTheme = (id) => load(LOADERS, id, { baseUrl: import.meta.env.BASE_URL, validate: validateManifest })

export { menuSettingFor, menuSettings, settingFor } from './registry.js'

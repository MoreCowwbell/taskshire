/**
 * Theme resolution, kept free of Vite so it can be unit-tested under Node.
 *
 * A theme is `{ id, name, manifest, hooks }`. `loadTheme` validates the manifest, fills any
 * missing hook from the space theme, and never throws: a theme that fails to load falls back
 * to space with `fallbackReason` set, so the page can say why instead of going blank.
 *
 * A broken manifest usually fails a dozen checks at once. `fallbackReason` is therefore the
 * first failure, a count and the command that prints the rest — a line that fits in a toast;
 * `fallbackDetail` is the whole list, for the console.
 */

import { resolveFeatures } from '../core/features.js'

export const DEFAULT_THEME = 'space'
export const HOOK_NAMES = ['ceremony', 'surfaces', 'faces', 'particles', 'props']

export function resolveThemeId(id, ids) {
  return ids.includes(id) ? id : DEFAULT_THEME
}

/**
 * @param {Record<string, () => Promise<{default: object}>>} loaders  id → dynamic importer
 * @param {string} id
 * @param {{ baseUrl: string, validate: (manifest, features) => string[] }} opts
 */
export async function loadTheme(loaders, id, { baseUrl = '/', validate }) {
  const space = (await loaders[DEFAULT_THEME]()).default
  const wanted = resolveThemeId(id, Object.keys(loaders))
  let theme = space
  let fallbackReason = ''
  let fallbackDetail = ''
  if (wanted !== DEFAULT_THEME) {
    try {
      const candidate = (await loaders[wanted]()).default
      const errors = validate(candidate.manifest, candidate.features)
      if (errors.length) throw Object.assign(new Error(`${wanted}: ${errors[0]}`), { errors })
      // A misspelt feature would otherwise leave that system silently off.
      resolveFeatures(candidate.features)
      theme = candidate
    } catch (err) {
      const errors = err?.errors || []
      fallbackReason =
        errors.length > 1
          ? `${wanted}: ${errors[0]} (+${errors.length - 1} more; run npm run validate-kit ${wanted})`
          : err?.message || String(err)
      fallbackDetail = errors.length ? `${wanted}: ${errors.join('; ')}` : fallbackReason
      theme = space
    }
  } else if (id && id !== DEFAULT_THEME) {
    fallbackReason = `no theme named "${id}"`
    fallbackDetail = fallbackReason
  }
  const out = withDefaults(theme, space)
  const dir = out.manifest.assetDir || 'assets'
  out.assetUrl = (file) => `${baseUrl}${dir}/${file}`
  out.fallbackReason = fallbackReason
  out.fallbackDetail = fallbackDetail
  return out
}

/**
 * The hooks whose *result* the engine keeps calling: the ceremony every frame, the particle
 * recipes several times a frame per agent. Everything else — `surfaces`, `faces`, `props` —
 * is called once at build time, where the construction guard below is the whole story and
 * there is nothing sensible to hand back from a half-built mesh.
 */
const LIVE_HOOKS = new Set(['ceremony', 'particles'])

/**
 * Wrap every method of a live hook result so a throw cannot take the renderer with it.
 *
 * `engine._loop` has no try/catch — deliberately, because a per-frame catch hides the very
 * bug it swallows — so anything reached from it is one uncaught throw away from a frozen
 * canvas. A method that throws is logged once, with the hook and the method named, and is a
 * no-op for the rest of the session: a colony without its confetti, rather than a still
 * frame. Non-function properties (the ceremony's `group`, its `footRadius`) pass straight
 * through, and `this` stays the real object, so a class instance keeps its own state.
 *
 * @param {object} made    whatever the hook returned
 * @param {string} label   hook name, for the log
 * @param {(message: string) => void} report  says the same thing where the user can see it
 */
function guardMethods(made, label, report) {
  if (!made || typeof made !== 'object') return made
  const dead = new Set()
  const wrapped = new Map()
  return new Proxy(made, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (typeof value !== 'function') return value
      if (!wrapped.has(prop)) {
        wrapped.set(prop, (...args) => {
          if (dead.has(prop)) return undefined
          try {
            return value.apply(target, args)
          } catch (err) {
            dead.add(prop)
            console.warn(`theme hook "${label}": ${String(prop)}() threw and is disabled for this session`, err)
            report(`${label}.${String(prop)}() threw and is off for this session`)
            return undefined
          }
        })
      }
      return wrapped.get(prop)
    },
  })
}

/** Missing hooks come from space; a hook that throws is logged and replaced by the default. */
export function withDefaults(theme, space) {
  const hooks = {}
  // From the theme alone, never from space: a theme that declares no features gets none of
  // space's systems, where a missing hook is filled from space's.
  const out = { ...theme, hooks, features: resolveFeatures(theme.features), warnings: [] }
  // Said once on screen as well as in the console: a theme that silently falls back to the
  // space implementation looks like a theme that is half itself, and nobody knows why. `out`
  // is built first so this closes over the object the caller gets `onWarning` onto.
  const report = (message) => {
    // Once per message: the props hook is rebuilt on every crew-size change, and a hook that
    // throws would otherwise toast again each time the slider moves.
    if (out.warnings.includes(message)) return
    out.warnings.push(message)
    out.onWarning?.(message)
  }
  for (const name of HOOK_NAMES) {
    const own = theme.hooks?.[name]
    const fallback = space.hooks?.[name]
    const guard = LIVE_HOOKS.has(name) ? (made) => guardMethods(made, `${theme.id}.${name}`, report) : (made) => made
    if (!own) {
      hooks[name] = fallback && LIVE_HOOKS.has(name) ? (...args) => guard(fallback(...args)) : fallback
      continue
    }
    hooks[name] = (...args) => {
      try {
        return guard(own(...args))
      } catch (err) {
        console.error(`theme ${theme.id}: hook "${name}" threw, using default`, err)
        report(`hook "${name}" threw — using the space one`)
        return fallback ? guard(fallback(...args)) : undefined
      }
    }
  }
  return out
}

/**
 * The settings a person can pick: those on the theme's `menu`, else every listed setting. In
 * the list's own order, which is the picker's, so Tab steps through them as they are laid out.
 */
export function menuSettings(theme) {
  const list = theme.manifest.settings || []
  const menu = theme.manifest.menu
  return menu ? list.filter((s) => menu.includes(s.id)) : list
}

/** A setting from `list` by id, else the theme's `defaultWorld`, else the list's first. */
function pick(theme, list, id) {
  const byId = (want) => list.find((s) => s.id === want)
  return byId(id) || byId(theme.manifest.defaultWorld) || list[0]
}

/**
 * A listed setting by id, else the theme's `defaultWorld`, else its first. Any built world,
 * on the menu or not: the colony draws what it is asked to, and the snapshot harness asks for
 * worlds the menu hides. What a person can pick is `menuSettingFor`'s question.
 */
export function settingFor(theme, id) {
  return pick(theme, theme.manifest.settings || [], id)
}

/** A setting on the menu by id, else the theme's `defaultWorld`, else the menu's first. */
export function menuSettingFor(theme, id) {
  return pick(theme, menuSettings(theme), id)
}

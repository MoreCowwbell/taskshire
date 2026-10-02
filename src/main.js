import * as THREE from 'three'
import './ui/styles.css'
import { DEFAULT_PRESET, Settings, hasStoredSettings, relaysRoster, resumeChoice } from './core/settings.js'
import { Engine } from './core/engine.js'
import { CameraRig } from './core/camera.js'
import { Colony, STATUS_LABEL, STATUS_ORDER, isAsking, statusFor, transcriptProgress } from './game/colony.js'
import { countedStates } from './game/fate.js'
import { isHelperId } from './game/helpers.js'
import { nextArrivals, reconcileSeen } from './game/seen.js'
import { cdThen } from './game/shell-quote.js'
import { unseenWarnings } from './game/warnings.js'
import { Hud } from './ui/hud.js'
import { archiveRows } from './ui/hud-data.js'
import { loadTheme, menuSettingFor, menuSettings } from './themes/index.js'
import { configureKits, loadKit } from './world/kit.js'
import { configureBuildings } from './world/buildings.js'
import { configurePlots, setDeckGlaze, DECK_TOP, PLOT_CELL, hexToWorld, worldToHex } from './world/plots.js'
import { planMove } from './world/plot-move.js'
import { CURVE_FULL, bendPoint, installWorldCurve, setCurveView } from './core/curve.js'
import { configureFeatures } from './core/features.js'
import { featureRng, isolated } from './core/rng.js'
import { Ambience } from './audio/ambience.js'
import { pickPhrase } from './audio/sounds.js'
import { configureFade, setFadeGhosts } from './world/fade.js'
import { configureCrew, crewRig, loadCrew } from './agents/crew.js'
import { TIMES } from './world/sky.js'
import {
  fetchThreads,
  fetchState,
  saveState,
  fetchRecap,
  openThread,
  newSession,
  revealFolder,
} from './game/api.js'

/**
 * Boot and the outer game loop.
 *
 * The one interesting piece of orchestration here is the archive round trip. The harness
 * owns the session records; the colony owns nothing but its own list of what you archived,
 * and that list is written by exactly one writer — this page — so a save from a stale tab
 * can never silently drop an archive. Everything else is wiring.
 */

const POLL_MS = 15000
/** The side panel's groups, in the order they read: what is open, then what is behind it. */
const STATE_ORDER = ['active', 'idle', 'inactive', 'archived']
const app = document.getElementById('app')

app.insertAdjacentHTML(
  'beforeend',
  `<div class="boot"><div class="inner">
     <h1>Taskshire</h1>
     <p>Scanning for agent threads…</p>
     <div class="bar"><i></i></div>
   </div></div>`
)

const settings = new Settings()
// A phone gets the light preset the first time: a retina panel at full scale with bloom
// and shadows is more than its GPU wants to do at sixty, and the governor only ever finds
// that out by stuttering first.
const phoneLike = window.matchMedia('(max-width: 600px)').matches || (window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 900)
if (!hasStoredSettings()) settings.applyPreset(phoneLike ? 'low' : DEFAULT_PRESET)

// Resolved before anything is built: the colony and the HUD both read from it, and a
// theme that fails to load falls back to space rather than leaving a blank canvas.
const theme = await loadTheme(settings.get('theme'))
// The toast later on gets the one-line summary; the console gets every failure.
if (theme.fallbackReason) console.warn(`theme: ${theme.fallbackDetail || theme.fallbackReason} — using ${theme.name}`)
// A stored world off this theme's menu opens on its default, and the default is stored, so the
// picker highlights what is shown. Again after a colony file is adopted, which can name one.
// Only for the theme that was asked for: a fallback theme, or a colony file that has just
// switched theme and is reloading, would otherwise overwrite a world the real one shows.
const keepOnMenu = () => {
  if (theme.fallbackReason || settings.get('theme') !== theme.id) return
  const shown = menuSettingFor(theme, settings.get('setting'))
  if (shown) settings.set('setting', shown.id)
}
keepOnMenu()

// The kit registry, the per-cell surface tables and the crew spec are all manifest data, so
// they are installed before anything asks for a part. None of them waits on the GLBs.
// Before anything reads them: buildings, the sky and plots each ask for a feature when built.
configureFeatures(theme.features)
configureKits(theme.manifest.kits, theme.assetUrl)
configureBuildings(theme.manifest.buildings, theme.manifest.palette, theme.manifest.plots, theme.manifest.decay, {
  settings: theme.manifest.settings,
})
configureCrew(theme.manifest.crew, theme.assetUrl(theme.manifest.crew.file))
configurePlots(theme.manifest.plots, theme.hooks.surfaces(theme.manifest), theme.manifest.decay)
configureFade(theme.manifest.fade)
// How deep the ghost goes is the theme's; whether it is drawn at all is the user's. Set here
// rather than left to the first settings change, or a session that saved it on would boot
// with every zone at full colour until the toggle was touched.
setFadeGhosts(settings.get('fadeGhosts'))
// Likewise the zone tint: plots are built with whatever strength is set when they are.
setDeckGlaze(settings.get('deckGlaze'))

// The theme's own tokens, over the ones `styles.css` ships. The space theme writes back the
// same values it already declares, so this is a no-op for it and the whole of the swap for
// a theme with a different accent.
for (const [k, v] of Object.entries(theme.manifest.palette.css)) document.documentElement.style.setProperty(k, v)
// The one status label that is the theme's word rather than the engine's state.
STATUS_LABEL.celebrating = theme.manifest.copy.shipped

// Upstream's engine systems — the world curve, the colour grade, contact occlusion, the overlay
// pass, water, wildlife, the meadow and the sound — each run only where the theme declares that
// feature (`src/core/features.js`). The curve is patched into three's own shader chunks, so it
// has to go in before the first material compiles.
if (theme.features.curve) installWorldCurve()
const engine = new Engine(settings, { features: theme.features }).mount(app)
const rig = new CameraRig(engine.camera, engine.canvas, settings)
const colony = new Colony(engine.scene, settings, engine.camera, engine.renderer, theme)
engine.setPlanetGrade(colony.setting.grade)

let state = { archived: [], archivedAt: {}, hidden: [], pinned: [], forgotten: [], opened: [], plots: {}, seen: {}, viewedAt: {} }
let threads = []
/** Set once a poll has handed `applyThreads` a real scan; settings re-lay nothing before it (`relaysRoster`). */
let scanned = false
/** Threads this page has watched sitting closed, until they are back on the map — see `nextArrivals`. */
let closedHere = new Set()
/** Last legend built for the bottom bar, kept so the open zone's chip can light up between polls. */
let legendProjects = []
/** How many threads are in each state across the whole scan — the repo list's chip titles. */
let stateTotals = { active: 0, idle: 0, inactive: 0, archived: 0 }
/** Accents of repos hidden in this session, taken as they left the map — see `hideProject`. */
const hiddenAccents = new Map()
/** The zone layout as last written to the colony file, so an unchanged map is not re-saved. */
let lastLayout = ''
let selectedId = null
/** Which zone's sidebar is open. A repo, not a thread — they outlive the threads on them. */
let selectedProject = null
let hoverId = null
let statusCursor = 0
let pendingSave = 0
const hoverGround = new THREE.Vector3()
/**
 * Compact moves every zone on purpose and says so itself; it does not want one toast a zone.
 *
 * Belt and braces since the toast was narrowed to `colony.relocatedPlots`: `compactLayout`
 * forgets the layout outright, so every zone is re-seeded as a newcomer and the relocation
 * pass — which only ever picks up a zone that already had cells — cannot fire during a
 * Compact at all. Kept because "Compact raises no move toast" is the rule, not a thing to
 * re-derive from the allocator the next time either side of it changes.
 */
let suppressMoveToasts = false

/**
 * The same idea for the cleared list's own toast. Clearing the Hidden group lifts the hide,
 * so a repo in there with a thread still open is put back on the map by the very rebuild the
 * click triggers — and the rebuild would announce that as news. It is not news here: it is
 * half of what the click did, and `forgetProjects` says the whole of it in one sentence.
 */
let suppressWakeToast = false

// ── actions the HUD can trigger ────────────────────────────────────────────────────────

const actions = {
  /**
   * The HUD reports the space its panels leave, and a theme with `recentre` keeps the orbit target
   * centred in it (upstream 6344799). Anywhere else the framing stays the one the village has
   * always had — the permanent sidebar would otherwise slide every view half its width left.
   */
  viewportChanged: ({ width, height, right, bottom }) => {
    if (!theme.features.recentre) return
    rig.setViewportInsets(width, height, { right, bottom })
    engine.tiltShift?.setCamera(engine.camera)
  },

  resetView: () => {
    if (rig.following) select(null, {})
    rig.resetView()
  },

  screenshot: () => {
    // Render one more frame, then read the buffer before the compositor clears it — the
    // alternative is preserveDrawingBuffer, which costs a copy on every single frame.
    engine.renderFrame()
    const url = engine.canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = `taskshire-${theme.id}-${colony.setting.id}-${stamp()}.png`
    a.click()
    hud.toast('Screenshot saved')
  },

  /** Google Earth's auto-rotate: a slow sweep around whatever is centred. */
  toggleOrbit: () => {
    const on = rig.toggleOrbit()
    hud.hint(on ? 'Orbit mode on — drag or press O to stop' : 'Orbit mode off')
    return on
  },

  cycleSetting: () => {
    const list = menuSettings(theme)
    const i = list.findIndex((s) => s.id === settings.get('setting'))
    const next = list[(i + 1) % list.length]
    settings.set('setting', next.id)
    hud.hint(`${next.name} — ${next.blurb || ''}`)
  },

  cycleTime: () => {
    settings.set('autoTime', false)
    settings.set('clockTime', false)
    const current = settings.get('timeOfDay')
    // Step to the next named time *after* the current one, wrapping at midnight.
    const next = TIMES.find((t) => t.value > current + 0.005) || TIMES[0]
    settings.set('timeOfDay', next.value)
    hud.hint(next.label)
  },

  /** Fly to the next astronaut in a given state, cycling through them on repeat presses. */
  focusStatus: (status) => {
    const key = status === 'agents' ? null : status
    const pool = colony.astronauts.agents.filter((a) => (key ? a.status === key : true))
    if (!pool.length) {
      hud.hint(key ? `Nobody is ${(STATUS_LABEL[key] || key).toLowerCase()} right now` : theme.manifest.copy.empty)
      return
    }
    pool.sort((a, b) => a.id.localeCompare(b.id))
    const agent = pool[statusCursor++ % pool.length]
    select(agent.id, { fly: true })
  },

  focusProject: (name) => {
    const plot = colony.plots.get(name)
    if (!plot) return
    if (rig.following) select(null, {})
    rig.focus(plot.middle || plot.center, { distance: 30 })
  },

  /** The legend, and anything else that means "show me this repo". */
  pickProject: (name) => selectProject(name, { fly: true }),

  /** Back out of one repo to the list of all of them. The panel itself never leaves. */
  closeProject: () => {
    selectedProject = null
    select(null, {})
    syncProject()
  },

  select: (id) => select(id, {}),

  focusThread: (id) => select(id, { fly: true }),

  /**
   * A new thread in this repo, wherever the Resume opens setting says — nothing here is resumed,
   * and nothing is written to disk.
   *
   *   VS Code window → the window with this repo open, else a new one on its workspace or folder
   *   Desktop app    → an empty session in the harness's app, with the folder as its workspace
   *   Copy command   → the clipboard: the command that starts one from any terminal
   */
  newConversation: async (name = selectedProject) => {
    const folder = name && pathForProject(name)
    if (!folder) {
      hud.toast('No folder on disk for that project', 'err')
      return
    }
    const choice = resumeChoice(settings.get('resumeOpens'))
    if (choice === 'copy') {
      // Single-quoted for the shell the folder's shape implies, so nothing in its name expands.
      const command = cdThen(folder, harnessForProject(name) === 'codex' ? 'codex' : 'claude')
      if (await writeClipboard(command)) hud.toast(`Copied — paste in a terminal to start a thread in ${name}`)
      else hud.toast(command, 'err')
      return
    }
    try {
      const harness = harnessForProject(name)
      const res = await newSession(folder, harness, choice === 'ide' ? 'ide' : 'app')
      if (res.did === 'focused-ide') hud.toast(`${name} opened in ${res.ideName || 'your editor'} — start the thread in its terminal`)
      else hud.toast(`New thread in ${name} — opening ${harnessLabel(harness)}`)
      // It lands as an astronaut walking down the ramp, once it has a record to scan.
      setTimeout(poll, 6000)
    } catch (err) {
      hud.toast(err.message || 'Could not start a thread there', 'err')
    }
  },

  revealProject: async () => {
    const folder = selectedProject && pathForProject(selectedProject)
    if (!folder) return
    try {
      await revealFolder(folder)
    } catch (err) {
      hud.toast(err.message || 'Could not open that folder', 'err')
    }
  },

  /**
   * Stop a thread asking for you, without touching it.
   *
   * `unread` comes from the harness, and the harness only counts a thread as read when it is
   * focused *in its own app*. Answer one in a terminal, or read it over somebody's shoulder,
   * and it keeps its hand up forever. Marking it viewed here records when you looked; the
   * moment the thread does something newer than that it goes back to waving, which is the
   * behaviour you actually want and the reason this is a timestamp rather than a flag.
   */
  markViewed: (id = null) => {
    const thread = threads.find((t) => t.id === (id ?? selectedId))
    if (!thread) return
    state.viewedAt = { ...(state.viewedAt || {}), [thread.id]: Date.now() }
    queueSave()
    applyThreads(threads)
    hud.toast(`Marked ${thread.title.slice(0, 40)} as viewed`)
  },

  copyProjectPath: async () => {
    const folder = selectedProject && pathForProject(selectedProject)
    if (!folder) return
    try {
      await navigator.clipboard.writeText(folder)
      hud.toast('Path copied')
    } catch {
      // The async clipboard needs a permission this page does not always have — inside an
      // embedded preview, say. The old selection-based copy has no such gate.
      const copied = copyFallback(folder)
      hud.toast(copied ? 'Path copied' : 'Could not reach the clipboard', copied ? '' : 'err')
    }
  },

  // Both of these read the selection as a thread id. A helper id matches nothing in the
  // scan, so a selected subagent falls out here the same way an unknown id always did.
  // The card's Open/Resume button and the Enter key. One path now: the Resume opens setting
  // decides where the click goes, and `canOpen` only decides the word on the button.
  openThread: () => actions.resumeThread(selectedId),

  /**
   * Pick a thread back up, wherever the Resume opens setting says.
   *
   *   VS Code window → the window with this repo open (through its workspace file when it
   *                    came from one), else a new window on it, else the clipboard
   *   Desktop app    → the harness's own deep link, else a window, else the clipboard
   *   Copy command   → the clipboard, else a window, else the reason it could not
   *
   * The desktop app is never a fallback for the window choice: moving a thread into an app you
   * did not ask for is a bigger thing to do unasked than filling your clipboard. And
   * `claude://resume?session=` is never used at all — it imports the transcript and leaves you
   * with two copies of the same session.
   */
  resumeThread: async (id) => {
    const thread = threads.find((t) => t.id === id)
    if (!thread) return
    const choice = resumeChoice(settings.get('resumeOpens'))

    if (choice === 'copy' && thread.resume) return copyResume(thread)

    // Copied before the hand-over, not after: raising a window takes focus off this page, and a
    // page without focus may not write the clipboard. Only for a session that is not running —
    // one that is needs no command, its terminal is sitting in the window being raised.
    const running = stateOf(thread) === 'active' || stateOf(thread) === 'idle'
    // Nor when the desktop app is about to open the thread itself: that needs no command
    // either, and a clipboard quietly replaced is a cost with nothing bought.
    const toWindow = choice !== 'app' || !thread.canOpen
    const copied = toWindow && !running && thread.resume ? await writeClipboard(thread.resume) : false
    const failed = await handOver(thread, choice === 'app' ? 'app' : 'ide', copied)
    if (!failed) return
    if (thread.resume) return copyResume(thread, failed.live)
    hud.toast(failed.error, 'err')
  },

  /**
   * The whole resume command — `claude --resume <id>`, or the harness's own — ready to paste
   * into a terminal. Never the same thing as Resume: Resume may open a window, this only ever
   * copies, which is why the button is offered whenever the harness reported an id. The bare id
   * is the fallback for a harness that reported one without a command to wrap it in.
   */
  copyResumeCommand: async (id) => {
    const thread = threads.find((t) => t.id === id)
    const command = thread?.resume || thread?.sessionId
    if (!command) return
    if (await writeClipboard(command)) hud.toast('Resume command copied')
    else hud.toast(command, 'err')
  },

  /** The card's Archive button and the A key, which flip to Unarchive on an archived one. */
  archiveThread: () => {
    const thread = threads.find((t) => t.id === selectedId)
    if (!thread) return
    const archived = thread.archived || state.archived.includes(thread.id)
    return archived ? actions.unarchiveThread(thread.id) : actions.archiveThreadById(thread.id)
  },

  /**
   * Archiving is the colony's own bookkeeping and nothing else: the thread leaves the map and
   * the astronaut walks back to the ship. The harness's own records are never touched — see
   * `reconcileArchived` in server/api.mjs for why that stopped being worth doing.
   */
  archiveThreadById: (id) => {
    const thread = threads.find((t) => t.id === id)
    if (!thread) return
    state.archived = [...new Set([...state.archived, thread.id])]
    state.archivedAt = { ...state.archivedAt, [thread.id]: Date.now() }
    queueSave()
    if (selectedId === thread.id) select(null, {})
    applyThreads(threads)
    hud.toast('Archived — heading home')
    colony.ceremony.ping()
  },

  /**
   * Put one back. The colony's own list is the only thing that held it, so dropping it from
   * the list is the whole of unarchiving — nothing was ever written to the harness.
   */
  unarchiveThread: (id) => {
    const thread = threads.find((t) => t.id === id)
    if (!thread) return
    state.archived = state.archived.filter((x) => x !== id)
    const { [id]: _dropped, ...rest } = state.archivedAt
    state.archivedAt = rest
    queueSave()
    // The scan in hand was taken while the thread was still archived, and the server stamps
    // every thread it finds in that list. Clear it on our copy too, or the row does not move
    // until the next poll. A closed session is what an archived one nearly always is, and the
    // poll settles it.
    applyThreads(
      threads.map((t) => (t.id === id ? { ...t, archived: false, state: t.state === 'archived' ? 'inactive' : t.state } : t))
    )
    hud.toast('Unarchived')
  },

  /** The whole of a repo's closed history in one go, with one save behind it. */
  archiveAllInactive: (name) => {
    const archivedSet = new Set(state.archived)
    const list = threads.filter(
      (t) => t.project === name && t.state === 'inactive' && !t.archived && !archivedSet.has(t.id)
    )
    if (!list.length) {
      hud.toast('Nothing inactive to archive')
      return
    }
    const now = Date.now()
    state.archived = [...new Set([...state.archived, ...list.map((t) => t.id)])]
    state.archivedAt = { ...state.archivedAt, ...Object.fromEntries(list.map((t) => [t.id, now])) }
    queueSave()
    if (list.some((t) => t.id === selectedId)) select(null, {})
    applyThreads(threads)
    hud.toast(`Archived ${list.length} inactive thread${list.length === 1 ? '' : 's'} in ${name}`)
  },

  /** Never show this repo — or show it again. Hidden and pinned are exclusive. */
  hideProject: (name, on) => {
    if (!name) return
    // The plot is gone by the time the Hidden row is drawn — hiding is what removes it — so
    // its colour is taken now, while the zone is still standing, and kept for the row.
    if (on && colony.plots.has(name)) hiddenAccents.set(name, colony.plots.get(name).accent)
    state.hidden = on ? [...new Set([...state.hidden, name])] : state.hidden.filter((n) => n !== name)
    if (on) state.pinned = state.pinned.filter((n) => n !== name)
    // Showing it again clears every list that would keep it off the map, not just this one.
    // A repo can be on both: two tabs, one hiding the row while the other clears the group,
    // and the merge keeps both edits — after which lifting only the hide would leave the
    // toast saying it is back while `zoneFate` falls through to the cleared list and it is
    // nowhere at all, with no row anywhere to try again from.
    if (!on) state.forgotten = state.forgotten.filter((n) => n !== name)
    queueSave()
    if (on && selectedProject === name) actions.closeProject()
    applyThreads(threads)
    hud.toast(on ? `${name} hidden — it is under Hidden in the repo list` : `${name} is back on the map`)
  },

  /**
   * Clear a whole group of repos out of the sidebar: the Gone list, or the Hidden one.
   *
   * A first run scans every folder a coding agent has ever touched, and most of what comes
   * back is dead — experiments, one-afternoon repos, folders that no longer exist. Hiding
   * them one at a time only moves that pile into Hidden, and Hidden is meant to stay a short
   * list of deliberate choices. So a cleared repo goes on a third list that shows nowhere at
   * all, and `zoneFate` reads it after the wake rule: a dead folder never comes back, and one
   * that gets a thread again is on the map that same poll, off the list a moment later.
   *
   * Clearing therefore outranks both hand-kept lists, and drops the names from them.
   */
  forgetProjects: (names) => {
    const list = [...new Set((names || []).filter(Boolean))]
    if (!list.length) return
    const gone = new Set(list)
    state.forgotten = [...new Set([...state.forgotten, ...list])]
    state.hidden = state.hidden.filter((n) => !gone.has(n))
    state.pinned = state.pinned.filter((n) => !gone.has(n))
    for (const name of list) hiddenAccents.delete(name)
    queueSave()
    if (selectedProject && gone.has(selectedProject)) actions.closeProject()
    // The rebuild is what decides which of these were actually dead: anything with a thread
    // open is put straight back on the map and taken off the list again in the same pass. So
    // the toast is said after it, off what survived, rather than before it off what was asked
    // for — two sentences counting different things is how this reads as a failed click.
    suppressWakeToast = true
    applyThreads(threads)
    suppressWakeToast = false
    const cleared = list.filter((name) => state.forgotten.includes(name))
    const awake = list.length - cleared.length
    const back = `${awake} ${awake === 1 ? 'has a thread open and is' : 'have threads open and are'} back on the map`
    if (!cleared.length) hud.toast(back[0].toUpperCase() + back.slice(1))
    else if (awake) hud.toast(`Cleared ${cleared.length === 1 ? cleared[0] : `${cleared.length} repos`} — ${back}`)
    else if (cleared.length === 1) hud.toast(`Cleared ${cleared[0]} — it comes back if a thread opens there again`)
    else hud.toast(`Cleared ${cleared.length} repos — each comes back if a thread opens there again`)
  },

  /** Never fade this repo — or let it fade again. */
  pinProject: (name, on) => {
    if (!name) return
    state.pinned = on ? [...new Set([...state.pinned, name])] : state.pinned.filter((n) => n !== name)
    if (on) state.hidden = state.hidden.filter((n) => n !== name)
    queueSave()
    applyThreads(threads)
    hud.toast(on ? `${name} pinned — it will never fade` : `${name} unpinned`)
  },

  /**
   * Re-pack every zone toward the middle, once. The layout memory goes with it, so a repo
   * that left the map is not holding a hole open; `applyThreads` then lays the current
   * roster out from the spiral and saves the result the way any layout change is saved.
   */
  compactZones: () => {
    colony.compactLayout()
    suppressMoveToasts = true
    applyThreads(threads)
    suppressMoveToasts = false
    hud.toast('Zones packed toward the middle')
  },

  uiVisibility: (visible) => colony.setUiVisible(visible),

  // The card's bar is about the *thread*, not about how much of its building has risen —
  // those were the same number while construction was drawn by burying the structure.
  progressFor: (id) => {
    const thread = threads.find((t) => t.id === id)
    return thread ? transcriptProgress(thread) : 0
  },
}

const hud = new Hud(app, settings, actions, theme)
// Hooks that fell back before the HUD existed, then any that fall over later. A theme that is
// quietly half space is worse than one that says so.
for (const m of theme.warnings ?? []) hud.toast(`Theme ${theme.name}: ${m}`, 'err')
theme.onWarning = (m) => hud.toast(`Theme ${theme.name}: ${m}`, 'err')
/**
 * A world too small for the whole colony leaves some repos off the map and keeps their ground
 * for the next world with room (`Colony._keptLayout`). Said once, when a repo joins the list or
 * the world changes — never on every poll — and the names are on the toast's tooltip.
 */
colony.onUnplaced = (names, added) => {
  if (!added.length) return
  const n = names.length
  hud.toast(`No room for ${n} repo${n === 1 ? '' : 's'} on ${colony.setting.name}`, '', names.join(', '))
}

/**
 * Sound (upstream a1af059), where the theme has the `sound` feature: beds per world, things
 * calling out on their own clocks, and positional sources for whatever is actually making noise,
 * attenuated by distance from the camera. Null anywhere else, and every use below asks first.
 */
const ambience = theme.features.sound ? isolated(featureRng('sound'), () => new Ambience(settings)) : null
ambience?.setPlanet(colony.setting)
// `gain` is the keep bell's 0.9; the wildlife leaves it out and plays at the ambience's own 1.
if (ambience) colony.onSound = (name, x, y, z, gain) => ambience.play(name, { x, y, z, gain, kind: colony.fauna?.flock?.kind })

// ── selection ─────────────────────────────────────────────────────────────────────────

/**
 * Hand a thread back to its harness, the way the Resume opens setting asked for.
 *
 * The server does the two things that touch the OS — raise an editor window, or open the
 * harness's own app — and says which of them happened, so the toast is a fact rather than a
 * guess about a route with two possible outcomes behind it.
 *
 * Returns `''` when something happened, and the reason it did not otherwise: the caller owns
 * the rung below this one, which is the clipboard.
 */
async function handOver(thread, prefer, copied = false) {
  try {
    const res = await openThread(thread, prefer)
    colony.astronauts.celebrate(thread.id)
    if (res.did === 'focused-ide') {
      // `instead` is the server's reason the desktop app was asked for and a window opened.
      const opened = `${res.instead ? `${res.instead} — opened` : 'Opened'} in ${res.ideName || 'your editor'}`
      hud.toast(copied ? `${opened}. Resume command copied — paste in its terminal` : opened)
    } else if (res.did === 'ran-command') hud.toast('Resumed in a terminal')
    else hud.toast(`Opened in ${thread.harnessName || 'your harness'}`)
    // Opening is the thing that makes a thread no longer unread, so refresh shortly after.
    setTimeout(poll, 1800)
    return ''
  } catch (err) {
    // `live` is the server's, off the refusal itself: it re-read the live-session registry to
    // answer, and it is the only one of the two that can know a terminal is still attached to a
    // thread this page calls inactive.
    return { error: err.message || 'Could not open that thread', live: Boolean(err.body?.live) }
  }
}

/**
 * The clipboard rung: copy the command that reopens this thread in a terminal.
 *
 * A session whose process is still alive is copied all the same — the command is what you would
 * paste into a *new* terminal if you wanted a second one — but the toast says so, because
 * pasting it blind against a running session is how two agents end up appending to one
 * transcript. `live` is the server's own answer when it was asked; a thread whose state is
 * active or idle is live whether or not it was.
 */
async function copyResume(thread, live = false) {
  const running = live || stateOf(thread) === 'active' || stateOf(thread) === 'idle'
  const where = thread.project ? ` at ${thread.project}` : ''
  const said = running
    ? 'Copied — that session is already running in a terminal'
    : `Copied — paste in a terminal${where}`
  // If even the fallback is refused, the toast is the command itself, which you can at least
  // read and retype.
  if (await writeClipboard(thread.resume)) hud.toast(said)
  else hud.toast(thread.resume, 'err')
}

/** The async clipboard, then the selection-based copy it replaced. True when either took. */
async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return copyFallback(text)
  }
}

/**
 * The recap the server read for a thread, keyed on the thread id and the activity stamp it was
 * read at: a thread that has not moved costs nothing on the next poll, and one that has is read
 * again. Nothing here is persisted — a recap is transcript text, and it never reaches
 * `data/colony.json`.
 */
const recaps = new Map()

async function loadRecap(thread) {
  if (!thread) return
  const key = `${thread.id}@${thread.lastActivityAt || 0}`
  const held = recaps.get(thread.id)
  if (held?.key === key) return hud.setRecap(thread.id, held.recap)
  try {
    const { first, last } = await fetchRecap(thread)
    recaps.set(thread.id, { key, recap: { first, last } })
    hud.setRecap(thread.id, { first, last })
  } catch {
    // A transcript being written right now, or a harness with nothing to say. The line stays
    // hidden; there is nothing here for the user to do about it.
  }
}

/**
 * A thread's state as the *browser* sees it: the server's, with this page's own archive
 * list laid over it so a click takes effect now rather than at the next poll.
 */
const stateOf = (thread) => (thread.archived || state.archived.includes(thread.id) ? 'archived' : thread.state)
/** The same thread, with that overlay baked in — what the card and the list rows read. */
const asShown = (thread) => ({ ...thread, state: stateOf(thread) })

function select(id, { fly = false } = {}) {
  selectedId = id
  // A helper is a subagent standing on its parent's plot, not a thread: it has a character
  // and a card, and nothing else in this file will find it by id.
  if (isHelperId(id)) return selectHelper(id, fly)
  const agent = id ? colony.agentFor(id) : null
  const thread = id ? threads.find((t) => t.id === id) : null
  // Only a thread nobody has ever heard of puts everything down. A closed or archived one
  // has no character to fly to, but it still has a card.
  if (!agent && !thread) {
    selectedId = null
    rig.setFollow(null)
    colony.astronauts.setSelected(null)
    hud.setSelection(null, null)
    syncProject()
    return
  }
  if (!agent) {
    rig.setFollow(null)
    colony.astronauts.setSelected(null)
    hud.setSelection(null, asShown(thread))
    if (thread.project && colony.plots.has(thread.project)) selectedProject = thread.project
    syncProject()
    return
  }
  colony.astronauts.setSelected(agent)
  hud.setSelection(agent, asShown(thread || agent.thread))
  voice(agent)
  // Picking somebody is also picking the zone they are standing on: the sidebar follows.
  const home = thread || agent.thread
  if (home?.project && colony.plots.has(home.project)) selectedProject = home.project
  syncProject()
  if (fly) {
    rig.focus(new THREE.Vector3(agent.pos.x, 0, agent.pos.z), { distance: Math.min(rig.desiredDistance, 26) })
  }
  // Picking somebody is nearly always the start of watching them (upstream 908c9dc).
  rig.setFollow(settings.get('followSelected') ? agent : null)
}

let lastVoiced = null
let lastPhrase = -1
/**
 * It answers (upstream 9e09fc4): one of the theme's little phrases (`manifest.sounds.select`),
 * never twice in a row. Sound only. `pickPhrase` is the old pick for six, so the space colony
 * answers with the same phrase for the same draw.
 */
function voice(agent) {
  if (!ambience || agent.id === lastVoiced) return
  lastVoiced = agent.id
  const list = theme.manifest.sounds.select
  lastPhrase = pickPhrase(featureRng('sound')(), lastPhrase, list.length)
  ambience.play(list[lastPhrase], { x: agent.pos.x, y: agent.pos.y + 0.8, z: agent.pos.z, gain: 0.9 })
}

/**
 * The card for one of a thread's helpers. It follows its own character like any other, and
 * the sidebar still opens on the repo it is standing in — but the card carries the
 * subagent's name and brief rather than the thread's, and offers nothing to act on.
 */
function selectHelper(id, fly) {
  const entry = colony.helpers.get(id)
  const agent = colony.agentFor(id)
  if (!entry || !agent) {
    selectedId = null
    rig.setFollow(null)
    colony.astronauts.setSelected(null)
    hud.setSelection(null, null)
    syncProject()
    return
  }
  colony.astronauts.setSelected(agent)
  hud.setSelection(agent, asShown(entry.thread), entry.helper)
  if (entry.thread.project && colony.plots.has(entry.thread.project)) selectedProject = entry.thread.project
  syncProject()
  if (fly) {
    rig.focus(new THREE.Vector3(agent.pos.x, 0, agent.pos.z), { distance: Math.min(rig.desiredDistance, 26) })
  }
  rig.setFollow(settings.get('followSelected') ? agent : null)
}

/**
 * Open a zone's sidebar. Any selected astronaut from a different zone lets go — a helper
 * included, through the thread it is helping: a helper id is in no scan, so looking it up in
 * `threads` finds nothing, and the selection would survive into another repo's sidebar only
 * to drag it back to its own zone on the next poll.
 */
function selectProject(name, { fly = false } = {}) {
  if (!name || !colony.plots.has(name)) return
  selectedProject = name
  const current = isHelperId(selectedId)
    ? colony.helpers.get(selectedId)?.thread
    : threads.find((t) => t.id === selectedId)
  if (current && current.project !== name) select(null, {})
  else syncProject()
  if (fly) actions.focusProject(name)
}

/** The human name for a harness id — every thread already carries its own. */
function harnessLabel(id) {
  for (const thread of threads) {
    if (thread.harness === id && thread.harnessName) return thread.harnessName
  }
  return 'your harness'
}

/**
 * The threads a repo's folder and harness are read off. The whole scan rather than
 * `colony.threads`, which drops the archived ones: a repo whose every thread is archived still
 * has a folder on disk, and a new conversation there is the natural way back into it. Open and
 * closed threads win when there are any, so a pile of archived ones from before a repo moved
 * cannot outvote where it lives now.
 */
function threadsOfProject(name) {
  const mine = threads.filter((thread) => thread.project === name)
  const current = mine.filter((thread) => stateOf(thread) !== 'archived')
  return current.length ? current : mine
}

/**
 * Which harness a project's threads belong to, picked the same way its path is: the most
 * common answer among the threads standing there. A repo worked on from two harnesses gets
 * a new thread in whichever one it is mostly used from.
 */
function harnessForProject(name) {
  const counts = new Map()
  for (const thread of threadsOfProject(name)) {
    if (!thread.harness) continue
    counts.set(thread.harness, (counts.get(thread.harness) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [id, n] of counts) {
    if (n <= bestCount) continue
    best = id
    bestCount = n
  }
  return best
}

/**
 * The repo folder behind a zone. Plots are keyed by the folder's *name*, which is all the
 * colony needs to draw one — the path itself lives on the threads, so it is read back off
 * them, taking the most common answer if two checkouts somehow share a basename.
 */
function pathForProject(name) {
  const counts = new Map()
  for (const thread of threadsOfProject(name)) {
    const dir = thread.projectPath || thread.cwd
    if (!dir) continue
    counts.set(dir, (counts.get(dir) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [dir, n] of counts) {
    if (n <= bestCount) continue
    best = dir
    bestCount = n
  }
  return best
}

/** Push the open zone's current contents at the sidebar. Closes it if the zone is gone. */
function syncProject() {
  const plot = selectedProject ? colony.plots.get(selectedProject) : null
  if (!plot) {
    selectedProject = null
    hud.setProject(null)
    hud.setLegend(legendProjects, null, stateTotals)
    return
  }
  const now = Date.now()
  // Built from the whole scan rather than from `colony.threads`, which drops the archived
  // ones: the panel is the only place they exist, and the only way back out of the archive.
  const list = threads
    .filter((thread) => thread.project === plot.name)
    .map((thread) => {
      const shown = asShown(thread)
      return {
        id: shown.id,
        title: shown.title,
        worktree: shown.worktree,
        lastActivityAt: shown.lastActivityAt,
        status: statusFor(shown, now),
        state: shown.state,
        resume: shown.resume,
        canOpen: shown.canOpen,
        // Both are read by the action row: Viewed is only offered when there is something to
        // dismiss, and Copy resume command only when there is a command (or an id) to copy.
        asking: isAsking(shown),
        sessionId: shown.sessionId || '',
        // The helper count behind the row's `+N` chip.
        subagents: shown.subagents || [],
      }
    })
    // Open first, then history; within a group whoever wants something first, then most
    // recently touched — the same order of importance the badges use above their heads.
    .sort((a, b) => {
      const group = STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)
      if (group) return group
      const rank = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      return rank || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
    })

  const counts = { active: 0, idle: 0, inactive: 0, archived: 0 }
  for (const t of list) if (counts[t.state] !== undefined) counts[t.state]++

  hud.setProject({
    name: plot.name,
    accent: plot.accent,
    path: pathForProject(plot.name),
    threads: list,
    counts,
    selectedId,
    hidden: state.hidden.includes(plot.name),
    pinned: state.pinned.includes(plot.name),
  })
  // The legend is the same selection seen from the bottom of the screen: keep it in step
  // here rather than only on the next poll.
  hud.setLegend(legendProjects, selectedProject, stateTotals)
  // The selected thread's recap, read once per selection and once more whenever it moves on.
  loadRecap(threads.find((t) => t.id === selectedId))
}

// ── pointer ───────────────────────────────────────────────────────────────────────────

/**
 * Where an astronaut is on screen, in CSS pixels, or null if it is behind the camera.
 *
 * Measured off the engine's own viewport rather than the canvas's bounding rect: this runs
 * every frame for the selected agent, and a layout read per frame to learn a number that
 * only changes on resize is the kind of thing that quietly costs a HUD its smoothness.
 */
const cardAnchor = new THREE.Vector3()
function screenOf(agent) {
  // The card hangs off the shoulders, so the height follows the body's size (1 for a thread's
  // villager, half for a helper) — exact at 1, which keeps the frozen shots frozen.
  bendPoint(cardAnchor.set(agent.pos.x, agent.pos.y + 0.95 * agent.size, agent.pos.z)).project(engine.camera)
  if (cardAnchor.z > 1) return null
  const { w, h } = engine.viewport
  return { x: (cardAnchor.x * 0.5 + 0.5) * w, y: (-cardAnchor.y * 0.5 + 0.5) * h }
}

function ndc(e) {
  const rect = engine.canvas.getBoundingClientRect()
  return {
    x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
    y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    aspect: rect.width / rect.height,
  }
}

engine.canvas.addEventListener('pointermove', (e) => {
  // Mid-drag the cursor is the grab hand and nothing else: running a pick every move event
  // while the world is being dragged would flicker the hover ring across the whole colony.
  if (rig.interacting) {
    engine.canvas.style.cursor = rig._mode === 'orbit' ? 'move' : 'grabbing'
    return
  }
  const p = ndc(e)
  const agent = colony.pick(p.x, p.y, p.aspect)
  hoverId = agent?.id ?? null
  colony.astronauts.setHover(agent)
  // Pointing at a quiet plot is what makes its name appear.
  const plot = plotUnder(e, p)
  colony.setHoveredPlot(plot)
  // A plot is grabbable as well as clickable, so it gets the hand rather than the finger:
  // 'pointer' promised only a click and hid the hold-to-drag entirely (upstream 658cab1).
  engine.canvas.style.cursor = agent ? 'pointer' : 'grab'
})

/**
 * The zone under the cursor: its name plate first, then the deck itself. The plate is
 * hit-tested whether or not it is currently faded in — pointing at where a quiet project's
 * name would be is exactly what makes it appear.
 */
function plotUnder(e, p) {
  const label = colony.pickLabel(p.x, p.y)
  if (label) return label
  const ground = rig.groundPoint(e.clientX, e.clientY, hoverGround, { pick: true })
  return ground ? colony.plotAt(ground.x, ground.z) : null
}

// ── plot dragging (upstream 658cab1, 9c0fc54) ─────────────────────────────────────────

/**
 * Hold-to-lift, on the same press that would otherwise pan. The two gestures share a
 * button, and the split is time: move within the hold and it was a pan all along, keep
 * still and the plot under the pointer picks up. Everything mid-carry is cosmetic — a
 * y-offset and a ghost of the footprint — and the real move is one layout write plus one
 * roster pass on the drop, so a cancelled drag has nothing to unwind but visuals.
 *
 * Judged against this setting's own ground (`colony.dragGround()`): its arrival cell and every
 * cell it refuses a plot, not upstream's one fixed ship cell.
 */
const HOLD_MS = 250
/** How high a carried zone floats. Enough to read as "picked up", not enough to occlude. */
const LIFT_Y = 1.1
/** The carried zone's colours: the `working` green and the soft red the HUD reds a thread with. */
const GHOST_VALID = 0x7fd39a
const GHOST_INVALID = 0xe88b8b
/** The rim is the same hue lifted toward white, so the tile has an edge without a second colour. */
const GHOST_VALID_RIM = 0xcdf3de
const GHOST_INVALID_RIM = 0xffcfcf

const drag = {
  timer: 0, // pending long-press
  candidate: null, // repo name under the pressed pointer
  startX: 0,
  startY: 0,
  lifted: false,
  name: null,
  cells: null, // the zone's footprint at lift, root first
  grab: null, // which lattice cell the press landed on — the drag is relative to it
  dq: 0,
  dr: 0,
  valid: true,
  plan: null, // the layout a drop would apply, from planMove — null while the drop is illegal
  swallowClick: false,
  ghost: null, // { group, meshes, material, rim, geometry, inner }
  pendingThreads: null, // a poll that landed mid-carry, applied on the drop
}
const dragGround = new THREE.Vector3()

/**
 * A rounded hexagon, flat in XZ and in phase with the lattice: corners are quadratic arcs
 * through the true vertex, which keeps the flat-to-flat width exactly `radius * √3`.
 */
function roundedHexGeometry(radius, round) {
  const corner = (k) => {
    const a = Math.PI / 6 + (k * Math.PI) / 3
    return new THREE.Vector2(radius * Math.sin(a), radius * Math.cos(a))
  }
  const towards = (from, to, d) => from.clone().lerp(to, Math.min(d / from.distanceTo(to), 0.5))

  const shape = new THREE.Shape()
  for (let k = 0; k < 6; k++) {
    const prev = corner((k + 5) % 6)
    const here = corner(k)
    const next = corner((k + 1) % 6)
    const inbound = towards(here, prev, round)
    const outbound = towards(here, next, round)
    if (k === 0) shape.moveTo(inbound.x, inbound.y)
    else shape.lineTo(inbound.x, inbound.y)
    shape.quadraticCurveTo(here.x, here.y, outbound.x, outbound.y)
  }
  shape.closePath()

  const geo = new THREE.ShapeGeometry(shape, 6)
  geo.rotateX(-Math.PI / 2)
  return geo
}

/**
 * One tile per cell of the carried zone: a soft fill with a brighter rim sitting a hair above
 * it. Built on the lift, never before — every object three constructs spends seeded draws.
 */
function buildGhost(count) {
  const geometry = roundedHexGeometry(PLOT_CELL * 0.94, PLOT_CELL * 0.1)
  const inner = roundedHexGeometry(PLOT_CELL * 0.9, PLOT_CELL * 0.096)
  const material = new THREE.MeshBasicMaterial({ color: GHOST_VALID, transparent: true, opacity: 0.38, depthWrite: false })
  const rim = new THREE.MeshBasicMaterial({ color: GHOST_VALID_RIM, transparent: true, opacity: 0.85, depthWrite: false })
  const group = new THREE.Group()
  const meshes = []
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geometry, rim)
    const fill = new THREE.Mesh(inner, material)
    fill.position.y = 0.01
    mesh.add(fill)
    meshes.push(mesh)
    group.add(mesh)
  }
  engine.scene.add(group)
  drag.ghost = { group, meshes, material, rim, geometry, inner }
}

function placeGhost() {
  const { meshes } = drag.ghost
  drag.cells.forEach((c, i) => {
    const { x, z } = hexToWorld(c.q + drag.dq, c.r + drag.dr)
    // Just proud of the deck, which is itself proud of the roughest terrain.
    meshes[i].position.set(x, DECK_TOP + 0.12, z)
  })
  drag.ghost.material.color.setHex(drag.valid ? GHOST_VALID : GHOST_INVALID)
  drag.ghost.rim.color.setHex(drag.valid ? GHOST_VALID_RIM : GHOST_INVALID_RIM)
}

function disposeGhost() {
  if (!drag.ghost) return
  engine.scene.remove(drag.ghost.group)
  drag.ghost.geometry.dispose()
  drag.ghost.inner.dispose()
  drag.ghost.material.dispose()
  drag.ghost.rim.dispose()
  drag.ghost = null
}

function cancelHold() {
  clearTimeout(drag.timer)
  drag.timer = 0
  drag.candidate = null
}

function liftPlot() {
  drag.timer = 0
  const plot = colony.plots.get(drag.candidate)
  drag.candidate = null
  if (!plot) return // a poll rebuilt it out from under the hold — rare, and a lift of nothing
  drag.lifted = true
  drag.name = plot.name
  drag.cells = plot.cells
  // Relative to the cell the press landed on, not to the zone's root: snapping the root under
  // a cursor that grabbed the far corner would jump the zone half its width.
  const g = rig.groundPoint(drag.startX, drag.startY, dragGround, { pick: true })
  drag.grab = g ? worldToHex(g.x, g.z) : { ...plot.cells[0] }
  drag.dq = 0
  drag.dr = 0
  drag.valid = true
  drag.plan = null
  // The pan gesture is already live under this press; `suppressed` is its escape hatch, and
  // it self-clears on pointerup, so the rest of the press belongs to carrying the plot.
  rig.suppressed = true
  colony.setPlotLift(drag.name, LIFT_Y)
  buildGhost(drag.cells.length)
  placeGhost()
  engine.canvas.style.cursor = 'grabbing'
}

/**
 * Put the drag down, applying the move or not. Either way this ends in the standard "the map
 * changed under the same roster" re-entry: `applyThreads` re-runs the roster pass, whose
 * signature diff rebuilds the moved plot on its new ground and moves its villagers with it
 * (`movedPlots`), and whose layout diff writes the move to the colony file.
 */
function settleDrag(apply) {
  colony.setPlotLift(drag.name, 0)
  disposeGhost()
  if (apply && drag.plan) colony.applyLayout(drag.plan)
  const pending = drag.pendingThreads
  drag.lifted = false
  drag.pendingThreads = null
  drag.name = null
  drag.cells = null
  drag.grab = null
  drag.plan = null
  if (apply || pending) applyThreads(pending || threads)
  engine.canvas.style.cursor = 'grab'
}

engine.canvas.addEventListener('pointerdown', (e) => {
  if (drag.timer) cancelHold()
  if (drag.lifted) {
    // A second finger mid-carry is the start of a pinch, not a drop: put the zone back.
    settleDrag(false)
    drag.swallowClick = true
    return
  }
  // The camera reads these modifiers as "tilt and rotate" — that press is never a lift.
  if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return
  const p = ndc(e)
  if (colony.pick(p.x, p.y, p.aspect)) return // a press on an astronaut is a selection
  const plot = plotUnder(e, p)
  if (!plot) return
  drag.candidate = plot.name
  drag.startX = e.clientX
  drag.startY = e.clientY
  drag.timer = setTimeout(liftPlot, HOLD_MS)
})

// On window, like the camera's own listeners: a carry does not end at the canvas edge.
window.addEventListener('pointermove', (e) => {
  // The same 6px the camera's `wasClick` uses: past it this press was a pan all along.
  if (drag.timer && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) cancelHold()
  if (!drag.lifted) return
  if (!rig.groundPoint(e.clientX, e.clientY, dragGround, { pick: true })) return
  const cell = worldToHex(dragGround.x, dragGround.z)
  const dq = cell.q - drag.grab.q
  const dr = cell.r - drag.grab.r
  if (dq === drag.dq && dr === drag.dr) return
  drag.dq = dq
  drag.dr = dr
  // The plan, not just a yes/no: a drop that strands a zone is allowed, and what comes back
  // says where everything ends up.
  drag.plan = planMove(colony.visibleLayout(), drag.name, dq, dr, colony.dragGround())
  drag.valid = Boolean(drag.plan)
  placeGhost()
})

window.addEventListener('pointerup', () => {
  if (drag.timer) cancelHold()
  if (drag.lifted) settleDrag(drag.valid && (drag.dq !== 0 || drag.dr !== 0))
  // Cleared after the canvas's own pointerup has run — bubbling order is what lets the
  // click handler still see it.
  drag.swallowClick = false
})

window.addEventListener('pointercancel', () => {
  if (drag.timer) cancelHold()
  if (drag.lifted) settleDrag(false)
})

// Pressing on an astronaut used to suppress the camera, on the theory that grabbing one
// should not also drag the world out from under it. But nothing is draggable *about* an
// astronaut — a press is only ever the start of a selection or the start of a pan — so all
// that suppression did was make the ground refuse to move whenever a drag happened to begin
// on top of somebody. Selection is decided on release instead, where `wasClick` already
// distinguishes a click from a drag.
engine.canvas.addEventListener('pointerup', (e) => {
  // A release that ends a lift is the end of a carry, not a click — even an unmoved one:
  // long-pressing a plot and thinking better of it should not also open its sidebar.
  if (e.button !== 0 || !rig.wasClick || drag.lifted || drag.swallowClick) return
  const p = ndc(e)
  const agent = colony.pick(p.x, p.y, p.aspect)
  if (agent) {
    select(agent.id, {})
    return
  }
  // Nobody there: whoever was selected is put down first, whatever else the click lands on
  // — a deck of the same repo used to keep the card up (upstream db4d6ab). Then a zone's deck
  // or its name plate opens that repo's sidebar, and bare ground closes that too.
  if (selectedId) select(null, {})
  const plot = plotUnder(e, p)
  if (plot) selectProject(plot.name, {})
  else actions.closeProject()
})

engine.canvas.addEventListener('pointerleave', () => {
  hoverId = null
  colony.astronauts.setHover(null)
  colony.setHoveredPlot(null)
})

// ── keyboard ──────────────────────────────────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  // Never steal keys from a field the user is actually typing in.
  const t = e.target
  if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return
  // Enter on a focused button is that button's own activation, which the browser fires
  // *after* this handler — so the shortcut has to step aside or an eye pressed from the
  // keyboard would also open whichever thread happens to be selected.
  if (e.key === 'Enter' && t instanceof HTMLButtonElement) return

  // ⌘\ (⌃\ elsewhere) dismisses the chrome, the same as H — the shortcut every editor
  // uses for its sidebar, and the one hand that is already on the keyboard.
  if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
    e.preventDefault()
    hud.toggleUi()
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return

  switch (e.key) {
    case 'h':
    case 'H':
      hud.toggleUi()
      break
    case 's':
    case 'S':
      hud.toggleSettings()
      break
    case 'n':
    case 'N':
      actions.focusStatus('waiting')
      break
    case 'p':
    case 'P':
      actions.screenshot()
      break
    case 'l':
    case 'L':
      actions.cycleTime()
      break
    case 'o':
    case 'O':
      hud.setOrbit(actions.toggleOrbit())
      break
    case 'Tab':
      e.preventDefault()
      actions.cycleSetting()
      break
    case '0':
      actions.resetView()
      hud.setOrbit(false)
      break
    // Both of these act on the selected *thread*. A selected helper is a subagent, which has
    // neither a session to open nor anything to archive, so they pass it by.
    case 'Enter':
      if (selectedId && !isHelperId(selectedId)) actions.openThread()
      break
    case 'a':
    case 'A':
      if (selectedId && !isHelperId(selectedId)) actions.archiveThread()
      break
    case 'v':
    case 'V':
      if (selectedId) actions.markViewed()
      break
    case 'c':
    case 'C':
      if (selectedProject) actions.newConversation()
      break
    case '?':
      hud.toggleHelp()
      break
    // Arrow keys nudge the view and +/- zoom, the same as Earth's keyboard.
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight': {
      e.preventDefault()
      const step = rig.distance * 0.09
      const forward = new THREE.Vector3(Math.sin(rig.azimuth), 0, Math.cos(rig.azimuth))
      const right = new THREE.Vector3(forward.z, 0, -forward.x)
      if (e.key === 'ArrowUp') rig.desiredTarget.addScaledVector(forward, -step)
      if (e.key === 'ArrowDown') rig.desiredTarget.addScaledVector(forward, step)
      if (e.key === 'ArrowLeft') rig.desiredTarget.addScaledVector(right, -step)
      if (e.key === 'ArrowRight') rig.desiredTarget.addScaledVector(right, step)
      rig._clampTarget()
      rig.idleFor = 0
      break
    }
    case '+':
    case '=':
      rig.desiredDistance = Math.max(4, rig.desiredDistance * 0.82)
      break
    case '-':
    case '_':
      rig.desiredDistance = Math.min(150, rig.desiredDistance * 1.22)
      break
    // Sound on or off, on a theme that has any.
    case 'm':
    case 'M':
      if (!ambience) break
      settings.set('sound', !settings.get('sound'))
      hud.hint(settings.get('sound') ? 'Sound on' : 'Muted')
      break
    // One step at a time, outward: the drag in hand, the thread, then the zone it belongs to.
    case 'Escape':
      if (drag.lifted || drag.timer) {
        cancelHold()
        if (drag.lifted) {
          settleDrag(false)
          // The pointer is still down; the release that follows ends a dead gesture.
          drag.swallowClick = true
        }
      } else if (document.querySelector('.help.open')) hud.toggleHelp(false)
      else if (selectedId) select(null, {})
      else if (selectedProject) actions.closeProject()
      break
  }
})

// ── data ──────────────────────────────────────────────────────────────────────────────

function applyThreads(list) {
  // Parked while a plot is in hand. A sibling that grew a thread still rebuilds, and any rebuild
  // pass disposes whichever plots changed — mid-carry that can tear the lifted group down under
  // the drag's own hands. Polls are 15 s apart and a drag is seconds; the scan waits.
  if (drag.lifted) {
    drag.pendingThreads = list
    return
  }
  // A thread you have said you looked at stops asking for you — unread or idle — until it moves
  // on again. Done here rather than in `statusFor` so the card, the badge and the astronaut
  // all agree.
  const viewed = state.viewedAt || {}
  threads = list.map((t) => {
    const at = viewed[t.id]
    return at && t.lastActivityAt <= at ? { ...t, unread: false, viewed: true } : t
  })
  list = threads
  const archivedSet = new Set(state.archived)
  // Which threads the colony has met before. Walking out of the ship is meant to *mean*
  // something — a thread that just appeared — and without this every reload staged a
  // hundred-astronaut entrance, which piled up at the ramp and read as a bug because it was
  // one. A thread already on the books is simply already outside.
  //
  // But "met before" is only the right question for a thread that has been open all along. A
  // closed session is on the books too, and resuming it must be an entrance, not a pop onto its
  // tile — see `nextArrivals`.
  const open = []
  const closed = []
  for (const t of list) {
    const st = stateOf(t)
    if (st === 'active' || st === 'idle') open.push(t.id)
    else closed.push(t.id)
  }
  const arrivals = nextArrivals(closedHere, {
    open,
    closed,
    seen: new Set(Object.keys(state.seen || {})),
    hasVillager: (id) => Boolean(colony.agentFor(id)),
  })
  closedHere = arrivals.closedHere
  const known = arrivals.known
  // `seen` is read *before* the reconcile, because the reconcile is also where a thread first
  // seen this poll gets its row — asking afterwards would make every thread already known and
  // nobody would ever walk out again.
  //
  // The same pass forgets a thread no scan has carried for `hideDays`: the list here is the
  // whole scan, so anything still on disk is present, and anything absent that long is a
  // transcript somebody deleted. It normally changes nothing at all — a stamp is refreshed at
  // most once a day — so a quiet poll still queues no save.
  const reconciled = reconcileSeen(state.seen, list.map((t) => t.id), {
    now: Date.now(),
    hideDays: settings.get('hideDays'),
  })
  if (reconciled.changed) {
    state.seen = reconciled.seen
    queueSave()
  }

  const stats = colony.setThreads(
    list,
    archivedSet,
    { hidden: state.hidden, pinned: state.pinned, forgotten: state.forgotten },
    known
  )
  hud.setStats(stats)
  if (ambience) chimeForNewWaiting(list, archivedSet)

  // A repo you cleared comes back the moment somebody opens a thread in it again — that is
  // the promise that makes Clear all safe to press on forty rows at once. `zoneFate` has
  // already made the call; this only writes it down, so the name stops costing anything.
  const woken = state.forgotten.filter((name) => colony.fates.get(name)?.show)
  // And the other way off the list: the folder itself is gone. A cleared repo whose
  // transcripts are later deleted leaves the scan for good and would otherwise sit in the
  // colony file forever — the same reasoning `reconcileSeen` prunes a `seen` row on, and the
  // reason this is the only list here that could grow without a ceiling. Guarded on the scan
  // having found anything at all, because a poll that came back empty is a scan that failed,
  // and undoing somebody's cleanup on the strength of one bad answer is the worse mistake.
  const scanned = new Set(list.map((t) => t.project || 'unknown'))
  const vanished = list.length ? state.forgotten.filter((name) => !scanned.has(name)) : []
  if (woken.length || vanished.length) {
    const off = new Set([...woken, ...vanished])
    state.forgotten = state.forgotten.filter((name) => !off.has(name))
    queueSave()
  }
  // Only the repos that came back are worth saying out loud: a zone appearing on the map with
  // no cause on screen is the confusing half. A folder that left the machine is not news.
  if (woken.length && !suppressWakeToast) {
    hud.toast(
      woken.length === 1
        ? `${woken[0]} is back on the map — it has a thread again`
        : `${woken.length} cleared repos are back on the map — they have threads again`
    )
  }
  // A recap is only worth holding for a thread that still exists.
  for (const id of recaps.keys()) if (!threads.some((t) => t.id === id)) recaps.delete(id)

  // The chip counts what the plot actually holds — the states the Zone size settings
  // count — so the number next to a repo and the ground it is standing on agree.
  const counted = countedStates(settings)

  stateTotals = { active: 0, idle: 0, inactive: 0, archived: 0 }
  for (const t of list) {
    const st = stateOf(t)
    if (stateTotals[st] !== undefined) stateTotals[st]++
  }

  legendProjects = colony.plotOrder
    .map((plot) => {
      const fate = colony.fates.get(plot.name)
      return {
        name: plot.name,
        accent: plot.accent,
        count: list.filter((t) => t.project === plot.name && counted.has(stateOf(t))).length,
        urgent: colony.urgentPlots?.has(plot.id) ?? false,
        fade: fate?.fade ?? 0,
        age: fate?.age ?? 0,
        pinned: state.pinned.includes(plot.name),
      }
    })
    .sort((a, b) => b.count - a.count)
  // A repo hidden in this session keeps the colour it had; one hidden before the reload has
  // no plot to ask and draws a neutral swatch.
  hud.setHidden(state.hidden.map((name) => ({ name, accent: hiddenAccents.get(name) ?? null })))
  // Repos that aged out: still in the scan, not on the map, not yet hidden.
  hud.setGone(
    [...colony.fates]
      .filter(([name, fate]) => !fate.show && !state.hidden.includes(name) && !state.forgotten.includes(name))
      .map(([name, fate]) => ({ name, age: fate.age, hasFolder: Boolean(pathForProject(name)) }))
      .sort((a, b) => a.age - b.age)
  )
  // Every archived thread, across every repo — the one place to see what was put away, and to
  // put it back, without first finding the repo it lives in.
  hud.setArchive(
    archiveRows(list.map(asShown), state.archivedAt).map((r) => ({
      ...r,
      accent: colony.plots.get(r.project)?.accent ?? null,
    }))
  )

  // Keep the card honest if the thread it is showing changed underneath it. A thread whose
  // session has just closed loses its character but keeps its card, docked. A helper whose
  // subagent has finished has nothing left to show at all, so it lets go.
  if (isHelperId(selectedId)) {
    if (colony.helpers.has(selectedId)) select(selectedId, {})
    else select(null, {})
  } else if (selectedId) {
    const still = colony.agentFor(selectedId)
    const shown = list.find((t) => t.id === selectedId)
    if (still) hud.setSelection(still, asShown(shown || still.thread))
    else if (shown) hud.setSelection(null, asShown(shown))
    else select(null, {})
  }
  // Which also repaints the legend, so the open zone's chip is lit by the same pass.
  syncProject()

  // Zones only move when their own footprint changes, and when one does the colony file
  // learns about it — so the map you built up a memory of survives a reload.
  const layout = colony.layoutForSave()
  const signature = JSON.stringify(layout)
  if (signature !== lastLayout) {
    lastLayout = signature
    state.plots = layout
    queueSave()
  }

  // A zone that ran out of ground moved itself. Unannounced rearrangement is the one thing a
  // map must not do quietly, so say it once — the way Compact does for the whole colony.
  //
  // `relocatedPlots`, not `movedPlots`: plenty of other things move a zone's root tile, and all
  // of them are things the user just did. A setting whose coast blocks the ground under a zone,
  // a Zone size lowered until a zone is re-dealt, a Compact — a toast naming a zone that "moved
  // to open ground" after any of those is a sentence the user cannot connect to a cause.
  const moved = [...colony.relocatedPlots]
  if (!suppressMoveToasts && moved.length) {
    hud.toast(moved.length === 1 ? `${moved[0]} moved to open ground` : `${moved.length} zones moved to open ground`)
  }
}

/**
 * The one sound that is allowed to interrupt (upstream fc8e115): a thread that has just put its
 * hand up. Once per thread per wait, never on the first roster (a reload is not news), and never
 * more than one chime a couple of seconds apart however many arrive at once. `sound` only.
 */
const waitingBefore = new Set()
let seenFirstRoster = false
let lastChime = 0
function chimeForNewWaiting(list, archivedSet) {
  const now = Date.now()
  const waiting = new Set()
  for (const t of list) {
    if (archivedSet.has(t.id) || state.hidden.includes(t.project)) continue
    if (statusFor(t, now) === 'waiting') waiting.add(t.id)
  }
  if (seenFirstRoster) {
    for (const id of waiting) {
      if (waitingBefore.has(id) || now - lastChime < 2500) continue
      lastChime = now
      const agent = colony.agentFor(id)
      ambience.play(theme.manifest.sounds.attention, agent ? { x: agent.pos.x, y: agent.pos.y + 1, z: agent.pos.z, gain: 0.9 } : { gain: 0.9 })
    }
  }
  seenFirstRoster = true
  waitingBefore.clear()
  for (const id of waiting) waitingBefore.add(id)
}

let polling = false
/**
 * What the scan has already complained about. Module-level and never cleared, so a harness
 * that cannot read its own store says so once rather than once every fifteen seconds.
 */
const shownWarnings = new Set()
async function poll() {
  if (polling) return
  polling = true
  try {
    const res = await fetchThreads()
    applyThreads(res.threads || [])
    scanned = true
    // After the roster, not before: a harness that contributed nothing is worth explaining
    // once the colony it is missing from is on screen. An older server sends no `warnings`
    // at all, which is simply an empty list.
    for (const message of unseenWarnings(res.warnings, shownWarnings)) hud.toast(message, 'err')
    // Anything this scan set in motion that has not landed — today, the ghost dressing's kit
    // and the pass over the plots that follows it. Awaited here so a poll is finished when it
    // says it is: the screenshot harness calls this one with the clock paused and needs every
    // allocation the roster caused to have happened before it starts counting frames.
    await colony.settled()
    hud.removeBoot()
  } catch (err) {
    hud.toast(err.message || 'Could not reach the thread scanner', 'err')
    hud.removeBoot()
  } finally {
    polling = false
  }
}

function queueSave() {
  clearTimeout(pendingSave)
  pendingSave = setTimeout(async () => {
    try {
      // Adopt whatever comes back: unchanged when the save was clean, and the merged colony when
      // another tab had written since this one loaded. Dropping it would leave this page
      // asserting a picture the file has already moved past, and the next save would fight.
      state = await saveState(state)
    } catch {
      /* the colony still runs; only the archive list is at risk, and it retries next time */
    }
  }, 500)
}

async function boot() {
  // The model kit and the crew rig both have to be in hand before the first roster arrives:
  // buildings and the ground scatter are assembled out of the kit synchronously the moment
  // a thread shows up, and the crew's body mesh is built from the rig. Fetched alongside
  // the saved state rather than after it, since none of them waits on the others.
  const settle = (p) => p.then(() => null, (err) => err)
  const [, kitError, crewError] = await Promise.all([
    fetchState()
      .then((s) => {
        // Merged onto the defaults rather than assigned: a server process from before the
        // two lists returns neither, and the legend code indexes both.
        state = {
          ...state,
          ...s,
          hidden: Array.isArray(s.hidden) ? s.hidden : [],
          pinned: Array.isArray(s.pinned) ? s.pinned : [],
          forgotten: Array.isArray(s.forgotten) ? s.forgotten : [],
        }
        // Before the first roster: zones come back to the ground they were on last time.
        colony.restoreLayout(state.plots)
        // And the settings, but only for a browser that has none of its own — an explicit
        // choice made here always outranks the file.
        if (!hasStoredSettings() && state.settings) {
          settings.applyAll(state.settings)
          keepOnMenu()
        }
      })
      .catch(() => {
        // Not "first run, or the file is gone": the server answers a missing file with an empty
        // state rather than an error, so a rejection means it could not be reached and we do not
        // know what is on disk. Saves stay off for this session and say so (upstream 83f98ec).
        hud.toast('Could not read the saved colony — archiving is off until you reload', 'err')
      }),
    settle(loadKit()),
    settle(loadCrew()),
  ])
  if (kitError || crewError) {
    hud.toast('Could not load the model assets — run `npm run assets`', 'err')
    console.error(kitError || crewError)
  }
  colony.astronauts.setRig(crewRig())
  if (!kitError) colony.onAssetsReady()

  await poll()
  if (theme.fallbackReason) hud.toast(`Theme unavailable: ${theme.fallbackReason}. Showing ${theme.name}.`, 'err')
  setInterval(() => poll(), POLL_MS)
  window.addEventListener('focus', () => poll())
  // A tab that was hidden for an hour should catch up the moment it comes back.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll()
  })

  if (!localStorage.getItem('botcrossing.seen-help')) {
    hud.toggleHelp(true)
    localStorage.setItem('botcrossing.seen-help', '1')
  } else {
    hud.hint(theme.manifest.copy.welcome, 5200)
  }
}

// ── settings plumbing ─────────────────────────────────────────────────────────────────

settings.onChange((changed, scope) => {
  // A theme swap changes what every module was constructed with, so it comes back through
  // a reload rather than by tearing the colony down in place.
  if (changed.has('theme')) {
    settings.flush()
    location.reload()
    return
  }
  // Kept in the colony file as well as in this browser's own storage. `localStorage` is
  // per *origin*, so a dev server that comes back on a different port looks to the browser
  // like a different site and hands you factory settings — the file does not care.
  state.settings = { ...settings.values }
  queueSave()
  if (scope.render || changed.has('fov')) engine.applySettings()
  colony.onSettingsChanged(changed, scope)
  if (changed.has('setting')) {
    engine.setPlanetGrade(colony.setting.grade)
    ambience?.setPlanet(colony.setting)
  }
  if (changed.has('followSelected')) rig.setFollow(settings.get('followSelected') ? colony.agentFor(selectedId) : null)
  if (changed.has('showFps')) hud.syncSettings()
  // The two day sliders keep their order: dragging one across the other drags the other.
  if (changed.has('fadeDays') && settings.get('hideDays') <= settings.get('fadeDays')) {
    settings.set('hideDays', settings.get('fadeDays') + 1)
  }
  if (changed.has('hideDays') && settings.get('hideDays') <= settings.get('fadeDays')) {
    settings.set('fadeDays', settings.get('hideDays') - 1)
  }
  // Zone size is neither a world nor a render key: nothing is rebuilt, the roster is simply
  // laid out again against the new rules. So is a new world, at once rather than on the next
  // poll: its ground may refuse cells the last one dealt, and a repo with no room here is named
  // when the world changes, not up to a poll later. Nothing before the first scan, though: the
  // colony file's settings arrive at boot while the roster is still empty.
  if (relaysRoster(changed, scope, { scanned })) applyThreads(threads)
})

// ── frame ─────────────────────────────────────────────────────────────────────────────

engine.add({
  update(dt, elapsed) {
    rig.setFollow(settings.get('followSelected') ? colony.agentFor(selectedId) : null)
    rig.update(dt)
    // The world bends away from wherever the camera is looking, every frame, before the
    // colony projects anything to the screen (where the theme has the curve).
    if (theme.features.curve) setCurveView(rig.target, rig.azimuth, settings.get('worldCurve') * CURVE_FULL)
    colony.update(dt, elapsed, rig.target)
    // Whatever the camera is orbiting is what should be in focus.
    engine.setFocusDistance(rig.distance)

    if (selectedId) {
      // A selected astronaut that walked off the roster should not keep a stale card open —
      // unless its thread is still in the scan, in which case the card simply docks.
      const agent = colony.agentFor(selectedId)
      if (agent) {
        hud.updateAvatar(colony.astronauts.faceTexture.image, colony.astronauts.faces)
        hud.placeCard(screenOf(agent))
      } else if (!threads.some((t) => t.id === selectedId)) {
        select(null, {})
      }
    }
    hud.setFps(engine.perf, engine.viewport, `${colony.astronauts.visibleCount} crew · ${colony.particles.liveCount} bits`)
    if (ambience) ambience.update(dt, engine.camera, colony.soundWorld(rig.target))
  },
})

engine.start()
boot()

// Handy for poking at the running colony from the console, and what the smoke and probe
// harnesses read — both of which run on the Vite dev server, so it exists there only. A
// production build has no business handing every script on the page the engine, the settings
// and the thread list.
if (import.meta.env.DEV) {
  window.botCrossing = { engine, rig, colony, settings, hud, ambience, poll, get threads() { return threads } }
}

/** `execCommand('copy')` over a throwaway textarea — the copy that predates permissions. */
function copyFallback(text) {
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.cssText = 'position:fixed;top:0;opacity:0;pointer-events:none'
  document.body.appendChild(el)
  el.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  el.remove()
  return ok
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

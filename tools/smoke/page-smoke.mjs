/**
 * A page smoke: boot the real page on each theme and click through everything the sidebar
 * and the card offer.
 *
 * `npm test` never loads `src/main.js`, and the visual harness never clicks anything — it
 * drives `poll()` and `settings.set` and reads the canvas. So an undeclared identifier in
 * `syncProject` passed the whole suite and eight identical shots (2026-09-12). This is the
 * driver that caught it, kept: one process, one page per theme, every action the HUD offers,
 * and a failure on any page error.
 *
 * What it is not: a pixel test (the visual harness's job — nothing here reads the canvas),
 * a server test (`/api/*` is answered in the browser, so `apiMiddleware` never runs), or a
 * timing test (the real clock runs, so nothing here asserts where a villager stands).
 *
 * Two layers keep it off the real colony file. Every `/api/**` call is answered by a route
 * inside the browser, exactly as `snapshot.mjs` does it; and `BOT_CROSSING_DATA` is pointed
 * at a fresh temp directory before Vite loads `server/api.mjs`, which resolves its data
 * directory at import — so a route that ever missed could still not touch `data/colony.json`.
 * The temp directory is asserted empty at exit.
 *
 * The clock is real. `queueSave` (500 ms), the toasts and `removeBoot` all run on timers, and
 * a paused clock would stall every assertion. The fixture's timestamps are absolute at `NOW`,
 * so the whole roster is slid forward by `Date.now() - NOW` and the ghost ages stay as
 * authored — the same trick the ghost-decay driver used.
 *
 *   node tools/smoke/page-smoke.mjs [--only <theme>]
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

/**
 * Before anything that can reach `server/api.mjs`: it reads `BOT_CROSSING_DATA` once, at
 * import, and it is imported by `vite.config.js` — which `createServer` loads, so the read
 * happens partway down this file rather than at the top of it. Set here, at the top of the
 * module, so there is no ordering to get wrong later.
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'bot-crossing-smoke-'))
process.env.BOT_CROSSING_DATA = DATA_DIR

const { chromium } = await import('playwright')
const { createServer } = await import('vite')
const { FIXTURE_THREADS, FIXTURE_GHOST_THREADS, FIXTURE_HELPER_THREADS, FIXTURE_STATE, FIXTURE_SETTINGS, HELPER_PARENT, HELPER_REPO, NOW } =
  await import('../visual/fixture.mjs')
const { settingsLayout, panelContext } = await import('../../src/ui/hud-data.js')
const { loadTheme } = await import('../../src/themes/registry.js')

/**
 * The Settings panel each theme should build, worked out here in Node from the same layout and
 * theme the page reads, so the page is checked against the list rather than against itself.
 */
const THEME_LOADERS = {
  space: () => import('../../src/themes/space/index.js'),
  medieval: () => import('../../src/themes/medieval/index.js'),
}
async function panelFor(theme) {
  const t = await loadTheme(THEME_LOADERS, theme, { baseUrl: '/', validate: () => [] })
  return settingsLayout(panelContext(t)).map((g) => ({ id: g.id, open: g.open, keys: [...g.rows, ...(g.zoneSize || [])] }))
}

const VIEWPORT = { width: 1280, height: 800 }
/** The harness's own boot number. */
const BOOT_MS = 120_000
/** A roster is served and polled for until the page is holding it. */
const ROSTER_MS = 60_000
/** One DOM expectation. Everything here is a class flip or a re-render, not a load. */
const DOM_MS = 5_000
/**
 * `queueSave` debounces 500 ms; this is that with room for a slow round trip, and for a
 * software-rendered village page whose timers wait behind half-second frames. Two seconds lost
 * that race under full-run load ("mark viewed", 2026-09-26; clearing the Gone group,
 * 2026-09-30). `put` stops as soon as the save lands; the one step that sleeps it out, to
 * show a save did not happen, is only made stricter by the longer wait.
 */
const SAVE_MS = 5_000
/** A toast is appended synchronously by the action that raises it. */
const TOAST_MS = 1_000
/**
 * One panel slide, counted in frames rather than in the 240 ms of CSS. The slide runs on the
 * compositor, and until the compositor reports it started, the page holds the panel at its
 * first frame. Under SwiftShader a village frame takes 0.5–1.1 s, and that hold lasts two to
 * four of them.
 */
const SLIDE_MS = 10_000

/** The themes, in the order the pages are booted. Each is one page and one boot. */
const THEMES = ['space', 'medieval']

const onlyAt = process.argv.indexOf('--only')
const only = onlyAt >= 0 ? process.argv[onlyAt + 1] : null
if (onlyAt >= 0 && (!only || only.startsWith('--'))) {
  console.error('usage: page-smoke.mjs [--only <theme>]')
  process.exit(2)
}
if (only && !THEMES.includes(only)) {
  console.error(`unknown theme "${only}" — one of ${THEMES.join(', ')}`)
  process.exit(2)
}
const themes = THEMES.filter((t) => !only || t === only)

/**
 * The fixture is authored against a pinned `NOW`; real time is running here, so the whole
 * roster is slid forward by however far today is past it. "delta is nine days quiet" then
 * stays true without a fake clock.
 */
const SHIFT = Date.now() - NOW
const slide = (t) => ({
  ...t,
  createdAt: t.createdAt + SHIFT,
  lastActivityAt: t.lastActivityAt + SHIFT,
  lastFocusedAt: t.lastFocusedAt + SHIFT,
})
const ROSTERS = {
  base: FIXTURE_THREADS.map(slide),
  ghost: FIXTURE_GHOST_THREADS.map(slide),
  helpers: FIXTURE_HELPER_THREADS.map(slide),
}

/** A list field from a PUT body, for predicates that must not throw on a server without it. */
const asArray = (v) => (Array.isArray(v) ? v : [])

/**
 * Everything the HUD is showing, in one round trip. Printed under any failed expectation,
 * because "the DOM never got there" is not a diagnosis and this is.
 */
const SNAP = () => {
  const q = (s) => document.querySelector(s)
  const side = q('.side')
  const card = q('.thread-pop')
  return {
    drilled: side ? side.classList.contains('drilled') : null,
    shifted: side ? side.classList.contains('shifted') : null,
    name: q('.side .name') ? q('.side .name').textContent : null,
    head: q('.side .threads-head') ? q('.side .threads-head').textContent : null,
    repos: [...document.querySelectorAll('.projects > .repo')].map((r) => r.dataset.name),
    threads: [...document.querySelectorAll('.side .threads .thread')].map((r) => `${r.dataset.id}[${r.className}]`),
    groups: [...document.querySelectorAll('.side .threads details.thread-group')].map((d) => d.dataset.group),
    card: card ? card.className : null,
    title: q('.thread-pop .title') ? q('.thread-pop .title').textContent : null,
    settings: q('.settings') ? q('.settings').className : null,
    toasts: [...document.querySelectorAll('.toasts .toast')].map((t) => t.textContent),
    hudHidden: q('.hud') ? q('.hud').classList.contains('hidden') : null,
  }
}

/**
 * A port nobody else is expecting, asked of the OS and handed back before Vite takes it.
 *
 * Not `port: 0`, which is what this file used to pass and which does not mean "any free port"
 * to Vite: it reads a falsy port as no port and falls back to its default, 5173 — the port
 * `npm run dev` serves the game on. So whenever nothing else held 5173, the smoke's server
 * stood exactly where a person's own browser expects the game to be. A tab left open on it
 * after `npm run dev` was stopped keeps its Vite client pinging `/` every second; the moment
 * the smoke answered, that tab reloaded, booted against the smoke's server — a real browser,
 * outside Playwright, so none of the routes below applied to it — read the empty temp colony
 * and saved it back, and the data-directory check failed on a `colony.json` no step had
 * written (2026-09-28: every step green on both themes, exit 1, and the `PUT /api/state`
 * carried a desktop Chrome's user agent rather than Playwright's HeadlessChrome). The run
 * passed that morning only because no such tab was waiting.
 *
 * The OS is asked for an ephemeral port instead, and `strictPort` makes Vite take that one or
 * fail, rather than drift onto a neighbour. The port is released a moment before Vite binds
 * it, and another process could in principle take it in between; that is a loud failure, not
 * a quiet one.
 */
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.once('error', reject)
    probe.listen(0, 'localhost', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })

const server = await createServer({
  root: ROOT,
  // A run takes a minute or two, and any save anywhere in the tree would otherwise reload the
  // page out from under the driver. Same reason the screenshot harness turns both off.
  server: { host: 'localhost', port: await freePort(), strictPort: true, hmr: false, watch: { ignored: ['**'] } },
  logLevel: 'error',
})
await server.listen()
const url = `http://localhost:${server.httpServer.address().port}/`

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const started = Date.now()
/** `{ theme, passed, total, stray }` per page, for the last line. */
const tally = []

let leftovers = []
try {
  for (const theme of themes) await runTheme(theme)
} finally {
  // A throw from outside a step would otherwise leave a browser, a Vite server and a temp
  // directory behind it, and the run would have to be cleaned up by hand.
  await browser.close()
  await server.close()
  // Nothing this run did may have reached a colony file. The routes answer every `/api/**`
  // call in the browser, so this is the assertion that they did — one missed request and the
  // real middleware would have written `colony.json` in here.
  leftovers = readdirSync(DATA_DIR)
  rmSync(DATA_DIR, { recursive: true, force: true })
}

// A page error is a failure wherever it lands. One that arrives during boot, or between two
// steps, belongs to no step and would otherwise only be printed — so the strays are counted
// here as well as named above.
let failures = tally.reduce((n, t) => n + (t.total - t.passed) + t.stray, 0)
if (leftovers.length) {
  console.error(`\nthe smoke's data directory is not empty: ${leftovers.join(', ')} — a request reached the server`)
  failures++
}

const wall = ((Date.now() - started) / 1000).toFixed(1)
// The stray count is only printed when there is one, so a green run's last line is the one
// the spec asked for and nothing else.
const score = (t) => `${t.theme} ${t.passed}/${t.total}${t.stray ? ` +${t.stray} stray` : ''}`
console.log(`\n${tally.map(score).join(' · ')} · ${wall} s`)
process.exit(failures ? 1 : 0)

// ── one page ────────────────────────────────────────────────────────────────────────────

async function runTheme(theme) {
  const medieval = theme === 'medieval'
  /**
   * Settings for this page. `activeOnly` is on for medieval because that page owns the ghost
   * step, and a ghost zone only exists with the filter on.
   *
   * Two keys the spec's line did not carry, both found by running it. `setting` is pinned to
   * one this theme actually ships — `FIXTURE_SETTINGS` names `moon`, which medieval falls
   * back out of, leaving no picker button pressed for step 13 to compare against. And
   * `countArchived` is on, because step 15 archives a ghost zone's only thread: with the
   * default off, the zone loses its last counted thread and leaves the map mid-step.
   *
   * `renderScale` is halved because nothing here reads the canvas, and every pixel SwiftShader
   * draws is main-thread time the timers and waits below are not getting. The village
   * atmosphere took a village frame from 0.3–0.7 s to 0.55–1.1 s at full scale, and the
   * one-second toast wait started losing to it (2026-09-30); at half scale it is back where it
   * was. Every system still runs, on a smaller buffer.
   */
  const settings = {
    ...FIXTURE_SETTINGS,
    theme,
    activeOnly: medieval,
    planet: medieval ? 'forest' : 'moon',
    setting: medieval ? 'forest' : 'moon',
    countArchived: medieval,
    renderScale: 0.5,
  }

  /** Failures that arrive from the page rather than from an expectation. */
  const faults = []
  /** Every `PUT /api/state` body this page sent. */
  const puts = []
  let roster = ROSTERS.base
  /**
   * What `/api/open` answers.
   *
   * A variable rather than a constant because one step needs the refusal the real server sends
   * for a session whose process is still alive — `live: true` on a 400 — and the two watchers
   * below are told to expect that one 4xx.
   */
  const OPEN_FOCUSED = {
    json: { ok: true, did: 'focused-ide', ideName: 'Visual Studio Code', url: 'vscode://file/fixture' },
  }
  let openAnswer = OPEN_FOCUSED
  /**
   * Is this 4xx the one a step asked for? The refusal reaches the watchers twice — once as the
   * response itself, and once as the browser's own "Failed to load resource" console error —
   * and both have to let it through while it is the thing under test.
   */
  const expected4xx = (url) => Number(openAnswer.status) >= 400 && String(url || '').includes('/api/open')
  let n = 0
  let passed = 0
  /** Page errors that belong to no step — boot, or the gaps between them. Counted all the same. */
  let stray = 0
  let stopped = false
  let where = 'boot'
  const panel = await panelFor(theme)

  // A context of its own, so nothing one page stores — a settings group it opened, above all —
  // reaches the next page's first-time checks through `localStorage`.
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.addInitScript((s) => {
    localStorage.setItem('botcrossing.settings.v1', JSON.stringify(s))
    localStorage.setItem('botcrossing.seen-help', '1')
  }, settings)

  page.on('pageerror', (err) => faults.push(`page error: ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error' && expected4xx(msg.location()?.url)) return
    if (msg.type() === 'error') faults.push(`console error: ${msg.text()}`)
    else if (msg.type() === 'warning') console.log(`${theme}  info  ${where} — console warning: ${msg.text()}`)
  })
  page.on('response', (res) => {
    // A 4xx is a fault unless a step asked for one — see `expected4xx`.
    if (res.status() >= 400 && !expected4xx(res.url())) faults.push(`${res.status()} ${res.url()}`)
  })

  // Newest route wins, so the catch-all goes in first.
  await page.route('**/api/**', (route) => route.fulfill({ json: { ok: false, error: 'fixture' } }))
  await page.route('**/api/state', (route) => {
    if (route.request().method() !== 'PUT') return route.fulfill({ json: FIXTURE_STATE })
    puts.push({ at: Date.now(), body: route.request().postDataJSON() })
    return route.fulfill({ json: { ok: true } })
  })
  await page.route('**/api/threads', (route) => route.fulfill({ json: { threads: roster, scannedAt: Date.now() } }))
  // The two routes the Resume ladder and the recap ride on. Answered here rather than left to
  // the catch-all so the page sees the shapes the real server sends — and so nothing in this
  // run ever asks the OS to open anything.
  await page.route('**/api/open', (route) => route.fulfill(openAnswer))
  await page.route('**/api/recap', (route) =>
    route.fulfill({ json: { ok: true, first: 'Write the fixture recap', last: 'Done — the fixture recap is in.' } })
  )

  // ── the driver's own vocabulary ───────────────────────────────────────────────────────

  /** Poll one predicate in the page until it holds. On timeout the step fails with `what`. */
  async function want(what, fn, arg = null, timeout = DOM_MS) {
    try {
      await page.waitForFunction(fn, arg, { timeout, polling: 100 })
    } catch {
      const snap = await page.evaluate(SNAP).catch(() => null)
      throw new Error(`${what} — not seen in ${timeout} ms; HUD: ${JSON.stringify(snap)}`)
    }
  }

  /** Read one thing out of the page, and fail the step if it is not what was asked for. */
  async function is(what, fn, arg = null) {
    const got = await page.evaluate(fn, arg)
    if (got !== true) throw new Error(`${what} — got ${JSON.stringify(got)}`)
  }

  /** Click a selector, having first waited for it to be there. */
  const click = (sel) => page.click(sel, { timeout: DOM_MS })

  /**
   * The same click, for a button on the thread card.
   *
   * The card follows its villager every frame — `placeCard` rewrites its transform whenever
   * the body bobs a pixel — and Playwright's own actionability check refuses to click
   * anything whose bounding box differs across two animation frames. So the card's buttons
   * can never be "stable" while their villager is alive. Visibility is still waited for; only
   * the stability wait is dropped, and the click itself is a real one at a real point, which
   * a one-pixel bob cannot move out from under a forty-pixel button.
   */
  async function tap(sel) {
    await page.waitForSelector(sel, { state: 'visible', timeout: DOM_MS })
    await page.click(sel, { force: true, timeout: DOM_MS })
  }

  /**
   * Open or shut the Settings sheet the way a person does, with the gear or the sheet's own
   * close button, and wait for the sheet and the sidebar it pushes aside to stop sliding.
   *
   * Clicking into the sheet straight after the gear raced its slide. While the compositor had
   * not yet reported the transition started, the sheet sat at its first frame, 6 px past the
   * right edge, frame after frame. Playwright read it as stable there, found the close button
   * "outside of the viewport", and retried until the click ran out of time (2026-09-30:
   * medieval step 08, once the village atmosphere had doubled its software-rendered frame
   * time). Every control in the sheet is off screen for that long, so nothing in it is touched
   * before the slide has finished.
   */
  async function settingsSheet(open) {
    await click(open ? '#btn-settings' : '#btn-close-settings')
    await want(
      open ? 'the Settings sheet has slid in' : 'the Settings sheet has slid away',
      (o) => {
        const sheet = document.querySelector('.settings')
        const moving = [sheet, document.querySelector('.side')].some((el) => el.getAnimations().length > 0)
        return sheet.classList.contains('closed') !== o && !moving
      },
      open,
      SLIDE_MS
    )
  }

  /**
   * Open a settings group, if it is shut. Playwright will not click or select anything inside a
   * shut `<details>`, so a step that reaches into a group opens it first, as a person would.
   */
  async function openGroup(id) {
    const sel = `.settings details.fold[data-fold="${id}"]`
    if (!(await page.evaluate((s) => document.querySelector(s).open, sel))) await click(`${sel} > summary`)
    await want(`the ${id} group is open`, (s) => document.querySelector(s).open, sel)
  }

  /**
   * Open a repo from the sidebar list. The list and the drilled panel are the same slot, so a
   * panel already open on another repo has to be backed out of first — exactly the two clicks
   * a person makes.
   */
  async function openRepo(name) {
    if (await page.evaluate(() => document.querySelector('.side').classList.contains('drilled'))) {
      await click('#btn-close-project')
      await want('the panel is back on the repo list', () => !document.querySelector('.side').classList.contains('drilled'))
    }
    await click(`.repo[data-name="${name}"]`)
    await want(
      `${name} is open`,
      (n) =>
        document.querySelector('.side').classList.contains('drilled') &&
        document.querySelector('.side .name').textContent === n,
      name
    )
  }

  /**
   * Serve a roster and poll until the page is holding it.
   *
   * `poll()` returns immediately when one is already in flight — the boot's own, or the 15 s
   * repeat — so a single call proves nothing. Every thread is stamped with a token and the
   * loop polls until the page's whole roster carries it, then waits for whatever the poll set
   * in motion (the ghost dressing's kit) to land.
   */
  let seq = 0
  async function applyRoster(list) {
    const token = `tok-${theme}-${++seq}`
    roster = list.map((t) => ({ ...t, preview: token }))
    const deadline = Date.now() + ROSTER_MS
    for (;;) {
      await page.evaluate(() => window.botCrossing.poll())
      if (await page.evaluate((t) => window.botCrossing.threads.every((x) => x.preview === t), token)) break
      if (Date.now() > deadline) throw new Error(`roster did not land in ${ROSTER_MS / 1000} s`)
      await new Promise((r) => setTimeout(r, 100))
    }
    await page.evaluate(() => window.botCrossing.colony.settled())
  }

  /**
   * Wait for a `PUT /api/state` whose body satisfies `pred`, sent since `since`.
   *
   * The index matters: "the archive list is empty" is true of every save this page made
   * before the first archive, so a predicate read over the whole history would pass before
   * the click that is supposed to make it true.
   */
  async function put(what, pred, since, timeout = SAVE_MS) {
    const deadline = Date.now() + timeout
    for (;;) {
      const hit = puts.slice(since).some((p) => {
        try {
          return pred(p.body)
        } catch {
          return false
        }
      })
      if (hit) return
      if (Date.now() > deadline) {
        throw new Error(`${what} — no matching PUT in ${timeout} ms; ${puts.length - since} sent since`)
      }
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  /**
   * Wait for a toast whose text matches.
   *
   * By text rather than by counting: a toast leaves on its own after 3.6 s, so "one more than
   * before" is a race the run lost once — the new toast was up and an older one had gone in
   * the same window (2026-09-13).
   */
  const toast = (what, pattern, timeout = TOAST_MS) =>
    want(
      what,
      (p) => [...document.querySelectorAll('.toasts .toast')].some((t) => new RegExp(p).test(t.textContent)),
      pattern,
      timeout
    )

  /** Run one numbered step, and stop this page at the first one that fails. */
  async function step(name, fn) {
    n++
    const label = `${String(n).padStart(2, '0')} ${name}`
    if (stopped) {
      console.log(`${theme}  skip ${label}`)
      return
    }
    where = label
    const before = faults.length
    const t0 = Date.now()
    try {
      await fn()
      if (faults.length > before) throw new Error(faults.slice(before).join(' | '))
      passed++
      console.log(`${theme}  ok   ${label}  ${Date.now() - t0} ms`)
    } catch (err) {
      stopped = true
      // A page error is nearly always *why* the expectation never arrived, so it goes on the
      // same line rather than being swallowed by the DOM state that followed from it.
      const blame = faults.length > before ? ` (${faults.slice(before).join(' | ')})` : ''
      console.log(`${theme}  FAIL ${label} — ${err.message}${blame}`)
    } finally {
      // Consumed: anything still in the list at teardown arrived outside a step.
      faults.length = before
    }
  }

  // ── boot ──────────────────────────────────────────────────────────────────────────────

  try {
    await page.goto(url)
    const deadline = Date.now() + BOOT_MS
    while (!(await page.evaluate(() => Boolean(window.botCrossing && window.botCrossing.threads.length)))) {
      if (Date.now() > deadline) throw new Error(`boot did not complete in ${BOOT_MS / 1000} s`)
      await new Promise((r) => setTimeout(r, 50))
    }
  } catch (err) {
    console.log(`${theme}  FAIL boot — ${err.message}`)
    stopped = true
  }
  for (const f of faults) console.log(`${theme}  FAIL boot — ${f}`)
  stray += faults.length
  faults.length = 0

  // ── 1–14, both themes ─────────────────────────────────────────────────────────────────

  await step('boot', async () => {
    // A load, not a class flip: the boot screen waits for the first poll's `colony.settled()`
    // (the ghost dressing's kit, fetched and parsed when a roster has fading threads) and then
    // a 550 ms fade, and on a software-rendered village page that has run past the five-second
    // DOM wait (2026-09-30).
    await want('the boot screen is gone', () => !document.querySelector('.boot'), null, BOOT_MS)
    await want('three repos in the sidebar', () => document.querySelectorAll('.projects > .repo').length === 3)
    await is(
      'the repo head counts them',
      () => document.querySelector('.sec-head .n').textContent === '3 on the map'
    )
    await is(
      "the crew stat wears the theme's word",
      (word) => document.querySelector('.stat[data-key="agents"] .lbl').textContent === word,
      medieval ? 'villagers' : 'crew'
    )
  })

  // The panel as it first comes up, before any step has opened or shut a group. Read, not
  // opened: a closed sheet keeps its rows in the DOM.
  await step('settings: World and Time open the first time', async () => {
    await is(
      "the groups come in the layout's order, World and Time open and the rest shut",
      (want) => {
        const got = [...document.querySelectorAll('.settings details.fold[data-fold]')].map(
          (d) => `${d.dataset.fold}${d.open ? '+' : '-'}`
        )
        return got.join() === want || got.join()
      },
      panel.map((g) => `${g.id}${g.open ? '+' : '-'}`).join()
    )
    // A first-time state is not a choice, so nothing is stored for it.
    await is(
      'no group has a stored fold yet',
      () => {
        const stored = Object.keys(localStorage).filter((k) => k.startsWith('botcrossing.settings-fold.'))
        return stored.length === 0 || stored.join()
      }
    )
  })

  await step('settings: rows match the layout', async () => {
    await is(
      'each group holds its rows in order, and every key has one row',
      (groups) => {
        for (const g of groups) {
          const el = document.querySelector(`.settings details.fold[data-fold="${g.id}"]`)
          const got = [...el.querySelectorAll('[data-key]')].map((r) => r.dataset.key)
          if (got.join() !== g.keys.join()) return `${g.id}: ${got.join()}`
        }
        const all = [...document.querySelectorAll('.settings [data-key]')].map((r) => r.dataset.key)
        return all.length === new Set(all).size || `a key twice: ${all.join()}`
      },
      panel
    )
  })

  // Sound waits for a gesture: the browser's autoplay policy asks for one, and the ambience
  // builds its context on the first click or key anywhere, never before. These two run before
  // anything else here touches the page, because every step after them clicks.
  await step('no sound before the first click', async () => {
    await is('the page built its ambience, and it has no audio context yet', () => {
      const amb = window.botCrossing.ambience
      if (!amb) return 'no ambience'
      return amb.ctx === null || `a context, ${amb.ctx.state}`
    })
  })

  await step('sound after the first click', async () => {
    // A real click on the repo list's heading, which answers nothing of its own: the gesture
    // alone, with no selection or panel left behind for the steps below to trip over.
    await click('.sec-head .lbl')
    await want('the audio context is running', () => window.botCrossing.ambience?.ctx?.state === 'running', null, 2 * DOM_MS)
  })

  await step('the Sound group and the mute button', async () => {
    // Read, not opened: a closed sheet keeps its rows in the DOM.
    await is(
      'the Settings sheet has the four Sound rows',
      () =>
        ['sound', 'masterVolume', 'ambienceVolume', 'effectsVolume']
          .filter((k) => !document.querySelector(`.settings .row[data-key="${k}"]`))
          .map((k) => `no ${k} row`)
          .join(', ') || true
    )
    await is('the rail has the mute button', () => Boolean(document.querySelector('#btn-sound')))
    // The hints are the theme's words: the village has no drones and rings a bell, not a chime.
    if (medieval) {
      await is('the Effects hint names no drone and no chime', () => {
        const hint = document.querySelector('.settings .row[data-key="effectsVolume"] .hint')?.textContent ?? null
        return (hint !== null && !/drone|chime/i.test(hint)) || hint
      })
    }
  })

  await step('select a zone from the sidebar', async () => {
    await click('.repo[data-name="alpha"]')
    await want('the panel drilled into alpha', () => {
      const side = document.querySelector('.side')
      return side.classList.contains('drilled') && document.querySelector('.side .name').textContent === 'alpha'
    })
    await is(
      'the row reads as pressed',
      () => document.querySelector('.repo[data-name="alpha"]').getAttribute('aria-pressed') === 'true'
    )
    await want('six thread rows', () => document.querySelectorAll('.side .threads .thread').length === 6)
    await is(
      'the census reads 1 active · 3 idle · 2 inactive',
      () => document.querySelector('.side .threads-head').textContent === '1 active · 3 idle · 2 inactive'
    )
  })

  await step('select a zone by clicking the map', async () => {
    await click('#btn-close-project')
    await want('the panel is back on the repo list', () => !document.querySelector('.side').classList.contains('drilled'))
    // The camera to its rest pose with no easing left, so the projection below is the picture
    // that is actually on screen.
    await page.evaluate(() => {
      const { rig } = window.botCrossing
      rig.resetView()
      rig.target.copy(rig.desiredTarget)
      rig.distance = rig.desiredDistance
      rig.azimuth = rig.desiredAzimuth
      rig.polar = rig.desiredPolar
      rig._sync()
    })
    const aim = await page.evaluate(() => {
      const { engine, colony } = window.botCrossing
      engine.camera.updateMatrixWorld(true)
      engine.camera.matrixWorldInverse.copy(engine.camera.matrixWorld).invert()
      const rect = engine.canvas.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const out = []
      for (const plot of colony.plotOrder) {
        const v = (plot.middle || plot.center).clone().project(engine.camera)
        if (v.z > 1) continue
        const x = rect.left + (v.x * 0.5 + 0.5) * rect.width
        const y = rect.top + (-v.y * 0.5 + 0.5) * rect.height
        out.push({
          name: plot.name,
          x: Math.round(x),
          y: Math.round(y),
          // The HUD is DOM over the canvas: a zone whose middle sits under the sidebar cannot
          // be clicked at all, which is a fact about the point, not a failure.
          clickable: document.elementFromPoint(x, y) === engine.canvas,
          d: Math.round(Math.hypot(x - cx, y - cy)),
        })
      }
      out.sort((a, b) => a.d - b.d)
      return out
    })
    const target = aim.find((p) => p.clickable)
    if (!target) throw new Error(`no zone middle is on bare canvas: ${JSON.stringify(aim)}`)
    await page.mouse.click(target.x, target.y)
    await want(
      `clicking ${target.name} at ${target.x},${target.y} opens it`,
      (name) => {
        const side = document.querySelector('.side')
        return side.classList.contains('drilled') && document.querySelector('.side .name').textContent === name
      },
      target.name
    )
  })

  await step('poll with a zone open', async () => {
    const open = await page.evaluate(() => document.querySelector('.side .name').textContent)
    // The exact sequence that reached the undeclared identifier: poll → applyThreads →
    // syncProject, with a repo drilled into.
    await applyRoster(ROSTERS.base)
    await want(
      'the panel survived the poll',
      (name) => {
        const side = document.querySelector('.side')
        return side.classList.contains('drilled') && document.querySelector('.side .name').textContent === name
      },
      open
    )
  })

  await step('select a thread', async () => {
    await openRepo('beta')
    await click('.thread[data-id="fx-beta-2"]')
    await want('the card is up, anchored to its villager', () => {
      const card = document.querySelector('.thread-pop')
      return card.classList.contains('on') && !card.classList.contains('docked')
    })
    await is(
      'the card names the thread',
      () => document.querySelector('.thread-pop .title').textContent === 'Thread 2 in beta'
    )
    await is('Viewed is offered', () => document.querySelector('#btn-viewed').hidden === false)
    await is(
      'the row reads as pressed',
      () => document.querySelector('.thread[data-id="fx-beta-2"]').getAttribute('aria-pressed') === 'true'
    )
    await want('the action row is under the row it belongs to', () => {
      const row = document.querySelector('.thread[data-id="fx-beta-2"]')
      const acts = row && row.nextElementSibling
      return Boolean(acts && acts.classList.contains('thread-acts') && acts.dataset.id === 'fx-beta-2')
    })
    await is(
      'it offers Resume, Copy resume command, Viewed and Archive, in that order',
      () =>
        [...document.querySelectorAll('.thread-acts .act')].map((b) => b.dataset.act).join(',') ===
        'resume,copy-resume,viewed,archive'
    )
    await is(
      'a terminal thread resumes rather than opens',
      () => document.querySelector('.thread-acts .act[data-act="resume"]').textContent.trim() === 'Resume'
    )
    await click('.thread-acts .act[data-act="copy-resume"]')
    // The async clipboard needs a permission this page does not have; the fallback behind it
    // does not, and the last resort is the command itself so it can be read off the screen.
    await toast(
      'the whole resume command is copied, or handed over to be read',
      '^(Resume command copied|claude --resume fx-session-beta-2)$'
    )
  })

  await step('the recap lands on the card and under the row', async () => {
    await want('the card shows both lines', () => {
      const recap = document.querySelector('.thread-pop .recap')
      return (
        recap &&
        !recap.hidden &&
        recap.querySelector('.line.first .v').textContent === 'Write the fixture recap' &&
        recap.querySelector('.line.last .v').textContent === 'Done — the fixture recap is in.'
      )
    })
    await want('and so does the action row', () => {
      const v = document.querySelector('.side .thread-acts .recap .line.last .v')
      return Boolean(v && v.textContent === 'Done — the fixture recap is in.')
    })
  })

  await step('resume raises the editor window', async () => {
    await tap('#btn-open')
    await toast('the toast names the editor, not a guess', '^Opened in Visual Studio Code$')
  })

  await step('resume copies the command when the setting says so', async () => {
    await settingsSheet(true)
    await openGroup('threads')
    await page.selectOption('.settings .row[data-key="resumeOpens"] .select', 'copy')
    await settingsSheet(false)

    // `fx-beta-1` is inactive: its terminal is gone, so pasting the command is the whole of it.
    // The clipboard may be refused in a headless browser; the selection fallback puts up the
    // same toast, which is what this asserts either way. Its row lives in the Inactive group,
    // which opens closed, so it is reached the way a person reaches it — by the label, not the
    // middle of the summary, which is where that group keeps its "Archive all".
    await click('details[data-group="inactive"] > summary > span:first-child')
    await click('.thread[data-id="fx-beta-1"]')
    await tap('#btn-open')
    await toast('the clipboard rung says where to paste it', '^Copied — paste in a terminal at beta$')

    // `fx-beta-2` is idle, which means its process is alive — same copy, different sentence,
    // because pasting it blind is how two agents end up in one transcript.
    await click('.thread[data-id="fx-beta-2"]')
    await tap('#btn-open')
    await toast('a live session says so instead', '^Copied — that session is already running in a terminal$')

    await settingsSheet(true)
    await openGroup('threads')
    await page.selectOption('.settings .row[data-key="resumeOpens"] .select', 'ide')
    await settingsSheet(false)
  })

  await step('a live session says so even when the thread looks closed', async () => {
    // The server is the only one of the two that can know a terminal is still attached to a
    // thread the scan calls inactive — it re-reads the live-session registry to answer — and it
    // says so with `live` beside the refusal. While that flag was being dropped at the throw,
    // this toast read "paste in a terminal" against a session already running.
    openAnswer = { status: 400, json: { ok: false, error: 'That session is already running in a terminal', live: true } }
    await click('.thread[data-id="fx-beta-1"]')
    // The step before this one put the very same sentence on screen for a thread that really is
    // idle, and a toast lives 3.6 s — so the board is cleared before the click, or this would
    // pass on that one and prove nothing.
    await want('the last toasts have gone', () => !document.querySelector('.toasts .toast'), null, 6_000)
    await tap('#btn-open')
    await toast(
      'the refusal is believed over the thread state',
      '^Copied — that session is already running in a terminal$'
    )
    openAnswer = OPEN_FOCUSED
    // Back on the thread the steps after this one are written against.
    await click('.thread[data-id="fx-beta-2"]')
    await want(
      'the card is back on the idle thread',
      () => document.querySelector('.thread-pop .title').textContent === 'Thread 2 in beta'
    )
  })

  await step('mark viewed', async () => {
    const since = puts.length
    await tap('#btn-viewed')
    await want('Viewed comes off the card', () => document.querySelector('#btn-viewed').hidden === true)
    await toast('a toast says so', '^Marked Thread 2 in beta as viewed$')
    await put('the save records when it was looked at', (b) => Boolean(b.viewedAt && b.viewedAt['fx-beta-2']), since)
  })

  await step('archive from the card', async () => {
    const since = puts.length
    await tap('#btn-archive')
    await want('the card lets go', () => !document.querySelector('.thread-pop').classList.contains('on'))
    await want('the row is in the Archived group', () => {
      const row = document.querySelector('details[data-group="archived"] .thread[data-id="fx-beta-2"]')
      return Boolean(row && row.classList.contains('state-archived') && row.querySelector('.mini[data-act="unarchive"]'))
    })
    await want('and in the repo list’s Archive section, collapsed, with its repo', () => {
      const group = document.querySelector('.repo-group[data-group="archive"]')
      const row = group && group.querySelector('.archive-row[data-title="Thread 2 in beta"]')
      return Boolean(group && !group.hidden && !group.open && row && row.dataset.name === 'beta' && row.querySelector('.mini.undo'))
    })
    await is('the Archive section sits just above Gone', () => {
      const group = document.querySelector('.repo-group[data-group="archive"]')
      return group.nextElementSibling === document.querySelector('.repo-group[data-group="gone"]')
    })
    await put('the save carries the archive', (b) => Array.isArray(b.archived) && b.archived.includes('fx-beta-2'), since)
    await is('its villager is walking home, or already gone', () => {
      const a = window.botCrossing.colony.agentFor('fx-beta-2')
      return !a || a.state === 'leaving'
    })
  })

  await step('unarchive from the row', async () => {
    const since = puts.length
    // The label rather than the middle of the summary: an Inactive summary carries an
    // "Archive all" button, and a click that landed on it would archive the repo instead of
    // opening the group. Same reach for both, so both are safe.
    await click('details[data-group="archived"] > summary > span:first-child')
    await click('details[data-group="archived"] .thread[data-id="fx-beta-2"] .mini[data-act="unarchive"]')
    await want('the row is idle again, and the group is gone', () => {
      const row = document.querySelector('.thread[data-id="fx-beta-2"]')
      return Boolean(row && row.classList.contains('state-idle')) && !document.querySelector('details[data-group="archived"]')
    })
    await want('the repo list’s Archive section empties and goes', () => {
      const group = document.querySelector('.repo-group[data-group="archive"]')
      return group.hidden === true && !group.querySelector('.archive-row')
    })
    await put('the save empties the archive', (b) => Array.isArray(b.archived) && b.archived.length === 0, since)
  })

  await step('hide a repo, then show it', async () => {
    await click('#btn-hide-repo')
    await want('the panel closes and two repos are left', () => {
      const side = document.querySelector('.side')
      const group = document.querySelector('.repo-group[data-group="hidden"]')
      return (
        !side.classList.contains('drilled') &&
        document.querySelectorAll('.projects > .repo').length === 2 &&
        group.hidden === false &&
        group.querySelector('summary .count').textContent === '1' &&
        group.querySelector('.repo-row .n').textContent === 'beta'
      )
    })
    await is('the map has forgotten the zone', () => window.botCrossing.colony.plots.has('beta') === false)
    // Counted from here rather than from the top of the step: an empty hidden list is true of
    // every save this page made before the hide, including one a poll may have had in flight,
    // and such a save would satisfy the assertion below before the click that earns it.
    const since = puts.length
    // The group is a `<details>` that opens closed, so its rows have to be reached the way a
    // person reaches them.
    await click('.repo-group[data-group="hidden"] > summary > span:first-child')
    await click('.repo-group[data-group="hidden"] .rows .mini')
    await want('beta is back and the group is empty', () => {
      const group = document.querySelector('.repo-group[data-group="hidden"]')
      return document.querySelectorAll('.projects > .repo').length === 3 && group.hidden === true
    })
    await put('the save empties the hidden list', (b) => Array.isArray(b.hidden) && b.hidden.length === 0, since)
  })

  await step('pin a repo, then unpin it', async () => {
    const since = puts.length
    await openRepo('alpha')
    await click('#btn-pin-repo')
    await want('the pin shows on the button, the plate and the row', () => {
      const row = document.querySelector('.repo[data-name="alpha"]')
      return (
        document.querySelector('#btn-pin-repo').getAttribute('aria-pressed') === 'true' &&
        document.querySelector('.side .who').classList.contains('pinned') &&
        Boolean(row && row.querySelector('.pin'))
      )
    })
    await put('the save carries the pin', (b) => Array.isArray(b.pinned) && b.pinned.length === 1 && b.pinned[0] === 'alpha', since)
    await click('#btn-pin-repo')
    await want('every pin comes off again', () => {
      return (
        document.querySelector('#btn-pin-repo').getAttribute('aria-pressed') === 'false' &&
        !document.querySelector('.side .who').classList.contains('pinned') &&
        document.querySelectorAll('.projects > .repo .pin').length === 0
      )
    })
  })

  await step('the repo actions', async () => {
    await click('#btn-new-session')
    await toast('a new conversation is announced', '^New thread in alpha — opening ')
    // Reveal is the one action with nothing to say when it works: the fixture answers 200 and
    // `revealProject` toasts only on a throw. So this asks for the absence of a complaint —
    // and waits for the round trip first, because the toast it is looking for could only be
    // raised after it, and a check run straight off the click could never fail.
    const revealed = page.waitForResponse('**/api/reveal', { timeout: DOM_MS })
    await click('#btn-reveal')
    await revealed
    await is(
      'showing the folder raises no error',
      () => ![...document.querySelectorAll('.toasts .toast')].some((t) => t.classList.contains('err'))
    )
    await click('#btn-copy-path')
    // The async clipboard needs a permission this page does not have; the selection-based
    // fallback behind it does not, and either outcome toasts.
    await toast('the path is copied, or said not to be', '^(Path copied|Could not reach the clipboard)$')
  })

  await step('archive every inactive thread', async () => {
    const since = puts.length
    await click('details[data-group="inactive"] summary .mini.wide')
    await want('the Inactive group is gone and two rows are in Archived', () => {
      const archived = document.querySelector('details[data-group="archived"] summary .count')
      return !document.querySelector('details[data-group="inactive"]') && Boolean(archived) && archived.textContent === '2'
    })
    await toast('a toast counts them', '^Archived 2 inactive threads in alpha$')
    await put(
      'the save carries both ids',
      (b) => Array.isArray(b.archived) && b.archived.includes('fx-alpha-4') && b.archived.includes('fx-alpha-5'),
      since
    )
  })

  await step('the View section', async () => {
    await click('#btn-close-project')
    await want('the panel is back on the repo list', () => !document.querySelector('.side').classList.contains('drilled'))
    await is('the section is always shown', () => {
      const v = document.querySelector('.repo-view')
      return v.tagName === 'DIV' && !v.querySelector('summary')
    })
    await is(
      'four chips, one per counted state',
      () =>
        [...document.querySelectorAll('.repo-view .chip')].map((c) => c.textContent).join(',') ===
        'Active,Idle,Inactive,Archived'
    )
    // Read against the settings themselves rather than against four literals: the fixture
    // counts inactive threads and the medieval page also counts archived ones, so a hard-coded
    // on/off pattern would be asserting the fixture and not the wiring.
    await is(
      'they read the settings they write',
      () =>
        ['countActive', 'countIdle', 'countInactive', 'countArchived'].every(
          (k) =>
            document.querySelector(`.repo-view .chip[data-key="${k}"]`).getAttribute('aria-pressed') ===
            String(window.botCrossing.settings.get(k))
        )
    )
    await is(
      'and count what is in each state',
      () => /^Inactive · \d+ threads? — counted$/.test(document.querySelector('.repo-view .chip[data-key="countInactive"]').title)
    )
    await click('.repo-view .chip[data-key="countInactive"]')
    await want(
      'the setting flips with the chip',
      () =>
        window.botCrossing.settings.get('countInactive') === false &&
        document.querySelector('.repo-view .chip[data-key="countInactive"]').getAttribute('aria-pressed') === 'false'
    )
    // The Settings sheet is the other half of the same setting, and must have moved with it.
    await settingsSheet(true)
    await openGroup('repos')
    await click('.settings .zone-size > summary')
    await is(
      'the Zone size switch moved too',
      () => document.querySelector('.settings .row[data-key="countInactive"] .toggle').getAttribute('aria-checked') === 'false'
    )
    await click('.settings .row[data-key="countInactive"] .toggle')
    await settingsSheet(false)
    await want(
      'and turning it back on there turns the chip on here',
      () =>
        window.botCrossing.settings.get('countInactive') === true &&
        document.querySelector('.repo-view .chip[data-key="countInactive"]').getAttribute('aria-pressed') === 'true'
    )
    await click('#btn-compact')
    await toast('Compact packs the zones from here too', '^Zones packed toward the middle$')
  })

  await step('filter the repo list', async () => {
    await page.fill('.repo-search', 'alp')
    await want('one row is left, and the head says so', () => {
      const rows = [...document.querySelectorAll('.projects > .repo')]
      const shown = rows.filter((r) => !r.hidden)
      return (
        shown.length === 1 &&
        shown[0].dataset.name === 'alpha' &&
        document.querySelector('.sec-head .n').textContent === '1 of 3 on the map'
      )
    })
    await page.fill('.repo-search', 'zzz')
    await want('nothing matches, and the list says what was asked for', () => {
      const empty = document.querySelector('.repo-empty')
      return (
        empty.hidden === false &&
        empty.textContent === 'No repo matches “zzz”.' &&
        [...document.querySelectorAll('.projects > .repo')].every((r) => r.hidden)
      )
    })
    await page.fill('.repo-search', '')
    await want('clearing it gives the whole list back', () => {
      const rows = [...document.querySelectorAll('.projects > .repo')]
      return (
        rows.length === 3 &&
        rows.every((r) => !r.hidden) &&
        document.querySelector('.repo-empty').hidden === true &&
        document.querySelector('.sec-head .n').textContent === '3 on the map'
      )
    })

    // The groups are filtered too: a repo you hid is exactly the one you go looking for by
    // name. Hidden is empty by now, so this step makes its own and puts it back.
    await click('.repo[data-name="gamma"] .eye')
    await want('gamma is under Hidden', () => {
      const group = document.querySelector('.repo-group[data-group="hidden"]')
      return group.hidden === false && group.querySelector('.repo-row[data-name="gamma"]') !== null
    })
    // "hide a repo, then show it" left the group standing open. Put it away first, so that the
    // search opening it and the cleared box closing it again are both something to see.
    if (await page.evaluate(() => document.querySelector('.repo-group[data-group="hidden"]').open)) {
      await click('.repo-group[data-group="hidden"] > summary > span:first-child')
      await want('and the group is closed to start with', () => {
        return document.querySelector('.repo-group[data-group="hidden"]').open === false
      })
    }
    await page.fill('.repo-search', 'gam')
    await want('Hidden opens itself on the match', () => {
      const group = document.querySelector('.repo-group[data-group="hidden"]')
      return (
        group.open === true &&
        group.querySelector('summary .count').textContent === '1' &&
        [...group.querySelectorAll('.repo-row')].filter((r) => !r.hidden).length === 1
      )
    })
    await page.fill('.repo-search', 'zzz')
    await want(
      'and goes away when nothing in it matches',
      () => document.querySelector('.repo-group[data-group="hidden"]').hidden === true
    )
    await page.fill('.repo-search', '')
    await want('clearing the box puts the group back the way it was', () => {
      const group = document.querySelector('.repo-group[data-group="hidden"]')
      return group.hidden === false && group.open === false
    })
    await click('.repo-group[data-group="hidden"] > summary > span:first-child')
    await click('.repo-group[data-group="hidden"] .rows .mini')
    await want('gamma is back on the map', () => {
      const group = document.querySelector('.repo-group[data-group="hidden"]')
      return document.querySelectorAll('.projects > .repo').length === 3 && group.hidden === true
    })

  })

  /**
   * Clearing a group. The button is the one in the sidebar that nothing else can undo, so
   * both halves of its promise are checked here: the repo leaves for good, and a thread
   * opening in it again is the one thing that brings it back. Both groups get a turn — Gone,
   * which is what a first run fills, and Hidden, where clearing also has to lift the hide.
   */
  await step('clear the Gone group, then the Hidden one', async () => {
    // Gamma, three weeks quiet and with nothing running in it: past `hideDays`, so the zone
    // leaves the map on its own and the row lands in Gone, which is the state a first run
    // finds forty of. A live thread is exactly what un-clears a repo, and every repo in the
    // base roster has one — cleared with a thread still open, the poll that followed would
    // undo it and the step would prove the opposite of what it means to.
    const aged = (t) =>
      t.project === 'gamma' ? { ...t, state: 'inactive', lastActivityAt: Date.now() - 21 * 24 * 60 * 60 * 1000 } : t
    // Nothing is ever in Gone with the filter off, and this page runs with it off unless it
    // is the medieval one, which owns the ghost shot. Put back at the end of the step.
    const filter = await page.evaluate(() => window.botCrossing.settings.get('activeOnly'))
    await page.evaluate(() => window.botCrossing.settings.set('activeOnly', true))
    await applyRoster(ROSTERS.base.map(aged))
    await want('gamma has aged off the map and into Gone', () => {
      const group = document.querySelector('.repo-group[data-group="gone"]')
      return (
        group.hidden === false &&
        group.querySelector('.repo-row[data-name="gamma"]') !== null &&
        [...document.querySelectorAll('.projects > .repo')].every((r) => r.dataset.name !== 'gamma')
      )
    })

    await click('.repo-group[data-group="gone"] .clear')
    await want('the first click arms the button and says how many it would take', () => {
      const btn = document.querySelector('.repo-group[data-group="gone"] .clear')
      return btn.dataset.armed === 'true' && btn.textContent === 'Clear 1?'
    })
    // The filter box decides which rows are listed, so anything that changes it makes the
    // armed number a lie — and an armed button with a stale number is the one way this click
    // goes wrong. Both ways of changing it are here: typing fires `input`, Escape does not.
    await page.fill('.repo-search', 'gam')
    await want('typing in the filter box calls the arming off', () => {
      const btn = document.querySelector('.repo-group[data-group="gone"] .clear')
      return btn.dataset.armed === undefined && btn.textContent === 'Clear all'
    })
    await click('.repo-group[data-group="gone"] .clear')
    await want('armed again, on the one row the filter has left', () => {
      const btn = document.querySelector('.repo-group[data-group="gone"] .clear')
      return btn.dataset.armed === 'true' && btn.textContent === 'Clear 1?'
    })
    await page.focus('.repo-search')
    await page.keyboard.press('Escape')
    await want('and emptying the box with Escape calls it off too', () => {
      const btn = document.querySelector('.repo-group[data-group="gone"] .clear')
      return document.querySelector('.repo-search').value === '' && btn.dataset.armed === undefined
    })

    const since = puts.length
    await click('.repo-group[data-group="gone"] .clear')
    await click('.repo-group[data-group="gone"] .clear')
    await toast('the toast says what was cleared and how it comes back', '^Cleared gamma — it comes back')
    await want('gamma is nowhere: not on the map, and in neither group', () => {
      const repos = [...document.querySelectorAll('.projects > .repo')].map((r) => r.dataset.name)
      return (
        repos.length === 2 &&
        !repos.includes('gamma') &&
        document.querySelector('.repo-group[data-group="gone"]').hidden === true &&
        document.querySelector('.repo-row[data-name="gamma"]') === null
      )
    })
    await is('the map has let the zone go', () => window.botCrossing.colony.plots.has('gamma') === false)
    await put('the save records the clear', (b) => asArray(b.forgotten).includes('gamma'), since)

    const back = puts.length
    await applyRoster(ROSTERS.base)
    await want('a live thread brings gamma back on its own', () =>
      [...document.querySelectorAll('.projects > .repo')].some((r) => r.dataset.name === 'gamma')
    )
    // `Array.isArray` first: without it the field going missing altogether would satisfy a
    // bare "does not include gamma" just as well as the drop this is looking for.
    await put(
      'and the save drops it from the cleared list',
      (b) => Array.isArray(b.forgotten) && !b.forgotten.includes('gamma'),
      back
    )

    // The same button on Hidden, where it has one more thing to do: the hide is lifted with
    // it. Gamma has a live thread again by now, so the clear is answered immediately — which
    // is the promise the other way round, and the reason this cannot quietly lose a repo.
    const lifted = puts.length
    await click('.repo[data-name="gamma"] .eye')
    await want('gamma is under Hidden', () => {
      const group = document.querySelector('.repo-group[data-group="hidden"]')
      return group.hidden === false && group.querySelector('.repo-row[data-name="gamma"]') !== null
    })
    await click('.repo-group[data-group="hidden"] .clear')
    await click('.repo-group[data-group="hidden"] .clear')
    // One sentence for the whole click rather than two that count different things: the repo
    // was cleared and put back by the same press, and the toast is said after the rebuild.
    await toast('the toast owns up to the repo coming back', '^1 has a thread open and is back on the map$')
    await want('the group empties and gamma is straight back on the map', () => {
      const group = document.querySelector('.repo-group[data-group="hidden"]')
      return (
        group.hidden === true &&
        [...document.querySelectorAll('.projects > .repo')].some((r) => r.dataset.name === 'gamma')
      )
    })
    await put(
      'the save lifts the hide and keeps nothing behind',
      (b) =>
        Array.isArray(b.hidden) && !b.hidden.includes('gamma') && Array.isArray(b.forgotten) && !b.forgotten.includes('gamma'),
      lifted
    )

    await page.evaluate((v) => window.botCrossing.settings.set('activeOnly', v), filter)
    await want('the page is back on the filter it booted with, and the whole roster with it', () => {
      return [...document.querySelectorAll('.projects > .repo')].length === 3
    })
  })

  await step('act from the action row', async () => {
    const since = puts.length
    await openRepo('alpha')
    await click('.thread[data-id="fx-alpha-1"]')
    await want('an unread thread offers Viewed', () =>
      Boolean(document.querySelector('.thread-acts[data-id="fx-alpha-1"] .act[data-act="viewed"]'))
    )
    await click('.thread-acts[data-id="fx-alpha-1"] .act[data-act="viewed"]')
    await toast('a toast says so', '^Marked Thread 1 in alpha as viewed$')
    await want(
      'and Viewed leaves the row, having nothing left to dismiss',
      () => !document.querySelector('.thread-acts[data-id="fx-alpha-1"] .act[data-act="viewed"]')
    )
    await put('the save records when it was looked at', (b) => Boolean(b.viewedAt && b.viewedAt['fx-alpha-1']), since)

    await click('.thread-acts[data-id="fx-alpha-1"] .act[data-act="archive"]')
    await want('Archive sends it to the Archived group', () =>
      Boolean(document.querySelector('details[data-group="archived"] .thread[data-id="fx-alpha-1"]'))
    )

    // Selecting a history row opens its own action row, which says Unarchive instead. The
    // group has to be opened by hand first: archiving let the thread go, so nothing in there
    // is selected and the group has no reason to open itself. Reached by the label, as above.
    await click('details[data-group="archived"] > summary > span:first-child')
    await click('details[data-group="archived"] .thread[data-id="fx-alpha-1"]')
    await want('the archived row offers Unarchive', () => {
      const b = document.querySelector('.thread-acts[data-id="fx-alpha-1"] .act[data-act="archive"]')
      return Boolean(b) && b.textContent.trim() === 'Unarchive'
    })
    await is('the selected row drops its icon buttons for the words', () => {
      const set = document.querySelector('.thread[data-id="fx-alpha-1"] .mini-set')
      return Boolean(set) && getComputedStyle(set).display === 'none'
    })
    await click('.thread-acts[data-id="fx-alpha-1"] .act[data-act="archive"]')
    await want(
      'and Unarchive brings it back out',
      () => !document.querySelector('details[data-group="archived"] .thread[data-id="fx-alpha-1"]')
    )
  })

  await step('settings', async () => {
    await settingsSheet(true)
    await want('the sheet is open and the sidebar has stepped aside', () => {
      return (
        !document.querySelector('.settings').classList.contains('closed') &&
        document.querySelector('.side').classList.contains('shifted')
      )
    })
    // The Zone size copy. Read rather than clicked, and read without opening the group: a
    // closed <details> keeps its children in the DOM, so these hold whichever way it sits.
    await is(
      'the slider counts buildings',
      () =>
        document.querySelector('.settings .row[data-key="threadsPerTile"] .label > span:first-child').textContent ===
        'Buildings per tile'
    )
    await is(
      'and says what fills a tile',
      () =>
        document.querySelector('.settings .row[data-key="threadsPerTile"] .hint').textContent ===
        'How many buildings fit on one tile before the zone claims another.'
    )
    await is('the sub-heading says what a building is', () => {
      const head = document.querySelector('.settings .zone-size .subhead')
      return (
        head.querySelector('span:first-child').textContent === 'Which threads get a building' &&
        head.querySelector('.hint').textContent === 'one thread = one agent session = one building'
      )
    })
    await is(
      'each state is named and defined',
      () =>
        [...document.querySelectorAll('.settings .zone-size .row[data-key^="count"]')]
          .map((r) => `${r.querySelector('.label > span:first-child').textContent}: ${r.querySelector('.hint').textContent}`)
          .join(' | ') ===
        [
          'Active: Open and working right now.',
          'Idle: Open, and waiting on you.',
          'Inactive: Closed. The transcript is still on disk, so it can be resumed.',
          'Archived: You archived it. Unarchive puts it back.',
        ].join(' | ')
    )
    await is(
      'Compact keeps its own hint',
      () =>
        document.querySelector('.settings .zone-size .row .row-btn').textContent === 'Compact' &&
        document.querySelector('.settings .zone-size .row .row-btn').closest('.row').querySelector('.hint').textContent ===
          'Pack every zone toward the middle. Zones move once; the holes left by repos that left the map close up.'
    )
    // A group that starts shut opens, and the browser remembers it; then it shuts again.
    await click('.settings details.fold[data-fold="atmosphere"] > summary')
    await want(
      'Atmosphere opens, and the browser remembers it',
      () =>
        document.querySelector('.settings details.fold[data-fold="atmosphere"]').open &&
        localStorage.getItem('botcrossing.settings-fold.atmosphere') === '1'
    )
    await click('.settings details.fold[data-fold="atmosphere"] > summary')
    await want(
      'and folds away again, remembered too',
      () =>
        !document.querySelector('.settings details.fold[data-fold="atmosphere"]').open &&
        localStorage.getItem('botcrossing.settings-fold.atmosphere') === '0'
    )
    await openGroup('repos')
    await click('.settings .row[data-key="fadeGhosts"] .toggle')
    await want(
      'the ghost-fade switch is on, and the setting with it',
      () =>
        document.querySelector('.settings .row[data-key="fadeGhosts"] .toggle').getAttribute('aria-checked') === 'true' &&
        window.botCrossing.settings.get('fadeGhosts') === true
    )
    const world = medieval ? 'valley' : 'mars'
    await click(`.settings-picker .setting-btn[data-id="${world}"]`)
    await want(
      `the world is ${world}`,
      (id) =>
        window.botCrossing.settings.get('setting') === id &&
        document.querySelector(`.setting-btn[data-id="${id}"]`).getAttribute('aria-pressed') === 'true',
      world
    )
    // The world is rebuilt off the back of that click; give it a second to throw if it means to.
    await new Promise((r) => setTimeout(r, 1000))
    await settingsSheet(false)
    await want(
      'the sheet closes and the sidebar comes back',
      () =>
        document.querySelector('.settings').classList.contains('closed') &&
        !document.querySelector('.side').classList.contains('shifted')
    )
  })

  await step('a resumed session walks out of the door', async () => {
    // Spied at the one place the choice is made, rather than read off the villager's
    // position afterwards: the entrance lasts under a second, and a spy cannot miss it.
    await page.evaluate(() => {
      const crew = window.botCrossing.colony.astronauts
      window.__spawns = []
      const spawn = crew._spawnAgent.bind(crew)
      crew._spawnAgent = (entry, walksOut) => {
        window.__spawns.push({ id: entry.id, walksOut })
        return spawn(entry, walksOut)
      }
    })
    // A thread that has been closed, and on the colony's books, since the page loaded — picked
    // live, because the steps above archive some of them, and an archived one gets no villager
    // (it can still have a building, once a View step has counted archived threads).
    // `colony.threads` leaves the archived ones out.
    const closed = ROSTERS.base.filter((t) => t.state === 'inactive').map((t) => t.id)
    const id = await page.evaluate(
      (ids) =>
        ids.find((x) => {
          const { colony } = window.botCrossing
          return colony.threads.get(x)?.state === 'inactive' && colony.buildings.has(x) && !colony.agentFor(x)
        }),
      closed
    )
    if (!id) throw new Error('no closed thread with a building left to resume')
    await applyRoster(ROSTERS.base.map((t) => (t.id === id ? { ...t, state: 'active' } : t)))
    await is(
      'its villager walks out rather than appearing on its tile',
      (x) =>
        window.__spawns.some((s) => s.id === x && s.walksOut === true) ||
        JSON.stringify({
          x,
          spawns: window.__spawns,
          roster: window.botCrossing.colony.astronauts.roster.map((e) => e.id),
          agent: window.botCrossing.colony.agentFor(x)?.state ?? null,
        }),
      id
    )
    await applyRoster(ROSTERS.base)
  })

  await step('put everything down', async () => {
    if (await page.evaluate(() => document.querySelector('.thread-pop').classList.contains('on'))) {
      await tap('#btn-deselect')
      await want('the card lets go', () => !document.querySelector('.thread-pop').classList.contains('on'))
    }
    // Guarded like the card above it: the View steps run on the all-repos list, so whether a
    // repo is still open by the time this step runs depends on which steps ran before it.
    if (await page.evaluate(() => document.querySelector('.side').classList.contains('drilled'))) {
      await click('#btn-close-project')
      await want('the panel is back on the repo list', () => !document.querySelector('.side').classList.contains('drilled'))
    }
    await page.keyboard.press('Escape')
    await click('#btn-hide')
    await want('the whole HUD is gone', () => document.querySelector('.hud').classList.contains('hidden'))
    // A hidden HUD is `pointer-events: none`, so its own button cannot bring it back — H is
    // the way a person does it from here, and the way the help sheet says to.
    await page.keyboard.press('h')
    await want('and comes back', () => !document.querySelector('.hud').classList.contains('hidden'))
  })

  // ── 15–16, medieval only ──────────────────────────────────────────────────────────────

  if (medieval) {
    await step('a ghost zone', async () => {
      await applyRoster(ROSTERS.ghost)
      await want('delta is on the map and reads as quiet', () => {
        const row = document.querySelector('.repo[data-name="delta"]')
        return Boolean(row && row.classList.contains('quiet') && /\d+d quiet/.test(row.querySelector('.count').textContent))
      })
      await openRepo('delta')
      await want(
        'delta holds one inactive thread',
        () => document.querySelector('.side .threads-head').textContent === '1 inactive'
      )
      await is('the plot has been dressed as a ghost', () => window.botCrossing.colony.plots.get('delta').decayed === true)
      await is('epsilon is down to its ruin', () => {
        const entry = window.botCrossing.colony.buildings.get('fx-epsilon-0')
        if (!entry) return 'no building for fx-epsilon-0'
        const mesh = entry.mesh
        return Boolean(mesh.userData.intact) && mesh.geometry !== mesh.userData.intact
      })
      await click('.side details[data-group="inactive"] > summary > span:first-child')
      await click('.side details[data-group="inactive"] .thread[data-id="fx-delta-0"] .mini[data-act="archive"]')
      await want('the row moves to Archived', () =>
        Boolean(document.querySelector('details[data-group="archived"] .thread[data-id="fx-delta-0"]'))
      )
      await is('and the zone is still standing', () => window.botCrossing.colony.plots.has('delta') === true)
      // Every thread in it is archived now, but the folder is still on disk.
      await want('and it still offers a new conversation', () => {
        const b = document.querySelector('#btn-new-session')
        return !b.disabled && document.querySelector('.side .path').textContent !== 'folder unknown'
      })
    })

    await step('helpers', async () => {
      await page.evaluate(() => window.botCrossing.settings.set('activeOnly', false))
      await applyRoster(ROSTERS.helpers)
      await openRepo(HELPER_REPO)
      await want(
        `${HELPER_REPO} shows its thread carrying two helpers`,
        (id) => {
          const chip = document.querySelector(`.thread[data-id="${id}"] .helpers`)
          return Boolean(chip) && chip.textContent === '+2'
        },
        HELPER_PARENT
      )
      // Selected the way a canvas pick does it: a helper id is in no roster, so nothing else
      // in the page can find one.
      await page.evaluate(() => window.botCrossing.hud.actions.select('helper:agent-fx-a'))
      await want('the helper card is up, with nothing to act on', () => {
        const card = document.querySelector('.thread-pop')
        return (
          card.classList.contains('on') &&
          card.classList.contains('helper') &&
          document.querySelector('.thread-pop .title').textContent === 'Explore' &&
          document.querySelector('.thread-pop .desc').textContent === 'reads the tree' &&
          document.querySelector('#btn-open').hidden === true &&
          document.querySelector('#btn-archive').hidden === true
        )
      })
      const since = puts.length
      await page.keyboard.press('a')
      await new Promise((r) => setTimeout(r, SAVE_MS))
      await is('A does nothing to a helper', () => document.querySelector('.thread-pop').classList.contains('on'))
      // Not "no PUT at all": the roster that just landed can queue a layout save of its own.
      // What A must not have done is archive the thread the helper is standing on.
      const archived = puts.slice(since).some((p) => (p.body.archived || []).includes(HELPER_PARENT))
      if (archived) throw new Error('A archived the helper’s parent thread')
      await page.keyboard.press('Escape')
      await want('Escape puts the card down', () => !document.querySelector('.thread-pop').classList.contains('on'))
    })

    // Last, because it leaves the page on another world. The valley's arrival is a boat, and a
    // boat's loop is its hull creaking from the hull, never the lander's hum; a keep has no loop
    // at all, and rings only when somebody walks out of it.
    await step('the ship creaks and nothing hums', async () => {
      const world = (id) =>
        page.evaluate((w) => {
          const { colony, settings } = window.botCrossing
          if (colony.setting?.id !== w) settings.set('setting', w)
        }, id)
      const sources = () =>
        page.evaluate(() => {
          const { colony, rig } = window.botCrossing
          return colony.soundWorld(rig.target).sources.map((s) => ({ id: s.id, sound: s.sound }))
        })

      await world('valley')
      await want(
        'the valley stands, its boat moored',
        () => {
          const c = window.botCrossing.colony
          return c.setting?.id === 'valley' && c.ceremony?.kind === 'boat' && Boolean(c.ceremony.ship)
        },
        null,
        ROSTER_MS
      )
      const valley = await sources()
      if (!valley.some((s) => s.sound === 'hull-creak')) throw new Error(`no hull-creak on the valley: ${JSON.stringify(valley)}`)
      if (valley.some((s) => s.sound === 'ship-hum')) throw new Error(`the valley hums: ${JSON.stringify(valley)}`)

      await world('forest')
      await want(
        'the forest stands, its keep built',
        () => {
          const c = window.botCrossing.colony
          return c.setting?.id === 'forest' && c.ceremony?.kind === 'castle'
        },
        null,
        ROSTER_MS
      )
      const forest = await sources()
      const loops = forest.filter((s) => s.id === 'ship' || s.sound === 'hull-creak' || s.sound === 'ship-hum')
      if (loops.length) throw new Error(`an arrival loop on the forest: ${JSON.stringify(loops)}`)
    })
  }

  // Reloads too. Each theme's menu shows only its own worlds (2026-10-01): a browser that stored
  // one the menu hides opens on the theme's default with that pressed, and Tab, which steps
  // through the worlds, stays on the menu and comes round to where it started.
  await step('settings: a stored world off the menu opens on the default', async () => {
    const [hidden, home] = medieval ? ['sakura', 'forest'] : ['forest', 'moon']
    await page.evaluate((id) => {
      const saved = JSON.parse(localStorage.getItem('botcrossing.settings.v1') || '{}')
      localStorage.setItem('botcrossing.settings.v1', JSON.stringify({ ...saved, setting: id }))
    }, hidden)
    await page.reload()
    await want('the page is back', () => Boolean(window.botCrossing && window.botCrossing.threads.length), null, BOOT_MS)
    await want(
      `it opens on ${home}, pressed, and ${hidden} is not on the menu`,
      ([home, hidden]) =>
        window.botCrossing.settings.get('setting') === home &&
        window.botCrossing.colony.setting.id === home &&
        document.querySelector(`.setting-btn[data-id="${home}"]`)?.getAttribute('aria-pressed') === 'true' &&
        !document.querySelector(`.setting-btn[data-id="${hidden}"]`),
      [home, hidden]
    )
    const menu = await page.evaluate(() => [...document.querySelectorAll('.row[data-key="setting"] .setting-btn')].map((b) => b.dataset.id))
    const seen = []
    for (let i = 0; i < menu.length; i++) {
      await page.evaluate(() => document.activeElement?.blur())
      await page.keyboard.press('Tab')
      seen.push(await page.evaluate(() => window.botCrossing.settings.get('setting')))
    }
    const off = seen.filter((id) => !menu.includes(id))
    if (off.length) throw new Error(`Tab stepped off the menu onto ${off.join(', ')}`)
    if (seen.at(-1) !== home || new Set(seen).size !== menu.length) throw new Error(`Tab went ${seen.join(' → ')}`)
  })

  // Last, because it reloads the page: what a browser stored beats the first-time state, both
  // ways — World, which starts open, comes up shut, and Look, which starts shut, comes up open.
  // The repo panel's View section is the exception: it never folds (2026-10-01), even for a
  // browser that remembered it folded before.
  await step('settings: a stored fold beats the first-time state', async () => {
    await page.evaluate(() => {
      localStorage.setItem('botcrossing.settings-fold.world', '0')
      localStorage.setItem('botcrossing.settings-fold.look', '1')
      localStorage.setItem('botcrossing.repo-view', '0')
    })
    await page.reload()
    await want('the page is back', () => Boolean(window.botCrossing && window.botCrossing.threads.length), null, BOOT_MS)
    await is(
      'World comes up shut and Look open',
      () =>
        !document.querySelector('.settings details.fold[data-fold="world"]').open &&
        document.querySelector('.settings details.fold[data-fold="look"]').open
    )
    await is('View is still shown', () => document.querySelector('.repo-view .chips')?.offsetParent !== null)
    await page.evaluate(() => {
      localStorage.removeItem('botcrossing.settings-fold.world')
      localStorage.removeItem('botcrossing.settings-fold.look')
      localStorage.removeItem('botcrossing.repo-view')
    })
  })

  for (const f of faults) console.log(`${theme}  FAIL teardown — ${f}`)
  stray += faults.length
  await page.close()
  await context.close()
  tally.push({ theme, passed, total: n, stray })
}

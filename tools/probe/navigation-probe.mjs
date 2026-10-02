/**
 * Does the crew reach its work sites? A long, deterministic run of a colony, counted at the end.
 *
 * The screenshot harness settles a colony for seventeen simulated seconds and counts `onSite`
 * once. That is a gate on a picture, not an answer to "can this figure get there at all": a
 * figure still walking at second seventeen and one pressed against a wall for good look the same
 * to it. This runs the same fixture colonies for `DURATION_S` of simulated time with the roster
 * re-polled every `POLL_FRAMES`, the way the page does it, and reports per colony:
 *
 *   - `figures`     crew on the roster at the end
 *   - `onSite`      standing (`at-site`), not given up, on the site the roster gave it — the
 *                   harness's own definition (`tools/visual/snapshot.mjs`, `shootAndCount`)
 *   - `gaveUp`      standing, but on ground it adopted instead of the site it was sent to
 *   - `siteChanges` roster sites that moved between one poll and the next, summed over the run
 *
 * It rebuilds the throwaway probe that first measured stranded figures (2026-09-15), on the
 * harness's machinery: headless Chromium on SwiftShader, Playwright's paused
 * clock advanced in whole 16 ms frames with the engine's delta pinned, a seeded `Math.random`,
 * the pinned fixture settings, every `/api/*` answered inside the browser, and no wake-up render.
 * Two runs of one tree give identical numbers.
 *
 * Where it departs from the harness, and why:
 *
 *   - The page's own 15-second poll timer is never armed; the probe calls `poll()` itself every
 *     `POLL_FRAMES`, with the clock paused, so each roster lands on a known frame. The harness
 *     refuses repeat polls instead, which is right for a 17-second shot and would hide exactly
 *     the site flips this counts.
 *   - Only the first `WARM_S` are drawn. After that `engine._draw` is a no-op: a SwiftShader
 *     frame costs ~40 ms and a probe steps 20 000 of them. Drawing is not simulation — every
 *     updater still runs every frame — but three allocates render targets lazily inside a draw
 *     and each allocation spends seeded draws, so the stream the crew is dealt from differs from
 *     a fully drawn run. That is a different seed, consistently, not a source of drift.
 *   - Each colony boots straight into its world (theme and setting in storage) on a page of its
 *     own, rather than switching worlds on a shared page.
 *
 * The app tree it drives is `--root` (default: this repository). A tree without the theme layer
 * — upstream bot-crossing, which has only the space colony and derives a thread's behaviour from
 * `running` rather than `state` — gets a small adapter below (`treeKind`), and only the space
 * colonies.
 *
 *   node tools/probe/navigation-probe.mjs --variant <name> --out <file> [--root <dir>]
 *       [--commit <sha>] [--only <colony>] [--real] [--no-fixture] [--jobs <n>]
 *   node tools/probe/navigation-probe.mjs --check <file> [--only <colony>]
 *
 * `--real` also runs every selected setting against this machine's real sessions, read-only:
 * `BOT_CROSSING_DATA` points at a fresh temp directory, the scan is taken once through the
 * tree's own `/api/threads`, and `data/colony.json` is hashed before and after and must not
 * change. `--check` re-runs the file's `chosen` variant at the current checkout and exits 1 if
 * any recorded `figures` or `onSite` differs.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')

/** Frame length, the same whole 16 ms tick the harness steps. */
const FRAME_MS = 16
/** Simulated seconds per colony: twenty rosters, long past any walk that can finish. */
const DURATION_S = 320
const TOTAL_FRAMES = (DURATION_S * 1000) / FRAME_MS
/** A roster every 16 s — the page polls every 15, and 15 s is not a whole number of frames. */
const POLL_FRAMES = 1000
/** Seconds drawn before drawing is switched off; the harness's own first settle. */
const WARM_S = 2
/** Frames advanced per clock call between polls. */
const CHUNK = 50
const SEED = 20260903
const SETTLE_VIEWPORT = { width: 128, height: 80 }
/** How far a roster site has to move to count as a change; the crew's own `SITE_MOVED`. */
const SITE_MOVED = 0.05
/** Upstream's arrival radius (`SEPARATION + 0.45`), for a tree that does not publish it. */
const FALLBACK_ARRIVE = 1.6

const { FIXTURE_THREADS, FIXTURE_STATE, FIXTURE_SETTINGS, SHOTS, NOW } = await import(
  pathToFileURL(join(REPO, 'tools', 'visual', 'fixture.mjs')).href
)

/** The fixture colonies, as the harness shoots them: theme, world and time of day. */
const COLONIES = Object.fromEntries(
  ['forest-day', 'valley-day', 'mountain-night', 'moon-day', 'terra-day'].map((name) => {
    const shot = SHOTS.find((s) => s.name === name)
    return [name, { theme: shot.theme || 'space', world: shot.world || 'moon', timeOfDay: shot.set.timeOfDay ?? FIXTURE_SETTINGS.timeOfDay }]
  })
)

// ── arguments ─────────────────────────────────────────────────────────────────────────────

function usage(msg) {
  if (msg) console.error(msg)
  console.error(
    'usage: navigation-probe.mjs --variant <name> --out <file> [--root <dir>] [--commit <sha>] [--only <colony>] [--real] [--no-fixture]\n' +
      '       navigation-probe.mjs --check <file> [--only <colony>]'
  )
  process.exit(2)
}
const argv = process.argv.slice(2)
const opt = (name) => {
  const i = argv.indexOf(name)
  if (i < 0) return null
  const v = argv[i + 1]
  if (!v || v.startsWith('--')) usage(`${name} needs a value`)
  return v
}
const flag = (name) => argv.includes(name)
const checkFile = opt('--check')
const variant = opt('--variant')
const outFile = opt('--out')
const root = resolve(opt('--root') || REPO)
const only = opt('--only')
const real = flag('--real')
const noFixture = flag('--no-fixture')
/** Pages run at once. Every colony is independent; five at once is one colony's wall time. */
const JOBS = Math.max(1, Number(opt('--jobs') || 5))
if (checkFile ? variant || outFile || real : !variant || !outFile) usage()
if (only && !COLONIES[only]) usage(`unknown colony "${only}" — one of ${Object.keys(COLONIES).join(', ')}`)

/**
 * What kind of app tree this is. The fork has a theme layer (`src/themes`) and a `state` on
 * every thread; upstream has neither, lays its worlds out under `planet`, and decides a thread's
 * behaviour from `running`. Everything the probe reads in the page is common to both.
 */
const treeKind = (dir) => (existsSync(join(dir, 'src', 'themes')) ? 'themed' : 'planetary')

function commitOf(dir) {
  const given = opt('--commit')
  if (given) return execFileSync('git', ['-C', REPO, 'rev-parse', `${given}^{commit}`], { encoding: 'utf8' }).trim()
  try {
    const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain', '--', 'src', 'index.html'], { encoding: 'utf8' }).trim()
    if (dirty) console.warn(`warning: ${dir} has uncommitted changes under src/ — the recorded commit is not the tree that ran`)
    return sha
  } catch {
    usage(`${dir} is not a git checkout: say which commit it is with --commit`)
  }
}

/**
 * A real-time bound on one step of driving the page. With the clock paused, anything in the page
 * that waits on a timer never finishes, and an unbounded await would leave the probe — and its
 * browser — sitting there for good instead of failing.
 */
const STEP_MS = 120_000
function within(promise, what) {
  let timer
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish in ${STEP_MS / 1000} s of real time`)), STEP_MS)
  })
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer))
}

// ── one colony ────────────────────────────────────────────────────────────────────────────

/**
 * Boot one page on one colony, run it for `DURATION_S` with a roster every `POLL_FRAMES`, and
 * count the crew at the end.
 *
 * @param {object} ctx      the browser and the server URL
 * @param {object} colony   { theme, world, timeOfDay }
 * @param {object} feed     { threads, state, now, settings } — what `/api/*` answers
 */
async function runColony(ctx, colony, feed) {
  // A context of its own: its own storage, which the settings live in, and its own renderer.
  const context = await ctx.browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  try {
    await page.addInitScript(
      ([seed, settings]) => {
        // mulberry32, as the harness seeds it.
        let a = seed >>> 0
        Math.random = () => {
          a = (a + 0x6d2b79f5) >>> 0
          let t = a
          t = Math.imul(t ^ (t >>> 15), t | 1)
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
        localStorage.setItem('botcrossing.settings.v1', JSON.stringify(settings))
        localStorage.setItem('botcrossing.seen-help', '1')
        // No wake-up render and no wake-up poll: both arrive in real time.
        for (const type of ['pageshow', 'focus', 'visibilitychange']) {
          window.addEventListener(
            type,
            (ev) => {
              if (ev.target === window || ev.target === document) ev.stopImmediatePropagation()
            },
            true
          )
        }
      },
      [SEED, feed.settings]
    )
    await page.clock.install({ time: feed.now - 1000 })
    await page.clock.pauseAt(feed.now)
    /**
     * The page's poll timer, disarmed. Registered after `clock.install` so it wraps the fake
     * `setInterval` rather than being replaced by it. The page arms exactly one 15-second
     * interval, and that is the poll; nothing else it runs repeats that slowly.
     */
    await page.addInitScript(() => {
      const arm = window.setInterval
      window.__pollTimers = 0
      window.setInterval = function (fn, ms, ...rest) {
        if (ms === 15000) {
          window.__pollTimers++
          return 0
        }
        return arm.call(this, fn, ms, ...rest)
      }
    })

    let strayPolls = 0
    await page.route('**/api/**', (route) => route.fulfill({ json: { ok: false, error: 'probe' } }))
    await page.route('**/api/state', (route) =>
      route.request().method() === 'PUT' ? route.fulfill({ json: { ok: true } }) : route.fulfill({ json: feed.state })
    )
    const answer = (route) => route.fulfill({ json: { threads: feed.threads, scannedAt: feed.now } })
    await page.route('**/api/threads', answer)

    await page.goto(ctx.url)
    const deadline = Date.now() + 180_000
    while (!(await page.evaluate(() => Boolean(window.botCrossing && window.botCrossing.threads.length)))) {
      if (errors.length) throw new Error(`page error during boot: ${errors[0]}`)
      if (Date.now() > deadline) throw new Error('boot did not complete in 180 s')
      await new Promise((r) => setTimeout(r, 50))
    }
    // From here every roster is one the probe asked for; anything else is counted and fails the run.
    await page.unroute('**/api/threads', answer)
    await page.route('**/api/threads', (route) => {
      strayPolls++
      return route.abort()
    })

    await page.evaluate((step) => {
      window.__frames = 0
      window.botCrossing.engine.add({ update: () => window.__frames++ })
      window.botCrossing.engine.timer.getDelta = () => step
      /** Every roster site, by agent id, as the colony handed it over. */
      window.__rosterSites = () => {
        const out = {}
        for (const e of window.botCrossing.colony.astronauts.roster || []) if (e.site) out[e.id] = [e.site.x, e.site.z]
        return out
      }
    }, FRAME_MS / 1000)
    await page.setViewportSize(SETTLE_VIEWPORT)
    await page.evaluate(() => window.botCrossing.engine.resize?.())

    async function runFrames(count) {
      const before = await page.evaluate(() => window.__frames)
      await within(page.clock.runFor(count * FRAME_MS), `${count} frames`)
      const drawn = (await page.evaluate(() => window.__frames)) - before
      if (drawn !== count) throw new Error(`asked for ${count} frames, the page ran ${drawn}`)
    }

    let sites = await page.evaluate(() => window.__rosterSites())
    let siteChanges = 0
    const warm = Math.round((WARM_S * 1000) / FRAME_MS)
    for (let f = 0; f < warm; f++) await runFrames(1)
    await page.evaluate(() => {
      const { engine } = window.botCrossing
      // An engine from before `_draw` existed draws straight through the renderer instead.
      if (engine._draw) engine._draw = () => {}
      else engine.renderer.render = () => {}
    })

    let frame = warm
    let nextPoll = POLL_FRAMES
    while (frame < TOTAL_FRAMES) {
      const to = Math.min(nextPoll, frame + CHUNK, TOTAL_FRAMES)
      await runFrames(to - frame)
      frame = to
      if (errors.length) throw new Error(`page error at frame ${frame}: ${errors[0]}`)
      if (frame === nextPoll && frame < TOTAL_FRAMES) {
        await page.route('**/api/threads', answer)
        await within(page.evaluate(() => window.botCrossing.poll()), `the poll at frame ${frame}`)
        await page.unroute('**/api/threads', answer)
        const now = await page.evaluate(() => window.__rosterSites())
        for (const [id, [x, z]] of Object.entries(now)) {
          const was = sites[id]
          if (was && Math.hypot(x - was[0], z - was[1]) > SITE_MOVED) siteChanges++
        }
        sites = now
        nextPoll += POLL_FRAMES
      }
    }
    if (strayPolls) throw new Error(`${strayPolls} poll(s) the probe did not ask for — the run is not deterministic`)
    const pollTimers = await page.evaluate(() => window.__pollTimers)
    if (pollTimers !== 1) throw new Error(`expected the page to arm one poll timer, it armed ${pollTimers}`)

    const counts = await page.evaluate((fallbackArrive) => {
      const { colony } = window.botCrossing
      const crew = colony.astronauts
      const arrive = crew.constructor.ARRIVE_RADIUS ?? fallbackArrive
      const given = new Map((crew.roster || []).map((e) => [e.id, e]))
      let figures = 0
      let onSite = 0
      let gaveUp = 0
      const stranded = []
      for (const a of crew.agents) {
        const entry = given.get(a.id)
        if (!entry || a.state === 'leaving' || a.state === 'gone') continue
        figures++
        const site = entry.site
        const kept = site && Math.hypot(a.site.x - site.x, a.site.z - site.z) < arrive
        // `shootAndCount`'s test, word for word.
        if (a.state === 'at-site' && !a.gaveUp && kept) {
          onSite++
          continue
        }
        if (a.state === 'at-site') gaveUp++
        const r = (n) => Math.round(n * 100) / 100
        stranded.push({
          id: a.id,
          status: a.status,
          state: a.state,
          // How far it stands from the site it was given, and whether any route exists to it.
          fromSite: site ? r(Math.hypot(a.pos.x - site.x, a.pos.z - site.z)) : null,
          reachable: site && colony.nav.isReachable ? colony.nav.isReachable(site.x, site.z) : null,
          blocked: site ? colony.nav.isBlocked(site.x, site.z) : null,
          gaveUp: Boolean(a.gaveUp) || (a.state === 'at-site' && !kept),
        })
      }
      // Where every figure ended up, to the micron: two runs that agree on this agree on everything.
      const where = crew.agents.map((a) => `${a.id}:${a.state}:${a.pos.x.toFixed(4)},${a.pos.z.toFixed(4)}`).sort().join('|')
      return { figures, onSite, gaveUp, stranded, where }
    }, FALLBACK_ARRIVE)
    const digest = createHash('sha256').update(counts.where).digest('hex').slice(0, 12)
    return { figures: counts.figures, onSite: counts.onSite, gaveUp: counts.gaveUp, siteChanges, stranded: counts.stranded, digest }
  } finally {
    await context.close()
  }
}

// ── feeds ─────────────────────────────────────────────────────────────────────────────────

/** Storage settings for one colony: the harness's pins, the world, and the time of day. */
function settingsFor(colony, base = FIXTURE_SETTINGS) {
  // Both world keys: `setting` since the theme layer, `planet` before it (and in upstream).
  return { ...base, theme: colony.theme, setting: colony.world, planet: colony.world, timeOfDay: colony.timeOfDay }
}

/** Upstream reads `running`, not `state`; the fork's fixture says `state: 'active'` for it. */
const adaptThreads = (kind, threads) => (kind === 'planetary' ? threads.map((t) => ({ ...t, running: t.state === 'active' })) : threads)

/**
 * Real sessions are read with the product's own liveness defaults rather than the harness's:
 * the harness counts closed sessions so its shots have twelve buildings, and a real colony
 * with that on would be every transcript on the machine.
 */
const REAL_SETTINGS = { ...FIXTURE_SETTINGS, activeOnly: true, countInactive: false }

/**
 * Run colonies side by side, `JOBS` pages at a time. Each page has its own paused clock and its
 * own seeded stream, so running them together changes how long a probe takes and nothing else.
 */
async function pool(items, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(JOBS, items.length) }, worker))
  return out
}

const sha256 = (file) => (existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : 'absent')

// ── run ───────────────────────────────────────────────────────────────────────────────────

/**
 * Serve one tree and run the colonies asked for. The data directory is always a fresh temp
 * directory, set before `createServer` loads the tree's `vite.config.js` and with it
 * `server/api.mjs`, which reads `BOT_CROSSING_DATA` once at import.
 */
async function runTree(dir, colonies, realColonies = null) {
  const kind = treeKind(dir)
  const dataDir = mkdtempSync(join(tmpdir(), 'nav-probe-'))
  process.env.BOT_CROSSING_DATA = dataDir
  const guarded = [...new Set([join(REPO, 'data', 'colony.json'), join(dir, 'data', 'colony.json')])]
  const before = guarded.map(sha256)

  const { chromium } = await import('playwright')
  const { createServer } = await import('vite')
  let server = null
  let browser = null
  const result = { colonies: {}, real: null }
  try {
    server = await createServer({
      root: dir,
      configFile: join(dir, 'vite.config.js'),
      server: { host: 'localhost', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**'] } },
      logLevel: 'error',
    })
    await server.listen()
    const url = `http://localhost:${server.httpServer.address().port}/`
    browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
    const ctx = { browser, url }

    const report = (label, r) => {
      console.log(`${label}: ${r.onSite}/${r.figures} on site, ${r.gaveUp} gave up, ${r.siteChanges} site changes [${r.digest}]`)
      for (const s of r.stranded) console.log('   not on site:', JSON.stringify(s))
    }
    const fixtureFeed = (name) => ({ threads: adaptThreads(kind, FIXTURE_THREADS), state: FIXTURE_STATE, now: NOW, settings: settingsFor(COLONIES[name]) })
    const fixture = await pool(colonies, (name) => runColony(ctx, COLONIES[name], fixtureFeed(name)))
    colonies.forEach((name, i) => {
      result.colonies[name] = fixture[i]
      report(name, fixture[i])
    })

    if (realColonies) {
      // One scan, through the tree's own server, served unchanged to every setting.
      const res = await fetch(`${url}api/threads`)
      if (!res.ok) throw new Error(`/api/threads answered ${res.status}`)
      const scan = await res.json()
      const threads = scan.threads || []
      const state = await (await fetch(`${url}api/state`)).json()
      result.real = { threads: threads.length, settings: {} }
      const realFeed = (name) => ({ threads, state, now: scan.scannedAt || Date.now(), settings: settingsFor(COLONIES[name], REAL_SETTINGS) })
      const runs = await pool(realColonies, (name) => runColony(ctx, COLONIES[name], realFeed(name)))
      realColonies.forEach((name, i) => {
        result.real.settings[name] = runs[i]
        report(`real ${name}`, runs[i])
      })
    }
  } finally {
    await browser?.close()
    await server?.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
  const after = guarded.map(sha256)
  guarded.forEach((file, i) => {
    if (before[i] !== after[i]) throw new Error(`${file} changed during the probe (${before[i]} -> ${after[i]})`)
  })
  if (realColonies) result.real.colonyJson = Object.fromEntries(guarded.map((f, i) => [f.startsWith(REPO) ? 'repo' : 'root', before[i] === after[i] ? 'unchanged' : 'CHANGED']))
  return result
}

/** The four numbers the file records, and the stranded detail when there is any. */
const row = (r) => ({ figures: r.figures, onSite: r.onSite, gaveUp: r.gaveUp, siteChanges: r.siteChanges, ...(r.stranded.length ? { stranded: r.stranded } : {}) })

async function record() {
  const kind = treeKind(root)
  const planetary = ['moon-day', 'terra-day']
  const wanted = only ? [only] : kind === 'planetary' ? planetary : Object.keys(COLONIES)
  if (noFixture && !real) usage('--no-fixture leaves nothing to run without --real')
  if (kind === 'planetary' && wanted.some((c) => COLONIES[c].theme !== 'space')) usage(`${root} has no medieval theme: only ${planetary.join(', ')}`)
  const commit = commitOf(root)
  const out = await runTree(root, noFixture ? [] : wanted, real ? wanted : null)

  const file = resolve(outFile)
  const doc = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  doc.variants ||= {}
  const old = doc.variants[variant]
  const same = old && old.commit === commit && old.duration === DURATION_S
  doc.variants[variant] = {
    commit,
    duration: DURATION_S,
    colonies: { ...(same ? old.colonies : {}), ...Object.fromEntries(Object.entries(out.colonies).map(([k, v]) => [k, row(v)])) },
    real: out.real
      ? {
          threads: out.real.threads,
          colonyJson: out.real.colonyJson,
          settings: { ...(same && old.real ? old.real.settings : {}), ...Object.fromEntries(Object.entries(out.real.settings).map(([k, v]) => [k, row(v)])) },
        }
      : same
        ? (old.real ?? null)
        : null,
  }
  doc.chosen ||= 'ours'
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')
  console.log(`wrote variants.${variant} (${commit.slice(0, 7)}) to ${outFile}`)
}

async function check() {
  const doc = JSON.parse(readFileSync(resolve(checkFile), 'utf8'))
  const run = doc.variants?.[doc.chosen]
  if (!run?.colonies || !Object.keys(run.colonies).length) {
    console.error(`${checkFile}: no recorded colonies for chosen variant "${doc.chosen}"`)
    process.exit(1)
  }
  if (run.duration !== DURATION_S) {
    console.error(`${checkFile}: recorded at ${run.duration} s, this probe runs ${DURATION_S} s`)
    process.exit(1)
  }
  const names = Object.keys(run.colonies).filter((c) => !only || c === only)
  if (!names.length) usage(`"${only}" is not recorded for ${doc.chosen}`)
  const got = await runTree(REPO, names)
  let bad = 0
  const lines = [['colony', 'recorded', 'now', ''].join('\t')]
  for (const c of names) {
    const want = run.colonies[c]
    const have = got.colonies[c]
    const ok = want.figures === have.figures && want.onSite === have.onSite
    if (!ok) bad++
    lines.push([c, `${want.onSite}/${want.figures}`, `${have.onSite}/${have.figures}`, ok ? 'ok' : 'DIFFERS'].join('\t'))
  }
  console.log(`\n${doc.chosen} at ${execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()} (recorded on ${run.commit.slice(0, 7)}), onSite/figures:`)
  console.log(lines.join('\n'))
  if (bad) {
    console.error(`\n${bad} colony row(s) differ from ${checkFile}`)
    process.exit(1)
  }
  console.log('\nall rows match')
}

try {
  if (checkFile) await check()
  else await record()
  process.exit(0)
} catch (err) {
  console.error(err.stack || err.message)
  process.exit(1)
}

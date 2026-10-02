# Contributing to Taskshire

Thanks for looking. Taskshire is a fork of [Bot Crossing](https://github.com/Station-Sciences/bot-crossing),
kept by one person in spare time, so this page starts with what to expect.

## What you can expect

**Best effort.** Issues and pull requests are welcome, and they are read when time allows. There
is no promised response time, and some may go unanswered for a while. Forking is always a
reasonable thing to do; this project is itself a fork.

- **Issues:** read. A clear report with the platform it happened on is the most useful thing
  you can send.
- **Pull requests:** welcome, one thing at a time. A small PR with evidence is far likelier to
  land than a large one.
- **Feature requests:** fine to open. Whether they get built depends on time and fit.

## Where a change belongs

- **The medieval theme, the HUD and the workflow** (thread states, recap, Resume, the repo
  list): here.
- **A bug in the space theme or in shared code you can reproduce on upstream's own `main`:**
  upstream, at [Station-Sciences/bot-crossing](https://github.com/Station-Sciences/bot-crossing). A fix
  that lands there reaches this fork at the next merge, and reaches everyone who runs the
  original too. His [CONTRIBUTING](https://github.com/Station-Sciences/bot-crossing/blob/main/CONTRIBUTING.md)
  explains how he takes pull requests.
- **Verification on a machine that isn't Windows.** This fork is developed on Windows. Reports
  and fixes from macOS and Linux, saying what you ran and what you saw, are especially welcome.

## Two rules that don't bend

- **Read-only towards every harness.** Taskshire reads each harness's own session files and
  never writes to them, and a change that writes to a harness will not be merged.
- **One file written, and it stays local.** `data/colony.json` is the only file the app writes.
  The server binds to `127.0.0.1` and answers only its own page. See "Keeping it local" in the
  README.

## Working on it

```bash
npm install && npm run dev
```

That is the whole loop: the API runs inside the Vite dev server. `npm start` builds and serves
the production page instead.

Three gates, in this order, and all three should be green before you open a PR:

```bash
npm test                                  # unit suite, seconds
node tools/visual/snapshot.mjs --check    # nine reference screenshots, byte-identical
npm run test:smoke                        # boots the page on each theme and clicks every HUD action
```

The two slower ones need `npx playwright install chromium` first. The screenshots use a fixed
roster, a pinned clock and seeded randomness, so a change that moves a single pixel shows up.
If yours is meant to, say so in the PR and include the before and after. The four space
screenshots are frozen: `--update` refuses them unless `ALLOW_SPACE_BASELINE=1` is set.

## What makes a PR easy to say yes to

- **Say what you verified, and on which machine.** Operating system, harness, roughly how many
  real threads, and what you clicked. The gates cover a fixture; your description covers the
  real world.
- **Match the surrounding code.** No semicolons, single quotes, 2-space indent. Comments explain
  *why*, especially why an obvious approach was rejected.
- **No new dependencies without a reason.** The runtime has two.
- **Never commit real session data.** Screenshots and fixtures should show fixture repos, not
  your own.

## Security

If you find something that reads files it should not, writes where it should not, or lets a web
page you merely visited drive the local server, open an issue that describes the shape of the
problem **without** a working exploit, and say that you have more detail to share privately. If
the same flaw is in upstream's code, it belongs in his tracker too.

## Licensing

By contributing you agree your work is under the [MIT licence](LICENSE), same as the rest. There
is no CLA. The bundled art is CC0 and listed in `public/assets/<theme>/CREDITS.md`; any art you
add must be CC0 or similarly unencumbered, with its source recorded there. The name *Bot
Crossing* belongs to upstream; see [TRADEMARKS.md](TRADEMARKS.md).

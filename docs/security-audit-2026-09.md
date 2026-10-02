# Security and privacy audit — September 2026

This fork reads every coding-agent transcript on the machine it runs on, serves what it finds
to a browser tab, and can open folders, editors and new agent sessions on request. Before the
repository went public, all four of those seams were audited: the local server, the page that
renders transcript text, the dependencies and build tools, and the repository's own history.
Nothing let a remote website run code on the machine, no secret had ever been committed, and the
dependency tree was clean. What the audit did find was a handful of local-network weaknesses in
the server, most of them inherited from upstream, one quoting bug of our own in a clipboard
command, and a history that named more of the owner's private work than the publishing plan had
accounted for. Every finding below is now fixed, and each fix that a test can hold has one.

## Threat model

The attacker is not someone at the keyboard. It is one of three things: a web page open in the
same browser, trying to reach the local server; another program or device on the machine or
the LAN; or hostile text inside a transcript. That last one is the interesting case. An agent
reads web pages and foreign repositories for a living, so a thread title, a working-directory
name or a branch name can carry whatever someone upstream of the agent chose to put there, and
this app renders all of them.

## Findings

Severity is judged for the default setup: `npm run dev` or `npm run serve` on one Windows
machine, bound to loopback. "Upstream" means the code was inherited unchanged from Bot Crossing
at `d05ac2f`.

| # | Severity | Where | Finding | Origin | Status |
|---|---|---|---|---|---|
| S1 | Medium-high | `server/api.mjs` `isLocalRequest`, `server/serve.mjs` | The same-origin check compared hostname only, so a page on any other localhost port counted as the app and could call the state-changing routes; under `dev`, Vite's permissive CORS layer also let it read replies. The static files had no `Host` check. | Upstream (issue Station-Sciences/bot-crossing#69) | Fixed |
| S2 | Medium | `resolveFolder`, `threadFolder` | Folder validation hardened: network paths are now refused before the filesystem is touched. | Upstream, carried into our `threadFolder` | Fixed |
| S3 | Medium | `server/serve.mjs`, `apiMiddleware` | Request handling hardened: a malformed request is answered with an error rather than reaching the process. | Upstream | Fixed |
| S4 | Low-medium | `server/serve.mjs`, `send()` | No security headers: no CSP, no `nosniff`, nothing forbidding the page from being framed. | Upstream (PR Station-Sciences/bot-crossing#66 proposes them) | Fixed |
| C1 | Low-medium | `src/main.js` new-session "Copy command" | The folder was pasted inside double quotes with no escaping, so a directory named `$(…)` ran a command when the copied line was pasted into a terminal. | Ours | Fixed |
| S5 | Low | `server/api.mjs` `runInTerminal`, `via:'terminal'` routes | The terminal launcher the page no longer uses hardened: it now accepts only plain folder names. | Upstream launcher, kept by us | Fixed |
| S6 | Low | `server/api.mjs` state write | State-file writes hardened: a failed save is reported to the page and the server carries on. | Upstream | Fixed |
| S7 | Low | GET routes | A GET with no Origin from another site or another localhost port was allowed; a page could not read the answer but could force repeated full rescans. | Upstream | Fixed |
| S8 | Low | LAN mode | Bound to `0.0.0.0`, the server has no authentication; a LAN device can forge the headers a browser cannot. Opt-in only. | Upstream | Documented |
| D1 | Low | `package.json` | Version floors for `playwright` and `sharp` still admitted releases with known advisories; the lockfile already pinned fixed versions, so only a lockfile-free install was exposed. | Ours | Fixed |
| D2 | Low | `tools/contact-sheets/contact-sheets.mjs` | The tool's throwaway file server joined decoded URL paths without checking they stayed inside its roots. Loopback, random port, no CORS. | Ours | Fixed |
| I1 | Info | `src/main.js` | `window.botCrossing` debug handle shipped in production builds. Same-origin only. | Upstream | Fixed |
| I2 | Info | `spawn('rundll32', …)` | Launched by bare name rather than its System32 path. | Ours (Windows port) | Fixed |

## Privacy: what the history would publish

No credential of any kind appears in any blob or commit message across all reachable commits:
no API keys, tokens, private keys, `.env` files, `settings.local.json`, colony files,
transcripts, raw asset packs or licensed audio. Every image in history was checked against the
fixture that renders it, and none shows a real repository name or path.

What the history did carry was identity: the owner's personal address as commit author, the
names of several private projects and a few local paths in the changelog, the design specs and
plans, and three test fixtures, and private session links in many commit messages and plans.
None of that history is published: the public fork is upstream's history plus a single commit
on top of `d05ac2f`, authored with a no-reply address, and the development notes (changelog,
specs, plans) are kept out of the repository. The working tree was swept of the project names
and paths before that commit, and the ignore list now also keeps out environment-file variants, local data directories, transcript dumps, 3D source
files, archives and npm credentials.

## Checked and found sound

The server binds to `127.0.0.1` and Vite to `localhost` by default, and no script passes
`--host`. A rebound `Host`, a foreign `Origin` and `Origin: null` are all refused on the routes
that change anything. Every launch is an argument list, never a command string; the one path
that passes through `cmd.exe` is the unused terminal launcher's last fallback, which S5 now
restricts to plain folder names. The only strings that reach `rundll32` are existing, normalised folders or links built
on a fixed scheme with percent-encoded parts. Session ids are checked against strict patterns,
recaps are read only by id from the harness's own store, and the only file the server writes is
`colony.json` beside its temp file, at a path no request can steer. On the page, every place
transcript text meets `innerHTML` goes through an escape helper that covers all five special
characters, nothing builds a URL from API data, and no query parameter loads a file or script.
`npm audit` reports nothing against the committed lockfile, every package resolves from the npm
registry with an integrity hash, nothing runs on install, and there is no CI configuration to
misconfigure.

## What was changed

**S1 — the page, and only the page.** Following the fix proposed in upstream issue Station-Sciences/bot-crossing#69, an
`Origin` header now has to name exactly the server's own host and port, so a page on another
localhost port is a stranger rather than a neighbour; an `Origin` that does not parse is
refused. A POST or PUT whose body is not `application/json` is answered with 415, which closes
the one request shape a hostile page can send without a CORS preflight. The page has always sent
JSON, so nothing changed for it. The static files now get the same `Host` check as the API, and
the Vite dev server runs with `cors: false`. Tests cover an other-port `Origin` (403), a
`text/plain` POST (415), a matching JSON POST (still served) and a rebound `Host` on the bundle
(403).

**S2 — hardened.** `resolveFolder`, which every folder the page names passes through, refuses
any path that begins with two slashes or backslashes before a single filesystem call is made.
A test records every filesystem call during the request and checks none of them saw the path.

**S3 — hardened.** `serve.mjs` answers a URL it cannot decode with 400, and the whole request
handler is wrapped so that anything unexpected becomes a 500 with the usual headers. The API
does the same for a URL it cannot parse, and its mount in the Vite dev server passes any failure
on to Vite's own error handling. Tests send malformed requests to both and check the server still
answers the next one.

**S4 — security headers.** Ported from upstream PR Station-Sciences/bot-crossing#66: every answer from `serve.mjs` — hits,
misses, refusals and errors alike — carries a Content-Security-Policy that allows only the
page's own script, styles, models and audio, plus the `data:` and `blob:` URLs three.js uses for
textures, together with `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
`Referrer-Policy: no-referrer`. API answers carry `nosniff` too, and `colony.json` is written
readable by its owner only. The built page was loaded under the policy with the console open:
no violations, models textured (their embedded textures load through `blob:`), and the sound
manifest loaded; the game synthesises its sounds through Web Audio, which the policy does not
touch.

**S5 — hardened.** The terminal launcher stays, because it is the planned basis for a fourth
"Resume opens" choice, but it now refuses a working directory containing a shell metacharacter
or a line break, and applies S2's rule, before it touches the disk. Tested.

**S6 — hardened.** The state write is awaited inside its error handler (shipped just before the
audit, in the fix that lets a save survive a locked `colony.json`), and a test proves a save that cannot land is a 500 the server survives.

**S7 — requests from other sites.** An API request the browser marks with any `Sec-Fetch-Site`
other than `same-origin` or `none` is refused, which covers pages on other localhost ports
(`same-site`) as well as the wider web. Top-level navigation to the page itself is unaffected.
Tested.

**S8 — documented.** LAN mode stays opt-in and unauthenticated by design; the README's "Serving
it to your network" section now says so for both `BOT_CROSSING_HOST=0.0.0.0` and
`npm run dev -- --host`.

**C1 — quoting.** "Copy command" now single-quotes the folder for the shell its shape implies:
for a drive-letter or network path, `Set-Location -LiteralPath` with PowerShell quoting, where
every quote character PowerShell honours — the typographic single quotes as well as `'` — is
doubled; for everything else, POSIX quoting (`'` becomes `'\''`). A unit test covers both
shells with straight and typographic quotes, brackets, `$(…)`, backticks, variables and spaces.

**D1 — dependency floors.** `playwright` now asks for `^1.55.1` and `sharp` for `^0.35.4`, in
both `package.json` and the lockfile's root entry; the versions the lockfile resolves already
met them.

**D2 — contact sheets.** The tool's file server resolves each request, answers 404 for anything
outside its roots and 400 for a path it cannot decode. The check lives in a small module with its
own tests.

**I1 — debug handle.** `window.botCrossing` is set only in development builds, where the smoke
and navigation harnesses use it.

**I2 — rundll32.** Spawned by its full path under `%SystemRoot%\System32`.

## Reproduction

```
npm audit --omit=dev
npm test
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Origin: http://localhost:9999' \
  -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:5274/api/recap
```

The last line answered 200 before S1 was fixed, and answers 403 now.

import { defineConfig } from 'vite'
import { apiMiddleware } from './server/api.mjs'

/**
 * Serves /api from inside the Vite dev server, so `npm run dev` is the whole game. Connect never
 * looks at the promise a middleware returns, so anything the API rejects with is handed to `next`
 * and answered by Vite's own error handler rather than left unhandled.
 */
const api = () => ({
  name: 'bot-crossing-api',
  configureServer(server) {
    server.middlewares.use((req, res, next) => apiMiddleware(req, res, next).catch(next))
  },
})

/**
 * Everything `main.js` imports statically, except the page's entry and `main.js` itself, goes
 * into one shared `app` chunk. `main.js` awaits its theme at module scope, and by default Rollup leaves the shared code
 * in the entry chunk, so the lazy medieval chunk imported the entry back: the entry waited on
 * the theme, the theme waited on the entry, and the built page never got past "Scanning for
 * agent threads…". With the shared code in its own chunk, a lazy theme imports `app` and never
 * the entry. Modules reached only through a dynamic import keep the default split, so each
 * theme still loads on demand. Build only: the dev server serves modules unbundled.
 */
function appChunk(id, { getModuleInfo }) {
  if (getModuleInfo(id)?.isEntry || /[\\/]src[\\/]main\.js$/.test(id)) return undefined
  const seen = new Set()
  const staticFromEntry = (m) => {
    if (seen.has(m)) return false
    seen.add(m)
    const info = getModuleInfo(m)
    return !!info && (info.isEntry || info.importers.some(staticFromEntry))
  }
  return staticFromEntry(id) ? 'app' : undefined
}

export default defineConfig({
  plugins: [api()],
  // PORT lets a second copy run alongside the first without a flag on the command line.
  // `cors: false` because Vite's own CORS layer answers preflights for any localhost origin,
  // which would let a page on another local port read what `/api` sends back; the page and
  // the API share an origin, so it needs no CORS at all.
  server: { port: Number(process.env.PORT) || 5274, strictPort: false, cors: false },
  build: { target: 'esnext', rollupOptions: { output: { manualChunks: appChunk } } },
})

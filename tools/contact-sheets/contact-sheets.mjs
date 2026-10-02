/**
 * Renders every model in the raw KayKit packs into labelled contact sheets, one PNG per
 * category (characters, buildings, units, items, nature, props, tiles), so the whole
 * catalogue can be browsed at a glance. Reads the packs from ASSETS_SRC (`.env`) and writes
 * the sheets to `<ASSETS_SRC>/contact-sheets/` — renders of the paid packs, so never into git.
 *
 * Usage: contact-sheets.mjs [filter]   e.g. `contact-sheets.mjs 01_char` for one sheet
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { readEnv } from '../read-env.mjs';
import { decodedPath, within } from './serve-path.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const SRC = readEnv(path.join(REPO, '.env')).ASSETS_SRC;
if (!SRC || !fs.existsSync(SRC)) {
  console.error('ASSETS_SRC is unset or missing; point it at the unzipped KayKit packs in .env');
  process.exit(2);
}
const OUT = path.join(SRC, 'contact-sheets');

const ADV = 'KayKit_Adventurers_2.0_SOURCE/KayKit_Adventurers_2.0_SOURCE';
const MED = 'KayKit_Medieval_Hexagon_Pack_1.0_SOURCE/KayKit_Medieval_Hexagon_Pack_1.0_SOURCE/Assets/gltf';
const ANI = 'KayKit_Character_Animations_1.1/KayKit_Character_Animations_1.1';

const list = (rel, ext = /\.(gltf|glb)$/) =>
  fs.readdirSync(path.join(SRC, rel)).filter(f => ext.test(f)).sort()
    .map(f => ({ url: `/src/${rel}/${f}`, label: f.replace(/\.(gltf|glb)$/, '') }));
const COLOURS = ['blue', 'green', 'red', 'yellow'];

const rig = n => `/src/${ANI}/Animations/gltf/Rig_${n}/Rig_${n}_General.glb`;
const chars = list(`${ADV}/Characters/gltf`).map(i => ({ ...i, front: true, anim: rig(/Large/.test(i.label) ? 'Large' : 'Medium') }));
const manne = list(`${ANI}/Mannequin Character/characters`).map(i => ({ ...i, front: true, anim: rig(/Large/.test(i.label) ? 'Large' : 'Medium') }));

const sheets = [
  { file: '01_characters.png', title: 'Characters', cell: 300, cols: 6,
    subtitle: 'KayKit Adventurers 2.0 (rigged, shown in Idle pose) + Character Animations 1.1 mannequins',
    sections: [{ title: 'Adventurers 2.0 — heroes', items: chars }, { title: 'Character Animations 1.1 — mannequins', items: manne }] },
  { file: '02_buildings.png', title: 'Buildings', cell: 180, cols: 11,
    subtitle: 'KayKit Medieval Hexagon 1.0 — neutral structures, then every faction building per team colour',
    sections: [{ title: 'Neutral — construction stages, walls, fences, bridges', items: list(`${MED}/buildings/neutral`) },
      ...COLOURS.map(c => ({ title: `Faction buildings — ${c}`, items: list(`${MED}/buildings/${c}`) }))] },
  { file: '03_units.png', title: 'Units & Equipment', cell: 170, cols: 12,
    subtitle: 'KayKit Medieval Hexagon 1.0 — neutral units, then team-coloured units (_full = whole piece tinted, _accent = trim only)',
    sections: [{ title: 'Neutral', items: list(`${MED}/units/neutral`) },
      ...COLOURS.map(c => ({ title: `Team — ${c}`, items: list(`${MED}/units/${c}`) }))] },
  { file: '04_items.png', title: 'Items', cell: 180, cols: 10,
    subtitle: 'KayKit Adventurers 2.0 — weapons, shields, potions, books, mugs, crates',
    sections: [{ title: 'Adventurers 2.0 — assets', items: list(`${ADV}/Assets/gltf`) }] },
  { file: '05_nature.png', title: 'Nature', cell: 170, cols: 11,
    subtitle: 'KayKit Medieval Hexagon 1.0 — trees, rocks, hills, mountains, clouds, plants',
    sections: [{ title: 'Decoration — nature', items: list(`${MED}/decoration/nature`) }] },
  { file: '06_props.png', title: 'Props', cell: 170, cols: 10,
    subtitle: 'KayKit Medieval Hexagon 1.0 — barrels, crates, flags, tents, resources',
    sections: [{ title: 'Decoration — props', items: list(`${MED}/decoration/props`) }] },
  { file: '07_tiles.png', title: 'Hex Tiles', cell: 160, cols: 12,
    subtitle: 'KayKit Medieval Hexagon 1.0 — base, coast, river and road tiles (waterless = no water surface mesh)',
    sections: [
      { title: 'Base', items: list(`${MED}/tiles/base`) },
      { title: 'Coast', items: list(`${MED}/tiles/coast`) }, { title: 'Coast — waterless', items: list(`${MED}/tiles/coast/waterless`) },
      { title: 'Rivers', items: list(`${MED}/tiles/rivers`) }, { title: 'Rivers — waterless', items: list(`${MED}/tiles/rivers/waterless`) },
      { title: 'Roads', items: list(`${MED}/tiles/roads`) }] },
];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg' };
const PAGE = path.join(HERE, 'page.html');
// Every path is resolved and held inside its own root (serve-path.mjs): a `..` is a 404.
const server = http.createServer((req, res) => {
  const u = decodedPath(req.url);
  if (u === null) { res.writeHead(400); return res.end(); }
  let f = u === '/' ? PAGE
    : u.startsWith('/three/') ? within(path.join(REPO, 'node_modules/three'), u.slice(7))
    : u.startsWith('/src/') ? within(SRC, u.slice(5)) : null;
  if (!f || !fs.statSync(f, { throwIfNoEntry: false })?.isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('[page]', m.text()); });
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.ready);
const only = process.argv[2];
for (const s of sheets) {
  if (only && !s.file.includes(only)) continue;
  const t = Date.now();
  const r = await page.evaluate(sh => window.buildSheet(sh), s);
  fs.writeFileSync(path.join(OUT, s.file), Buffer.from(r.png.split(',')[1], 'base64'));
  const n = s.sections.reduce((a, x) => a + x.items.length, 0);
  console.log(`${s.file}: ${n} items, ${r.w}x${r.h}, ${((Date.now() - t) / 1000).toFixed(0)}s`, r.failed.length ? r.failed : '');
}
await browser.close(); server.close();

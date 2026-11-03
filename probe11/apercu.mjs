// Sonde n°11 : aperçus avec de VRAIES données (tuiles IGN, géologie et météo en ligne, zones
// construites dans ce job), plus la version de production servie par `vite preview`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';

const OUT = 'verif/';
mkdirSync(OUT, { recursive: true });
const CORS = { 'access-control-allow-origin': '*' };
const TERMS_VERSION = readFileSync('src/legal.ts', 'utf8').match(/TERMS_VERSION = '([^']+)'/)[1];
const notes = [];
const note = (...a) => {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  notes.push(line);
  console.log(line);
};

const dev = await createServer({ server: { port: 5300, strictPort: true, open: false }, logLevel: 'error' });
await dev.listen();
const base = dev.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function openMap({ view, state = {}, width = 1440, height = 900, mobile = false, accept = true }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await context.addInitScript(
    ([v, s, ok]) => {
      if (ok) localStorage.setItem('foret-explorer:avertissement', JSON.stringify({ v, t: Date.now() }));
      localStorage.setItem('foret-explorer:v1', JSON.stringify(s));
    },
    [TERMS_VERSION, state, accept],
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Zones : tuiles construites dans ce job (le site en ligne ne les a pas encore).
  await page.route('https://aligotaure.github.io/foret-explorer/data/zones/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace('/foret-explorer/data/zones/', '');
    const file = `public/data/zones/${rel}`;
    if (!existsSync(file)) return route.fulfill({ status: 404, headers: CORS, body: '' });
    return route.fulfill({ status: 200, headers: CORS, contentType: rel.endsWith('.json') ? 'application/json' : 'application/x-protobuf', body: readFileSync(file) });
  });
  await page.goto(`${base}#carte=${view}`);
  if (accept) await page.waitForFunction(() => window.map && window.map.loaded(), null, { timeout: 60000 });
  return { context, page, errors };
}

const idle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const m = window.map;
        const done = () => setTimeout(resolve, 400);
        if (m.loaded() && m.areTilesLoaded()) done();
        else m.once('idle', done);
      }),
  );

/** Centre (boîte englobante) de la première zone dont le nom correspond. */
const findZone = (page, sourceLayer, pattern) =>
  page.evaluate(
    ([layer, src]) => {
      const re = new RegExp(src, 'i');
      const f = window.map.querySourceFeatures('zones', { sourceLayer: layer }).find((x) => re.test(String(x.properties.nom)));
      if (!f) return null;
      const pts = JSON.stringify(f.geometry.coordinates).match(/-?\d+\.\d+,-?\d+\.\d+/g).map((p) => p.split(',').map(Number));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return { nom: f.properties.nom, center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] };
    },
    [sourceLayer, pattern],
  );

/** Point de l'écran le plus central qui vérifie `kind` (réserve, forêt publique ou forêt privée). */
const pickPoint = (page, kind, pattern = '.') =>
  page.evaluate(
    ([k, src]) => {
      const re = new RegExp(src, 'i');
      const m = window.map;
      const W = m.getCanvas().clientWidth;
      const H = m.getCanvas().clientHeight;
      let best = null;
      for (let y = 110; y < H - 60; y += 10) {
        for (let x = 400; x < W - 440; x += 10) {
          const hit = (layer) => m.queryRenderedFeatures([x, y], { layers: [layer] });
          const prot = hit('zones-protegees-hit');
          const pub = hit('forets-publiques-hit');
          const forest = hit('bdforet-hit').length > 0;
          const ok =
            k === 'reserve' ? prot.some((f) => re.test(f.properties.nom)) : k === 'publique' ? pub.some((f) => re.test(f.properties.nom)) && !prot.length : forest && !pub.length && !prot.length;
          if (!ok) continue;
          const d = Math.hypot(x - (400 + W - 440) / 2, y - H / 2);
          if (!best || d < best.d) best = { x, y, d };
        }
      }
      return best;
    },
    [kind, pattern],
  );

async function bilan(name, { view, kind, layer, pattern, state }) {
  const { context, page, errors } = await openMap({ view, state });
  await idle(page);
  if (layer) {
    const z = await findZone(page, layer, pattern);
    note(name, 'zone trouvée :', z);
    if (z) {
      await page.evaluate((c) => window.map.jumpTo({ center: c, zoom: 14.2 }), z.center);
      await idle(page);
    }
  }
  const pt = await pickPoint(page, kind, pattern ?? '.');
  if (!pt) {
    note(name, 'aucun point trouvé');
    await page.screenshot({ path: `${OUT}${name}.png` });
    await context.close();
    return;
  }
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('#spot .verdict', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  const rules = await page.evaluate(() => {
    const s = [...document.querySelectorAll('#spot .spot__section')].find((x) => x.querySelector('.spot__title')?.textContent === 'Droit de cueillir');
    return s?.textContent.replace(/\s+/g, ' ');
  });
  note(name, 'bilan :', rules, errors.length ? `ERREURS ${errors.join(' | ')}` : 'sans erreur');
  await page.screenshot({ path: `${OUT}${name}.png` });
  await context.close();
}

// 1. Vue d'ensemble : lac d'Annecy, zones protégées et forêts publiques, section « Où cueillir » ouverte.
{
  const { context, page, errors } = await openMap({ view: '12/45.855/6.19', state: { zones: true, publicForests: true } });
  await idle(page);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('#legend .layer__title')].find((x) => x.textContent === 'Où cueillir');
    t?.closest('.layer__header')?.querySelector('.layer__toggle')?.click();
    t?.closest('.layer')?.scrollIntoView();
  });
  await page.waitForTimeout(400);
  const counts = await page.evaluate(() => {
    const prot = window.map.querySourceFeatures('zones', { sourceLayer: 'protection' });
    const pub = window.map.querySourceFeatures('zones', { sourceLayer: 'foret_publique' });
    return {
      protection: [...new Set(prot.map((f) => `${f.properties.type}:${f.properties.nom}`))].slice(0, 40),
      forets: [...new Set(pub.map((f) => f.properties.nom))].slice(0, 25),
      legende: document.querySelector('.legend-card--zones')?.closest('.layer__content')?.textContent.replace(/\s+/g, ' ').slice(0, 400),
    };
  });
  note('vue lac :', counts, errors.length ? `ERREURS ${errors.join(' | ')}` : 'sans erreur');
  await page.screenshot({ path: `${OUT}a1-lac-annecy-zones.png` });
  await context.close();
}

// 2. Bilans réels : réserve du Roc de Chère, forêt communale, forêt privée.
await bilan('a2-bilan-roc-de-chere', { view: '13.5/45.848/6.200', kind: 'reserve', layer: 'protection', pattern: 'Roc de ch', state: { zones: true } });
await bilan('a3-bilan-foret-communale', { view: '12/45.86/6.11', kind: 'publique', layer: 'foret_publique', pattern: "Annecy", state: { zones: true, publicForests: true } });
await bilan('a4-bilan-foret-privee', { view: '14/45.935/6.205', kind: 'privee', state: { zones: true, publicForests: true } });

// 3. Avertissement sur mobile, avec la vraie carte derrière.
{
  const { context, page } = await openMap({ view: '12/45.9/6.15', mobile: true, width: 390, height: 844, accept: false });
  await page.waitForSelector('dialog.disclaimer[open]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}a5-mobile-avertissement.png` });
  await page.evaluate(() => document.querySelector('.disclaimer__body').scrollTo(0, 9999));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}a6-mobile-avertissement-bas.png` });
  await context.close();
}

// 4. Page « À propos » (mobile et bureau, page entière).
for (const [name, opts] of [
  ['a7-a-propos-mobile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['a8-a-propos-bureau', { viewport: { width: 1280, height: 900 } }],
]) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  await page.goto(`${base}a-propos.html`);
  await page.waitForSelector('[data-stored-list] li');
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
  note(name, 'débordement horizontal :', await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
  await context.close();
}
await dev.close();

// 5. Version de production (dist/) : avertissement, page À propos, zones servies avec le site.
{
  const server = await preview({ preview: { port: 4173, strictPort: true } });
  const url = server.resolvedUrls.local[0];
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const zoneRequests = [];
  page.on('response', (r) => r.url().includes('/data/zones/') && zoneRequests.push(`${r.status()} ${r.url().replace(url, '')}`));
  await page.goto(`${url}#carte=13/45.848/6.2`);
  await page.waitForSelector('dialog.disclaimer[open]', { timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}a9-production-avertissement.png` });
  await page.locator('.disclaimer__accept').click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}a10-production-carte.png` });
  note('production :', { erreurs: errors, zones: zoneRequests.slice(0, 6), nbZones: zoneRequests.length });
  const about = await (await fetch(`${url}a-propos.html`)).text();
  note('production a-propos.html :', about.includes('Mentions légales') ? 'présente' : 'ABSENTE');
  await context.close();
  await server.httpServer.close();
}

await browser.close();
writeFileSync(`${OUT}notes.txt`, `${notes.join('\n')}\n`);

// Test de bout en bout : vrai MapLibre dans Chromium, services IGN simulés (mocks.mjs).
//
//   npx playwright install chromium   # une seule fois
//   npm run test:e2e                  # démarre Vite, teste, s'arrête
//
// Variables : BASE_URL=http://… pour tester un serveur déjà lancé (il doit exposer
// window.map, c.-à-d. tourner en mode développement) ; HEADED=1 pour voir le navigateur.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const OUT = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Attend que la carte ait fini de charger et de dessiner. */
const idle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const m = window.map;
        if (m.loaded() && m.areTilesLoaded()) setTimeout(resolve, 150);
        else m.once('idle', () => setTimeout(resolve, 150));
      }),
  );
const renderedCodes = (page) =>
  page.evaluate(() =>
    [...new Set(window.map.queryRenderedFeatures({ layers: ['bdforet-fill'] }).map((f) => f.properties.code_tfv))].sort(),
  );
const waitForMap = (page) =>
  page.waitForFunction(() => window.map && window.map.loaded(), null, { timeout: 30000 });

async function startServer() {
  if (process.env.BASE_URL) return { url: process.env.BASE_URL, close: async () => {} };
  const { createServer } = await import('vite');
  const server = await createServer({ server: { port: 5199, strictPort: false, open: false }, logLevel: 'error' });
  await server.listen();
  const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/';
  return { url, close: () => server.close() };
}

async function desktopTests(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const log = { tms: [], wmts: [], geocode: [], other: [] };
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
  await installMocks(page, log);

  await page.goto(base);
  await waitForMap(page);
  await idle(page);

  // Légende et services appelés
  const legend = await page.evaluate(() => ({
    items: document.querySelectorAll('.legend-item').length,
    groups: document.querySelectorAll('.legend-group').length,
    checked: document.querySelectorAll('.legend-item input:checked').length,
  }));
  check('légende : 32 types en 5 groupes, tous cochés', legend.items === 32 && legend.groups === 5 && legend.checked === 32, JSON.stringify(legend));
  check('tuiles vectorielles BD Forêt demandées (zoom ≥ 10)', log.tms.length > 0 && log.tms.every((t) => +t.split('/')[0] >= 10), log.tms.slice(0, 3).join(', '));
  check('fond Plan IGN demandé (TILEMATRIXSET=PM)', log.wmts.some((w) => w.startsWith('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2|PM|')));
  check('aucune requête inattendue vers data.geopf.fr', log.other.length === 0, log.other.join(', '));

  let codes = await renderedCodes(page);
  check('polygones dessinés', codes.length >= 4, codes.join(', '));
  const fillColor = await page.evaluate(() => JSON.stringify(window.map.getPaintProperty('bdforet-fill', 'fill-color')));
  check('couleur pilotée par code_tfv', fillColor.startsWith('["match",["get","code_tfv"]'));
  await page.screenshot({ path: `${OUT}01-bureau.png` });

  const sections = await page.evaluate(() => [...document.querySelectorAll('#legend .layer__title')].map((t) => t.textContent));
  check('légende : 5 sections', sections.length === 5 && sections[0] === 'Je cherche…', sections.join(' | '));

  // Comptages
  const counts = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('li[data-code]')]
        .map((li) => [li.dataset.code, li.querySelector('.legend-item__count')])
        .filter(([, el]) => el && !el.hidden)
        .map(([code, el]) => [code, el.textContent]),
    ),
  );
  check('pastilles de comptage', counts['FF1G01-01'] && counts['FF1G01-01'] !== '0', `chênes=${counts['FF1G01-01']}`);
  check('polygone sur plusieurs tuiles compté une fois', counts['LA4'] === '1', `LA4=${counts['LA4']}`);
  check('type absent compté 0', counts['FF2-51-51'] === '0');

  // Préréglage « Chênes »
  await page.getByRole('button', { name: 'Chênes', exact: true }).click();
  await idle(page);
  codes = await renderedCodes(page);
  const filter = await page.evaluate(() => JSON.stringify(window.map.getFilter('bdforet-fill')));
  check('préréglage Chênes → filtre MapLibre', filter === '["in",["get","code_tfv"],["literal",["FF1G01-01","FF1G06-06"]]]', filter);
  check('préréglage Chênes → seuls les chênes restent', codes.length === 1 && codes[0] === 'FF1G01-01', codes.join(', '));
  const badge = await page.evaluate(() => {
    const b = document.querySelector('#legend-toggle .badge');
    return b && !b.hidden ? b.textContent : null;
  });
  check('pastille du bouton légende = 2', badge === '2', String(badge));
  await page.screenshot({ path: `${OUT}02-bureau-chenes.png` });

  // Case individuelle, case de groupe, double-clic
  await page.locator('li[data-code="FF1-09-09"] input').check();
  await idle(page);
  codes = await renderedCodes(page);
  check('cocher Hêtre l’ajoute', codes.includes('FF1-09-09') && codes.includes('FF1G01-01'), codes.join(', '));

  await page.locator('input[data-group="coniferes"]').check();
  await idle(page);
  const groups = await page.evaluate(() => ({
    coniferes: document.querySelector('input[data-group="coniferes"]').checked,
    feuillusPartiel: document.querySelector('input[data-group="feuillus"]').indeterminate,
  }));
  codes = await renderedCodes(page);
  check('case de groupe : tous les conifères', groups.coniferes && codes.includes('FF2G61-61'));
  check('groupe partiellement coché = indéterminé', groups.feuillusPartiel);

  await page.locator('li[data-code="FF2G61-61"] .legend-item__label').dblclick();
  await idle(page);
  codes = await renderedCodes(page);
  check('double-clic → ce type seulement', codes.length === 1 && codes[0] === 'FF2G61-61', codes.join(', '));

  // « Tous les types » + « Seulement les types présents »
  await page.locator('.legend-all input').check();
  await page.getByText('Seulement les types présents dans la zone').click();
  await idle(page);
  const visibleRows = await page.evaluate(() =>
    [...document.querySelectorAll('li[data-code]')].filter((li) => !li.hidden).map((li) => li.dataset.code),
  );
  check('« présents » : seuls les types de la zone', visibleRows.length === 5 && visibleRows.includes('LA4'), visibleRows.join(', '));
  await page.getByText('Seulement les types présents dans la zone').click();

  // Clic sur un polygone : bilan du coin + surbrillance
  const target = await page.evaluate(() => {
    for (const f of window.map.queryRenderedFeatures({ layers: ['bdforet-fill'] })) {
      if (f.properties.code_tfv !== 'FF1G01-01') continue;
      const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
      const lng = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const pt = window.map.project([lng, lat]);
      if (pt.x > 420 && pt.x < 1000 && pt.y > 90 && pt.y < 840) return { x: pt.x, y: pt.y, id: f.properties.id };
    }
    return null;
  });
  if (target) {
    await page.mouse.click(target.x, target.y);
    await page.waitForSelector('#spot .verdict', { timeout: 10000 });
    const spot = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('#spot .spot__row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
      verdicts: [...document.querySelectorAll('#spot .verdict strong')].map((x) => x.textContent),
      summary: document.querySelector('#spot .spot__summary')?.textContent,
      bars: document.querySelectorAll('#spot .rain-chart__bar').length,
      highlight: JSON.stringify(window.map.getFilter('bdforet-highlight')),
    }));
    check('bilan : type de forêt du point', spot.rows[0]?.includes('Forêt fermée de chênes décidus purs'), spot.rows[0]);
    check('bilan : nature du sol', /Calcaires et dolomies|Moraines et dépôts glaciaires/.test(spot.rows[1] ?? ''), spot.rows[1]);
    check('bilan : altitude IGN', /^Altitude\s*930 m$/.test(spot.rows[2] ?? ''), spot.rows[2]);
    check('bilan : pluie des 20 jours', /mm de pluie/.test(spot.summary ?? '') && spot.bars >= 8, `${spot.summary} (${spot.bars} barres)`);
    check('bilan : un verdict par champignon (5 espèces)', spot.verdicts.length === 5 && spot.verdicts.includes('Morilles'), spot.verdicts.join(', '));
    check('surbrillance du polygone cliqué', spot.highlight === JSON.stringify(['==', ['get', 'id'], target.id]), spot.highlight);
    await page.screenshot({ path: `${OUT}03-bureau-bilan.png` });
    await page.locator('#spot .panel__close').click();
    const cleared = await page.evaluate(() => ({ hidden: document.getElementById('spot').hidden, f: JSON.stringify(window.map.getFilter('bdforet-highlight')) }));
    check('fermeture du bilan → surbrillance effacée', cleared.hidden && cleared.f.includes('__aucun__'), JSON.stringify(cleared));
  } else {
    check('clic sur un polygone de chênes', false, 'aucun polygone visible');
  }

  // « Je cherche… » : cèpes → forêts hôtes + indice météo
  await page.getByRole('button', { name: 'Cèpes', exact: true }).click();
  await page.waitForFunction(() => window.map.querySourceFeatures('meteo').length > 0, null, { timeout: 15000 });
  await idle(page);
  const cepes = await page.evaluate(() => ({
    mushroom: window.store.state.mushroom,
    mode: window.store.state.weatherMode,
    filter: JSON.stringify(window.map.getFilter('bdforet-fill')),
    visible: window.map.getLayoutProperty('meteo-cellules', 'visibility'),
    fill: JSON.stringify(window.map.getPaintProperty('meteo-cellules', 'fill-color')),
    levels: [...new Set(window.map.querySourceFeatures('meteo').map((f) => f.properties.l_cepe))].sort(),
    status: [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).find((t) => /cellules/.test(t)),
  }));
  check('Je cherche cèpes → forêts hôtes seulement', cepes.filter.includes('FF1-09-09') && !cepes.filter.includes('FF1-14-14'), cepes.filter.slice(0, 80));
  check('Je cherche cèpes → grille « indice » visible', cepes.mode === 'indice' && cepes.visible === 'visible' && cepes.fill.includes('l_cepe'), `${cepes.mode} ${cepes.visible}`);
  check('grille météo calculée', cepes.levels.length > 0 && cepes.levels.every((l) => l >= 0 && l <= 3), `niveaux ${cepes.levels.join(',')}`);
  check('requêtes Open-Meteo groupées (20 jours passés)', log.meteo.length >= 1 && log.meteo.every((q) => q.includes('past_days=20')), `${log.meteo.length} requête(s)`);
  check('état de la grille dans la légende', Boolean(cepes.status), cepes.status);
  await page.screenshot({ path: `${OUT}04-bureau-cepes.png` });

  // Grille fine : carrés de 500 m à partir du zoom 13 (mode indice)
  const before = log.altitude.length;
  await page.evaluate(() => window.map.jumpTo({ zoom: 13.6 }));
  await page.waitForFunction(() => window.map.querySourceFeatures('meteo-fin').length > 0, null, { timeout: 20000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('#legend .legend-hint')].some((p) => /carrés? de 500 m avec arbres hôtes/.test(p.textContent)),
    null,
    { timeout: 20000 },
  );
  await idle(page);
  const fine = await page.evaluate(() => {
    const features = window.map.querySourceFeatures('meteo-fin');
    return {
      count: features.length,
      visible: window.map.getLayoutProperty('meteo-fin-cellules', 'visibility'),
      filter: JSON.stringify(window.map.getFilter('meteo-fin-cellules')),
      altitudes: [...new Set(features.map((f) => f.properties.z))].length,
      levels: [...new Set(features.map((f) => f.properties.l_cepe))].sort(),
      coverage: features.every((f) => f.properties.c_cepe >= 0 && f.properties.c_cepe <= 1),
      coarseOpacity: JSON.stringify(window.map.getPaintProperty('meteo-cellules', 'fill-opacity')),
      status: [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).find((t) => /500 m avec/.test(t)),
      saved: (() => {
        try {
          return Object.keys(JSON.parse(localStorage.getItem('foret-explorer:altitudes')).z).length;
        } catch {
          return 0;
        }
      })(),
    };
  });
  const batches = log.altitude.slice(before);
  check('grille fine : carrés de 500 m dessinés', fine.count > 20 && fine.visible === 'visible' && fine.filter.includes('c_cepe'), `${fine.count} carrés, ${fine.levels.join(',')}`);
  check('grille fine : altitudes IGN groupées et variées', batches.length >= 1 && batches.every((q) => q.includes('%7C')) && fine.altitudes > 5, `${batches.length} requête(s), ${fine.altitudes} altitudes`);
  check('grille fine : altitudes gardées dans le navigateur', fine.saved > 20, `${fine.saved} altitudes`);
  check('grille fine : la grille de 4,5 km s’efface au zoom 13', fine.coarseOpacity.startsWith('["step",["zoom"]'), fine.coarseOpacity.slice(0, 40));
  check('grille fine : état dans la légende', Boolean(fine.status) && fine.coverage, fine.status);
  await page.screenshot({ path: `${OUT}04b-bureau-grille-fine.png` });
  await page.evaluate(() => window.map.jumpTo({ zoom: 11.5 }));
  await idle(page);

  // Grille en mode pluie
  await page.getByText('Pluie cumulée', { exact: true }).click();
  const rain = await page.evaluate(() => ({
    fill: JSON.stringify(window.map.getPaintProperty('meteo-cellules', 'fill-color')),
    text: JSON.stringify(window.map.getLayoutProperty('meteo-etiquettes', 'text-field')),
  }));
  check('mode pluie : couleurs et étiquettes en mm', rain.fill.startsWith('["step",["get","rain20"]') && rain.text.includes('rain20'), rain.text);

  // Nature du sol
  await page.getByRole('switch', { name: 'Afficher la nature du sol' }).check();
  await idle(page);
  const soil = await page.evaluate(() => ({
    visible: window.map.getLayoutProperty('geologie-motifs', 'visibility'),
    pattern: window.map.hasImage('sol-calcaire') && window.map.hasImage('sol-moraine'),
    rows: document.querySelectorAll('.soil-item').length,
    favored: [...document.querySelectorAll('.soil-item.is-favored')].map((li) => li.dataset.soil),
  }));
  check('nature du sol : couche et motifs', soil.visible === 'visible' && soil.pattern, JSON.stringify(soil));
  check('nature du sol : 7 types, sols favorables aux cèpes repérés', soil.rows === 7 && soil.favored.includes('gres') && !soil.favored.includes('calcaire'), soil.favored.join(','));
  check('tuiles de géologie demandées', log.geologie.length > 0, log.geologie.slice(0, 2).join(', '));
  await page.screenshot({ path: `${OUT}05-bureau-sol.png` });
  await page.getByRole('switch', { name: 'Afficher la nature du sol' }).uncheck();

  // Morilles : forêts hôtes de printemps, encadré de sécurité
  await page.getByRole('button', { name: 'Morilles', exact: true }).click();
  await idle(page);
  const morel = await page.evaluate(() => ({
    mushroom: window.store.state.mushroom,
    filter: JSON.stringify(window.map.getFilter('bdforet-fill')),
    caution: document.querySelector('.mushroom-card__caution')?.textContent ?? '',
    season: document.querySelector('.mushroom-card__season')?.textContent ?? '',
    facts: document.querySelector('.mushroom-card__facts')?.textContent ?? '',
    favored: [...document.querySelectorAll('.soil-item.is-favored')].map((li) => li.dataset.soil),
  }));
  const springNow = [3, 4, 5, 6].includes(new Date().getMonth() + 1);
  check('morilles : frênaies, peupleraies et coupes affichées', morel.mushroom === 'morille' && ['FF1-49-49', 'FP', 'FF0'].every((c) => morel.filter.includes(c)), morel.filter.slice(0, 90));
  check('morilles : encadré gyromitre et cuisson', /gyromitre/i.test(morel.caution) && /20 minutes/.test(morel.caution) && /pas ce qui se mange/i.test(morel.caution), morel.caution.slice(0, 60));
  check('morilles : saison de mars à juin, hors saison signalé', /mars à juin/.test(morel.facts) && (springNow || /Hors saison/.test(morel.season)), morel.season || morel.facts.slice(-30));
  check('morilles : sols calcaires et alluvions favorables', ['calcaire', 'humide', 'marne'].every((x) => morel.favored.includes(x)), morel.favored.join(','));
  await page.screenshot({ path: `${OUT}05b-bureau-morilles.png` });
  await page.getByRole('button', { name: 'Morilles', exact: true }).click();
  await page.getByRole('switch', { name: 'Afficher la grille météo' }).uncheck();

  // Consommation des API : compteurs de la visite et envoi groupé au serveur de mesure
  const totals = await page.evaluate(() => window.metrics.totals());
  check(
    'mesure : compteurs Open-Meteo, IGN, géologie',
    totals['app.sessions'] === 1 &&
      totals['openMeteo.requests'] >= 1 &&
      totals['openMeteo.calls10'] === totals['openMeteo.locations'] * 15 &&
      totals['ign.tiles.forest'] > 0 &&
      totals['ign.tiles.plan'] > 0 &&
      totals['ign.altitude.points'] > 20 &&
      totals['pages.geology'] > 0 &&
      totals['app.spots'] === 1,
    JSON.stringify(totals),
  );
  await page.evaluate(() => window.metrics.flush());
  await page.waitForTimeout(400);
  const sent = log.mesures.filter((m) => m.method === 'POST' && m.path === '/collect');
  const payload = sent.length ? JSON.parse(sent[sent.length - 1].body) : null;
  check('mesure : envoi groupé, sans identifiant', sent.length >= 1 && payload?.v === 1 && Object.keys(payload).sort().join() === 'c,v' && payload.c['ign.tiles.forest'] > 0, sent.length ? sent[sent.length - 1].body.slice(0, 90) : 'aucun envoi');

  // Opacité, fond de carte
  await page.locator('.opacity input').fill('40');
  const opacity = await page.evaluate(() => window.map.getPaintProperty('bdforet-fill', 'fill-opacity'));
  check('curseur d’opacité', opacity === 0.4, String(opacity));

  await page.locator('#toolbar-top button').first().click();
  const basemap = await page.evaluate(() => ({
    ortho: window.map.getLayoutProperty('base-ortho', 'visibility'),
    plan: window.map.getLayoutProperty('base-plan', 'visibility'),
  }));
  check('bouton fond de carte → photographies aériennes', basemap.ortho === 'visible' && basemap.plan === 'none', JSON.stringify(basemap));
  await page.locator('#toolbar-top button').first().click();

  // Recherche
  await page.locator('#search-input').fill('Parmel');
  await page.waitForSelector('.search__option', { timeout: 5000 });
  check('recherche : 3 suggestions', (await page.locator('.search__option').count()) === 3);
  check('recherche : paramètres du géocodeur', log.geocode.some((q) => q.includes('text=Parmel') && q.includes('type=StreetAddress%2CPositionOfInterest')), log.geocode[0]);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await idle(page);
  const center = await page.evaluate(() => {
    const c = window.map.getCenter();
    return { lng: +c.lng.toFixed(4), lat: +c.lat.toFixed(4), zoom: +window.map.getZoom().toFixed(1) };
  });
  check('recherche au clavier → Nâves-Parmelan', Math.abs(center.lng - 6.1935) < 0.002 && Math.abs(center.lat - 45.9346) < 0.002 && center.zoom === 13, JSON.stringify(center));

  // Petit zoom
  await page.evaluate(() => window.map.jumpTo({ zoom: 9 }));
  await idle(page);
  const lowZoom = await page.evaluate(() => ({
    hint: !document.getElementById('zoom-hint').hidden,
    note: !document.querySelector('.legend-note').hidden,
    countsHidden: [...document.querySelectorAll('.legend-item__count')].every((c) => c.hidden),
  }));
  check('zoom 9 : bandeau, note, pastilles masquées', lowZoom.hint && lowZoom.note && lowZoom.countsHidden, JSON.stringify(lowZoom));
  // Tuiles raster de 256 px : MapLibre charge le niveau z+1 (ici 10) pour un zoom carte de 9.
  check('zoom 9 : aperçu raster BD Forêt (PM_6_16)', log.wmts.some((w) => w.startsWith('LANDCOVER.FORESTINVENTORY.V2|PM_6_16|10')));
  await page.screenshot({ path: `${OUT}06-bureau-zoom9.png` });
  await page.locator('.zoom-hint__btn').click();
  await page.waitForTimeout(800);
  check('bouton « Zoomer ici »', (await page.evaluate(() => window.map.getZoom())) >= 10);

  // Persistance
  await page.getByRole('button', { name: 'Conifères', exact: true }).click();
  await page.waitForTimeout(600);
  await page.reload();
  await waitForMap(page);
  const persisted = await page.evaluate(() => ({
    pressed: document.querySelector('.chip:not(.chip--mushroom)[aria-pressed="true"]')?.textContent,
    filterHasFO2: JSON.stringify(window.map.getFilter('bdforet-fill')).includes('FO2'),
  }));
  check('sélection conservée après rechargement', persisted.pressed === 'Conifères' && persisted.filterHasFO2, JSON.stringify(persisted));
  check('aucune erreur JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function mobileTests(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await installMocks(page, { tms: [], wmts: [], geocode: [], other: [] });
  await page.goto(base);
  await waitForMap(page);
  await idle(page);
  check('mobile : légende fermée au démarrage', await page.evaluate(() => document.getElementById('legend').hidden));
  const topbar = await page.evaluate(() => ({
    searchRight: Math.round(document.querySelector('.search').getBoundingClientRect().right),
    toolbarLeft: Math.round(document.getElementById('toolbar-top').getBoundingClientRect().left),
    toggleWidth: Math.round(document.getElementById('legend-toggle').getBoundingClientRect().width),
  }));
  check('mobile : recherche sans chevauchement', topbar.searchRight <= topbar.toolbarLeft - 4 && topbar.toggleWidth === 46, JSON.stringify(topbar));
  await page.screenshot({ path: `${OUT}07-mobile-carte.png` });
  await page.locator('#legend-toggle').tap();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}08-mobile-legende.png` });
  await page.locator('#legend .panel__close').tap();
  await page.touchscreen.tap(200, 300);
  await page.waitForSelector('#spot .verdict', { timeout: 10000 });
  const sheet = await page.evaluate(() => {
    const r = document.getElementById('spot').getBoundingClientRect();
    return { bottom: Math.round(r.bottom), width: Math.round(r.width), legendHidden: document.getElementById('legend').hidden };
  });
  check('mobile : bilan en tiroir bas', sheet.bottom >= 840 && sheet.width === 390 && sheet.legendHidden, JSON.stringify(sheet));
  await page.screenshot({ path: `${OUT}09-mobile-bilan.png` });
  check('mobile : pas de défilement horizontal', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  await context.close();
}

const server = await startServer();
const browser = await chromium.launch({
  headless: !process.env.HEADED,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  await desktopTests(browser, server.url);
  await mobileTests(browser, server.url);
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications OK — captures dans tests/e2e/shots/`);
process.exit(failed ? 1 : 0);

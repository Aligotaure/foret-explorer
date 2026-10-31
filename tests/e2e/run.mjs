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

  const layout = await page.evaluate(() => ({
    panelBottom: Math.round(document.getElementById('legend').getBoundingClientRect().bottom),
    baseBottom: Math.round(document.querySelectorAll('.layer__header')[1].getBoundingClientRect().bottom),
  }));
  check('section « Plan IGN » visible sans défiler', layout.baseBottom <= layout.panelBottom, JSON.stringify(layout));

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

  // Clic sur un polygone : bulle + surbrillance
  const target = await page.evaluate(() => {
    for (const f of window.map.queryRenderedFeatures({ layers: ['bdforet-fill'] })) {
      if (f.properties.code_tfv !== 'FF1G01-01') continue;
      const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
      const lng = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const pt = window.map.project([lng, lat]);
      if (pt.x > 420 && pt.x < 1360 && pt.y > 90 && pt.y < 840) return { x: pt.x, y: pt.y, id: f.properties.id };
    }
    return null;
  });
  if (target) {
    await page.mouse.click(target.x, target.y);
    await page.waitForSelector('.forest-popup', { timeout: 5000 });
    const popup = await page.evaluate(() => ({
      title: document.querySelector('.forest-popup__title strong')?.textContent,
      props: document.querySelector('.forest-popup__props')?.textContent,
      highlight: JSON.stringify(window.map.getFilter('bdforet-highlight')),
    }));
    check('bulle : libellé du type', popup.title === 'Forêt fermée de chênes décidus purs', popup.title);
    check('bulle : essence et code', /Chênes décidus/.test(popup.props) && /FF1G01-01/.test(popup.props));
    check('surbrillance du polygone cliqué', popup.highlight === JSON.stringify(['==', ['get', 'id'], target.id]), popup.highlight);
    await page.screenshot({ path: `${OUT}03-bureau-bulle.png` });
    await page.locator('.forest-popup .maplibregl-popup-close-button').click();
    await page.waitForTimeout(300);
    const cleared = await page.evaluate(() => JSON.stringify(window.map.getFilter('bdforet-highlight')));
    check('fermeture de la bulle → surbrillance effacée', cleared.includes('__aucun__'), cleared);
  } else {
    check('clic sur un polygone de chênes', false, 'aucun polygone visible');
  }

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
  await page.screenshot({ path: `${OUT}04-bureau-zoom9.png` });
  await page.locator('.zoom-hint__btn').click();
  await page.waitForTimeout(800);
  check('bouton « Zoomer ici »', (await page.evaluate(() => window.map.getZoom())) >= 10);

  // Persistance
  await page.getByRole('button', { name: 'Conifères', exact: true }).click();
  await page.waitForTimeout(600);
  await page.reload();
  await waitForMap(page);
  const persisted = await page.evaluate(() => ({
    pressed: document.querySelector('.chip[aria-pressed="true"]')?.textContent,
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
  await page.screenshot({ path: `${OUT}05-mobile-carte.png` });
  await page.locator('#legend-toggle').tap();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}06-mobile-legende.png` });
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

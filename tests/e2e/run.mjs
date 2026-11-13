// Test de bout en bout : vrai MapLibre dans Chromium, services IGN simulés (mocks.mjs).
//
//   npx playwright install chromium   # une seule fois
//   npm run test:e2e                  # démarre Vite, teste, s'arrête
//
// Variables : BASE_URL=http://… pour tester un serveur déjà lancé (il doit exposer
// window.map, c.-à-d. tourner en mode développement, avec VITE_METRICS_URL=https://mesures.test) ;
// HEADED=1 pour voir le navigateur.
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';
import { viewTests } from './views.mjs';

const OUT = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

// Version des conditions (src/legal.ts) : les tests qui ne portent pas sur l'avertissement le
// considèrent comme déjà accepté.
const TERMS_VERSION = readFileSync(new URL('../../src/legal.ts', import.meta.url), 'utf8').match(/TERMS_VERSION = '([^']+)'/)[1];
const preAccept = (context) =>
  context.addInitScript((v) => {
    try {
      localStorage.setItem('foret-explorer:avertissement', JSON.stringify({ v, t: Date.now() }));
    } catch {
      /* rien */
    }
  }, TERMS_VERSION);
const disclaimerOpen = (page) => page.evaluate(() => document.querySelector('dialog.disclaimer')?.open === true);

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
// Tant que le code de la carte (chargé à la demande) n'est pas arrivé, `window.map` désigne la
// balise <div id="map"> : on attend l'objet MapLibre lui-même.
const waitForMap = (page) =>
  page.waitForFunction(() => typeof window.map?.loaded === 'function' && window.map.loaded(), null, { timeout: 30000 });
/** Vue des tests de la carte : au-dessus d'Annecy et du Parmelan (#carte=zoom/lat/lon). */
const ANNECY = '#carte=11.5/45.92/6.19';
const viewOf = (page) =>
  page.evaluate(() => {
    const c = window.map.getCenter();
    return { lng: +c.lng.toFixed(3), lat: +c.lat.toFixed(3), zoom: +window.map.getZoom().toFixed(1) };
  });

async function startServer() {
  if (process.env.BASE_URL) return { url: process.env.BASE_URL, close: async () => {} };
  // Serveur de mesure fictif (intercepté par mocks.mjs) : on vérifie les envois sans rien publier.
  process.env.VITE_METRICS_URL ??= 'https://mesures.test';
  const { createServer } = await import('vite');
  const server = await createServer({ server: { port: 5199, strictPort: false, open: false }, logLevel: 'error' });
  await server.listen();
  const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/';
  return { url, close: () => server.close() };
}

/** Avertissement bloquant à l'ouverture, page « À propos » et effacement des données. */
async function disclaimerTests(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  // Historique du bouton (bloqué ou non, texte) dès la création de la page : le compte à rebours se
  // vérifie ainsi même si la machine de test est lente.
  await context.addInitScript(() => {
    window.__bouton = [];
    new MutationObserver(() => {
      const b = document.querySelector('.disclaimer__accept');
      if (!b) return;
      const state = `${b.disabled}|${b.textContent}`;
      if (window.__bouton.at(-1)?.s !== state) window.__bouton.push({ t: Date.now(), s: state });
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
  await installMocks(page, { tms: [], wmts: [], geocode: [], other: [] });

  await page.goto(base);
  await page.waitForSelector('dialog.disclaimer[open]', { timeout: 10000 });
  const first = await page.evaluate(() => {
    const d = document.querySelector('dialog.disclaimer');
    const b = d.querySelector('.disclaimer__accept');
    return {
      modal: d.matches(':modal'),
      role: d.getAttribute('role'),
      label: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent,
      disabled: b.disabled,
      button: b.textContent,
      text: d.textContent.replace(/\s+/g, ' '),
      link: d.querySelector('.disclaimer__terms a')?.getAttribute('href'),
    };
  });
  check('avertissement : fenêtre modale à l’ouverture', first.modal && first.role === 'alertdialog' && first.label === 'Avant de partir en forêt', JSON.stringify({ modal: first.modal, role: first.role }));
  const history = await page.evaluate(() => window.__bouton);
  check(
    'avertissement : bouton bloqué avec compte à rebours',
    history[0]?.s === 'true|Lisez d’abord… 3' && (first.disabled || history.some((h) => h.s.startsWith('false|'))),
    history.map((h) => h.s).join(' → '),
  );
  check(
    'avertissement : identification, centre antipoison, propriétaire, responsabilité',
    ['pharmacien', 'entiers', 'application', 'centre antipoison', 'le 15', 'propriétaire', 'seul responsable', 'limites permises par la loi'].every((w) => first.text.includes(w)) && !first.text.includes('Lyon'),
    first.text.slice(0, 80),
  );
  check('avertissement : lien vers les conditions', first.link === 'a-propos.html#conditions', first.link);
  await page.screenshot({ path: `${OUT}00-avertissement.png` });

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.mouse.click(60, 500);
  await page.waitForTimeout(200);
  const blocked = await page.evaluate(() => ({ open: document.querySelector('dialog.disclaimer')?.open, spotHidden: document.getElementById('spot').hidden }));
  check('avertissement : Échap et clic à côté ne le ferment pas, la carte reste bloquée', blocked.open && blocked.spotHidden, JSON.stringify(blocked));

  await page.waitForFunction(() => !document.querySelector('.disclaimer__accept').disabled, null, { timeout: 8000 });
  const delay = await page.evaluate(() => {
    const d = document.querySelector('dialog.disclaimer');
    const enabled = window.__bouton.find((h) => h.s.startsWith('false|'));
    return { shown: Number(d.dataset.actif) - Number(d.dataset.debut), sinceButton: enabled ? enabled.t - window.__bouton[0].t : 0 };
  });
  check(
    'avertissement : acceptation possible au bout de 3 secondes d’affichage',
    delay.shown >= 2950 && delay.shown < 6000 && delay.sinceButton >= 2950,
    JSON.stringify(delay),
  );
  await page.locator('.disclaimer__accept').click();
  const after = await page.evaluate(() => ({
    gone: !document.querySelector('dialog.disclaimer'),
    saved: JSON.parse(localStorage.getItem('foret-explorer:avertissement') ?? 'null'),
  }));
  check('avertissement : accepté et mémorisé avec la version des conditions', after.gone && after.saved?.v === TERMS_VERSION && typeof after.saved?.t === 'number', JSON.stringify(after.saved));
  await waitForMap(page);
  const firstView = await viewOf(page);
  check('première visite : la France entière', firstView.zoom < 7 && firstView.lat > 44 && firstView.lat < 49 && firstView.lng > 0 && firstView.lng < 5, JSON.stringify(firstView));
  // Vue d'ensemble : l'indice de pousse de tout le pays, lu dans les fichiers météo communs.
  await page.getByRole('button', { name: 'Cèpes', exact: true }).click();
  await page.waitForFunction(() => window.map.querySourceFeatures('meteo').length > 1000, null, { timeout: 20000 });
  const national = await page.evaluate(() => ({
    status: [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).find((t) => /cases de 18 km/.test(t)) ?? '',
    opacity: JSON.stringify(window.map.getPaintProperty('meteo-cellules', 'fill-opacity')).slice(0, 34),
  }));
  check(
    'vue France : indice de pousse sur tout le pays',
    Number(national.status.match(/^(\d+) cases/)?.[1]) > 1500 && national.opacity.startsWith('["interpolate",["linear"],["zoom"]'),
    national.status.slice(0, 80),
  );
  await page.screenshot({ path: `${OUT}00b-france.png` });
  await page.getByRole('button', { name: 'Cèpes', exact: true }).click(); // on retire le champignon
  await page.evaluate(() => window.map.jumpTo({ center: [2.35, 48.85], zoom: 10 }));
  await page.waitForTimeout(1500); // la vue est enregistrée une seconde après le dernier mouvement
  await page.goto(base);
  await waitForMap(page);
  await page.waitForTimeout(500);
  check('avertissement : pas redemandé à la visite suivante', !(await disclaimerOpen(page)));
  const kept = await viewOf(page);
  check('visite suivante : la carte reprend la dernière vue', Math.abs(kept.lng - 2.35) < 0.01 && Math.abs(kept.lat - 48.85) < 0.01 && kept.zoom === 10, JSON.stringify(kept));

  // Page « À propos »
  await page.goto(new URL('a-propos.html', base).href);
  await page.waitForSelector('[data-stored-list] li');
  const about = await page.evaluate(() => ({
    ids: [...document.querySelectorAll('main section[id]')].map((s) => s.id),
    host: document.body.textContent.includes('GitHub, Inc., 88 Colin P. Kelly Jr. Street'),
    law: document.body.textContent.includes('1-1 (II)') && document.body.textContent.includes('L163-11'),
    stored: [...document.querySelectorAll('[data-stored-list] li')].map((li) => li.textContent),
    metrics: document.querySelector('[data-metrics-state]')?.textContent,
    back: document.querySelector('.top__back')?.getAttribute('href'),
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  check(
    'À propos : cueillette, règles, conditions, mentions légales, confidentialité, sources',
    ['identifier', 'regles', 'securite', 'conditions', 'mentions-legales', 'confidentialite', 'sources'].every((id) => about.ids.includes(id)) && about.host && about.law,
    about.ids.join(','),
  );
  check('À propos : ce que garde le navigateur, état de la mesure', about.stored.some((t) => /Acceptation de l’avertissement, le /.test(t)) && about.metrics === 'activée', `${about.stored.join(' | ')} — mesure ${about.metrics}`);
  await page.screenshot({ path: `${OUT}10-a-propos.png` });
  await page.locator('[data-clear]').click();
  await page.locator('[data-clear]').click();
  const cleared = await page.evaluate(() => ({
    keys: Object.keys(localStorage).filter((k) => k.startsWith('foret-explorer:')),
    status: document.querySelector('[data-clear-status]').textContent,
  }));
  check('À propos : « Effacer mes données » vide le stockage du site', cleared.keys.length === 0 && /effacé/.test(cleared.status), JSON.stringify(cleared));
  await page.locator('.top__back').click();
  await page.waitForSelector('dialog.disclaimer[open]', { timeout: 10000 });
  check('après effacement : l’avertissement revient', await disclaimerOpen(page));
  check('avertissement et À propos : aucune erreur JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function desktopTests(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await preAccept(context);
  const page = await context.newPage();
  const log = { tms: [], wmts: [], geocode: [], other: [] };
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
  await installMocks(page, log);

  await page.goto(`${base}${ANNECY}`);
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
  check('légende : 6 sections, dont « Où cueillir »', sections.length === 6 && sections[0] === 'Je cherche…' && sections[2] === 'Où cueillir', sections.join(' | '));
  const footer = await page.evaluate(() => [...document.querySelectorAll('#legend .legend-footer a')].map((a) => a.getAttribute('href')));
  check('légende : liens vers conseils, conditions, mentions légales, confidentialité', footer.length === 4 && footer.every((h) => h.startsWith('a-propos.html#')), footer.join(', '));

  // Zones protégées (par défaut) et forêts publiques (sur demande)
  const zones = await page.evaluate(() => ({
    protectedVis: window.map.getLayoutProperty('zones-protegees', 'visibility'),
    lineVis: window.map.getLayoutProperty('zones-protegees-contours', 'visibility'),
    publicVis: window.map.getLayoutProperty('forets-publiques', 'visibility'),
    switches: [...document.querySelectorAll('#legend .zone-row .switch')].map((s) => s.checked),
    hatch: window.map.hasImage('zone-hachures'),
    drawn: window.map.queryRenderedFeatures({ layers: ['zones-protegees'] }).length,
  }));
  check(
    'zones protégées affichées par défaut (hachures), forêts publiques sur demande',
    zones.protectedVis === 'visible' && zones.lineVis === 'visible' && zones.publicVis === 'none' && zones.switches.join() === 'true,false' && zones.hatch && zones.drawn > 0,
    JSON.stringify(zones),
  );
  check('archive des zones (lue par morceaux) et info.json demandés', log.zones.some((p) => p.endsWith('/info.json')) && log.zones.some((p) => p.endsWith('/zones.pmtiles')), log.zones.slice(0, 2).join(', '));
  await page.locator('#legend .layer', { hasText: 'Où cueillir' }).locator('.layer__toggle').click();
  await page.getByRole('switch', { name: 'Afficher les forêts publiques' }).check();
  check('interrupteur « Forêts publiques »', (await page.evaluate(() => window.map.getLayoutProperty('forets-publiques', 'visibility'))) === 'visible');
  await page.screenshot({ path: `${OUT}01b-bureau-zones.png` });

  // Bilan d'un coin : droit de cueillir selon la zone touchée
  const zonePoints = await page.evaluate(() => {
    const m = window.map;
    const W = m.getCanvas().clientWidth;
    const H = m.getCanvas().clientHeight;
    const out = {};
    for (let y = 130; y < H - 80; y += 23) {
      for (let x = 450; x < W - 520; x += 29) {
        const at = (layer) => m.queryRenderedFeatures([x, y], { layers: [layer] }).length > 0;
        const prot = at('zones-protegees-hit');
        const pub = at('forets-publiques-hit');
        const forest = at('bdforet-hit');
        if (prot && !pub && forest) out.prot ??= { x, y };
        if (pub && !prot && forest) out.pub ??= { x, y };
        if (!pub && !prot && forest) out.priv ??= { x, y };
      }
    }
    return out;
  });
  const rulesAt = async (pt) => {
    await page.mouse.click(pt.x, pt.y);
    await page.waitForSelector('#spot .verdict', { timeout: 10000 });
    return page.evaluate(() => {
      const section = [...document.querySelectorAll('#spot .spot__section')].find((s) => s.querySelector('.spot__title')?.textContent === 'Droit de cueillir');
      return {
        text: section?.textContent.replace(/\s+/g, ' ') ?? '',
        link: section?.querySelector('.spot__alert a')?.getAttribute('href') ?? null,
        warning: document.querySelector('#spot .spot__warning')?.textContent ?? null,
      };
    });
  };
  if (zonePoints.prot && zonePoints.pub && zonePoints.priv) {
    const before = log.meteo.length;
    const blocksBefore = log.meteoCommune.length;
    const prot = await rulesAt(zonePoints.prot);
    check(
      'bilan : réserve naturelle signalée, fiche INPN, mise en garde sur l’indice',
      /Réserve naturelle nationale « Réserve d’essai »/.test(prot.text) && /interdire ou limiter la cueillette/.test(prot.text) && prot.link?.startsWith('https://inpn.mnhn.fr/') && /Zone protégée/.test(prot.warning ?? ''),
      prot.text.slice(0, 110),
    );
    check(
      'bilan : météo de la case commune, aucun appel à Open-Meteo',
      log.meteo.length === before && log.meteoCommune.slice(blocksBefore).every((p) => /\/data\/meteo\/(index|b\/\d+_\d+)\.json$/.test(p)),
      `${log.meteo.length - before} appel(s) Open-Meteo, ${log.meteoCommune.length} fichier(s) météo`,
    );
    await page.screenshot({ path: `${OUT}03b-bureau-bilan-reserve.png` });
    const pub = await rulesAt(zonePoints.pub);
    check('bilan : forêt publique, cueillette familiale tolérée', /Forêt communale d’essai : forêt publique/.test(pub.text) && /tolérée/.test(pub.text) && !pub.warning, pub.text.slice(0, 110));
    const priv = await rulesAt(zonePoints.priv);
    check('bilan : forêt sans doute privée, accord du propriétaire', /Forêt sans doute privée/.test(priv.text) && /accord du propriétaire/.test(priv.text) && /délit au-delà de 10 litres/.test(priv.text), priv.text.slice(0, 110));
    await page.locator('#spot .panel__close').click();
  } else {
    check('bilan : points dans une réserve, une forêt publique et une forêt privée', false, JSON.stringify(zonePoints));
  }
  await page.getByRole('switch', { name: 'Afficher les forêts publiques' }).uncheck();

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
    check('bilan : pluie des 30 jours', /mm de pluie/.test(spot.summary ?? '') && /il y a 1[03] jours/.test(spot.summary ?? '') && spot.bars >= 8, `${spot.summary} (${spot.bars} barres)`);
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
    status: [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).find((t) => /cases de 18 km/.test(t)),
  }));
  check('Je cherche cèpes → forêts hôtes seulement', cepes.filter.includes('FF1-09-09') && !cepes.filter.includes('FF1-14-14'), cepes.filter.slice(0, 80));
  check('Je cherche cèpes → grille « indice » visible', cepes.mode === 'indice' && cepes.visible === 'visible' && cepes.fill.includes('l_cepe'), `${cepes.mode} ${cepes.visible}`);
  check('grille météo calculée', cepes.levels.length > 0 && cepes.levels.every((l) => l >= 0 && l <= 3), `niveaux ${cepes.levels.join(',')}`);
  check(
    'grille météo lue dans les fichiers communs, sans appel à Open-Meteo',
    log.meteo.length === 0 && log.meteoCommune.some((p) => p.endsWith('/meteo/index.json')) && log.meteoCommune.some((p) => /\/b\/\d+_\d+\.json$/.test(p)),
    `${log.meteo.length} appel(s) Open-Meteo, ${log.meteoCommune.length} fichier(s)`,
  );
  check('état de la grille dans la légende (cases de 18 km, date de la pluie)', Boolean(cepes.status) && /pluie connue jusqu’au/.test(cepes.status ?? ''), cepes.status);
  const squares = await page.evaluate(() => {
    const features = window.map.querySourceFeatures('meteo');
    return {
      squares: features.filter((f) => f.properties.sub === 1).length,
      whole: features.filter((f) => f.properties.sub === 0).length,
      altitudes: [...new Set(features.map((f) => f.properties.elevation))].length,
    };
  });
  check(
    'indice détaillé par carrés de 4,5 km, chacun à son altitude',
    squares.squares > 10 && squares.whole === 0 && squares.altitudes > 8 && /par carrés de 4,5 km/.test(cepes.status ?? ''),
    JSON.stringify(squares),
  );
  await page.screenshot({ path: `${OUT}04-bureau-cepes.png` });

  // Vue d'ensemble : chance en % dans chaque case, pastilles sur les secteurs à 50 % et plus
  // (selon la saison du jour du test, il peut n'y en avoir aucun).
  const zoomBefore = await page.evaluate(() => window.map.getZoom());
  await page.evaluate(() => window.map.jumpTo({ zoom: 7 }));
  await page.waitForFunction(() => window.map.querySourceFeatures('meteo').some((f) => f.properties.sub === 0), null, { timeout: 15000 });
  await idle(page);
  const top = await page.evaluate(() => {
    const cells = window.map.querySourceFeatures('meteo');
    return {
      chances: cells.every((f) => f.properties.p_cepe >= 0 && f.properties.p_cepe <= 95),
      above: cells.some((f) => f.properties.p_cepe >= 50),
      points: window.map.querySourceFeatures('meteo-points').map((f) => f.properties.p),
      status: [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).find((t) => /cases de 18 km/.test(t)) ?? '',
    };
  });
  check(
    'chance estimée en % dans chaque case, pastilles seulement à 50 % et plus',
    top.chances && top.points.every((p) => p >= 50) && top.points.length > 0 === top.above && (top.above ? /Meilleure chance dans la vue : \d+ %/ : /Aucun secteur à 50 %/).test(top.status),
    `${top.points.length} pastille(s) ${top.points.slice(0, 5).join(', ')} ; ${top.status.slice(0, 130)}`,
  );
  await page.evaluate((z) => window.map.jumpTo({ zoom: z }), zoomBefore);
  await idle(page);

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
  check(
    'grille fine : la grille des cases s’efface au zoom 12',
    fine.coarseOpacity.startsWith('["interpolate",["linear"],["zoom"]') && fine.coarseOpacity.includes(',12,["*",0.35,'),
    fine.coarseOpacity.slice(0, 40),
  );
  check('grille fine : état dans la légende', Boolean(fine.status) && fine.coverage, fine.status);
  await page.screenshot({ path: `${OUT}04b-bureau-grille-fine.png` });
  await page.evaluate(() => window.map.jumpTo({ zoom: 11.5 }));
  await idle(page);

  // Grille en mode pluie
  await page.getByText('Pluie cumulée sur 20 jours', { exact: true }).click();
  const rain = await page.evaluate(() => ({
    fill: JSON.stringify(window.map.getPaintProperty('meteo-cellules', 'fill-color')),
    text: JSON.stringify(window.map.getLayoutProperty('meteo-etiquettes', 'text-field')),
  }));
  check('mode pluie : couleurs et étiquettes en mm', rain.fill.startsWith('["step",["get","rain20"]') && rain.text.includes('rain20'), rain.text);
  const wholeCells = await page
    .waitForFunction(
      () => {
        const features = window.map.querySourceFeatures('meteo');
        return features.length > 0 && features.every((f) => f.properties.sub === 0);
      },
      null,
      { timeout: 10000 },
    )
    .then(
      () => true,
      () => false,
    );
  check('mode pluie : cases entières (la pluie est celle de toute la case)', wholeCells);

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
  check('nature du sol : 8 types, sols favorables aux cèpes repérés', soil.rows === 8 && soil.favored.includes('gres') && !soil.favored.includes('calcaire'), soil.favored.join(','));
  check('archive de géologie demandée (lue par morceaux)', log.geologie.some((p) => p.endsWith('/geologie.pmtiles')), log.geologie.slice(0, 2).join(', '));
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
    'mesure : compteurs météo commune, IGN, géologie, aucun appel direct à Open-Meteo',
    totals['app.sessions'] === 1 &&
      totals['pages.meteo'] >= 2 &&
      !totals['openMeteo.requests'] &&
      totals['ign.tiles.forest'] > 0 &&
      totals['ign.tiles.plan'] > 0 &&
      totals['ign.altitude.points'] > 20 &&
      totals['pages.geology'] > 0 &&
      totals['pages.zones'] > 0 &&
      totals['app.spots'] === 4,
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

/** Fichiers météo communs injoignables : la carte interroge Open-Meteo elle-même, avec mesure. */
async function fallbackTests(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await preAccept(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const log = { tms: [], wmts: [], geocode: [], other: [] };
  await installMocks(page, log, { meteoCommune: false });
  await page.goto(`${base}#carte=10.5/45.92/6.19`);
  await waitForMap(page);
  await page.getByRole('button', { name: 'Cèpes', exact: true }).click();
  await page.waitForFunction(() => window.map.querySourceFeatures('meteo').length > 0, null, { timeout: 15000 });
  const status = await page.evaluate(() => [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).find((t) => /cases de 18 km/.test(t)) ?? '');
  check(
    'secours : sans fichiers communs, grille par Open-Meteo (20 jours, appels groupés)',
    log.meteo.length >= 1 && log.meteo.every((q) => q.includes('past_days=20')) && /Open-Meteo interrogé directement/.test(status),
    `${log.meteo.length} requête(s) ; ${status.slice(0, 90)}`,
  );
  const before = log.meteo.length;
  await page.mouse.click(640, 400);
  await page.waitForSelector('#spot .verdict', { timeout: 10000 });
  const query = log.meteo.slice(before).pop() ?? '';
  check('secours : bilan d’un coin, coordonnées arrondies à 0,01°, altitude exacte', /latitude=\d+\.\d\d00&/.test(query) && /longitude=\d+\.\d\d00&/.test(query) && /elevation=930/.test(query), query.slice(0, 70));
  const totals = await page.evaluate(() => window.metrics.totals());
  check('secours : appels Open-Meteo comptés (1,5 appel par point sur 21 jours)', totals['openMeteo.requests'] >= 2 && totals['openMeteo.calls10'] === totals['openMeteo.locations'] * 15 && totals['pages.meteo.errors'] >= 1, JSON.stringify(totals).slice(0, 160));
  check('secours : aucune erreur JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));

  // Fichiers communs en retard de 6 jours (tâche GitHub en panne) : même repli.
  const page2 = await context.newPage();
  const log2 = { tms: [], wmts: [], geocode: [], other: [] };
  await installMocks(page2, log2, { meteoCommune: 'ancienne' });
  await page2.goto(`${base}#carte=10.5/44.5/3.1`); // ailleurs : pas dans le cache du jour de la page précédente
  await waitForMap(page2);
  await page2.getByRole('button', { name: 'Cèpes', exact: true }).click();
  await page2.waitForFunction(() => window.map.querySourceFeatures('meteo').length > 0, null, { timeout: 15000 });
  check(
    'secours : fichiers communs trop anciens, Open-Meteo interrogé, aucun bloc lu',
    log2.meteo.length >= 1 && !log2.meteoCommune.some((p) => p.includes('/b/')),
    `${log2.meteo.length} requête(s) Open-Meteo, fichiers lus : ${log2.meteoCommune.map((p) => p.split('/meteo/')[1]).join(', ')}`,
  );

  // Passage du jour pas encore fait (GitHub lance les tâches planifiées quand il peut) : hier est
  // connu par l'estimation relevée la veille, et la carte le dit.
  const page3 = await context.newPage();
  const log3 = { tms: [], wmts: [], geocode: [], other: [] };
  await installMocks(page3, log3, { meteoCommune: 'provisoire' });
  await page3.goto(`${base}#carte=10.5/45.92/6.19`);
  await waitForMap(page3);
  await page3.getByRole('button', { name: 'Cèpes', exact: true }).click();
  await page3.waitForFunction(() => window.map.querySourceFeatures('meteo').length > 0, null, { timeout: 15000 });
  const status3 = await page3.evaluate(() => [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).find((t) => /cases de 18 km/.test(t)) ?? '');
  check(
    'veille provisoire : grille lue dans les fichiers communs, dernier jour annoncé comme estimé',
    log3.meteo.length === 0 && /dernier jour estimé d’après la prévision/.test(status3) && !/Open-Meteo interrogé/.test(status3),
    `${log3.meteo.length} appel(s) Open-Meteo ; ${status3.slice(0, 140)}`,
  );
  await page3.mouse.click(640, 400);
  await page3.waitForSelector('#spot .rain-chart', { timeout: 10000 });
  const provisional = await page3.evaluate(() => ({
    bars: [...document.querySelectorAll('#spot .rain-chart__bar--estimated')].map((b) => b.querySelector('title')?.textContent ?? ''),
    summary: [...document.querySelectorAll('#spot .spot__summary')].map((p) => p.textContent).join(' | '),
    unknown: document.querySelectorAll('#spot .rain-chart__unknown').length,
    pills: [...document.querySelectorAll('#spot .level-pill')].map((p) => p.textContent),
  }));
  check(
    'veille provisoire : bilan complet jusqu’à hier, barre d’hier marquée « estimation »',
    provisional.bars.length === 1 && /\(estimation\)$/.test(provisional.bars[0] ?? '') && /dernier jour estimé/.test(provisional.summary) && provisional.unknown === 0 && log3.meteo.length === 0,
    JSON.stringify(provisional).slice(0, 200),
  );
  check('bilan : chance estimée en % pour chaque champignon', provisional.pills.length === 5 && provisional.pills.every((t) => /^≈ \d+ % · /.test(t)), provisional.pills.join(' | '));

  // Altitude IGN lente : la météo s'affiche sans l'attendre, puis le bilan est refait.
  const page4 = await context.newPage();
  await installMocks(page4, { tms: [], wmts: [], geocode: [], other: [] }, { altitudeLente: 7000 });
  await page4.goto(`${base}#carte=10.5/45.92/6.19`);
  await waitForMap(page4);
  await page4.mouse.click(640, 400);
  await page4.waitForSelector('#spot .rain-chart', { timeout: 6000 });
  const early = await page4.evaluate(() => document.querySelector('#spot .spot__facts')?.textContent ?? '');
  await page4.waitForFunction(() => /930 m/.test(document.querySelector('#spot .spot__facts')?.textContent ?? ''), null, { timeout: 12000 });
  check('altitude lente : météo affichée sans attendre, puis altitude exacte', /≈ \d+ m \(d’après la grille météo\) · altitude exacte en cours/.test(early), early.slice(-80));
  await context.close();
}

async function mobileTests(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await installMocks(page, { tms: [], wmts: [], geocode: [], other: [] });
  await page.goto(`${base}#carte=12/45.92/6.19`);
  // Avertissement à l'ouverture : il tient dans l'écran, le bouton reste atteignable.
  await page.waitForSelector('dialog.disclaimer[open]', { timeout: 10000 });
  const dialog = await page.evaluate(() => {
    const r = document.querySelector('dialog.disclaimer').getBoundingClientRect();
    const b = document.querySelector('.disclaimer__accept').getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), button: Math.round(b.bottom), height: Math.round(b.height) };
  });
  check('mobile : avertissement dans l’écran, bouton de 46 px visible', dialog.left >= 0 && dialog.right <= 390 && dialog.button <= 844 && dialog.height >= 46, JSON.stringify(dialog));
  await page.screenshot({ path: `${OUT}06b-mobile-avertissement.png` });
  await page.waitForFunction(() => !document.querySelector('.disclaimer__accept').disabled, null, { timeout: 8000 });
  await page.locator('.disclaimer__accept').tap();
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
  await disclaimerTests(browser, server.url);
  await desktopTests(browser, server.url);
  await fallbackTests(browser, server.url);
  await mobileTests(browser, server.url);
  await viewTests({ browser, base: server.url, OUT, check, preAccept, installMocks, waitForMap, idle, viewOf });
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications OK — captures dans tests/e2e/shots/`);
process.exit(failed ? 1 : 0);

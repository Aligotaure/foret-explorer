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
import { SHARE_BARE, SHARE_BUILT, SHARE_CELL, SHARE_OTHER, SHARE_THIN, installMocks } from './mocks.mjs';
import { viewTests } from './views.mjs';

const OUT = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

// Version des conditions (src/legal.ts) : les tests qui ne portent pas sur l'avertissement le
// considèrent comme déjà accepté.
const TERMS_VERSION = readFileSync(new URL('../../src/legal.ts', import.meta.url), 'utf8').match(/TERMS_VERSION = '([^']+)'/)[1];
/** Section de la légende, désignée par son titre exact (un texte cherché dans toute la section en trouverait plusieurs). */
const legendSection = (page, title) => page.locator('#legend .layer').filter({ has: page.locator('.layer__title', { hasText: new RegExp(`^${title}$`) }) });

/**
 * Ferme « La carte en 3 gestes », qui suit un premier accord donné à la main et couvre la carte : sans
 * cela, le clic suivant attendrait sous une fenêtre modale. Un instant d'attente : la présentation
 * ignore les fermetures de sa première demi-seconde (double appui).
 */
export async function closeTour(page) {
  await page.waitForSelector('dialog.tour[open]', { timeout: 5000 });
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog.tour', { state: 'detached', timeout: 3000 });
}

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
      window.__pret = document.querySelector('dialog.disclaimer [role="status"]')?.textContent || window.__pret;
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
      links: [...d.querySelectorAll('.disclaimer__terms a')].map((a) => a.getAttribute('href')),
      words: d.querySelector('.disclaimer__body').textContent.trim().split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length,
      fits: d.querySelector('.disclaimer__body').scrollHeight <= d.querySelector('.disclaimer__body').clientHeight + 1,
      steps: d.querySelectorAll('.tour-num, [class*="pagination"]').length,
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
    'avertissement : risque mortel, identification, enfants, centre antipoison, propriétaire, estimation, responsabilité',
    ['mortels', 'connaissez parfaitement', 'pharmacien', 'application', 'jeunes enfants', 'centre antipoison', 'le 15', 'propriétaire', 'estimation', 'seul responsable'].every((w) => first.text.includes(w)) && !first.text.includes('Lyon'),
    first.text.slice(0, 80),
  );
  check(
    'avertissement : court (moins de 100 mots), lisible sans défiler, sans rien d’une étape de présentation',
    first.words < 100 && first.fits && first.steps === 0 && !/comestible|garanti[^e]|autoris|probabilit|trouvez/i.test(first.text),
    `${first.words} mots, tient dans la fenêtre : ${first.fits}`,
  );
  check(
    'avertissement : liens vers les conditions, puis vers tous les conseils',
    first.link === 'a-propos.html#conditions' && first.links.join() === 'a-propos.html#conditions,a-propos.html#identifier',
    first.links.join(', '),
  );
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
  const announced = await page.evaluate(() => window.__pret);
  check('avertissement : fin du compte à rebours annoncée aux lecteurs d’écran', announced === 'Vous pouvez maintenant accepter.', String(announced));

  // Premier accord : « La carte en 3 gestes », qu'on ferme comme on veut (ce n'est plus une porte).
  await page.waitForSelector('dialog.tour[open]', { timeout: 5000 });
  const tour = await page.evaluate(() => {
    const d = document.querySelector('dialog.tour');
    const body = d.querySelector('.tour__body');
    return {
      modal: d.matches(':modal'),
      role: d.getAttribute('role'),
      label: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent,
      focus: document.activeElement?.id,
      steps: [...d.querySelectorAll('.tour__steps li strong')].map((s) => s.textContent),
      text: d.innerText.replace(/\s+/g, ' '),
      decorative: [...d.querySelectorAll('.tour__screen')].every((s) => s.getAttribute('aria-hidden') === 'true'),
      screens: [...d.querySelectorAll('.tour__screen')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.className.split('--').pop()),
      fits: body.scrollHeight <= body.clientHeight + 1,
      images: d.querySelectorAll('img, picture, canvas').length,
    };
  });
  check(
    'accueil : après un premier accord, « La carte en 3 gestes » (fenêtre libre, nommée, clavier sur son titre)',
    tour.modal && tour.role === null && tour.label === 'La carte en 3 gestes' && tour.focus === 'tour-heading',
    JSON.stringify({ modal: tour.modal, role: tour.role, focus: tour.focus }),
  );
  check(
    'présentation : trois gestes, schéma dessiné et décoratif (grand écran), sans défilement ni image',
    tour.steps.join(' | ') === 'Choisissez un champignon | Zoomez sur un secteur coloré | Touchez un coin' && tour.decorative && tour.screens.join() === 'wide' && tour.fits && tour.images === 0,
    `${tour.steps.join(' | ')} — schéma : ${tour.screens.join()}`,
  );
  check(
    'présentation : « à gauche », « à droite », vocabulaire prudent (estimée, ni promesse ni droit)',
    /à gauche, dans la légende/.test(tour.text) && /à droite, son bilan/.test(tour.text) && /chance estimée/.test(tour.text) && /ni une promesse d’en trouver, ni un droit de cueillir/.test(tour.text) && !/comestible|garanti|autoris|probabilit|temps réel|trouvez|bas :/i.test(tour.text),
    tour.text.slice(0, 110),
  );
  // Double appui : « Voir la carte » apparaît là où l'on vient d'accepter ; il est ignoré une demi-seconde.
  await page.keyboard.press('Escape');
  await page.locator('.tour__close').click();
  const guarded = await page.evaluate(() => Boolean(document.querySelector('dialog.tour[open]')) && document.querySelectorAll('dialog.tour').length === 1);
  await page.waitForTimeout(600);
  await page.locator('.tour__close').click();
  const closed = await page.evaluate(() => ({ tour: Boolean(document.querySelector('dialog.tour')), inert: document.getElementById('app').inert, dialogs: document.querySelectorAll('dialog').length, focus: document.activeElement?.id }));
  check(
    'présentation : ni Échap ni un second appui immédiats ne la ferment, « Voir la carte » la ferme ensuite et rend le clavier au bouton de la légende',
    guarded && !closed.tour && !closed.inert && closed.dialogs === 0 && closed.focus === 'legend-toggle',
    JSON.stringify({ guarded, ...closed }),
  );
  await waitForMap(page);
  // À la demande, depuis la légende : elle se rouvre seule, se ferme par Échap ou par un clic à côté,
  // et rend le clavier au bouton ; l'accord gardé n'est pas touché.
  const how = page.getByRole('button', { name: 'Comment ça marche ?' });
  await how.click();
  await page.waitForSelector('dialog.tour[open]');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  // La fenêtre se retire à l'événement « close », un instant après la touche.
  await page.waitForSelector('dialog.tour', { state: 'detached', timeout: 3000 }).catch(() => {});
  const byEscape = await page.evaluate(() => ({ tour: Boolean(document.querySelector('dialog.tour')), focus: document.activeElement?.textContent }));
  await how.click();
  await page.waitForSelector('dialog.tour[open]');
  await page.waitForTimeout(600);
  await page.mouse.click(20, 400);
  await page.waitForSelector('dialog.tour', { state: 'detached', timeout: 3000 }).catch(() => {});
  const byBackdrop = await page.evaluate((t) => ({ tour: Boolean(document.querySelector('dialog.tour')), disclaimer: Boolean(document.querySelector('dialog.disclaimer')), same: JSON.parse(localStorage.getItem('foret-explorer:avertissement')).t === t }), after.saved.t);
  check(
    'légende : « Comment ça marche ? » rouvre la présentation, fermée par Échap ou par un clic à côté, sans redemander l’accord',
    !byEscape.tour && byEscape.focus === 'Comment ça marche ?' && !byBackdrop.tour && !byBackdrop.disclaimer && byBackdrop.same,
    JSON.stringify({ byEscape, byBackdrop }),
  );
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

  for (const [name, saved, expected] of [
    ['accord de la version en cours vieux de 31 jours', { v: TERMS_VERSION, t: Date.now() - 31 * 86_400_000 }, false],
    ['accord d’une version d’avant la refonte', { v: '2026-11-03', t: Date.now() - 86_400_000 }, true],
  ]) {
    const again = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    // Posé une seule fois : le rechargement ne doit pas effacer l'accord que la page vient d'enregistrer.
    await again.addInitScript((value) => {
      if (sessionStorage.getItem('accord-pose')) return;
      sessionStorage.setItem('accord-pose', '1');
      localStorage.setItem('foret-explorer:avertissement', JSON.stringify(value));
    }, saved);
    const page2 = await again.newPage();
    await installMocks(page2, { tms: [], wmts: [], geocode: [], other: [] });
    await page2.goto(base);
    const asked = await page2.waitForSelector('dialog.disclaimer[open]', { timeout: 10000 }).then(() => true, () => false);
    if (asked) {
      await page2.waitForFunction(() => !document.querySelector('.disclaimer__accept').disabled, null, { timeout: 8000 });
      await page2.locator('.disclaimer__accept').click();
      await page2.waitForTimeout(700);
    }
    const tourShown = await page2.evaluate(() => Boolean(document.querySelector('dialog.tour[open]')));
    check(`accueil, ${name} : accord redemandé, présentation ${expected ? 'montrée une fois' : 'non remontrée'}`, asked && tourShown === expected, JSON.stringify({ asked, tourShown }));
    await again.close();
  }
  await context.close();
}

/** Zoom en pause pendant le calcul des carrés ? (gestes interceptés, boutons en pause, champignon affiché) */
const zoomPause = (page) =>
  page.evaluate(() => {
    const loader = document.getElementById('grid-loader');
    const buttons = [...document.querySelectorAll('#toolbar-bottom .toolbar__group button')];
    return {
      paused: window.map.getContainer().classList.contains('zoom-paused'),
      // (Plein, il est en train de disparaître : le calcul est fini.)
      loader: !loader.hidden && !loader.classList.contains('is-full'),
      doubleClick: window.map.doubleClickZoom.isEnabled(),
      buttons: buttons.map((b) => b.getAttribute('aria-disabled') ?? 'libre').join(),
      described: buttons.map((b) => document.getElementById(b.getAttribute('aria-describedby') ?? '')?.textContent ?? '').join('|'),
      // Rien n'est coupé dans MapLibre (sauf le double clic) : les gestes sont arrêtés avant lui.
      handlers: [window.map.scrollZoom, window.map.touchZoomRotate, window.map.boxZoom, window.map.dragPan].every((g) => g.isEnabled()),
    };
  });
const zoomFree = (z) => !z.paused && !z.loader && z.doubleClick && z.buttons === 'libre,libre' && z.described === '|' && z.handlers;

async function desktopTests(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await preAccept(context);
  // (Le mois est figé en octobre par `installMocks`, pour toutes les pages des tests.)
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

  const sections = await page.evaluate(() =>
    [...document.querySelectorAll('#legend .layer')].map((l) => ({
      title: l.querySelector('.layer__title')?.textContent,
      open: l.querySelector('.layer__toggle')?.getAttribute('aria-expanded') === 'true',
    })),
  );
  check(
    'légende : 6 sections, le champignon puis la météo en tête',
    sections.map((s) => s.title).join(' | ') === 'Je cherche… | Météo | Types de forêt | Nature du sol | Droit de cueillir | Fond de carte : Plan IGN',
    sections.map((s) => s.title).join(' | '),
  );
  check(
    'légende, première visite : seule « Je cherche… » est dépliée, le panneau tient sans défiler',
    sections.filter((s) => s.open).map((s) => s.title).join() === 'Je cherche…' && (await page.evaluate(() => { const b = document.querySelector('#legend .panel__body'); return b.scrollHeight <= b.clientHeight + 1; })),
    sections.filter((s) => s.open).map((s) => s.title).join(', '),
  );
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
  await legendSection(page, 'Droit de cueillir').locator('.layer__toggle').click();
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
      // « Vu » : dans la partie visible du bilan, sans rien déplier ni faire défiler.
      const body = document.querySelector('#spot .spot__body').getBoundingClientRect();
      const seen = (el) => {
        const r = el?.getBoundingClientRect();
        return Boolean(r && r.height > 0 && r.top >= body.top && r.bottom <= body.bottom);
      };
      const before = (a, b) => Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      const text = (el) => el?.textContent.replace(/\s+/g, ' ').trim() ?? '';
      const status = [...document.querySelectorAll('#spot .spot__row')].find((r) => r.querySelector('dt')?.textContent === 'Statut');
      const rules = document.querySelector('#spot .spot__rules');
      const alert = document.querySelector('#spot .spot__alert');
      const pill = document.querySelector('#spot .level-pill');
      return {
        status: text(status?.querySelector('dd')),
        statusSeen: seen(status),
        alert: text(alert),
        alertSeen: seen(alert),
        alertFirst: before(alert, pill),
        link: alert?.querySelector('a')?.getAttribute('href') ?? null,
        rules: text(rules),
        rulesOpen: rules?.open ?? null,
        rulesLast: before(pill, rules),
        pillSeen: seen(pill),
      };
    });
  };
  if (zonePoints.prot && zonePoints.pub && zonePoints.priv) {
    const before = log.meteo.length;
    const blocksBefore = log.meteoCommune.length;
    const prot = await rulesAt(zonePoints.prot);
    check(
      'bilan : réserve naturelle signalée en tête, visible avant tout pourcentage, fiche INPN',
      /Réserve naturelle nationale « Réserve d’essai »/.test(prot.alert) && /interdire ou limiter la cueillette/.test(prot.alert) && prot.link?.startsWith('https://inpn.mnhn.fr/') && prot.alertSeen && prot.alertFirst,
      `${prot.alert.slice(0, 90)} — vue : ${prot.alertSeen}, avant les pourcentages : ${prot.alertFirst}`,
    );
    check(
      'bilan : météo de la case commune, aucun appel à Open-Meteo',
      log.meteo.length === before && log.meteoCommune.slice(blocksBefore).every((p) => /\/data\/meteo\/(index|b\/\d+_\d+)\.json$/.test(p)),
      `${log.meteo.length - before} appel(s) Open-Meteo, ${log.meteoCommune.length} fichier(s) météo`,
    );
    await page.screenshot({ path: `${OUT}03b-bureau-bilan-reserve.png` });
    const pub = await rulesAt(zonePoints.pub);
    check(
      'bilan : forêt publique dite dans le statut, sans alerte ; tolérance dans les règles',
      /Forêt communale d’essai : forêt publique/.test(pub.status) && pub.statusSeen && !pub.alert && /tolérée/.test(pub.rules),
      `${pub.status} — vu : ${pub.statusSeen}`,
    );
    const priv = await rulesAt(zonePoints.priv);
    check(
      'bilan : « forêt sans doute privée, accord du propriétaire » visible sans rien déplier',
      /Forêt sans doute privée/.test(priv.status) && /accord du propriétaire/.test(priv.status) && priv.statusSeen,
      `${priv.status} — vu : ${priv.statusSeen}`,
    );
    check(
      'bilan : règles de cueillette repliées, sous les champignons (sanctions, lien vers les règles)',
      priv.rulesOpen === false && priv.rulesLast && /délit au-delà de 10 litres/.test(priv.rules) && /Règles de cueillette et quantités/.test(priv.rules),
      `ouvert : ${priv.rulesOpen}, après les pourcentages : ${priv.rulesLast}`,
    );
    check('bilan : un pourcentage de champignon visible sans faire défiler', priv.pillSeen && pub.pillSeen, `privée : ${priv.pillSeen}, publique : ${pub.pillSeen}`);
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

  // Types de forêt : section repliée par défaut, que le titre déplie comme le chevron.
  const forestSection = legendSection(page, 'Types de forêt');
  await forestSection.locator('.layer__title').click();
  check(
    'légende : un clic sur le titre déplie « Types de forêt » (32 cases visibles)',
    (await forestSection.locator('.layer__toggle').getAttribute('aria-expanded')) === 'true' && (await page.locator('.legend-all input').isVisible()),
  );

  // Préréglage « Chênes »
  await page.getByRole('button', { name: 'Chênes', exact: true }).click();
  const filterBadge = await forestSection.locator('.layer__badge').evaluate((b) => ({ hidden: b.hidden, text: b.textContent }));
  check('légende : rappel du filtre dans l’en-tête de la section (« 2 / 32 »)', !filterBadge.hidden && filterBadge.text === '2 / 32', JSON.stringify(filterBadge));
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

    // Du plus probable au moins probable, sans exception ; le champignon recherché est signalé à son rang.
    const wanted = spot.verdicts[spot.verdicts.length - 1] === 'Morilles' ? 'girolle' : 'morille';
    const ranking = await page.evaluate(async (id) => {
      const read = () => ({
        chances: [...document.querySelectorAll('#spot .level-pill')].map((p) => Number(/≈ (\d+) %/.exec(p.textContent)?.[1])),
        chosen: [...document.querySelectorAll('#spot .verdict--chosen')].map((v) => `${v.querySelector('strong')?.textContent} · ${v.querySelector('.verdict__tag')?.textContent}`),
        open: [...document.querySelectorAll('#spot details.verdict__card[open]')].length,
        cards: document.querySelectorAll('#spot details.verdict__card').length,
        off: [...document.querySelectorAll('#spot .verdict--off .verdict__why')].map((w) => w.textContent),
        // Hors saison de plus d'un mois (les morilles, en octobre) : ligne grisée, sans pourcentage, en dernier.
        dormant: [...document.querySelectorAll('#spot .verdict--dormant')].map((v) => `${v.querySelector('strong')?.textContent} : ${v.querySelector('.verdict__why')?.textContent} ${v.querySelector('.level-pill') ? 'avec %' : 'sans %'}${v.querySelector('.verdict__tag') ? ' · recherché' : ''}`),
        last: [...document.querySelectorAll('#spot .verdict strong')].map((n) => n.textContent).pop(),
      });
      // Un instant entre chaque changement : un <details> créé ouvert émet « toggle » après coup.
      const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
      const opened = () => [...document.querySelectorAll('#spot details.verdict__card[open]')].map((d) => d.querySelector('strong')?.textContent);
      const before = read();
      const previous = window.store.state.mushroom;
      window.store.update({ mushroom: id });
      await tick();
      const during = { ...read(), opened: opened() };
      window.store.update({ mushroom: id === 'girolle' ? 'cepe' : 'girolle' });
      await tick();
      const other = { opened: opened(), chosen: [...document.querySelectorAll('#spot .verdict--chosen strong')].map((s) => s.textContent) };
      // Le champignon recherché est hors saison : sa ligne grisée porte « recherché », rien ne se déplie pour lui.
      window.store.update({ mushroom: 'morille' });
      await tick();
      const asleep = { ...read(), opened: opened() };
      window.store.update({ mushroom: previous });
      await tick();
      return { before, during, other, asleep, after: read() };
    }, wanted);
    // Quatre champignons de saison en octobre : les morilles, grisées, n'ont pas de pourcentage.
    const descending = (list) => list.length === 4 && list.every((v, i) => i === 0 || list[i - 1] >= v);
    check(
      'bilan : champignons du plus probable au moins probable, même avec un champignon recherché',
      descending(ranking.before.chances) && descending(ranking.during.chances) && JSON.stringify(ranking.before.chances) === JSON.stringify(ranking.during.chances),
      `${ranking.before.chances.join(' ≥ ')} ; recherché : ${ranking.during.chances.join(' ≥ ')}`,
    );
    check(
      'bilan : le champignon recherché est signalé sans recliquer la carte, puis ne l’est plus',
      ranking.before.chosen.length === 0 && ranking.during.chosen.length === 1 && / · recherché$/.test(ranking.during.chosen[0]) && ranking.after.chosen.length === 0,
      `${ranking.during.chosen.join(', ')}`,
    );
    check(
      'bilan : la ligne dépliée suit le champignon recherché (une seule à la fois, l’ancienne se replie)',
      ranking.during.opened.length === 1 && ranking.other.opened.length === 1 && ranking.other.opened[0] === ranking.other.chosen[0] && ranking.during.opened[0] !== ranking.other.opened[0] && ranking.after.open <= 1,
      `${ranking.during.opened.join()} puis ${ranking.other.opened.join()} ; ensuite ${ranking.after.open} dépliée(s)`,
    );
    check(
      'bilan : champignon hors saison de plus d’un mois (morilles en octobre) grisé, sans pourcentage, en dernier ; « recherché » gardé',
      ranking.before.dormant.join() === 'Morilles : hors saison (mars à juin) sans %' && ranking.before.last === 'Morilles' &&
        ranking.asleep.dormant.join() === 'Morilles : hors saison (mars à juin) sans % · recherché' && ranking.asleep.last === 'Morilles' && ranking.asleep.opened.length === ranking.before.open,
      `${ranking.before.dormant.join()} ; recherché : ${ranking.asleep.dormant.join()}`,
    );
    check(
      'bilan : raisons repliées (une carte dépliée au plus), champignon exclu sur une ligne avec sa raison',
      ranking.before.open <= 1 && ranking.before.cards + ranking.before.off.length === 5 && ranking.before.off.every((w) => w.length > 5),
      `${ranking.before.open} dépliée(s) sur ${ranking.before.cards} ; exclus : ${ranking.before.off.join(' | ') || 'aucun'}`,
    );

    // Bouton « ? » : explication dépliée au clic, repliée par Échap, le clavier revient sur le bouton.
    const help = page.locator('#spot .help-btn');
    const helpBefore = await page.evaluate(() => ({ hidden: document.getElementById('spot-chance-help')?.hidden, expanded: document.querySelector('#spot .help-btn')?.getAttribute('aria-expanded') }));
    await help.click();
    const helpOpen = await page.evaluate(() => ({
      hidden: document.getElementById('spot-chance-help')?.hidden,
      expanded: document.querySelector('#spot .help-btn')?.getAttribute('aria-expanded'),
      text: document.getElementById('spot-chance-help')?.textContent ?? '',
      link: document.querySelector('#spot-chance-help a')?.getAttribute('href'),
      size: document.querySelector('#spot .help-btn')?.getBoundingClientRect().width,
    }));
    await page.keyboard.press('Escape');
    const helpClosed = await page.evaluate(() => ({ hidden: document.getElementById('spot-chance-help')?.hidden, focus: document.activeElement?.className, spot: !document.getElementById('spot').hidden }));
    check(
      'bilan : « ? » déplie l’explication du pourcentage (estimation, pas une probabilité mesurée)',
      helpBefore.hidden === true && helpBefore.expanded === 'false' && helpOpen.hidden === false && helpOpen.expanded === 'true' && /saison × pluie × température × arbre hôte × sol/.test(helpOpen.text) && /pas une probabilité mesurée/.test(helpOpen.text) && helpOpen.link === 'a-propos.html#fiabilite' && helpOpen.size >= 24,
      helpOpen.text.slice(0, 80),
    );
    check('bilan : Échap replie l’explication et rend le clavier au bouton « ? »', helpClosed.hidden === true && helpClosed.focus === 'help-btn' && helpClosed.spot, JSON.stringify(helpClosed));
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
    levels: [...new Set(window.map.querySourceFeatures('meteo').map((f) => f.properties.l))].sort(),
    status: [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).find((t) => /cases de 18 km/.test(t)),
  }));
  check('Je cherche cèpes → forêts hôtes seulement', cepes.filter.includes('FF1-09-09') && !cepes.filter.includes('FF1-14-14'), cepes.filter.slice(0, 80));
  check('Je cherche cèpes → grille « indice » visible', cepes.mode === 'indice' && cepes.visible === 'visible' && cepes.fill.includes('["get","l"]'), `${cepes.mode} ${cepes.visible}`);
  check('grille météo calculée', cepes.levels.length > 0 && cepes.levels.every((l) => l >= 0 && l <= 3), `niveaux ${cepes.levels.join(',')}`);

  // Arbres hôtes : un carré n'est coloré que s'il en contient assez et n'est pas d'abord une ville
  // (fichier des parts de forêt, simulé ici). Un carré éteint n'est même pas envoyé à la carte.
  const hosts = await page.evaluate(
    ({ cell, squares }) => {
      // Un carré se reconnaît à son centre (les identifiants de texte ne survivent pas aux tuiles de MapLibre).
      const [ci, cj] = cell.split(':').map(Number);
      const centre = (k) => `${((cj * 4 + (k % 4) + 0.5) * 0.056).toFixed(3)},${((ci * 4 + Math.floor(k / 4) + 0.5) * 0.04).toFixed(3)}`;
      const key = (p) => `${Number(p.x).toFixed(3)},${Number(p.y).toFixed(3)}`;
      const by = new Map(window.map.querySourceFeatures('meteo').map((f) => [key(f.properties), f.properties]));
      const pick = (k) => {
        const p = by.get(centre(k));
        return p ? { c: p.c, p: p.p, l: p.l } : null;
      };
      // Ce que MapLibre applique à chaque carré : ses expressions évaluées sur les propriétés du carré
      // (compter les étiquettes dessinées ne prouverait rien, la police simulée est vide).
      const fill = window.map.style.getLayer('meteo-cellules').paint.get('fill-opacity');
      const line = window.map.style.getLayer('meteo-contours').paint.get('line-opacity');
      const label = window.map.style.getLayer('meteo-etiquettes').layout.get('text-field');
      const drawnWith = (p) => {
        const feature = { type: 'Polygon', properties: p };
        return { fill: +fill.evaluate(feature, {}).toFixed(3), line: +line.evaluate(feature, {}).toFixed(3), label: String(label.evaluate(feature, {})) };
      };
      const drawn = (k) => {
        const p = by.get(centre(k));
        return p ? drawnWith(p) : null;
      };
      return {
        unlit: squares.map(pick),
        wooded: pick(0),
        properties: Object.keys(by.get(centre(0)) ?? {}).sort().join(),
        opacity: JSON.stringify(window.map.getPaintProperty('meteo-cellules', 'fill-opacity')),
        lines: JSON.stringify(window.map.getPaintProperty('meteo-contours', 'line-opacity')),
        // Une case du mode pluie (elle ne porte ni l, ni p, ni c), encore dans la source à l'instant où
        // l'on passe à l'indice.
        leftover: drawnWith({ sub: 0, rain20: 40, elevation: 900, x: 6.2, y: 45.9 }),
        // En passant le zoom 10, une case entière (sub 0) reste un instant dans la source : pas d'étiquette pour elle.
        wholeLabel: drawnWith({ sub: 0, l: 3, p: 80, c: 0.6 }).label,
        squareLabel: drawnWith({ sub: 1, l: 3, p: 80, c: 0.6 }).label,
        woodedDrawn: drawn(0),
        zoom: window.map.getZoom(),
        caveat: [...document.querySelectorAll('#legend .legend-hint--caveat')].filter((p) => !p.hidden).map((p) => p.textContent).join(' '),
      };
    },
    { cell: SHARE_CELL, squares: [SHARE_BARE, SHARE_THIN, SHARE_OTHER, SHARE_BUILT] },
  );
  check(
    'carrés : sans arbre hôte du champignon (aucun arbre, 3 % de hêtres, robiniers) ou d’abord bâti (40 %), le carré n’est pas envoyé à la carte',
    hosts.unlit.length === 4 && hosts.unlit.every((u) => u === null) && hosts.wooded?.c === 0.6 && hosts.wooded.p >= 50 && hosts.wooded.l > 0,
    JSON.stringify({ unlit: hosts.unlit, wooded: hosts.wooded }),
  );
  check(
    'carrés : seulement les valeurs du champignon montré, sous des noms fixes (les expressions ne changent pas avec lui)',
    hosts.properties === 'c,elevation,l,p,rain20,sub,x,y' && hosts.opacity.includes('["get","c"]') && hosts.lines.includes('["get","c"]') && !/_cepe/.test(hosts.opacity + hosts.lines),
    hosts.properties,
  );
  check(
    'carrés : teinte, quadrillage et étiquette sur le carré boisé ; rien pour une case restée du mode pluie',
    hosts.leftover.fill === 0 && hosts.leftover.line === 0 && hosts.leftover.label === '' &&
      hosts.woodedDrawn?.fill > 0 && hosts.woodedDrawn.line > 0 && (hosts.zoom < 10 || hosts.zoom >= 12 || /^\d+ %$/.test(hosts.woodedDrawn.label)),
    JSON.stringify({ zoom: +hosts.zoom.toFixed(1), reste: hosts.leftover, boise: hosts.woodedDrawn }),
  );
  check(
    'passage du zoom 10 : une case entière encore dans la source n’affiche pas son pourcentage, un carré de 4,5 km oui',
    hosts.zoom < 10 || hosts.zoom >= 12 || (hosts.wholeLabel === '' && hosts.squareLabel === '80 %'),
    `zoom ${hosts.zoom.toFixed(1)} : case « ${hosts.wholeLabel} », carré « ${hosts.squareLabel} »`,
  );
  // Changer de champignon ne change aucune expression de la grille : MapLibre n'a pas à refaire ses
  // tuiles pour cela (c'était la lenteur du choix d'un champignon), seul le contenu de la source change.
  const stable = await page.evaluate(() => {
    const read = () =>
      JSON.stringify([
        window.map.getPaintProperty('meteo-cellules', 'fill-color'),
        window.map.getPaintProperty('meteo-cellules', 'fill-opacity'),
        window.map.getPaintProperty('meteo-contours', 'line-opacity'),
        window.map.getLayoutProperty('meteo-etiquettes', 'text-field'),
        window.map.getPaintProperty('meteo-fin-cellules', 'fill-color'),
        window.map.getPaintProperty('meteo-fin-cellules', 'fill-opacity'),
        window.map.getLayoutProperty('meteo-fin-etiquettes', 'text-field'),
        window.map.getFilter('meteo-fin-cellules') ?? null,
      ]);
    const before = read();
    window.store.update({ mushroom: 'trompette' });
    const during = read();
    window.store.update({ mushroom: 'cepe' });
    return { same: before === during && before === read(), size: before.length };
  });
  check('changer de champignon ne change aucune expression de la grille (ni teinte, ni étiquette, ni filtre)', stable.same && stable.size > 200, `${stable.size} caractères`);
  check('légende : « seuls les secteurs où poussent ses arbres hôtes sont colorés », estimation rappelée', /arbres hôtes sont colorés/.test(hosts.caveat) && /estimées, pas mesurées/.test(hosts.caveat), hosts.caveat.slice(0, 80));
  check('parts de forêt : un seul chargement du fichier', log.foret.length === 1, `${log.foret.length} requête(s)`);
  // Réglages de dessin qui allègent chaque image (mesurés sans carte graphique) : invisibles dans les
  // captures, une régression passerait inaperçue.
  const light = await page.evaluate(() => ({
    fade: ['base-plan', 'base-ortho', 'bdforet-overview'].map((id) => window.map.getPaintProperty(id, 'raster-fade-duration')).join(),
    smooth: ['bdforet-fill', 'geologie-motifs', 'zones-protegees', 'meteo-cellules', 'meteo-fin-cellules'].map((id) => window.map.getPaintProperty(id, 'fill-antialias')).join(),
    lines: window.map.getLayer('meteo-contours').minzoom,
  }));
  check(
    'dessin allégé : images de fond sans fondu, forêts, motifs et carrés sans lissage des bords, quadrillage à partir du zoom 10 en mode indice',
    light.fade === '0,0,0' && light.smooth === 'false,false,false,false,false' && light.lines === 10,
    JSON.stringify(light),
  );

  // Vue d'ensemble (zoom 9, la règle affiche 10 km) : des cases entières de 18 km, pas de carrés de
  // 4,5 km ; pastilles à 70 % et plus seulement, jamais sur un carré sans arbre hôte.
  const viewBefore = await viewOf(page);
  await page.evaluate(() => window.map.jumpTo({ center: [6.16, 45.98], zoom: 9 }));
  const freeLow = await zoomPause(page);
  check(
    'vue d’ensemble (zoom 9) : pas de champignon de chargement, le zoom reste libre juste après un déplacement',
    zoomFree(freeLow),
    JSON.stringify(freeLow),
  );
  await page.waitForFunction(() => window.map.getZoom() < 10 && window.map.querySourceFeatures('meteo-points').length > 0, null, { timeout: 15000 }).catch(() => {});
  await idle(page);
  const spots = await page.evaluate(
    ({ cell, squares }) => {
      const [ci, cj] = cell.split(':').map(Number);
      const unlit = squares.map((k) => `${((cj * 4 + (k % 4) + 0.5) * 0.056).toFixed(3)},${((ci * 4 + Math.floor(k / 4) + 0.5) * 0.04).toFixed(3)}`);
      const points = window.map.querySourceFeatures('meteo-points');
      const cells = window.map.querySourceFeatures('meteo');
      return {
        chances: points.map((f) => f.properties.p),
        onUnlit: points.filter((f) => unlit.includes(`${f.geometry.coordinates[0].toFixed(3)},${f.geometry.coordinates[1].toFixed(3)}`)).length,
        status: [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).find((t) => /cases de 18 km/.test(t)) ?? '',
        whole: cells.length > 0 && cells.every((f) => f.properties.sub === 0),
        cellChances: cells.map((f) => f.properties.p),
        lines: window.map.getLayer('meteo-contours').minzoom,
      };
    },
    { cell: SHARE_CELL, squares: [SHARE_BARE, SHARE_THIN, SHARE_OTHER, SHARE_BUILT] },
  );
  check(
    'vue d’ensemble : des pastilles, toutes à 70 % et plus, aucune sur un carré sans arbre hôte ou d’abord bâti ; meilleure chance « estimée » annoncée',
    spots.chances.length > 0 && spots.chances.every((p) => p >= 70) && spots.onUnlit === 0 && /Meilleure chance estimée dans la vue : ≈ \d+ %/.test(spots.status),
    `${spots.chances.length} pastille(s) ${spots.chances.slice(0, 5).join(', ')} ; ${spots.status.slice(0, 120)}`,
  );
  check(
    'vue d’ensemble (zoom 9) : cases entières de 18 km, sans quadrillage ni « carrés de 4,5 km » ; la meilleure chance annoncée est celle de la plus forte pastille',
    spots.whole && !/par carrés de 4,5 km/.test(spots.status) && spots.lines === 10 && Number(/≈ (\d+) %/.exec(spots.status)?.[1]) === Math.max(...spots.chances),
    `cases : ${[...new Set(spots.cellChances)].join(', ')} % ; pastilles : ${[...new Set(spots.chances)].join(', ')} % ; quadrillage à partir du zoom ${spots.lines}`,
  );
  // La pastille (et la teinte de sa case) porte le chiffre de son meilleur carré de 4,5 km : au zoom 10,
  // le carré posé au même endroit affiche ce chiffre, et aucun carré de la case ne le dépasse.
  const overview = await page.evaluate(() => ({
    points: window.map.querySourceFeatures('meteo-points').map((f) => ({ p: f.properties.p, x: +f.geometry.coordinates[0].toFixed(3), y: +f.geometry.coordinates[1].toFixed(3) })),
    cells: window.map.querySourceFeatures('meteo').map((f) => ({ p: f.properties.p, x: f.properties.x, y: f.properties.y })),
  }));
  await page.evaluate(() => window.map.jumpTo({ zoom: 10.2 }));
  await page.waitForFunction(() => window.map.querySourceFeatures('meteo').some((f) => f.properties.sub === 1), null, { timeout: 15000 }).catch(() => {});
  await idle(page);
  const detail = await page.evaluate(() => window.map.querySourceFeatures('meteo').filter((f) => f.properties.sub === 1).map((f) => ({ p: f.properties.p, x: +Number(f.properties.x).toFixed(3), y: +Number(f.properties.y).toFixed(3) })));
  const cellOf = (o) => `${Math.floor(o.y / 0.16)}:${Math.floor(o.x / 0.224)}`;
  const compared = overview.points
    .map((pt) => {
      const inCell = detail.filter((sq) => cellOf(sq) === cellOf(pt));
      const here = inCell.find((sq) => sq.x === pt.x && sq.y === pt.y);
      const cell = overview.cells.find((c) => cellOf(c) === cellOf(pt));
      // (Au zoom 10 la vue est plus petite : seules les pastilles dont le carré est encore dans les tuiles chargées se comparent.)
      return here ? { pastille: pt.p, carre: here.p, max: Math.max(...inCell.map((sq) => sq.p)), case: cell?.p ?? null, altitudes: new Set(inCell.map((sq) => sq.p)).size } : null;
    })
    .filter(Boolean);
  check(
    'pastille et teinte de la case : le chiffre du meilleur carré de 4,5 km de la case, celui que son étiquette affiche au zoom 10 au même endroit',
    compared.length > 0 && compared.every((c) => c.pastille === c.carre && c.pastille === c.max && c.case === c.pastille) && compared.some((c) => c.altitudes > 1),
    JSON.stringify(compared.slice(0, 3)),
  );
  await page.evaluate(() => window.map.jumpTo({ zoom: 9 }));
  await page.waitForFunction(() => window.map.getZoom() < 10 && window.map.querySourceFeatures('meteo').some((f) => f.properties.sub === 0), null, { timeout: 15000 }).catch(() => {});
  await idle(page);

  // Bilan sous le zoom 10 : la forêt y est inconnue (pas absente), l'indice ne retombe pas à zéro.
  await page.mouse.click(760, 470);
  await page.waitForSelector('#spot .verdict', { timeout: 10000 });
  const lowSpot = await page.evaluate(() => ({
    forest: document.querySelector('#spot .spot__row dd')?.textContent ?? '',
    status: [...document.querySelectorAll('#spot .spot__row')].find((r) => r.querySelector('dt')?.textContent === 'Statut')?.querySelector('dd')?.textContent ?? '',
    chances: [...document.querySelectorAll('#spot .level-pill')].map((p) => Number(/≈ (\d+) %/.exec(p.textContent)?.[1])),
    reasons: [...document.querySelectorAll('#spot .verdict__reasons li')].map((li) => li.textContent),
    off: [...document.querySelectorAll('#spot .verdict__why')].map((w) => w.textContent),
  }));
  check(
    'bilan sous le zoom 10 : forêt « à connaître en zoomant », chance non nulle, « forêt inconnue » dans les raisons, jamais « pas de forêt »',
    /zoomez pour la connaître/.test(lowSpot.forest) && Math.max(...lowSpot.chances) > 0 && lowSpot.reasons.some((r) => /Forêt inconnue à ce zoom/.test(r)) && ![...lowSpot.reasons, ...lowSpot.off].some((r) => /pas de forêt/i.test(r)),
    `${lowSpot.forest} ; chances ${lowSpot.chances.join(', ')} ; ${[...lowSpot.off, ...lowSpot.reasons].join(' | ').slice(0, 200)}`,
  );
  check('bilan sous le zoom 10 : statut inconnu, accord du propriétaire rappelé, sans parenthèses imbriquées', /^Inconnu : il faut l’accord du propriétaire \(zoomez au niveau 10 ou plus pour le connaître\)$/.test(lowSpot.status.trim()), lowSpot.status);
  check('bilan sous le zoom 10 : la raison dit que la chance est celle des forêts hôtes du secteur', lowSpot.reasons.some((r) => /chance des forêts hôtes du secteur/.test(r)), lowSpot.reasons.find((r) => /Forêt inconnue/.test(r)) ?? '');
  const bare = await page.evaluate(({ cell, k }) => {
    const [ci, cj] = cell.split(':').map(Number);
    const p = window.map.project([(cj * 4 + (k % 4) + 0.5) * 0.056, (ci * 4 + Math.floor(k / 4) + 0.5) * 0.04]);
    return { x: p.x, y: p.y };
  }, { cell: SHARE_CELL, k: SHARE_BARE });
  // Là où rien ne peut être estimé (secteur sans arbres hôtes, ville), le bilan ne demande rien à l'IGN.
  const altitudeBefore = log.altitude.length;
  await page.mouse.click(bare.x, bare.y);
  await page.waitForFunction(() => [...document.querySelectorAll('#spot .verdict__why')].some((w) => /peu d’arbres hôtes/.test(w.textContent)), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  const bareSpot = await page.evaluate(() => ({
    lines: [...document.querySelectorAll('#spot .verdict')].map((v) => `${v.querySelector('strong')?.textContent} : ${v.querySelector('.verdict__why')?.textContent ?? ''} ${v.querySelector('.level-pill')?.textContent ?? ''}`),
    chances: [...document.querySelectorAll('#spot .level-pill')].map((p) => Number(/≈ (\d+) %/.exec(p.textContent)?.[1])),
    altitude: [...document.querySelectorAll('#spot .spot__row')].find((r) => r.querySelector('dt')?.textContent === 'Altitude')?.querySelector('dd')?.textContent ?? '',
    rain: Boolean(document.querySelector('#spot .rain-chart')),
    urban: document.querySelector('#spot .spot__urban')?.textContent ?? '',
  }));
  check(
    'bilan sous le zoom 10, secteur sans arbres (comme une ville) : aucune chance annoncée, « peu d’arbres hôtes dans ce secteur »',
    bareSpot.chances.length === 4 && bareSpot.chances.every((c) => c === 0) && bareSpot.lines.filter((l) => /peu d’arbres hôtes dans ce secteur/.test(l)).length === 4 && bareSpot.lines.some((l) => /^Morilles : hors saison/.test(l)),
    bareSpot.lines.join(' | ').slice(0, 260),
  );
  check(
    'bilan là où rien ne peut être estimé : aucune altitude demandée à l’IGN, altitude lue dans la grille météo, pluie affichée, pas de conseil de ville',
    log.altitude.length === altitudeBefore && /^≈ \d+ m \(d’après la grille météo\)$/.test(bareSpot.altitude) && bareSpot.rain && bareSpot.urban === '',
    `${log.altitude.length - altitudeBefore} appel(s) d’altitude ; ${bareSpot.altitude}`,
  );
  // Même règle pour une ville avec un bois : 60 % de hêtres, mais 40 % du carré est bâti.
  const town = await page.evaluate(({ cell, k }) => {
    const [ci, cj] = cell.split(':').map(Number);
    const p = window.map.project([(cj * 4 + (k % 4) + 0.5) * 0.056, (ci * 4 + Math.floor(k / 4) + 0.5) * 0.04]);
    return { x: p.x, y: p.y };
  }, { cell: SHARE_CELL, k: SHARE_BUILT });
  await page.mouse.click(town.x, town.y);
  await page.waitForFunction(() => [...document.querySelectorAll('#spot .verdict__why')].some((w) => /secteur urbanisé/.test(w.textContent)), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  const townSpot = await page.evaluate(() => ({
    lines: [...document.querySelectorAll('#spot .verdict')].map((v) => `${v.querySelector('strong')?.textContent} : ${v.querySelector('.verdict__why')?.textContent ?? ''} ${v.querySelector('.level-pill')?.textContent ?? ''}`),
    chances: [...document.querySelectorAll('#spot .level-pill')].map((p) => Number(/≈ (\d+) %/.exec(p.textContent)?.[1])),
    urban: document.querySelector('#spot .spot__urban')?.textContent ?? '',
    link: document.querySelector('#spot .spot__urban a')?.getAttribute('href') ?? '',
  }));
  check(
    'bilan sous le zoom 10, secteur urbanisé (une ville avec un bois) : aucune chance annoncée, « secteur urbanisé » sans pourcentage (rien n’y est estimé)',
    townSpot.chances.every((c) => c === 0) && townSpot.lines.filter((l) => /secteur urbanisé/.test(l)).length >= 3 && townSpot.lines.filter((l) => /secteur urbanisé/.test(l)).every((l) => !/≈/.test(l)),
    townSpot.lines.join(' | ').slice(0, 200),
  );
  check(
    'bilan en secteur urbanisé : aucune altitude demandée, conseil « loin des routes… » avec le lien vers les conseils de cueillette',
    log.altitude.length === altitudeBefore && /cueillez loin des routes, des zones industrielles et des décharges/.test(townSpot.urban) && townSpot.link === 'a-propos.html#identifier' && !/comestible|autorisé|garanti/i.test(townSpot.urban),
    `${log.altitude.length - altitudeBefore} appel(s) d’altitude ; ${townSpot.urban.slice(0, 90)}`,
  );
  // Même ville, forêt connue (zoom 11) : la carte n'y allume aucun carré de 4,5 km, le bilan n'estime
  // pas non plus et ne demande rien ; il invite à zoomer. Puis, aux zooms des carrés de 500 m, il suit
  // le relevé de la carte : un bois qu'elle ne dessinerait pas est écarté, un massif est estimé.
  const townCentre = await page.evaluate(({ cell, k }) => {
    const [ci, cj] = cell.split(':').map(Number);
    return [(cj * 4 + (k % 4) + 0.5) * 0.056, (ci * 4 + Math.floor(k / 4) + 0.5) * 0.04];
  }, { cell: SHARE_CELL, k: SHARE_BUILT });
  const hostPoint = () =>
    page.evaluate(({ centre }) => {
      // Un point de l'écran sous une hêtraie ou une chênaie, dans le carré de 4,5 km bâti.
      for (let y = 200; y < 700; y += 8) {
        for (let x = 420; x < 1100; x += 8) {
          const ll = window.map.unproject([x, y]);
          if (Math.abs(ll.lng - centre[0]) > 0.024 || Math.abs(ll.lat - centre[1]) > 0.017) continue;
          const hit = window.map.queryRenderedFeatures([x, y], { layers: ['bdforet-hit'] })[0];
          if (hit && ['FF1-09-09', 'FF1G01-01'].includes(hit.properties.code_tfv)) return { x, y };
        }
      }
      return null;
    }, { centre: townCentre });
  const readTown = () =>
    page.evaluate(() => ({
      lines: [...document.querySelectorAll('#spot .verdict')].map((v) => `${v.querySelector('strong')?.textContent} : ${v.querySelector('.verdict__why')?.textContent ?? ''} ${v.querySelector('.level-pill')?.textContent ?? ''}`),
      urban: document.querySelector('#spot .spot__urban')?.textContent ?? '',
      forest: document.querySelector('#spot .spot__row dd')?.textContent ?? '',
    }));
  await page.evaluate((c) => window.map.jumpTo({ center: c, zoom: 11 }), townCentre);
  await page.waitForTimeout(900);
  await idle(page);
  const wood = await hostPoint();
  let cityClicks = 0;
  if (wood) {
    await page.mouse.click(wood.x, wood.y);
    cityClicks++;
    await page.waitForFunction(() => [...document.querySelectorAll('#spot .verdict__why')].some((w) => /juger ce bois/.test(w.textContent)), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(400);
    const known = await readTown();
    check(
      'bilan en ville, forêt hôte connue (zoom 11) : « secteur urbanisé : zoomez pour juger ce bois », sans pourcentage, sans altitude demandée, avec le conseil',
      /hêtre|chênes/i.test(known.forest) && known.lines.filter((l) => /secteur urbanisé : zoomez pour juger ce bois $/.test(l)).length >= 2 && log.altitude.length === altitudeBefore && /cueillez loin des routes/.test(known.urban),
      `${known.forest} ; ${known.lines.join(' | ').slice(0, 220)} ; ${log.altitude.length - altitudeBefore} altitude(s)`,
    );
  } else {
    check('bilan en ville, forêt hôte connue (zoom 11) : un bois dans le carré bâti', false, 'aucun point trouvé');
  }
  await page.evaluate((c) => window.map.jumpTo({ center: c, zoom: 13.6 }), townCentre);
  await page.waitForFunction(() => [...document.querySelectorAll('#legend .legend-hint')].some((p) => /carrés? de 500 m avec arbres hôtes/.test(p.textContent)), null, { timeout: 20000 }).catch(() => {});
  await idle(page);
  const wood13 = await hostPoint();
  if (wood13) {
    // Le relevé de la carte dit « ce carré ne serait pas dessiné » : écarté, rien n'est demandé.
    const altitudeTown = log.altitude.length;
    await page.evaluate(() => {
      window.__survey = window.spot.survey;
      window.spot.survey = { townSquareKept: () => false };
    });
    await page.mouse.click(wood13.x, wood13.y);
    cityClicks++;
    await page.waitForFunction(() => [...document.querySelectorAll('#spot .verdict__why')].some((w) => /trop peu de bois/.test(w.textContent)), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(400);
    const park = await readTown();
    const parkCalls = log.altitude.length - altitudeTown;
    // Le vrai relevé de la carte (un massif dans la tuile simulée) : estimé, altitude demandée, conseil gardé.
    await page.evaluate(() => {
      window.spot.survey = window.__survey;
    });
    const kept = await page.evaluate(async ({ x, y }) => {
      const { MUSHROOM_BY_ID } = await import('/src/mushrooms.ts');
      const ll = window.map.unproject([x, y]);
      return window.meteo.townSquareKept(ll.lat, ll.lng, MUSHROOM_BY_ID.get('cepe'));
    }, wood13);
    await page.mouse.click(wood13.x, wood13.y);
    cityClicks++;
    await page.waitForSelector('#spot .rain-chart', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(400);
    const massif = await readTown();
    check(
      'bilan en ville aux zooms des carrés de 500 m : écarté sans appel si la carte n’y dessinerait pas de carré (« trop peu de bois autour du point »)',
      park.lines.filter((l) => /secteur urbanisé, trop peu de bois autour du point $/.test(l)).length >= 2 && parkCalls === 0 && /cueillez loin des routes/.test(park.urban),
      `${park.lines.join(' | ').slice(0, 200)} ; ${parkCalls} altitude(s)`,
    );
    check(
      'bilan en ville aux zooms des carrés de 500 m : le bilan suit le relevé de la carte (massif dessiné : estimé, altitude demandée), le conseil reste affiché',
      kept === null || (kept ? massif.lines.some((l) => /^Cèpes :  ≈ \d+ %/.test(l)) && log.altitude.length > altitudeTown : massif.lines.some((l) => /^Cèpes : secteur urbanisé, trop peu de bois/.test(l))) && /cueillez loin des routes/.test(massif.urban),
      `relevé de la carte : ${kept} ; ${massif.lines.join(' | ').slice(0, 160)}`,
    );
  } else {
    check('bilan en ville aux zooms des carrés de 500 m : un bois dans le carré bâti', false, 'aucun point trouvé');
  }
  await page.locator('#spot .panel__close').click();
  await page.evaluate((v) => window.map.jumpTo({ center: [v.lng, v.lat], zoom: v.zoom }), viewBefore);
  await page.waitForTimeout(900);
  await idle(page);

  // « pousse attendue d'ici N jours » en gras dans les raisons du bilan (c'est elle qui dit quand revenir).
  const emphasis = await page.evaluate(async () => {
    const { reasonItem } = await import('/src/spot.ts');
    const awaited = reasonItem('Pluie de 30 mm il y a 2 jours : encore tôt, pousse attendue d’ici 5 jours.');
    const one = reasonItem('Pluie de 30 mm il y a 3 jours : encore tôt, pousse attendue d’ici 1 jour.');
    const plain = reasonItem('Pluie de 16 mm il y a 10 jours : bon délai pour le cèpe (4 à 14 jours).');
    return {
      tag: awaited.tagName,
      strong: [...awaited.querySelectorAll('strong')].map((s) => s.textContent),
      text: awaited.textContent,
      one: one.querySelector('strong')?.textContent ?? '',
      plain: plain.querySelectorAll('strong').length,
    };
  });
  check(
    'bilan : « pousse attendue d’ici 5 jours » en gras dans sa raison, le reste de la phrase inchangé, rien en gras ailleurs',
    emphasis.tag === 'LI' && emphasis.strong.join('|') === 'pousse attendue d’ici 5 jours' && emphasis.text === 'Pluie de 30 mm il y a 2 jours : encore tôt, pousse attendue d’ici 5 jours.' && emphasis.one === 'pousse attendue d’ici 1 jour' && emphasis.plain === 0,
    JSON.stringify(emphasis),
  );

  // Carrés de 500 m : trois points sur neuf sous un arbre hôte ; en ville, cinq, et le carré doit
  // tenir à un massif (un parc isolé n'en pose plus).
  const fineRule = await page.evaluate(async () => {
    const { fineCellsToDraw, hostShare } = await import('/src/fineGrid.ts');
    const { MUSHROOM_BY_ID } = await import('/src/mushrooms.ts');
    const kept = fineCellsToDraw(
      [
        { id: '10:10', share: 3 / 9, town: false }, // campagne, trois points : dessiné
        { id: '10:12', share: 2 / 9, town: false }, // campagne, deux points : non
        { id: '12:11', share: 1, town: true }, // ville, parc isolé : non
        { id: '13:12', share: 4 / 9, town: true }, // ville, quatre points, au bord d'un massif : non
        { id: '13:13', share: 5 / 9, town: true }, // ville, massif de quatre carrés : dessinés
        { id: '13:14', share: 1, town: true },
        { id: '14:13', share: 1, town: true },
        { id: '14:14', share: 6 / 9, town: true },
        { id: '14:10', share: 1, town: true }, // ville, au bord de l'écran : ses voisins hors de l'écran ne comptent pas
      ],
    );
    // Un carré à cheval sur le bord de l'écran, dont un seul point est relevé : compté sur neuf points.
    const hetre = { code: 'FF1-09-09', soil: null };
    const edge = hostShare(MUSHROOM_BY_ID.get('cepe'), [hetre]);
    return { kept: [...kept].sort().join(' '), edge: +edge.toFixed(3), full: hostShare(MUSHROOM_BY_ID.get('cepe'), Array.from({ length: 9 }, () => hetre)) };
  });
  check(
    'carrés de 500 m : 3 points sur 9 hors des villes ; en ville, 5 points et un massif (parc isolé écarté, bord de l’écran compris) ; un seul point visible ne suffit pas',
    fineRule.kept === '10:10 13:13 13:14 14:13 14:14' && fineRule.edge === 0.111 && fineRule.full === 1,
    JSON.stringify(fineRule),
  );

  // Phrase de pluie : une vieille pluie « dépassée » ne masque plus la pluie récente qui va faire pousser.
  const [rainReasons, modestRain, rightTime] = await page.evaluate(async () => {
    const { MUSHROOM_BY_ID, scoreMushroom } = await import('/src/mushrooms.ts');
    const reasons = (recent, old) => {
      const weather = { days: Array.from({ length: 30 }, () => ({})), events: [{ date: 'a', ...recent }, { date: 'b', ...old }], rain30: 60, rain20: 60, tmean7: 14, tmin5: 8, frost: false, elevation: 500 };
      return scoreMushroom(MUSHROOM_BY_ID.get('cepe'), weather, 10).reasons;
    };
    return [reasons({ amount: 30, daysAgo: 2 }, { amount: 30, daysAgo: 17 }), reasons({ amount: 16, daysAgo: 2 }, { amount: 45, daysAgo: 17 }), reasons({ amount: 16, daysAgo: 10 }, { amount: 45, daysAgo: 17 })];
  });
  check(
    'phrase de pluie : petite pluie récente → « pousse incertaine » ; pluie récente dans le bon délai → c’est elle qui est citée',
    modestRain.some((r) => /Pluie de 16 mm il y a 2 jours : encore tôt, et pluie modeste : pousse incertaine/.test(r)) && rightTime.some((r) => /Pluie de 16 mm il y a 10 jours : bon délai pour le cèpe/.test(r)) && ![...modestRain, ...rightTime].some((r) => /délai dépassé|pousse attendue/.test(r)),
    `${modestRain[0]} | ${rightTime[0]}`,
  );
  check(
    'phrase de pluie : la pluie récente « encore tôt, pousse attendue d’ici 5 jours », pas la vieille pluie « dépassée » ; « idéal » dit une fois',
    rainReasons.some((r) => /Pluie de 30 mm il y a 2 jours : encore tôt, pousse attendue d’ici 5 jours/.test(r)) && !rainReasons.some((r) => /délai dépassé/.test(r)) && rainReasons.some((r) => /: idéal \(10 à 19 °C\)/.test(r)),
    rainReasons.join(' | '),
  );
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

  // Vue d'ensemble : chance en % dans chaque case, pastilles sur les secteurs à 70 % et plus.
  const zoomBefore = await page.evaluate(() => window.map.getZoom());
  await page.evaluate(() => window.map.jumpTo({ zoom: 7 }));
  await page.waitForFunction(() => window.map.querySourceFeatures('meteo').some((f) => f.properties.sub === 0), null, { timeout: 15000 });
  await idle(page);
  const top = await page.evaluate(() => {
    const cells = window.map.querySourceFeatures('meteo');
    return {
      chances: cells.every((f) => f.properties.p >= 0 && f.properties.p <= 95),
      points: window.map.querySourceFeatures('meteo-points').map((f) => f.properties.p),
      status: [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).find((t) => /cases de 18 km/.test(t)) ?? '',
    };
  });
  check(
    'chance estimée en % dans chaque case, pastilles seulement à 70 % et plus (12 au plus), meilleure chance de la vue annoncée',
    top.chances && top.points.length > 0 && top.points.length <= 12 && top.points.every((p) => p >= 70) && Number(/Meilleure chance estimée dans la vue : ≈ (\d+) %/.exec(top.status)?.[1]) >= Math.max(...top.points),
    `${top.points.length} pastille(s) ${top.points.slice(0, 5).join(', ')} ; ${top.status.slice(0, 130)}`,
  );
  // Choix des pastilles et saisons : deux règles simples, vérifiées sur leurs fonctions.
  const rules = await page.evaluate(async () => {
    const { pickHotspots } = await import('/src/meteoLayer.ts');
    const { MUSHROOMS, isDormant, noEstimate, seasonText } = await import('/src/mushrooms.ts');
    const spot = (p, x) => ({ p, l: 3, x, y: 46 });
    const months = Array.from({ length: 12 }, (_, k) => k + 1);
    return {
      threshold: pickHotspots([spot(69, 0), spot(70, 5)], 7).map((c) => c.p).join(),
      spaced: pickHotspots([spot(90, 0), spot(85, 0.5), spot(80, 3)], 7).map((c) => c.p).join(),
      capped: pickHotspots(Array.from({ length: 20 }, (_, k) => spot(95 - k, k * 2)), 7).length,
      dormant: Object.fromEntries(MUSHROOMS.map((m) => [m.id, months.filter((k) => isDormant(m, k)).join(' ')])),
      // Tout mois grisé est hors de la saison écrite, et rien n'est estimé ce mois-là.
      coherent: MUSHROOMS.every((m) => months.every((k) => !isDormant(m, k) || (noEstimate(m, k) && (m.season[k] ?? 0) < 0.5))),
      text: seasonText(MUSHROOMS.find((m) => m.id === 'morille')),
      // Rien à estimer sans être grisé : poids de saison nul à un mois de la saison écrite (trompettes en juillet).
      nearly: MUSHROOMS.flatMap((m) => months.filter((k) => noEstimate(m, k) && !isDormant(m, k)).map((k) => `${m.id} ${k}`)).join(', '),
      estimated: MUSHROOMS.every((m) => months.every((k) => noEstimate(m, k) || (m.season[k] ?? 0) > 0)),
    };
  });
  // L'indice léger d'un carré (pastilles) rend exactement celui du calcul complet.
  const quick = await page.evaluate(async () => {
    const { MUSHROOMS, scoreMushroom, squareScore, weatherCeiling } = await import('/src/mushrooms.ts');
    const { summaryAtAltitude, temperaturesAt } = await import('/src/weather.ts');
    const base = { rain20: 62, rain30: 80, tmean7: 12.3, tmin5: 4.1, frost: false, elevation: 500, lastDate: '', estimated: false, days: [], events: [{ date: '', amount: 31, daysAgo: 9 }, { date: '', amount: 18, daysAgo: 3 }] };
    let checked = 0;
    let differ = 0;
    for (const m of MUSHROOMS) {
      for (const month of [4, 7, 10, 11]) {
        for (const z of [null, 200, 500, 930, 1410, 2300]) {
          for (const quality of [1, 0.9, 0.55]) {
            const full = scoreMushroom(m, summaryAtAltitude(base, z), month, { hostQuality: quality }).score;
            const quick = squareScore(m, weatherCeiling(m, base, month), temperaturesAt(base, z), quality);
            checked++;
            if (full !== quick) differ++;
          }
        }
      }
    }
    return { checked, differ };
  });
  check('indice léger des carrés (pastilles) : identique au calcul complet, au dernier chiffre', quick.checked === 360 && quick.differ === 0, JSON.stringify(quick));
  check(
    'rien à estimer sans être grisé : seulement les trompettes en juillet et les chanterelles en tube en août ; partout ailleurs, un champignon estimé a un poids de saison',
    rules.nearly === 'trompette 7, chanterelle 8' && rules.estimated,
    rules.nearly,
  );
  check(
    'pastilles : 69 % écarté, 70 % gardé ; deux secteurs voisins n’en font qu’une ; 12 au plus',
    rules.threshold === '70' && rules.spaced === '90,80' && rules.capped === 12,
    JSON.stringify({ seuil: rules.threshold, espacement: rules.spaced, plafond: rules.capped }),
  );
  check(
    'hors saison de plus d’un mois, compté depuis la saison écrite : cèpes et girolles de janvier à avril, trompettes de février à juin, chanterelles de février à juillet, morilles d’août à janvier',
    rules.dormant.cepe === '1 2 3 4' && rules.dormant.girolle === '1 2 3 4' && rules.dormant.trompette === '2 3 4 5 6' && rules.dormant.chanterelle === '2 3 4 5 6 7' && rules.dormant.morille === '1 8 9 10 11 12' && rules.coherent && rules.text === 'mars à juin',
    JSON.stringify(rules.dormant),
  );
  await page.evaluate((z) => window.map.jumpTo({ zoom: z }), zoomBefore);
  await idle(page);

  // Grille fine : carrés de 500 m à partir du zoom 13 (mode indice)
  const before = log.altitude.length;
  await page.evaluate(() => {
    // Quand la pause se lève-t-elle ? (noté dans la page : les attentes qui suivent sont plus longues)
    const container = window.map.getContainer();
    const t0 = performance.now();
    window.__released = null;
    new MutationObserver(() => {
      if (window.__released === null && !container.classList.contains('zoom-paused')) window.__released = Math.round(performance.now() - t0);
    }).observe(container, { attributes: true, attributeFilter: ['class'] });
    window.map.jumpTo({ zoom: 13.6 });
  });
  // Calcul des carrés en cours : le zoom est en pause (molette, pincement, cadre, touches, boutons),
  // sans rien couper dans MapLibre ni bloquer le déplacement ; le champignon s'affiche.
  const paused = await zoomPause(page);
  const ignored = await page.evaluate(async () => {
    const canvas = window.map.getCanvas();
    const inner = window.map.getCanvasContainer(); // là où MapLibre écoute
    const reached = [];
    const spy = (event) => reached.push(event.type === 'keydown' ? `touche ${event.keyCode}` : event.type === 'touchstart' ? `toucher ${event.touches.length}` : event.type);
    for (const type of ['wheel', 'keydown', 'touchstart', 'mousedown']) inner.addEventListener(type, spy, true);
    const before = window.map.getZoom();
    const [plus] = document.querySelectorAll('#toolbar-bottom .toolbar__group button');
    plus.click();
    const wheel = new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true, clientX: 700, clientY: 400 });
    canvas.dispatchEvent(wheel);
    const pinch = new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, bubbles: true, cancelable: true, clientX: 700, clientY: 400 });
    canvas.dispatchEvent(pinch);
    // Maj + « + » d'un clavier allemand : la touche vaut « * », son code 187 : MapLibre zoomerait de deux niveaux.
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '*', keyCode: 187, shiftKey: true, bubbles: true }));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '-', keyCode: 189, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, button: 0, bubbles: true, cancelable: true, clientX: 700, clientY: 400 }));
    const finger = (id, x) => new Touch({ identifier: id, target: canvas, clientX: x, clientY: 400 });
    canvas.dispatchEvent(new TouchEvent('touchstart', { touches: [finger(1, 650), finger(2, 750)], changedTouches: [finger(2, 750)], bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    for (const type of ['wheel', 'keydown', 'touchstart', 'mousedown']) inner.removeEventListener(type, spy, true);
    const loader = document.getElementById('grid-loader');
    return {
      before,
      after: window.map.getZoom(),
      reached: reached.join(),
      prevented: wheel.defaultPrevented && pinch.defaultPrevented,
      focusable: !plus.disabled,
      loader: !loader.hidden,
      fill: Boolean(loader.querySelector('.grid-loader__fill svg')),
      text: loader.querySelector('.grid-loader__text')?.textContent ?? '',
      hiddenFromReaders: loader.getAttribute('aria-hidden'),
    };
  });
  check(
    'calcul des carrés (zoom 13,6) : zoom en pause dès la fin du déplacement, boutons « + » et « − » en pause et décrits, rien de coupé dans MapLibre sauf le double clic',
    paused.paused && !paused.doubleClick && paused.buttons === 'true,true' && paused.described === 'Zoom en pause pendant le calcul des carrés.|Zoom en pause pendant le calcul des carrés.' && paused.handlers,
    JSON.stringify(paused),
  );
  check(
    'zoom en pause : molette, pincement du pavé tactile, touches + et − (d’après leur code), Maj + glisser et toucher à deux doigts n’arrivent pas à MapLibre ; la page ne zoome pas ; le zoom ne bouge pas',
    ignored.reached === '' && ignored.prevented && ignored.after === ignored.before && ignored.focusable,
    `arrivés à MapLibre : « ${ignored.reached} » ; zoom ${ignored.before} → ${ignored.after}`,
  );
  check(
    'champignon de chargement : affiché après un quart de seconde, plein et contour superposés, « Calcul des carrés… », décoratif pour les lecteurs d’écran',
    ignored.loader && ignored.fill && ignored.text === 'Calcul des carrés…' && ignored.hiddenFromReaders === 'true',
    JSON.stringify({ affiche: ignored.loader, texte: ignored.text }),
  );
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
      altitudes: [...new Set(features.map((f) => f.properties.z))].length,
      levels: [...new Set(features.map((f) => f.properties.l))].sort(),
      coverage: features.every((f) => f.properties.c >= 0.3 && f.properties.c <= 1),
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
  await page.waitForFunction(() => window.__released !== null && document.getElementById('grid-loader').hidden, null, { timeout: 9000 }).catch(() => {});
  const free = await zoomPause(page);
  const releasedAfter = await page.evaluate(() => window.__released);
  check(
    'carrés dessinés : la pause se lève d’elle-même, bien avant son plafond de 8 s ; le champignon disparaît, les boutons reprennent',
    zoomFree(free) && releasedAfter !== null && releasedAfter < 6000,
    `levée après ${releasedAfter} ms ; ${JSON.stringify(free)}`,
  );
  // Contre-épreuve : hors pause, la même molette zoome bien (puis retour au zoom du test).
  await page.mouse.move(700, 430);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(1200);
  const wheeled = await page.evaluate(() => window.map.getZoom());
  check('hors pause, la molette zoome normalement', wheeled > 13.7, `zoom ${wheeled.toFixed(2)}`);
  await page.evaluate(() => window.map.jumpTo({ zoom: 13.6 }));
  await page.waitForFunction(() => !window.map.getContainer().classList.contains('zoom-paused') && document.getElementById('grid-loader').hidden, null, { timeout: 12000 }).catch(() => {});
  await page.waitForFunction(() => [...document.querySelectorAll('#legend .legend-hint')].some((p) => /carrés? de 500 m avec arbres hôtes/.test(p.textContent)), null, { timeout: 20000 }).catch(() => {});
  await idle(page);
  // Suivi de la position (GPS) : il déplace la carte à chaque nouvelle position ; la grille est refaite,
  // mais sans pause du zoom (sinon on ne pourrait plus zoomer en marchant).
  const tracking = await page.evaluate(async () => {
    const container = window.map.getContainer();
    window.meteo.refresh(true);
    const byTracking = container.classList.contains('zoom-paused');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // Déplacement du visiteur sur une vue déjà relevée : rien à attendre, pas de pause non plus.
    window.meteo.refresh(false);
    const known = container.classList.contains('zoom-paused');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // Vue jamais relevée (relevés oubliés) : la pause revient.
    (await import('/src/fineGrid.ts')).forgetSurveys();
    window.meteo.refresh(false);
    const byVisitor = container.classList.contains('zoom-paused');
    return { byTracking, known, byVisitor };
  });
  check('suivi de la position : pas de pause du zoom quand c’est le GPS qui déplace la carte (un déplacement du visiteur, lui, la déclenche)', !tracking.byTracking && tracking.byVisitor, JSON.stringify(tracking));
  check('vue déjà relevée dans la visite : un déplacement du visiteur n’y met pas le zoom en pause', !tracking.known, JSON.stringify(tracking));
  await page.waitForFunction(() => !window.map.getContainer().classList.contains('zoom-paused') && document.getElementById('grid-loader').hidden, null, { timeout: 12000 }).catch(() => {});
  await idle(page);
  const batches = log.altitude.slice(before);
  // Un point par carré demandé (séparés par « | », écrit %7C dans l'adresse).
  const asked = batches.reduce((n, q) => n + (/[?&]lon=([^&]*)/.exec(q)?.[1].split('%7C').length ?? 0), 0);
  check('grille fine : carrés de 500 m dessinés, tous avec au moins 3 points sur 9 sous un arbre hôte', fine.count > 20 && fine.visible === 'visible' && fine.coverage, `${fine.count} carrés, ${fine.levels.join(',')}`);
  check('grille fine : une altitude demandée par carré à dessiner, pas davantage', asked > 20 && asked <= fine.count, `${asked} altitude(s) demandée(s) pour ${fine.count} carré(s) dessiné(s)`);
  check('grille fine : altitudes IGN groupées et variées', batches.length >= 1 && batches.every((q) => q.includes('%7C')) && fine.altitudes > 5, `${batches.length} requête(s), ${fine.altitudes} altitudes`);
  check('grille fine : altitudes gardées dans le navigateur', fine.saved > 20, `${fine.saved} altitudes`);
  check(
    'grille fine : la grille des cases s’efface au zoom 12',
    fine.coarseOpacity.startsWith('["interpolate",["linear"],["zoom"]') && fine.coarseOpacity.includes(',12,["*",0.35,'),
    fine.coarseOpacity.slice(0, 40),
  );
  check('grille fine : état dans la légende', Boolean(fine.status) && fine.coverage, fine.status);
  // Le bilan d'un coin en ville suit ce relevé : la règle de ville du carré de 500 m qui contient le
  // point, connue seulement si ses neuf carrés (lui et ses voisins) sont relevés en entier.
  const survey = await page.evaluate(async () => {
    const { MUSHROOM_BY_ID } = await import('/src/mushrooms.ts');
    const cepe = MUSHROOM_BY_ID.get('cepe');
    const c = window.map.getCenter();
    const b = window.map.getBounds();
    return {
      centre: typeof window.meteo.townSquareKept(c.lat, c.lng, cepe),
      edge: window.meteo.townSquareKept(b.getNorth() - 0.0001, b.getEast() - 0.0001, cepe),
      outside: window.meteo.townSquareKept(c.lat + 1, c.lng + 1, cepe),
    };
  });
  check(
    'bilan en ville : la règle des carrés de 500 m est connue au centre de la vue relevée, inconnue dès qu’un des neuf carrés autour du point manque au relevé (coin de l’écran, hors de la vue) : le bilan estime alors',
    survey.centre === 'boolean' && survey.edge === null && survey.outside === null,
    JSON.stringify(survey),
  );
  // Changer de champignon : les nouvelles valeurs partent tout de suite, à partir du dernier relevé,
  // sans attendre ni le réseau ni le repos de la carte (sinon les carrés gardent un instant les
  // valeurs de l'ancien champignon sous le nom du nouveau).
  const redrawn = await page.evaluate(() => {
    const calls = { meteo: 0, 'meteo-fin': 0 };
    const restore = [];
    for (const id of Object.keys(calls)) {
      const source = window.map.getSource(id);
      const original = source.setData;
      source.setData = function (data) {
        calls[id]++;
        return original.call(this, data);
      };
      restore.push(() => {
        source.setData = original;
      });
    }
    window.store.update({ mushroom: 'trompette' });
    const after = { ...calls };
    window.store.update({ mushroom: 'cepe' });
    const back = { ...calls };
    restore.forEach((r) => r());
    return { after, back };
  });
  check(
    'changer de champignon : grille et carrés de 500 m redessinés dans l’instant, une seule fois chacun',
    redrawn.after.meteo === 1 && redrawn.after['meteo-fin'] === 1 && redrawn.back.meteo === 2 && redrawn.back['meteo-fin'] === 2,
    JSON.stringify(redrawn),
  );
  await idle(page);
  await page.screenshot({ path: `${OUT}04b-bureau-grille-fine.png` });
  await page.evaluate(() => window.map.jumpTo({ zoom: 11.5 }));
  await idle(page);

  // Grille en mode pluie
  await page.getByText('Pluie des 20 derniers jours', { exact: true }).click();
  const rain = await page.evaluate(() => ({
    fill: JSON.stringify(window.map.getPaintProperty('meteo-cellules', 'fill-color')),
    text: JSON.stringify(window.map.getLayoutProperty('meteo-etiquettes', 'text-field')),
  }));
  check('mode pluie : couleurs et étiquettes en mm', rain.fill.startsWith('["step",["get","rain20"]') && rain.text.includes('rain20'), rain.text);
  await page.evaluate(() => {
    const c = window.map.getCenter();
    window.map.jumpTo({ center: [c.lng + 0.002, c.lat] });
  });
  const rainFree = await zoomPause(page);
  check('mode pluie (zoom 11,5) : pas de calcul de carrés, donc ni champignon ni pause du zoom', zoomFree(rainFree), JSON.stringify(rainFree));
  const rainLines = await page.evaluate(() => window.map.getLayer('meteo-contours').minzoom);
  check('mode pluie : le quadrillage des cases revient à tous les zooms', rainLines === 4, `à partir du zoom ${rainLines}`);
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
  // En mode pluie, changer de champignon ne change rien à la grille : rien n'est renvoyé à la carte.
  await idle(page);
  const rainStill = await page.evaluate(() => {
    const source = window.map.getSource('meteo');
    const original = source.setData;
    let calls = 0;
    source.setData = function (data) {
      calls++;
      return original.call(this, data);
    };
    const properties = Object.keys(window.map.querySourceFeatures('meteo')[0]?.properties ?? {}).sort().join();
    window.store.update({ mushroom: 'trompette' });
    window.store.update({ mushroom: 'cepe' });
    source.setData = original;
    return { calls, properties };
  });
  check('mode pluie : les cases ne portent pas d’indice, changer de champignon ne renvoie rien à la carte', rainStill.calls === 0 && rainStill.properties === 'elevation,rain20,sub,x,y', JSON.stringify(rainStill));

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
    sheet: [...document.querySelectorAll('.mushroom-card a[target="_blank"]')].map((a) => ({ href: a.getAttribute('href'), rel: a.getAttribute('rel'), text: a.textContent })),
    order: [...document.querySelectorAll('.mushroom-card > *')].map((el) => el.className.split(' ').pop()),
  }));
  const springNow = false; // la page croit être en octobre (mois figé par installMocks)
  // Hors saison de plus d'un mois : puce grisée (et en tirets), toujours cliquable ; rien n'est
  // chargé, calculé ni dessiné pour elle, et la légende le dit.
  await page.waitForTimeout(900);
  await idle(page);
  // La grille montrait la pluie : choisir un champignon hors saison ne la remplace pas par une grille vide.
  const keptRain = await page.evaluate(() => ({ mode: window.store.state.weatherMode, cells: window.map.querySourceFeatures('meteo').length }));
  check('champignon hors saison choisi : la grille de pluie affichée est gardée', keptRain.mode === 'pluie' && keptRain.cells > 0, JSON.stringify(keptRain));
  await page.evaluate(() => window.store.update({ weatherMode: 'indice' }));
  await page.waitForTimeout(900);
  await idle(page);
  const asleep = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.chip--mushroom')];
    const chip = chips.find((b) => b.textContent === 'Morilles');
    return {
      dormant: chips.filter((b) => b.classList.contains('chip--dormant')).map((b) => b.textContent).join(),
      dashed: chip ? getComputedStyle(chip).borderStyle : '',
      pressed: chip?.getAttribute('aria-pressed'),
      described: document.getElementById(chip?.getAttribute('aria-describedby') ?? '')?.textContent ?? '',
      mode: window.store.state.weatherMode,
      sources: ['meteo', 'meteo-points', 'meteo-fin'].map((id) => window.map.querySourceFeatures(id).length).join(),
      hints: [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).join(' | '),
      radio: [...document.querySelectorAll('#legend .basemap-option')].map((l) => l.textContent).find((t) => /Chance estimée/.test(t)) ?? '',
      scale: document.querySelector('#legend .scale')?.hidden,
      caveat: document.querySelector('#legend .legend-hint--caveat')?.hidden,
    };
  });
  check(
    'morilles en octobre : seule puce grisée et en tirets, toujours cliquable, « hors saison (mars à juin) » en description',
    asleep.dormant === 'Morilles' && asleep.dashed === 'dashed' && asleep.pressed === 'true' && asleep.described === 'hors saison (mars à juin)',
    JSON.stringify({ grisees: asleep.dormant, bord: asleep.dashed, description: asleep.described }),
  );
  check(
    'champignon hors saison choisi : ni grille, ni pastilles, ni carrés de 500 m ; la légende dit « hors saison », sans échelle de couleurs',
    asleep.mode === 'indice' && asleep.sources === '0,0,0' && /Morilles hors saison \(mars à juin\) : aucune chance estimée en ce moment/.test(asleep.hints) && /morilles \(hors saison\)/.test(asleep.radio) && asleep.scale === true && asleep.caveat === true,
    `${asleep.mode} ; carrés ${asleep.sources} ; ${asleep.radio}`,
  );
  check('morilles : frênaies, peupleraies et coupes affichées', morel.mushroom === 'morille' && ['FF1-49-49', 'FP', 'FF0'].every((c) => morel.filter.includes(c)), morel.filter.slice(0, 90));
  check('morilles : encadré gyromitre et cuisson', /gyromitre/i.test(morel.caution) && /20 minutes/.test(morel.caution) && /pas ce qui se mange/i.test(morel.caution), morel.caution.slice(0, 60));
  check('morilles : saison de mars à juin, hors saison signalé', /mars à juin/.test(morel.facts) && (springNow || /Hors saison/.test(morel.season)), morel.season || morel.facts.slice(-30));
  check('morilles : sols calcaires et alluvions favorables', ['calcaire', 'humide', 'marne'].every((x) => morel.favored.includes(x)), morel.favored.join(','));
  check(
    'fiche : un seul lien externe, vers la fiche MycoDB de l’espèce nommée, libellé neutre, avant l’encadré de précaution',
    morel.sheet.length === 1 &&
      morel.sheet[0].href === 'https://www.mycodb.fr/fiche.php?genre=Morchella&espece=esculenta' &&
      /noopener/.test(morel.sheet[0].rel) && /noreferrer/.test(morel.sheet[0].rel) &&
      /Morchella esculenta sur MycoDB \(site tiers\)/.test(morel.sheet[0].text) &&
      !/comestible|identifier|reconna/i.test(morel.sheet[0].text) &&
      morel.order.indexOf('mushroom-card__link') >= 0 && morel.order.indexOf('mushroom-card__link') < morel.order.indexOf('mushroom-card__caution') && morel.order[morel.order.length - 1] === 'mushroom-card__caution',
    `${morel.sheet[0]?.text} — ${morel.order.join(' > ')}`,
  );
  await page.screenshot({ path: `${OUT}05b-bureau-morilles.png` });
  // Retour à un champignon de saison : la grille revient dans l'instant, à partir du dernier relevé gardé.
  const back = await page.evaluate(() => {
    const source = window.map.getSource('meteo');
    const original = source.setData;
    let sent = 0;
    source.setData = function (data) {
      sent = data.features.length;
      return original.call(this, data);
    };
    window.store.update({ mushroom: 'cepe' });
    const now = sent;
    window.store.update({ mushroom: 'morille' });
    source.setData = original;
    return now;
  });
  check('retour à un champignon de saison : la grille est redessinée dans l’instant, sans attendre le réseau', back > 0, `${back} carré(s) envoyé(s) tout de suite`);
  // (Après ce test seulement : déplacer la carte pendant qu'un champignon hors saison est montré fait oublier le relevé gardé.)
  await page.evaluate(() => {
    const c = window.map.getCenter();
    window.map.jumpTo({ center: [c.lng + 0.002, c.lat] });
  });
  const asleepFree = await zoomPause(page);
  check('champignon hors saison choisi : rien à calculer, donc ni champignon de chargement ni pause du zoom', zoomFree(asleepFree), JSON.stringify(asleepFree));
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
      totals['app.spots'] === 7 + cityClicks,
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

/**
 * Relevés des carrés de 500 m gardés d'une visite à l'autre : une vue déjà relevée se redessine sans
 * attendre les tuiles des forêts, sans pause du zoom ; une tuile en panne ne laisse rien dans le cache.
 */
async function surveyCacheTests(browser, base) {
  const FOREST = '13.2/45.92/6.19';
  const KEY = 'foret-explorer:releves';
  const stored = (page) =>
    page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      const saved = raw ? JSON.parse(raw) : null;
      const texts = Object.values(saved?.s ?? {});
      return { chars: raw?.length ?? 0, entries: texts.length, shapes: texts.every((t) => t.length === 2 || t.length === 18), day: saved?.d ?? '', codes: saved?.c?.length ?? 0 };
    }, KEY);
  const squares = (page) =>
    page.evaluate(() => {
      // `drawn` : morceaux de carrés dans les tuiles (un carré à cheval sur deux tuiles compte deux
      // fois) ; `count` : le nombre annoncé par la légende, une fois le relevé fini.
      const status = [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).find((t) => /500 m avec/.test(t)) ?? '';
      return {
        drawn: window.map.querySourceFeatures('meteo-fin').length,
        count: Number(status.match(/(\d+) carrés? de 500 m avec/)?.[1] ?? -1),
        surveyed: window.meteo.fineData?.cells.length ?? 0,
        forests: window.map.isSourceLoaded('bdforet'),
      };
    });
  const indexOn = (page) => page.evaluate(() => window.store.update({ mushroom: 'cepe', weatherMode: 'indice' }));

  // Première visite : le relevé de la vue est écrit dans le navigateur, quelques secondes après.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await preAccept(context);
  const page = await context.newPage();
  await installMocks(page, { tms: [], wmts: [], geocode: [], other: [] });
  await page.goto(`${base}#carte=${FOREST}`);
  await waitForMap(page);
  await indexOn(page);
  await page.waitForFunction(() => window.map.querySourceFeatures('meteo-fin').length > 0, null, { timeout: 15000 });
  await page.waitForFunction((key) => localStorage.getItem(key) !== null, KEY, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => [...document.querySelectorAll('#legend .legend-hint')].some((p) => /500 m avec/.test(p.textContent)), null, { timeout: 8000 }).catch(() => {});
  const first = { ...(await squares(page)), ...(await stored(page)) };
  check(
    'relevés gardés : la vue relevée est écrite dans le navigateur (2 ou 18 caractères par carré, jour de la première écriture)',
    first.drawn > 20 && first.entries > 100 && first.shapes && /^\d{4}-\d\d-\d\d$/.test(first.day) && first.codes > 0 && first.chars < first.entries * 40,
    `${first.entries} carré(s), ${first.chars} caractères, ${first.codes} type(s) de forêt ; ${first.drawn} dessiné(s)`,
  );
  await page.close();

  // Seconde visite (mémoire vide, même navigateur) : les tuiles détaillées des forêts mettent 6 s.
  // Arrivé par le zoom 10,5, on saute sur la forêt déjà relevée : ses carrés sont là avant ces tuiles,
  // et le zoom n'est pas mis en pause.
  let slow = 0;
  const page2 = await context.newPage();
  await installMocks(page2, { tms: [], wmts: [], geocode: [], other: [] }, { delaiForet: (z) => (z >= 12 ? slow : 0) });
  await page2.goto(`${base}#carte=10.5/45.92/6.19`);
  await waitForMap(page2);
  await indexOn(page2);
  await page2.waitForFunction(() => window.map.querySourceFeatures('meteo').length > 0, null, { timeout: 15000 });
  slow = 6000;
  await page2.evaluate(() => {
    window.__paused = false;
    new MutationObserver(() => {
      if (window.map.getContainer().classList.contains('zoom-paused')) window.__paused = true;
    }).observe(window.map.getContainer(), { attributes: true, attributeFilter: ['class'] });
    window.__t0 = performance.now();
    window.map.jumpTo({ zoom: 13.2 });
  });
  const quick = await page2
    .waitForFunction(() => window.map.querySourceFeatures('meteo-fin').length > 0, null, { timeout: 4000 })
    .then(() => true, () => false);
  const again = {
    ...(await squares(page2)),
    after: await page2.evaluate(() => Math.round(performance.now() - window.__t0)),
    paused: await page2.evaluate(() => window.__paused),
    loader: await page2.evaluate(() => !document.getElementById('grid-loader').hidden),
  };
  check(
    'vue déjà relevée à une visite précédente : carrés de 500 m dessinés avant l’arrivée des tuiles des forêts, sans pause du zoom ni champignon',
    quick && !again.forests && again.drawn > 20 && again.after < 4000 && !again.paused && !again.loader,
    `${again.drawn} carré(s) après ${again.after} ms, tuiles des forêts ${again.forests ? 'arrivées' : 'en route'}, pause : ${again.paused}`,
  );
  // Les tuiles arrivées, le relevé est complété par les carrés du bord de l'écran : aucun ne disparaît.
  await page2.waitForFunction(() => window.map.isSourceLoaded('bdforet') && window.map.loaded(), null, { timeout: 20000 }).catch(() => {});
  await page2.waitForTimeout(800);
  const full = await squares(page2);
  check(
    'vue déjà relevée : une fois les tuiles arrivées, le relevé est complété (bord de l’écran) sans rien retirer',
    full.forests && full.surveyed >= again.surveyed && full.drawn >= again.drawn && full.count === first.count && first.count > 0,
    `${again.surveyed} → ${full.surveyed} carré(s) boisé(s), ${again.drawn} → ${full.drawn} morceau(x) dessiné(s) ; ${full.count} carré(s) annoncé(s) (première visite : ${first.count})`,
  );
  // Vue jamais relevée : rien n'est dessiné d'avance, et le zoom se met en pause comme avant.
  await page2.evaluate(() => {
    window.__paused = false;
    window.map.jumpTo({ center: [6.45, 45.92] });
  });
  await page2.waitForTimeout(1500);
  const fresh = { ...(await zoomPause(page2)), seen: await page2.evaluate(() => window.__paused) };
  check('vue jamais relevée : le zoom se met en pause en attendant les tuiles des forêts', fresh.paused && fresh.seen, `pause : ${fresh.paused}`);
  await page2.close();

  // Règles du cache : écriture compacte relue à l'identique, texte abîmé refusé.
  const page3 = await context.newPage();
  await installMocks(page3, { tms: [], wmts: [], geocode: [], other: [] });
  await page3.goto(`${base}#carte=10.5/45.92/6.19`);
  await waitForMap(page3);
  const rules = await page3.evaluate(async () => {
    const { packSamples, unpackSamples } = await import('/src/fineGrid.ts');
    const mixed = [
      { code: 'FF1G01-01', soil: 'calcaire' },
      { code: null, soil: null },
      { code: 'FF2-91-91', soil: null },
      { code: 'FF1G01-01', soil: 'gres' },
      { code: 'FF1G01-01', soil: 'calcaire' },
      { code: null, soil: null },
      { code: 'FF1-49-49', soil: 'humide' },
      { code: 'FF1-49-49', soil: 'humide' },
      { code: null, soil: null },
    ];
    const same = Array.from({ length: 9 }, () => ({ code: 'FF1G01-01', soil: 'marne' }));
    const none = Array.from({ length: 9 }, () => ({ code: null, soil: null }));
    const codes = [];
    const soils = [];
    const texts = [mixed, same, none].map((s) => packSamples(s, codes, soils));
    const back = texts.map((t) => unpackSamples(t, codes, soils));
    return {
      lengths: texts.map((t) => t.length).join(),
      equal: JSON.stringify(back) === JSON.stringify([mixed, same, none]),
      partial: packSamples(mixed.slice(0, 4), codes, soils),
      broken: [unpackSamples('0', codes, soils), unpackSamples('z0', codes, soils), unpackSamples('0z', codes, soils), unpackSamples('0000', codes, soils)].every((v) => v === null),
      unknownSoil: unpackSamples('00', codes, ['granit']),
    };
  });
  check(
    'relevés gardés : neuf points écrits en 18 caractères (2 s’ils se valent), relus à l’identique ; relevé partiel et texte abîmé refusés',
    rules.lengths === '18,2,2' && rules.equal && rules.partial === null && rules.broken && rules.unknownSoil === null,
    JSON.stringify(rules),
  );
  await context.close();

  // Tuiles détaillées des forêts en panne : la carte dessine avec ce qu'elle a, mais ne garde rien
  // (un relevé fait sans elles resterait faux pendant des semaines).
  const broken = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await preAccept(broken);
  const page4 = await broken.newPage();
  await installMocks(page4, { tms: [], wmts: [], geocode: [], other: [] }, { panneForet: (z) => z >= 12 });
  await page4.goto(`${base}#carte=10.5/45.92/6.19`);
  await waitForMap(page4);
  await indexOn(page4);
  await page4.evaluate(() => window.map.jumpTo({ zoom: 13.2 }));
  await page4.waitForFunction(() => window.meteo.fineData !== null && window.map.loaded(), null, { timeout: 15000 }).catch(() => {});
  await page4.waitForTimeout(4500); // plus que le délai d'écriture
  const lost = { ...(await stored(page4)), ...(await squares(page4)) };
  check('tuiles des forêts en panne : aucun relevé gardé dans le navigateur', lost.entries === 0, `${lost.entries} carré(s) gardé(s), ${lost.surveyed} relevé(s) à l’écran`);
  await broken.close();
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
  // Un coin sans forêt sous le point : rien à estimer, donc rien n'est demandé, pas même en secours.
  const empty = await page.evaluate(() => {
    for (let y = 150; y < 700; y += 6) {
      for (let x = 500; x < 1150; x += 6) {
        if (!window.map.queryRenderedFeatures([x, y], { layers: ['bdforet-hit'] }).length) return { x, y };
      }
    }
    return null;
  });
  if (empty) {
    const meteoBefore = log.meteo.length;
    const altitudeBefore = log.altitude.length;
    await page.mouse.click(empty.x, empty.y);
    await page.waitForFunction(() => [...document.querySelectorAll('#spot .verdict__why')].some((w) => /pas de forêt cartographiée sous ce point/.test(w.textContent)), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const nothing = await page.evaluate(() => ({
      off: [...document.querySelectorAll('#spot .verdict--off .verdict__why')].map((w) => w.textContent),
      pills: [...document.querySelectorAll('#spot .level-pill')].map((p) => p.textContent),
      altitude: [...document.querySelectorAll('#spot .spot__row')].find((r) => r.querySelector('dt')?.textContent === 'Altitude')?.querySelector('dd')?.textContent ?? '',
      text: document.querySelector('#spot .spot__body')?.textContent ?? '',
    }));
    check(
      'secours, coin sans forêt : cinq lignes écartées sans calcul, ni altitude IGN ni Open-Meteo demandés, pas de « météo indisponible »',
      nothing.off.length === 5 && nothing.off.filter((w) => /pas de forêt cartographiée sous ce point/.test(w)).length === 4 && nothing.pills.length === 4 && nothing.pills.every((t) => /^≈ 0 % · /.test(t)) &&
        log.meteo.length === meteoBefore && log.altitude.length === altitudeBefore && /non demandée \(rien à estimer ici\)/.test(nothing.altitude) && !/réseau \?/.test(nothing.text),
      `${nothing.off.join(' | ')} ; altitude : ${nothing.altitude} ; ${log.meteo.length - meteoBefore} appel(s) Open-Meteo, ${log.altitude.length - altitudeBefore} altitude(s)`,
    );
  } else {
    check('secours, coin sans forêt : un point sans forêt à l’écran', false, 'aucun point trouvé');
  }
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
  check('bilan : chance estimée en % pour chaque champignon de saison (quatre en octobre)', provisional.pills.length === 4 && provisional.pills.every((t) => /^≈ \d+ % · /.test(t)), provisional.pills.join(' | '));

  // Fichier des parts de forêt absent : la grille se dessine comme avant, et la légende le dit.
  const page5 = await context.newPage();
  await installMocks(page5, { tms: [], wmts: [], geocode: [], other: [] }, { foret: false });
  await page5.goto(`${base}#carte=10.5/45.92/6.19`);
  await waitForMap(page5);
  await page5.getByRole('button', { name: 'Cèpes', exact: true }).click();
  await page5.waitForFunction(() => window.map.querySourceFeatures('meteo').length > 0, null, { timeout: 15000 });
  const blind = await page5.evaluate(() => ({
    covers: [...new Set(window.map.querySourceFeatures('meteo').map((f) => f.properties.c))],
    levels: [...new Set(window.map.querySourceFeatures('meteo').map((f) => f.properties.l))],
    status: [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).find((t) => /cases de 18 km/.test(t)) ?? '',
  }));
  check(
    'parts de forêt absentes : tous les carrés dessinés à la météo seule, la légende le dit',
    blind.covers.join() === '-1' && blind.levels.length > 0 && /Arbres hôtes inconnus/.test(blind.status),
    `c = ${blind.covers.join()} ; ${blind.status.slice(-90)}`,
  );
  await page5.close();

  // En secours, Open-Meteo n'est interrogé que pour les cases que l'appelant dessinera.
  const filtered = await page.evaluate(async () => {
    const { weatherForCells } = await import('/src/weather.ts');
    const cell = (i, j) => ({ i, j, id: `${i}:${j}`, lat: +((i + 0.5) * 0.16).toFixed(4), lon: +((j + 0.5) * 0.224).toFixed(4) });
    const wanted = cell(280, 20);
    const skipped = cell(280, 21);
    const result = await weatherForCells([wanted, skipped], undefined, (c) => c.id !== skipped.id);
    return { got: [...result.series.keys()].join(), wanted: wanted.lat, skipped: skipped.lat, lonWanted: wanted.lon, lonSkipped: skipped.lon, shared: result.shared };
  });
  const lastQuery = decodeURIComponent(log.meteo[log.meteo.length - 1] ?? '');
  check(
    'secours : une case que la carte ne dessinera pas (aucun carré allumé) n’est pas demandée à Open-Meteo',
    filtered.shared === false && filtered.got === '280:20' && lastQuery.includes(String(filtered.lonWanted)) && !lastQuery.includes(String(filtered.lonSkipped)),
    `séries : ${filtered.got} ; ${lastQuery.slice(0, 110)}`,
  );

  // Juillet : les trompettes ne sont pas grisées (août est à un mois) mais leur poids de saison est nul.
  // Rien n'est calculé : ni grille, ni carrés de 500 m, ni altitude ; le bilan le dit avec « ≈ 0 % ».
  const page7 = await context.newPage();
  const log7 = { tms: [], wmts: [], geocode: [], other: [] };
  await installMocks(page7, log7, { mois: 7 });
  // Réglages par défaut (grille éteinte) : avec ceux des pages précédentes, la grille, qui démarre dès
  // la lecture du style, dessinerait les cèpes et demanderait leurs altitudes avant le test.
  await page7.addInitScript(() => localStorage.removeItem('foret-explorer:v1'));
  await page7.goto(`${base}#carte=13.6/45.92/6.19`);
  await waitForMap(page7);
  await page7.evaluate(() => window.store.update({ mushroom: null, weatherMode: 'off' })); // l'état gardé par le navigateur vient des pages précédentes
  await page7.getByRole('button', { name: 'Trompettes', exact: true }).click();
  await page7.waitForTimeout(1500);
  await idle(page7);
  const july = await page7.evaluate(() => {
    const chip = [...document.querySelectorAll('.chip--mushroom')].find((b) => b.textContent === 'Trompettes');
    return {
      dormant: [...document.querySelectorAll('.chip--dormant')].map((b) => b.textContent).join(),
      chip: chip?.classList.contains('chip--dormant'),
      mode: window.store.state.weatherMode,
      sources: ['meteo', 'meteo-points', 'meteo-fin'].map((id) => window.map.querySourceFeatures(id).length).join(),
      card: document.querySelector('.mushroom-card__season')?.textContent ?? '',
    };
  });
  // La grille allumée sur l'indice n'a rien à montrer : la légende le dit, aucune altitude n'est demandée.
  await page7.evaluate(() => window.store.update({ weatherMode: 'indice' }));
  await page7.waitForTimeout(1500);
  await idle(page7);
  const julyIndex = await page7.evaluate(() => ({
    sources: ['meteo', 'meteo-points', 'meteo-fin'].map((id) => window.map.querySourceFeatures(id).length).join(),
    hints: [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).join(' | '),
  }));
  check(
    'juillet, trompettes (poids de saison nul, pas grisées) : la puce reste normale, le mode météo n’est pas forcé, la fiche dit « hors saison »',
    july.chip === false && !/Trompettes/.test(july.dormant) && july.mode === 'off' && /Hors saison en ce moment : aucune chance estimée avant la saison \(août à décembre\)/.test(july.card),
    JSON.stringify(july),
  );
  check(
    'juillet, trompettes, grille d’indice allumée : ni grille, ni carrés de 500 m, ni altitude demandée ; « Trompettes hors saison (août à décembre) »',
    julyIndex.sources === '0,0,0' && log7.altitude.length === 0 && /Trompettes hors saison \(août à décembre\) : aucune chance estimée en ce moment/.test(julyIndex.hints),
    `${julyIndex.sources} ; ${log7.altitude.length} altitude(s)`,
  );
  await page7.close();

  // Carrés de 500 m : l'altitude n'est demandée que pour les carrés à dessiner pour le champignon montré.
  // Chanterelles en tube (les chênaies ne sont pas leurs hôtes) puis cèpes (elles le sont) : le second
  // doit encore demander des altitudes, celles des chênaies que le premier a laissées de côté.
  const page8 = await context.newPage();
  const log8 = { tms: [], wmts: [], geocode: [], other: [] };
  await installMocks(page8, log8);
  // Réglages par défaut et aucune altitude gardée : la page part de zéro.
  await page8.addInitScript(() => {
    localStorage.removeItem('foret-explorer:v1');
    localStorage.removeItem('foret-explorer:altitudes');
  });
  await page8.goto(`${base}#carte=13.6/45.92/6.19`);
  await waitForMap(page8);
  const fineOf = async (id) => {
    await page8.evaluate((m) => window.store.update({ mushroom: m, weatherMode: 'indice' }), id);
    await page8.waitForFunction(() => [...document.querySelectorAll('#legend .legend-hint')].some((p) => /carrés? de 500 m avec arbres hôtes/.test(p.textContent)), null, { timeout: 20000 }).catch(() => {});
    await page8.waitForTimeout(1500);
    await idle(page8);
    const drawn = await page8.evaluate(() => new Set(window.map.querySourceFeatures('meteo-fin').map((f) => f.geometry.coordinates[0][0].map((v) => v.toFixed(4)).join())).size);
    const asked = log8.altitude.reduce((n, q) => n + (/[?&]lon=([^&]*)/.exec(q)?.[1].split('%7C').length ?? 0), 0);
    return { drawn, asked };
  };
  const tube = await fineOf('chanterelle');
  const cepe = await fineOf('cepe');
  check(
    'carrés de 500 m : altitudes demandées pour les seuls carrés du champignon montré (les chênaies attendent qu’on cherche des cèpes)',
    tube.drawn > 0 && tube.asked > 0 && tube.asked <= tube.drawn + 8 && cepe.drawn > tube.drawn && cepe.asked > tube.asked,
    `chanterelles : ${tube.asked} altitude(s) pour ${tube.drawn} carré(s) ; puis cèpes : ${cepe.asked} en tout pour ${cepe.drawn} carré(s)`,
  );
  await page8.close();

  // Fichier des parts de forêt qui ne répond jamais (réseau qui pend) : le bilan ne l'attend pas plus de
  // 2,5 s ; il fait sans (météo et forêt du point) et demande l'altitude.
  const page6 = await context.newPage();
  const log6 = { tms: [], wmts: [], geocode: [], other: [] };
  await installMocks(page6, log6, { foret: 'suspendu' });
  await page6.goto(`${base}#carte=10.5/45.92/6.19`);
  await waitForMap(page6);
  await page6.mouse.click(640, 400);
  const shown = await page6.waitForSelector('#spot .rain-chart', { timeout: 6000 }).then(
    () => true,
    () => false,
  );
  const hung = await page6.evaluate(() => [...document.querySelectorAll('#spot .level-pill')].map((p) => p.textContent));
  check(
    'parts de forêt qui ne répondent pas : bilan affiché en moins de 6 s, altitude demandée, chances estimées quand même',
    shown && log6.altitude.length === 1 && log6.foret.length >= 1 && hung.length === 4 && hung.some((t) => !/^≈ 0 %/.test(t)),
    `${hung.join(' | ')} ; ${log6.altitude.length} altitude(s)`,
  );
  await page6.close();

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
  // La pause du zoom s'arrête dès que les carrés de 500 m sont dessinés (à l'altitude du carré de
  // 4,5 km) : elle n'attend pas leurs altitudes exactes, ici retardées de 7 s.
  await page4.locator('#spot .panel__close').click();
  await page4.evaluate(async () => {
    localStorage.removeItem('foret-explorer:altitudes'); // celles que les pages précédentes ont gardées
    (await import('/src/fineGrid.ts')).forgetSurveys(); // et leurs relevés : la vue doit être neuve
    window.store.update({ mushroom: 'cepe', weatherMode: 'indice' });
    window.__t0 = performance.now();
    window.map.jumpTo({ zoom: 13.6 });
  });
  const lockedSlow = await zoomPause(page4);
  await page4.waitForFunction(() => document.getElementById('grid-loader').hidden && !window.map.getContainer().classList.contains('zoom-paused') && window.map.querySourceFeatures('meteo-fin').length > 0, null, { timeout: 6500 }).catch(() => {});
  const slow = await page4.evaluate(() => ({
    after: Math.round(performance.now() - window.__t0),
    free: document.getElementById('grid-loader').hidden && !window.map.getContainer().classList.contains('zoom-paused'),
    squares: window.map.querySourceFeatures('meteo-fin').length,
    status: [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).find((t) => /500 m/.test(t)) ?? '',
  }));
  check(
    'altitudes lentes : la pause du zoom se lève dès que les carrés de 500 m sont dessinés, sans attendre leurs altitudes',
    lockedSlow.paused && slow.free && slow.squares > 0 && slow.after < 6500 && /relevé des forêts et des altitudes/.test(slow.status),
    `libre après ${slow.after} ms, ${slow.squares} carré(s) ; ${slow.status.slice(-60)}`,
  );
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
  const fit = await page.evaluate(() => {
    const d = document.querySelector('dialog.disclaimer');
    const body = d.querySelector('.disclaimer__body');
    const links = [...d.querySelectorAll('.disclaimer__links a')].map((a) => Math.round(a.getBoundingClientRect().height));
    return { scrolls: body.scrollHeight > body.clientHeight + 1, width: Math.round(d.getBoundingClientRect().width), links };
  });
  check('mobile : avertissement lisible sans défiler, sur toute la largeur, liens à la taille du doigt', !fit.scrolls && fit.width >= 370 && fit.links.every((v) => v >= 24), JSON.stringify(fit));
  await page.screenshot({ path: `${OUT}06b-mobile-avertissement.png` });
  await page.waitForFunction(() => !document.querySelector('.disclaimer__accept').disabled, null, { timeout: 8000 });
  await page.locator('.disclaimer__accept').tap();
  // Présentation sur téléphone : silhouette de téléphone, gestes décrits sans « à gauche » ni « à droite ».
  await page.waitForSelector('dialog.tour[open]', { timeout: 5000 });
  const mobileTour = await page.evaluate(() => {
    const d = document.querySelector('dialog.tour');
    const body = d.querySelector('.tour__body');
    const r = d.getBoundingClientRect();
    return {
      screens: [...d.querySelectorAll('.tour__screen')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.className.split('--').pop()),
      text: d.innerText.replace(/\s+/g, ' '),
      scrolls: body.scrollHeight > body.clientHeight + 1,
      inside: r.left >= 0 && r.right <= 390 && r.bottom <= 844,
      button: Math.round(d.querySelector('.tour__close').getBoundingClientRect().height),
    };
  });
  check(
    'mobile : présentation en version téléphone (bouton en haut à gauche, bilan en bas), sans défilement',
    mobileTour.screens.join() === 'phone' && /bouton en haut à gauche/.test(mobileTour.text) && /s’ouvre en bas/.test(mobileTour.text) && !/à droite|à gauche,/.test(mobileTour.text) && !mobileTour.scrolls && mobileTour.inside && mobileTour.button >= 46,
    mobileTour.text.slice(0, 120),
  );
  await page.screenshot({ path: `${OUT}06c-mobile-presentation.png` });
  await closeTour(page);
  await waitForMap(page);
  await idle(page);
  check('mobile : légende fermée au démarrage', await page.evaluate(() => document.getElementById('legend').hidden));
  // Très petit écran et téléphone couché : le schéma, décoratif, se retire pour que les trois gestes
  // et la mise en garde tiennent sans défiler.
  const tight = [];
  for (const [width, height] of [[320, 568], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.store.update({ legendOpen: true }));
    await page.getByRole('button', { name: 'Comment ça marche ?' }).click();
    await page.waitForSelector('dialog.tour[open]');
    tight.push(
      await page.evaluate(() => {
        const d = document.querySelector('dialog.tour');
        const body = d.querySelector('.tour__body');
        const note = d.querySelector('.tour__note').getBoundingClientRect();
        const box = body.getBoundingClientRect();
        return {
          size: `${innerWidth}×${innerHeight}`,
          scrolls: body.scrollHeight > body.clientHeight + 1,
          noteSeen: note.bottom <= box.bottom + 1,
          screens: [...d.querySelectorAll('.tour__screen')].filter((s) => getComputedStyle(s).display !== 'none').length,
          steps: d.querySelectorAll('.tour__steps li').length,
        };
      }),
    );
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog.tour', { state: 'detached' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.store.update({ legendOpen: false }));
  await idle(page);
  check(
    'présentation à 320 × 568 et sur téléphone couché (844 × 390) : sans schéma ni défilement, trois gestes et mise en garde visibles',
    tight.every((t) => !t.scrolls && t.noteSeen && t.screens === 0 && t.steps === 3),
    JSON.stringify(tight),
  );
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
  await surveyCacheTests(browser, server.url);
  await mobileTests(browser, server.url);
  await viewTests({ browser, base: server.url, OUT, check, preAccept, installMocks, waitForMap, idle, viewOf, closeTour });
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications OK — captures dans tests/e2e/shots/`);
process.exit(failed ? 1 : 0);

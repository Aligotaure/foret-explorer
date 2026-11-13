// Tests de bout en bout des deux vues : îlot « Carte / Analytics », adresse et historique, carte
// gardée en mémoire, vue Analytics et son fichier de contenu. Lancés par run.mjs, qui fournit le
// serveur, le navigateur et ses utilitaires.
//
// Les jeux d'essai ci-dessous sont factices et ne servent qu'ici : le site, lui, n'affiche que le
// contenu de src/analyticsData.ts.

const EMPTY = { headline: '', contact: null, currentBet: null, analyses: [], settledBets: [] };

const FILLED = {
  headline: 'Phrase d’en-tête du jeu d’essai',
  contact: { label: 'Contact du jeu d’essai', url: 'https://example.org/contact' },
  currentBet: { hypothesis: 'Hypothèse de test', kpi: 'KPI de test', threshold: 'Seuil de test', verdictDate: '2026-01-31' },
  analyses: [
    {
      question: 'Question de test A',
      chart: { type: 'bars', unit: '%', points: [{ label: 'Étape 1', value: 100 }, { label: 'Étape 2', value: 50 }, { label: 'Étape 3', value: 12.5 }] },
      reading: 'Lecture de test A',
      decision: 'Décision de test A',
      sampleSize: '1234 lignes de test',
      date: '2026-02-01',
    },
    { question: 'Question de test B', chart: null, reading: 'Lecture de test B', decision: 'Décision de test B', sampleSize: '56 lignes de test', date: '2026-01-20' },
  ],
  settledBets: [
    { hypothesis: 'Pari de test 1', kpi: 'KPI 1', threshold: 'Seuil 1', verdictDate: '2026-01-15', result: 'Résultat 1', outcome: 'validated', decision: 'Suite 1' },
    { hypothesis: 'Pari de test 2', kpi: 'KPI 2', threshold: 'Seuil 2', verdictDate: '2026-01-10', result: 'Résultat 2', outcome: 'invalidated', decision: 'Suite 2' },
    { hypothesis: 'Pari de test 3', kpi: 'KPI 3', threshold: 'Seuil 3', verdictDate: '2026-01-05', result: 'Résultat 3', outcome: 'inconclusive', decision: 'Suite 3' },
  ],
};

const ANNECY = '#carte=11.5/45.92/6.19';
/** Tout ce qui trahirait le chargement de la carte : son code, MapLibre, les tuiles, les données. */
const MAP_REQUEST = /\/src\/mapView\.ts|\/deps\/maplibre-gl\.js|\/deps\/pmtiles\.js|data\.geopf\.fr|\/data\/(?:meteo|zones|geologie)\/|open-meteo\.com/;
const view = (page) => page.evaluate(() => document.documentElement.dataset.view ?? 'map');
const hash = (page) => page.evaluate(() => location.hash);
const island = (page, name) => page.locator(`.island__link[data-view="${name}"]`);

/** Rectangles de l'îlot et des contrôles de la carte, chevauchements, contrôles recouverts. */
const geometry = (page) =>
  page.evaluate(() => {
    const shown = (el) => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const box = (el) => el.getBoundingClientRect();
    const bar = box(document.getElementById('view-switch'));
    const controls = {
      'bouton légende': document.getElementById('legend-toggle'),
      recherche: document.getElementById('search'),
      'boutons du haut': document.getElementById('toolbar-top'),
      'boutons du bas': document.getElementById('toolbar-bottom'),
      légende: document.getElementById('legend'),
      bilan: document.getElementById('spot'),
      'bandeau de zoom': document.getElementById('zoom-hint'),
    };
    // Écart le plus faible entre l'îlot et un contrôle visible (négatif : ils se chevauchent).
    const gaps = {};
    for (const [name, el] of Object.entries(controls)) {
      if (!shown(el)) continue;
      const r = box(el);
      const dx = Math.max(r.left - bar.right, bar.left - r.right);
      const dy = Math.max(r.top - bar.bottom, bar.top - r.bottom);
      gaps[name] = Math.round(Math.max(dx, dy));
    }
    // Au milieu d'un bouton, qu'est-ce qu'on touche ? (lui-même, sinon ce qui le recouvre)
    const topAt = (el) => {
      const r = box(el);
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    };
    const reachable = (el) => {
      const top = topAt(el);
      return Boolean(top) && (top === el || el.contains(top));
    };
    const buttons = [
      ...document.querySelectorAll('#legend-toggle, .search__input, .search__submit, #toolbar-top > *, #toolbar-bottom button, #spot .panel__close, #legend .panel__close, .zoom-hint__btn'),
    ].filter(shown);
    // Boutons de la carte recouverts par l'îlot.
    const masked = buttons.filter((el) => document.getElementById('view-switch').contains(topAt(el))).map((el) => el.getAttribute('aria-label') ?? el.textContent);
    const spotClose = document.querySelector('#spot .panel__close');
    const hintButton = document.querySelector('.zoom-hint__btn');
    const links = [...document.querySelectorAll('.island__link')].map((a) => ({ w: Math.round(box(a).width), h: Math.round(box(a).height) }));
    return {
      island: { left: Math.round(bar.left), right: Math.round(bar.right), top: Math.round(bar.top), bottom: Math.round(bar.bottom), centre: Math.round((bar.left + bar.right) / 2) },
      width: window.innerWidth,
      gaps,
      masked,
      islandReachable: [...document.querySelectorAll('.island__link')].every(reachable),
      spotClose: shown(spotClose) ? reachable(spotClose) : null,
      hintButton: shown(hintButton) ? reachable(hintButton) : null,
      links,
      scroll: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

export async function viewTests({ browser, base, OUT, check, preAccept, installMocks, waitForMap, idle, viewOf }) {
  const errors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
  };

  // ── 1. Arrivée directe sur la vue Analytics : ni carte ni avertissement ──────────────────────
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    watch(page);
    const log = { tms: [], wmts: [], geocode: [], other: [] };
    await installMocks(page, log);
    const requested = [];
    page.on('request', (r) => requested.push(r.url()));
    await page.goto(`${base}#vue=analytics`);
    await page.waitForSelector('#analytics h1');
    await page.waitForTimeout(600); // le temps qu'une requête de trop se montre
    const landing = await page.evaluate(() => ({
      view: document.documentElement.dataset.view,
      title: document.title,
      dialog: Boolean(document.querySelector('dialog.disclaimer')),
      mapBuilt: Boolean(document.querySelector('.maplibregl-canvas')),
      appHidden: getComputedStyle(document.getElementById('app')).visibility,
      current: [...document.querySelectorAll('.island__link')].map((a) => `${a.textContent}:${a.getAttribute('aria-current') ?? '-'}`).join(' '),
      background: getComputedStyle(document.documentElement).backgroundColor,
    }));
    const mapRequests = requested.filter((u) => MAP_REQUEST.test(u));
    check(
      'Analytics : arrivée directe sans charger la carte (ni MapLibre, ni tuile, ni météo)',
      mapRequests.length === 0 && !landing.mapBuilt && log.tms.length + log.wmts.length + log.zones.length + log.meteoCommune.length + log.geologie.length === 0,
      mapRequests.slice(0, 3).join(', ') || `${requested.length} requêtes, aucune pour la carte`,
    );
    check(
      'Analytics : arrivée directe sans avertissement, vue et titre en place, fond bleu nuit',
      landing.view === 'analytics' && landing.title === 'Analytics — Forêt Explorer' && !landing.dialog && landing.appHidden === 'hidden' && landing.current === 'Carte:- Analytics:page' && landing.background === 'rgb(22, 22, 48)',
      JSON.stringify(landing),
    );
    // Le vrai fichier de contenu (src/analyticsData.ts) : structure en place, rien à corriger.
    const real = await page.evaluate(() => {
      const data = window.analytics.data;
      const link = document.querySelector('#analytics .analytics__contact');
      return {
        problems: window.analytics.check(data),
        banner: Boolean(document.querySelector('.analytics__problems')),
        titles: [...document.querySelectorAll('#analytics h2')].map((t) => t.textContent),
        h1: document.querySelectorAll('#analytics h1').length,
        contact: data.contact ? { href: link?.getAttribute('href') === data.contact.url, https: data.contact.url.startsWith('https://'), rel: link?.getAttribute('rel') ?? '', target: link?.getAttribute('target') } : null,
        linkShown: Boolean(link),
        anchors: document.querySelectorAll('#analytics a[href^="#"]').length,
        scroll: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    check('Analytics : contenu de src/analyticsData.ts relu, rien à corriger', real.problems.length === 0 && !real.banner, real.problems.join(' | '));
    check(
      'Analytics : en-tête et quatre sections (entonnoir, pari en cours, analyses, paris tranchés)',
      real.h1 === 1 && real.titles.join('|') === 'Entonnoir en direct|Pari en cours|Analyses|Paris tranchés' && real.anchors === 0 && !real.scroll,
      real.titles.join(' | '),
    );
    check(
      'Analytics : lien de contact du fichier, en https, ouvert à part',
      real.contact ? real.contact.href && real.contact.https && /noopener/.test(real.contact.rel) && real.contact.target === '_blank' : !real.linkShown,
      JSON.stringify(real.contact),
    );
    await page.screenshot({ path: `${OUT}12-analytics-1280.png`, fullPage: true });

    // États vides (jeu d'essai vide : ce test reste vrai le jour où le vrai fichier sera rempli).
    const empty = await page.evaluate((data) => {
      window.analytics.render(data);
      return {
        texts: [...document.querySelectorAll('#analytics .analytics__empty')].map((p) => p.textContent),
        h1: document.querySelector('#analytics h1').textContent,
        link: Boolean(document.querySelector('#analytics .analytics__contact')),
      };
    }, EMPTY);
    check(
      'Analytics : états vides tant que le fichier est vide',
      empty.texts.join('|') === 'L’entonnoir n’est pas encore mesuré.|Aucun pari en cours pour le moment.|Aucune analyse publiée pour le moment.|Aucun pari tranché pour le moment.' && empty.h1 === 'Analytics' && !empty.link,
      empty.texts.join(' | '),
    );

    // Jeu d'essai rempli : chaque champ affiché, dates et nombres à la française.
    const filled = await page.evaluate((data) => {
      window.analytics.render(data);
      const text = (sel) => document.querySelector(sel)?.textContent ?? '';
      const cards = [...document.querySelectorAll('#analytics .analytics-analysis')];
      return {
        h1: text('#analytics h1'),
        contact: document.querySelector('#analytics .analytics__contact')?.getAttribute('href'),
        bet: text('#analytics .analytics-card'),
        empties: [...document.querySelectorAll('#analytics .analytics__empty')].map((p) => p.textContent),
        cards: cards.map((c) => c.textContent),
        bars: [...(cards[0]?.querySelectorAll('.analytics-bars__row') ?? [])].map((li) => `${li.querySelector('.analytics-bars__label').textContent}=${li.querySelector('.analytics-bars__bar').style.width}=${li.querySelector('.analytics-bars__value').textContent}`),
        chartB: Boolean(cards[1]?.querySelector('.analytics-bars')),
        rows: [...document.querySelectorAll('#analytics .analytics-bets__row')].map((li) => li.textContent),
        problems: Boolean(document.querySelector('.analytics__problems')),
        scroll: document.documentElement.scrollWidth > window.innerWidth,
      };
    }, FILLED);
    check(
      'Analytics (jeu d’essai) : phrase d’en-tête, contact et pari en cours',
      filled.h1 === FILLED.headline && filled.contact === FILLED.contact.url && ['Hypothèse de test', 'KPI de test', 'Seuil de test', '31 janvier 2026'].every((t) => filled.bet.includes(t)) && filled.empties.length === 1,
      filled.bet.slice(0, 100),
    );
    check(
      'Analytics (jeu d’essai) : une carte par analyse (question, graphique, lecture, décision, échantillon, date)',
      filled.cards.length === 2 &&
        ['Question de test A', 'Lecture de test A', 'Décision de test A', '1234 lignes de test', '1 février 2026'].every((t) => filled.cards[0].includes(t)) &&
        filled.bars.join('|') === 'Étape 1=100%=100 %|Étape 2=50%=50 %|Étape 3=12.5%=12,5 %' &&
        !filled.chartB,
      filled.bars.join(' | '),
    );
    check(
      'Analytics (jeu d’essai) : une ligne par pari tranché, issue écrite en toutes lettres',
      filled.rows.length === 3 &&
        ['Validé', 'Pari de test 1', '15 janvier 2026', 'KPI 1', 'Seuil 1', 'Résultat 1', 'Suite 1'].every((t) => filled.rows[0].includes(t)) &&
        filled.rows[1].includes('Invalidé') &&
        filled.rows[2].includes('Non concluant') &&
        !filled.problems &&
        !filled.scroll,
      filled.rows[0]?.slice(0, 110),
    );
    await page.screenshot({ path: `${OUT}12b-analytics-jeu-d-essai-1280.png`, fullPage: true });

    // Contenu mal écrit : la vue s'affiche quand même, et dit quoi corriger (en développement).
    const edge = await page.evaluate(() => {
      window.analytics.render({
        headline: '',
        contact: { label: '', url: 'https://sans-point' },
        currentBet: { hypothesis: '', kpi: 'k', threshold: 's', verdictDate: '2026-02-31' },
        analyses: [
          { question: 'Q', chart: { type: 'bars', points: [] }, reading: 'l', decision: 'd', sampleSize: 'n', date: '05-11-2026' },
          { question: 'Q2', chart: { type: 'bars', points: [{ label: 'a', value: NaN }, { label: 'b', value: -3 }, { label: 'c', value: 2 }] }, reading: 'l', decision: 'd', sampleSize: 'n', date: '2026-11-05' },
        ],
        settledBets: [{ hypothesis: 'h', kpi: 'k', threshold: 's', verdictDate: '2026-11-05', result: 'r', outcome: 'gagné', decision: '' }],
      });
      const body = document.getElementById('analytics').textContent;
      return {
        problems: [...document.querySelectorAll('.analytics__problems li')].map((li) => li.textContent),
        rawDate: body.includes('2026-02-31') && body.includes('05-11-2026'),
        garbage: /Invalid Date|NaN %|undefined/.test(body.replace(/analyses\[1\][^|]*NaN[^|]*/g, '')),
        bars: [...document.querySelectorAll('.analytics-bars__row')].map((li) => `${li.querySelector('.analytics-bars__label').textContent}=${li.querySelector('.analytics-bars__bar')?.style.width ?? 'aucune'}`),
        outcome: document.querySelector('.analytics-outcome')?.textContent,
      };
    });
    check(
      'Analytics : un contenu mal écrit s’affiche quand même, et la relecture dit quoi corriger',
      edge.rawDate &&
        !edge.garbage &&
        edge.bars.join('|') === 'b=aucune|c=100%' &&
        edge.outcome.includes('Non concluant') &&
        ['contact.label', 'contact.url', 'currentBet.hypothesis', 'currentBet.verdictDate', 'analyses[0].chart.points', 'analyses[0].date', 'analyses[1].chart.points[0].value', 'analyses[1].chart.points[1].value', 'settledBets[0].decision'].every((f) =>
          edge.problems.some((p) => p.startsWith(`${f} :`)),
        ),
      `${edge.problems.length} problèmes signalés · barres ${edge.bars.join(' ')}`,
    );
    await page.evaluate(() => window.analytics.render(window.analytics.data));

    // Du lien « Carte » de l'îlot : la carte se charge, l'avertissement arrive avec elle.
    await island(page, 'map').click();
    await page.waitForSelector('dialog.disclaimer[open]', { timeout: 10000 });
    const toMap = await page.evaluate(() => ({ view: document.documentElement.dataset.view ?? 'map', hash: location.hash, href: location.href, title: document.title }));
    check(
      'Analytics → Carte par l’îlot : adresse sans « vue », avertissement affiché avec la carte',
      toMap.view === 'map' && toMap.hash === '' && !toMap.href.endsWith('#') && toMap.title === 'Forêt Explorer',
      JSON.stringify(toMap),
    );
    await waitForMap(page);
    // Précédent avant d'avoir accepté : l'avertissement se retire avec la carte, et revient avec elle.
    await page.goBack();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'analytics');
    await page.waitForTimeout(300);
    const withdrawn = await page.evaluate(() => ({ dialog: Boolean(document.querySelector('dialog.disclaimer')), hash: location.hash, focusable: !document.getElementById('app').inert }));
    check('avertissement : retiré quand on quitte la carte sans l’avoir accepté', !withdrawn.dialog && withdrawn.hash.includes('vue=analytics'), JSON.stringify(withdrawn));
    await page.goForward();
    await page.waitForSelector('dialog.disclaimer[open]', { timeout: 10000 });
    const again = await page.evaluate(() => {
      const button = document.querySelector('.disclaimer__accept');
      return { count: document.querySelectorAll('dialog.disclaimer').length, disabled: button.disabled, text: button.textContent, modal: document.querySelector('dialog.disclaimer').matches(':modal') };
    });
    check(
      'avertissement : de retour avec la carte, compte à rebours repris de zéro',
      again.count === 1 && again.disabled && /^Lisez d’abord… [23]$/.test(again.text) && again.modal,
      JSON.stringify(again),
    );
    await page.waitForFunction(() => !document.querySelector('.disclaimer__accept').disabled, null, { timeout: 8000 });
    await page.locator('.disclaimer__accept').click();
    const accepted = await page.evaluate(() => ({ dialog: Boolean(document.querySelector('dialog.disclaimer')), saved: Boolean(localStorage.getItem('foret-explorer:avertissement')) }));
    check('avertissement : accepté après le retour, la carte est libre', !accepted.dialog && accepted.saved, JSON.stringify(accepted));
    await context.close();
  }

  // ── 2. La carte arrive après coup, alors que le visiteur est revenu sur Analytics ────────────
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    watch(page);
    await installMocks(page, { tms: [], wmts: [], geocode: [], other: [] });
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/src/mapView.ts*', async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(`${base}#vue=analytics`);
    await page.waitForSelector('#analytics h1');
    await island(page, 'map').click();
    await page.waitForSelector('dialog.disclaimer[open]');
    await page.goBack();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'analytics');
    release();
    await waitForMap(page);
    await page.waitForTimeout(300);
    const late = await page.evaluate(() => ({ view: document.documentElement.dataset.view, dialog: Boolean(document.querySelector('dialog.disclaimer')), visible: [...document.querySelectorAll('#app, #app *')].filter((el) => getComputedStyle(el).visibility !== 'hidden').length }));
    check('carte arrivée pendant la vue Analytics : ni avertissement ni carte à l’écran', late.view === 'analytics' && !late.dialog && late.visible === 0, JSON.stringify(late));
    await context.close();
  }

  // ── 3. Code d'une vue injoignable : un message et un bouton, l'îlot reste utilisable ─────────
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await preAccept(context);
    const page = await context.newPage(); // (erreurs attendues ici : pas de `watch`)
    await installMocks(page, { tms: [], wmts: [], geocode: [], other: [] });
    await page.route('**/src/mapView.ts*', (route) => route.abort());
    await page.goto(`${base}#vue=analytics`);
    await page.waitForSelector('#analytics h1');
    await island(page, 'map').click();
    await page.waitForSelector('#view-error:not([hidden])', { timeout: 10000 });
    const failure = await page.evaluate(() => ({ text: document.getElementById('view-error').textContent, button: document.querySelector('#view-error button')?.textContent }));
    await island(page, 'analytics').click();
    check(
      'vue injoignable : message et bouton « Recharger », retour possible par l’îlot',
      /n’a pas pu se charger/.test(failure.text) && failure.button === 'Recharger' && (await view(page)) === 'analytics',
      failure.text,
    );
    await context.close();
  }

  // ── 4. Aller-retour depuis la carte : position, légende et bilan intacts ─────────────────────
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await preAccept(context);
    const page = await context.newPage();
    watch(page);
    const log = { tms: [], wmts: [], geocode: [], other: [] };
    await installMocks(page, log);
    await page.goto(`${base}${ANNECY}`);
    await waitForMap(page);
    await idle(page);
    await page.screenshot({ path: `${OUT}11-carte-1280.png` });

    // Clavier : l'îlot est le premier arrêt de la touche Tab, Entrée bascule.
    await page.keyboard.press('Tab');
    const firstStop = await page.evaluate(() => {
      const el = document.activeElement;
      const s = getComputedStyle(el);
      return { text: el.textContent, ring: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineOffset}` };
    });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const byKeyboard = { view: await view(page), status: await page.evaluate(() => document.getElementById('view-status').textContent), focus: await page.evaluate(() => document.activeElement.textContent) };
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    check(
      'îlot : utilisable au clavier (Tab, Entrée), anneau de focus visible, changement annoncé',
      firstStop.text === 'Carte' && firstStop.ring === 'solid 2px -2px' && byKeyboard.view === 'analytics' && byKeyboard.status === 'Vue Analytics affichée' && byKeyboard.focus === 'Analytics' && (await view(page)) === 'map',
      JSON.stringify({ firstStop, byKeyboard }),
    );

    // État de la carte avant de la quitter : un type décoché, la légende défilée, un bilan ouvert.
    await page.locator('#legend .legend-item input').nth(3).uncheck();
    await page.locator('#legend .panel__body').evaluate((el) => el.scrollTo(0, 240));
    await page.mouse.click(640, 430);
    await page.waitForSelector('#spot .verdict', { timeout: 10000 });
    await idle(page);
    const snapshot = () =>
      page.evaluate(() => {
        const style = (sel) => {
          const s = getComputedStyle(document.querySelector(sel));
          return `${s.color}|${s.backgroundColor}|${s.fontSize}|${s.outlineColor}`;
        };
        return {
          mark: (window.map.__mark ??= 'la même carte'),
          selected: window.store.state.selected.size,
          legendOpen: window.store.state.legendOpen,
          scrollTop: document.querySelector('#legend .panel__body').scrollTop,
          spot: !document.getElementById('spot').hidden && document.querySelector('#spot .spot__coords')?.textContent,
          drawn: window.map.queryRenderedFeatures({ layers: ['bdforet-fill'] }).length > 0,
          styles: [style('#legend-toggle'), style('.search__input'), style('#legend .panel__title'), getComputedStyle(document.documentElement).backgroundColor].join(' / '),
          canvas: `${window.map.getCanvas().clientWidth}x${window.map.getCanvas().clientHeight}`,
        };
      });
    const before = { ...(await snapshot()), view: await viewOf(page), hash: await hash(page) };
    const tilesBefore = log.tms.length + log.wmts.length;

    await island(page, 'analytics').click();
    await page.waitForSelector('#analytics h1');
    const away = await page.evaluate(() => {
      const grid = [];
      for (let y = 20; y < window.innerHeight; y += 60) for (let x = 20; x < window.innerWidth; x += 60) grid.push(document.elementFromPoint(x, y));
      return {
        hash: location.hash,
        title: document.title,
        current: [...document.querySelectorAll('.island__link')].map((a) => `${a.textContent}:${a.getAttribute('aria-current') ?? '-'}`).join(' '),
        visible: [...document.querySelectorAll('#app, #app *')].filter((el) => getComputedStyle(el).visibility !== 'hidden').length,
        credits: getComputedStyle(document.querySelector('.maplibregl-ctrl-attrib')).visibility,
        hit: grid.filter((el) => el && document.getElementById('app').contains(el)).length,
        focus: document.activeElement.textContent,
        encoded: location.href.includes('%2F'),
      };
    });
    check(
      'Carte → Analytics par l’îlot : adresse partageable qui garde la position',
      away.hash === `${ANNECY}&vue=analytics` && !away.encoded && away.title === 'Analytics — Forêt Explorer' && away.current === 'Carte:- Analytics:page' && away.focus === 'Analytics',
      away.hash,
    );
    check('vue Analytics : la carte est entièrement masquée (crédits MapLibre compris), rien ne se clique dessous', away.visible === 0 && away.credits === 'hidden' && away.hit === 0, JSON.stringify({ visibles: away.visible, crédits: away.credits, touchés: away.hit }));
    await page.screenshot({ path: `${OUT}12c-analytics-apres-la-carte-1280.png` });

    // Fenêtre redimensionnée pendant la vue Analytics : la carte suit, sans attendre le retour.
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.waitForTimeout(400);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(400);

    await island(page, 'map').click();
    await page.waitForTimeout(350);
    const after = { ...(await snapshot()), view: await viewOf(page), hash: await hash(page) };
    check(
      'retour à la carte : même carte, même position, légende et bilan intacts',
      JSON.stringify(after) === JSON.stringify(before) && before.selected === 31 && before.scrollTop === 240 && Boolean(before.spot) && before.drawn,
      JSON.stringify({ avant: before, après: after }).slice(0, 420),
    );
    check('retour à la carte : rien n’a été rechargé (aucune tuile redemandée)', log.tms.length + log.wmts.length === tilesBefore, `${log.tms.length + log.wmts.length - tilesBefore} tuile(s) de plus`);

    // Historique : Précédent et Suivant rendent à chaque entrée sa vue.
    await page.goBack();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'analytics');
    const back1 = await hash(page);
    await page.goBack();
    await page.waitForFunction(() => !document.documentElement.dataset.view);
    const back2 = { hash: await hash(page), view: await viewOf(page), mark: await page.evaluate(() => window.map.__mark) };
    await page.goForward();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'analytics');
    check(
      'historique : Précédent ramène à la carte au même endroit, Suivant à la vue Analytics',
      back1 === `${ANNECY}&vue=analytics` && back2.hash === ANNECY && JSON.stringify(back2.view) === JSON.stringify(before.view) && back2.mark === 'la même carte',
      JSON.stringify({ back1, back2 }),
    );
    // Clavier resté dans la carte masquée (Précédent depuis la carte) : il revient sur l'îlot.
    await island(page, 'map').click();
    await page.locator('.maplibregl-canvas').focus();
    await page.goBack();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'analytics');
    const centre = await viewOf(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    check(
      'vue Analytics : le clavier ne pilote plus la carte masquée',
      (await page.evaluate(() => document.activeElement.textContent)) === 'Analytics' && JSON.stringify(await viewOf(page)) === JSON.stringify(centre),
      JSON.stringify(await viewOf(page)),
    );

    // Animation : 300 ms au plus, rien si les animations sont réduites.
    const motion = () =>
      page.evaluate(() => {
        const s = getComputedStyle(document.getElementById('view-switch'), '::before');
        const seconds = (list) => list.split(',').map((t) => parseFloat(t));
        const durations = seconds(s.transitionDuration);
        const delays = seconds(s.transitionDelay);
        return { total: Math.round(Math.max(...durations.map((d, i) => d + (delays[i] ?? delays[0]))) * 1000), props: s.transitionProperty, left: s.left, right: s.right };
      });
    const moving = await motion();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const still = await motion();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    check(
      'îlot : le fond glisse en 300 ms au plus, sans animation si elles sont réduites',
      moving.total > 0 && moving.total <= 300 && moving.props === 'left, right' && moving.left === '108px' && moving.right === '4px' && still.total === 0 && still.props === 'none',
      JSON.stringify({ moving, still }),
    );
    await context.close();
  }

  // ── 5. L'îlot ne masque aucun contrôle de la carte, à toutes les largeurs ────────────────────
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await preAccept(context);
    const page = await context.newPage();
    watch(page);
    await installMocks(page, { tms: [], wmts: [], geocode: [], other: [] });
    const rows = [];
    // France entière (bandeau « Zoomez… » affiché), légende ouverte sur grand écran, puis bilan ouvert.
    // La mise en page de la carte se décide au chargement (plus ou moins de 641 px) : deux chargements.
    for (const group of [
      [280, 320, 360, 390, 414, 640],
      [641, 700, 768, 834, 1024, 1127, 1128, 1187, 1188, 1280, 1440, 1920],
    ]) {
      await page.setViewportSize({ width: group[0], height: 780 });
      await page.goto(`${base}#carte=5.5/46.5/2.5`);
      await page.reload();
      await waitForMap(page);
      for (const width of group) {
        await page.setViewportSize({ width, height: 780 });
        await page.evaluate(() => window.spot.close());
        await page.waitForTimeout(120);
        const closed = await geometry(page);
        // Un clic sur la carte ouvre le bilan : au milieu sur téléphone, à droite de la légende sinon.
        await page.mouse.click(width <= 640 ? Math.round(width / 2) : 400, 520);
        await page.waitForFunction(() => !document.getElementById('spot').hidden);
        await page.waitForTimeout(120);
        const open = await geometry(page);
        rows.push({ width, closed, open });
      }
    }
    const worst = (g) => Math.min(...Object.values(g.gaps));
    const tight = rows.filter((r) => r.width >= 320 && (worst(r.closed) < 6 || worst(r.open) < 6));
    check(
      'îlot : aucun chevauchement avec les contrôles de la carte, de 320 à 1920 px (bilan ouvert ou fermé)',
      tight.length === 0,
      tight.length ? tight.map((r) => `${r.width} px : ${JSON.stringify(r.open.gaps)}`).join(' ; ') : `écart le plus faible : ${Math.min(...rows.filter((r) => r.width >= 320).map((r) => Math.min(worst(r.closed), worst(r.open))))} px`,
    );
    const masked = rows.filter((r) => r.closed.masked.length || r.open.masked.length || !r.closed.islandReachable || !r.open.islandReachable);
    check(
      'îlot : il ne recouvre aucun bouton de la carte, et rien ne le recouvre',
      masked.length === 0,
      masked.map((r) => `${r.width} px : ${[...r.closed.masked, ...r.open.masked].join(', ') || 'îlot recouvert'}`).join(' ; '),
    );
    // Entre 641 et 1127 px, le bilan s'ouvre une rangée plus bas, là où passe le bandeau « Zoomez… ».
    const closeHidden = rows.filter((r) => r.width > 640 && r.open.spotClose !== true);
    check('bilan : son bouton « Fermer » reste atteignable à toutes les largeurs de bureau', closeHidden.length === 0, closeHidden.map((r) => `${r.width} px`).join(', '));
    const hintHidden = rows.filter((r) => r.width <= 640 && r.closed.hintButton !== true);
    check('mobile : bouton « Zoomer ici » du bandeau entièrement dégagé des boutons de droite', hintHidden.length === 0, hintHidden.map((r) => `${r.width} px`).join(', '));
    // Bureau : le bandeau reste cliquable, bilan ouvert compris (à partir de 834 px ; plus étroit, il
    // déborde déjà de l'écran quand la légende est ouverte, comme avant l'îlot).
    const hintUnder = rows.filter((r) => r.width >= 834 && (r.closed.hintButton !== true || r.open.hintButton !== true));
    check('bureau : bouton « Zoomer ici » cliquable, bilan ouvert ou fermé', hintUnder.length === 0, hintUnder.map((r) => `${r.width} px`).join(', '));
    const small = rows.filter((r) => r.closed.links.some((l) => l.h < 44 || l.w < 44));
    const off = rows.filter((r) => r.closed.island.left < 0 || r.closed.island.right > r.width || r.closed.island.top !== 8 || r.closed.scroll || r.open.scroll);
    const centred = rows.filter((r) => (r.width <= 640 || r.width >= 1188) && Math.abs(r.closed.island.centre - r.width / 2) > 1);
    check(
      'îlot : en haut, centré (téléphone et grand écran), zones tactiles d’au moins 44 px',
      small.length === 0 && off.length === 0 && centred.length === 0,
      `liens ${rows[3].closed.links.map((l) => `${l.w}×${l.h}`).join(' et ')} à 390 px ; décentré de ${rows.filter((r) => r.width > 640 && r.width < 1188).map((r) => `${r.closed.island.centre - r.width / 2} px à ${r.width}`).join(', ')}`,
    );
    await context.close();
  }

  // ── 6. Téléphone : îlot sous la zone de sécurité, recherche dessous, vue Analytics ───────────
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await preAccept(context);
    const page = await context.newPage();
    watch(page);
    await installMocks(page, { tms: [], wmts: [], geocode: [], other: [] });
    await page.goto(`${base}#carte=12/45.92/6.19`);
    await waitForMap(page);
    await idle(page);
    const phone = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      return { island: Math.round(r('#view-switch').bottom), search: Math.round(r('.search').top), searchWidth: Math.round(r('.search').width), toggle: Math.round(r('#legend-toggle').top), tools: Math.round(r('#toolbar-top').top) };
    });
    check(
      'mobile : îlot entre le bouton légende et les boutons de droite, recherche sur la rangée suivante',
      phone.island === 54 && phone.search === 62 && phone.searchWidth === 320 && phone.toggle === 8 && phone.tools === 8,
      JSON.stringify(phone),
    );
    await page.screenshot({ path: `${OUT}13-carte-390.png` });
    // Zone de sécurité de l'iPhone (encoche) : simulée par la variable qui la porte.
    await page.addStyleTag({ content: ':root { --safe-top: 47px; }' });
    const notch = await geometry(page);
    check('mobile : îlot placé sous la zone de sécurité du haut', notch.island.top === 55 && Math.min(...Object.values(notch.gaps)) >= 6 && notch.masked.length === 0 && notch.islandReachable, JSON.stringify({ haut: notch.island.top, écarts: notch.gaps }));
    await page.evaluate(() => document.querySelector('style:last-of-type').remove());
    // Un geste sur la carte entre le bouton légende et l'îlot atteint bien la carte.
    const through = await page.evaluate(() => document.elementFromPoint(72, 30)?.className);
    check('mobile : la rangée de l’îlot laisse passer les gestes vers la carte', /maplibregl-canvas/.test(String(through)), String(through));

    await island(page, 'analytics').tap();
    await page.waitForSelector('#analytics h1');
    await page.waitForTimeout(400);
    const analytics = await page.evaluate(() => ({
      view: document.documentElement.dataset.view,
      scroll: document.documentElement.scrollWidth > window.innerWidth,
      h1Top: Math.round(document.querySelector('#analytics h1').getBoundingClientRect().top),
      contact: Math.round(document.querySelector('#analytics .analytics__contact')?.getBoundingClientRect().height ?? 44),
    }));
    check('mobile : vue Analytics sans défilement horizontal, contenu sous l’îlot', analytics.view === 'analytics' && !analytics.scroll && analytics.h1Top > 62 && analytics.contact >= 44, JSON.stringify(analytics));
    await page.screenshot({ path: `${OUT}14-analytics-390.png`, fullPage: true });
    await page.evaluate((data) => window.analytics.render(data), FILLED);
    const filledPhone = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await page.screenshot({ path: `${OUT}14b-analytics-jeu-d-essai-390.png`, fullPage: true });
    check('mobile : vue Analytics remplie (jeu d’essai) sans défilement horizontal', !filledPhone);
    await context.close();
  }

  check('deux vues : aucune erreur JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
}

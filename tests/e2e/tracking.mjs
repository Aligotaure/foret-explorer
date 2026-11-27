// Tests de bout en bout de la mesure d'usage (src/tracking.ts) : ce qui part vers PostHog, dans quel
// ordre, et surtout ce qui ne part jamais (position de la carte, coordonnées d'un coin). Lancés par
// run.mjs, qui fournit le navigateur et deux serveurs : `base`, construit avec une clé PostHog
// fictive (la mesure n'est en service que là), et `plainBase`, le serveur des autres tests, sans clé.
//
// Rien ne sort de la machine : toute requête vers posthog.com est interceptée et gardée (`spy`).
import { gunzipSync } from 'node:zlib';

const ANNECY = '#carte=11.5/45.92/6.19';
/** Un navigateur ordinaire : la bibliothèque écarte ceux qui se disent pilotés par un programme. */
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const PLAN = ['avertissement_accepte', 'champignon_choisi', 'bilan_ouvert', 'y_aller_ouvert', 'navigation_choisie', 'coordonnees_copiees'];
const LEVELS = ['defavorable', 'peu_probable', 'possible', 'favorable'];
/** Identifiant de clic d'une régie publicitaire, tel qu'un lien partagé sur un réseau social en porte. */
const CLICK_ID = 'IwAR0identifiantDeClic';

/** Corps d'un envoi, en clair : la bibliothèque le compresse (gzip, reconnu à ses deux premiers octets). */
function decode(request) {
  const buffer = request.postDataBuffer();
  if (!buffer) return '';
  return buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer).toString('utf8') : buffer.toString('utf8');
}

/**
 * Intercepte tout ce qui part vers PostHog et le garde dans `log` : une entrée par requête, avec ses
 * événements. `log.code` : les fichiers de la bibliothèque demandés au serveur de développement.
 */
async function spy(page, log) {
  log.sent = [];
  log.code = [];
  page.on('request', (request) => {
    if (/posthog/i.test(new URL(request.url()).pathname)) log.code.push(new URL(request.url()).pathname);
  });
  await page.route(/^https?:\/\/[a-z0-9.-]*posthog\.com\//, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const entry = { method: request.method(), host: url.host, path: url.pathname, raw: '', events: [] };
    try {
      entry.raw = decode(request);
      const data = JSON.parse(entry.raw);
      entry.events = Array.isArray(data) ? data : (data.batch ?? [data]);
    } catch (error) {
      entry.raw ||= `illisible : ${error.message}`;
    }
    log.sent.push(entry);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{"status":1}' });
  });
}
const eventsOf = (log) => log.sent.flatMap((entry) => entry.events);
const named = (log, name) => eventsOf(log).filter((event) => event.event === name);
/** Attend que les événements `names` soient partis (la bibliothèque envoie par lots, toutes les 3 s). */
async function waitFor(page, log, names, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end && !names.every((name) => named(log, name).length > 0)) await page.waitForTimeout(250);
}
/** Clique un lien sans le suivre (il ouvrirait un autre site dans un nouvel onglet) : les écouteurs du site, eux, sont appelés. */
const clickWithoutLeaving = (page, selector) =>
  page.evaluate((s) => {
    const link = document.querySelector(s);
    link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    link.click();
  }, selector);
/** Ce que la bibliothèque aurait écrit dans le navigateur. */
const stored = (page) =>
  page.evaluate(() => ({
    cookie: document.cookie,
    local: Object.keys(localStorage).filter((key) => !key.startsWith('foret-explorer:')),
    session: Object.keys(sessionStorage),
  }));

export async function trackingTests({ browser, base, plainBase, key, check, preAccept, installMocks, waitForMap, idle, closeTour, passHunting }) {
  const visitor = async (options = {}) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, userAgent: USER_AGENT, ...options });
    // La bibliothèque écarte les robots : adresse du navigateur, marque « HeadlessChrome », `navigator.webdriver`.
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
    });
    return context;
  };
  const open = async (context, address, log) => {
    const page = await context.newPage();
    log.errors = [];
    page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && log.errors.push(`console.error: ${m.text()}`));
    await installMocks(page, { tms: [], wmts: [], geocode: [], other: [] });
    await spy(page, log);
    await page.goto(address);
    return page;
  };

  // ── 1. Première visite : de l'avertissement à l'itinéraire ───────────────────────────────────
  const context = await visitor();
  const log = {};
  const page = await open(context, `${base}?utm_source=essai&fbclid=${CLICK_ID}${ANNECY}`, log);
  await page.waitForSelector('dialog.disclaimer[open]', { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('.disclaimer__accept').disabled, null, { timeout: 8000 });
  await page.locator('.disclaimer__accept').click();
  await passHunting(page);
  await closeTour(page);
  await waitForMap(page);
  await idle(page);
  await page.evaluate(() => [...document.querySelectorAll('#legend .chip--mushroom')].find((b) => b.firstChild.textContent === 'Cèpes').click());
  await idle(page);
  // Un point de forêt, à l'écart de la légende et du bilan.
  const wood = await page.evaluate(() => {
    for (let y = 200; y < 760; y += 40) for (let x = 460; x < 820; x += 40) if (window.map.queryRenderedFeatures([x, y], { layers: ['bdforet-hit'] }).length) return { x, y };
    return null;
  });
  await page.mouse.click(wood?.x ?? 640, wood?.y ?? 430);
  await page.waitForSelector('#spot .verdict', { timeout: 10000 });
  const coords = ((await page.locator('#spot .spot__coords').textContent()) ?? '').split(', ');
  await page.locator('#spot .directions-btn').click();
  await clickWithoutLeaving(page, '#spot-directions a[data-app="google"]');
  await page.locator('#spot-directions button.directions__btn').click();
  await waitFor(page, log, ['$pageview', ...PLAN]);

  const events = eventsOf(log);
  const names = events.map((event) => event.event);
  const byTime = [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).map((event) => event.event);
  check(
    'mesure : l’ouverture de la page puis les six gestes du plan, chacun une fois, dans l’ordre où ils ont eu lieu',
    byTime.join() === ['$pageview', ...PLAN].join() && names.length === PLAN.length + 1,
    `par heure : ${byTime.join(' → ')} ; reçus : ${names.join()}`,
  );
  const hosts = [...new Set(log.sent.map((entry) => `${entry.method} ${entry.host}`))];
  check('mesure : tout part vers le cloud UE de PostHog, rien d’autre n’est demandé à PostHog', hosts.join() === 'POST eu.i.posthog.com', `${hosts.join()} ; ${[...new Set(log.sent.map((entry) => entry.path))].join()}`);
  const anonymous = events.every((event) => (event.distinct_id ?? event.properties?.distinct_id) === '$posthog_cookieless' && event.properties?.$cookieless_mode === true && event.properties?.token === key);
  check('mesure : mode sans cookie (identifiant « $posthog_cookieless », calculé ensuite par PostHog), clé du projet', anonymous, JSON.stringify(events.map((event) => [event.event, event.distinct_id ?? event.properties?.distinct_id, event.properties?.$cookieless_mode])));
  const kept = await stored(page);
  check('mesure : rien d’écrit dans le navigateur (ni cookie, ni stockage)', kept.cookie === '' && kept.local.length === 0 && kept.session.length === 0, JSON.stringify(kept));

  const raw = log.sent.map((entry) => entry.raw).join('\n');
  const leaks = ['carte=', '45.92/6.19', ...coords, '#', CLICK_ID, 'fbclid":'].filter((text) => text && raw.includes(text));
  const pageview = named(log, '$pageview')[0]?.properties ?? {};
  check(
    'mesure : ni la position de la carte (partie « # » de l’adresse), ni les coordonnées du coin, ni l’identifiant de clic publicitaire dans aucun envoi',
    leaks.length === 0 && coords.length === 2 && String(pageview.$current_url).includes('/?utm_source=essai'),
    `fuites : ${leaks.join() || 'aucune'} ; adresse envoyée : ${pageview.$current_url} ; coin : ${coords.join(', ')}`,
  );
  check('mesure : la campagne (utm_source) arrive avec l’ouverture de la page, visite ordinaire (pas « vitrine »)', pageview.utm_source === 'essai' && events.every((event) => event.properties?.vitrine === false), `utm_source ${pageview.utm_source}`);
  const picked = named(log, 'champignon_choisi')[0]?.properties ?? {};
  const opened = named(log, 'bilan_ouvert')[0]?.properties ?? {};
  const went = named(log, 'navigation_choisie')[0]?.properties ?? {};
  check(
    'mesure : propriétés du plan (champignon et saison, niveau de chance du bilan, application choisie)',
    picked.champignon === 'cepe' && picked.hors_saison === false && LEVELS.includes(opened.niveau) && went.appli === 'google' && went.niveau === opened.niveau,
    JSON.stringify({ picked: [picked.champignon, picked.hors_saison], opened: opened.niveau, went: [went.appli, went.niveau] }),
  );
  // Seuls les propriétés du plan et ce que la bibliothèque ajoute d'elle-même (noms en « $ », clé) : rien d'autre.
  const own = (event) => Object.keys(event.properties ?? {}).filter((name) => !name.startsWith('$') && !['token', 'distinct_id', 'vitrine', 'title'].includes(name) && !name.startsWith('utm_'));
  const extra = events.flatMap((event) => own(event).filter((name) => !['champignon', 'hors_saison', 'niveau', 'appli'].includes(name)).map((name) => `${event.event}.${name}`));
  check('mesure : aucune propriété hors du plan de tracking', extra.length === 0, extra.join() || 'aucune');

  // Un second coin, quitté aussitôt : son ouverture est notée quand même, niveau « inconnu ».
  const before = named(log, 'bilan_ouvert').length;
  await page.evaluate(() => {
    const c = window.map.getCenter();
    void window.spot.open(c, window.map.project(c));
    window.spot.close();
  });
  const end = Date.now() + 10000;
  while (Date.now() < end && named(log, 'bilan_ouvert').length === before) await page.waitForTimeout(250);
  const quick = named(log, 'bilan_ouvert').at(-1)?.properties ?? {};
  check('mesure : un bilan refermé avant que la météo soit lue est compté, niveau « inconnu »', named(log, 'bilan_ouvert').length === before + 1 && quick.niveau === 'inconnu', `${named(log, 'bilan_ouvert').length - before} envoi, niveau ${quick.niveau}`);
  check('mesure : aucune erreur dans la console', log.errors.length === 0, log.errors.join(' | '));
  await context.close();

  // ── 2. Lien « vitrine » : la visite d'un prospect est marquée, le clic de contact compté ─────
  const showcase = await visitor();
  const shown = {};
  const page2 = await open(showcase, `${base}?analytics#vue=analytics`, shown);
  await page2.waitForSelector('.analytics__contact', { timeout: 10000 });
  await clickWithoutLeaving(page2, '.analytics__contact');
  await waitFor(page2, shown, ['$pageview', 'contact_clique']);
  // (Le clic de contact part sans attendre le lot suivant : il peut arriver avant l'ouverture de la page.)
  const showcaseEvents = eventsOf(shown).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  check(
    'mesure, lien « vitrine » : ouverture de la page et clic de contact, tous deux marqués « vitrine », sans la partie « # »',
    showcaseEvents.map((event) => event.event).join() === '$pageview,contact_clique' && showcaseEvents.every((event) => event.properties?.vitrine === true) && !shown.sent.map((entry) => entry.raw).join('').includes('#'),
    `${showcaseEvents.map((event) => `${event.event} vitrine=${event.properties?.vitrine}`).join()} ; ${named(shown, '$pageview')[0]?.properties?.$current_url}`,
  );
  await showcase.close();

  // ── 3. Global Privacy Control : rien n'est téléchargé, rien ne part ──────────────────────────
  const refusing = await visitor();
  await preAccept(refusing);
  await refusing.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
  const quiet = {};
  const page3 = await open(refusing, `${base}${ANNECY}`, quiet);
  await waitForMap(page3);
  await idle(page3);
  await page3.evaluate(() => [...document.querySelectorAll('#legend .chip--mushroom')].find((b) => b.firstChild.textContent === 'Cèpes').click());
  await page3.waitForTimeout(4000); // plus qu'un lot de la bibliothèque (3 s)
  const off = await page3.evaluate(() => window.tracking());
  check(
    'mesure, Global Privacy Control : bibliothèque jamais téléchargée, aucun envoi, rien en attente',
    quiet.sent.length === 0 && quiet.code.length === 0 && off.state === 'off' && off.waiting === 0,
    `${quiet.sent.length} envoi, ${quiet.code.length} fichier, état ${off.state}, ${off.waiting} en attente`,
  );
  await refusing.close();

  // ── 4. Site construit sans clé (celui qui est en ligne tant que la publication n'en fournit pas) ──
  const keyless = await visitor();
  await preAccept(keyless);
  const silent = {};
  const page4 = await open(keyless, `${plainBase}${ANNECY}`, silent);
  await waitForMap(page4);
  await idle(page4);
  await page4.evaluate(() => [...document.querySelectorAll('#legend .chip--mushroom')].find((b) => b.firstChild.textContent === 'Cèpes').click());
  await page4.waitForTimeout(4000);
  const dormant = await page4.evaluate(() => window.tracking());
  check(
    'mesure, site sans clé de projet : bibliothèque jamais téléchargée, aucun envoi, rien en attente',
    silent.sent.length === 0 && silent.code.length === 0 && dormant.state === 'off' && dormant.waiting === 0,
    `${silent.sent.length} envoi, ${silent.code.length} fichier, état ${dormant.state}, ${dormant.waiting} en attente`,
  );
  await keyless.close();
}

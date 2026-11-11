// Sonde n°19 : le site en ligne dans un vrai navigateur, avec les vraies données (aucun service simulé).
// Écrit des captures et un rapport dans verif/live/ : vue France, indice et pluie sur tout le pays,
// sols et bilans d'un coin dans plusieurs régions, téléphone. Compte les appels à Open-Meteo.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SITE = 'https://aligotaure.github.io/foret-explorer/';
const OUT = 'verif/live/';
mkdirSync(OUT, { recursive: true });
const lines = [];
const say = (s) => {
  lines.push(s);
  console.log(s);
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

function watch(page, log) {
  const started = new Map();
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('api.open-meteo.com')) log.openMeteo.push(u.slice(0, 160));
    if (u.includes('/data/meteo/')) log.meteo.push(u.split('/data/meteo/')[1]);
    if (u.endsWith('.pmtiles')) started.set(r, Date.now());
    if (/\/data\/(geologie|zones)\/\d+\/\d+\/\d+\.pbf/.test(u)) log.loose.push(u.slice(-40));
  });
  page.on('response', (r) => {
    const u = r.url();
    const s = r.status();
    if (s >= 400) log.failed.push(`${s} ${u.slice(0, 140)}`);
    if (u.endsWith('.pmtiles')) {
      const name = u.split('/').pop();
      const range = r.request().headers().range ?? '';
      const size = Number(r.headers()['content-length'] ?? 0);
      log.archives.push({ name, status: s, range, size, ms: Date.now() - (started.get(r.request()) ?? Date.now()) });
    }
  });
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && log.errors.push(`console: ${m.text().slice(0, 200)}`));
}
const newLog = () => ({ openMeteo: [], meteo: [], failed: [], errors: [], archives: [], loose: [] });
/** Résumé des lectures d'archives de tuiles (requêtes partielles) depuis `from`. */
function archives(log, from = 0) {
  const list = log.archives.slice(from);
  const out = [];
  for (const name of [...new Set(list.map((a) => a.name))]) {
    const mine = list.filter((a) => a.name === name);
    const ms = mine.map((a) => a.ms).sort((a, b) => a - b);
    const bad = mine.filter((a) => a.status !== 206);
    out.push(
      `${name} : ${mine.length} requêtes partielles, ${Math.round(mine.reduce((s, a) => s + a.size, 0) / 1024)} Ko, ` +
        `médiane ${ms[ms.length >> 1]} ms, la plus lente ${ms.at(-1)} ms${bad.length ? `, ${bad.length} SANS 206 (${bad[0].status})` : ''}`,
    );
  }
  return out.length ? out.join(' ; ') : 'aucune archive lue';
}
const idle = (page, ms = 20000) =>
  page
    .evaluate(
      (timeout) =>
        new Promise((resolve) => {
          const m = window.__map;
          const t = setTimeout(resolve, timeout);
          const done = () => {
            clearTimeout(t);
            setTimeout(resolve, 400);
          };
          if (!m) return resolve();
          if (m.loaded() && m.areTilesLoaded()) done();
          else m.once('idle', done);
        }),
      ms,
    )
    .catch(() => {});
const status = (page) =>
  page.evaluate(() => [...document.querySelectorAll('#legend .legend-hint')].map((p) => p.textContent).find((t) => /cases de \d+ km|Chargement|Zoomez|indisponible|Pas de météo|Trop de cases/.test(t)) ?? '(pas d’état)');

async function accept(page) {
  await page.waitForSelector('dialog.disclaimer[open]', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.disclaimer__accept').disabled, null, { timeout: 15000 });
  const text = await page.evaluate(() => document.querySelector('dialog.disclaimer').textContent.replace(/\s+/g, ' '));
  await page.locator('.disclaimer__accept').click();
  return text;
}

// ── Ordinateur ───────────────────────────────────────────────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const page = await context.newPage();
  const log = newLog();
  watch(page, log);
  const t0 = Date.now();
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: `${OUT}01-avertissement.png` });
  const disclaimer = await accept(page);
  say(`avertissement : ${/le 15 ou un centre antipoison/.test(disclaimer) ? 'texte national' : 'TEXTE INATTENDU'} ; Lyon cité : ${/Lyon/.test(disclaimer)} ; ${disclaimer.match(/version du [^)]+/)?.[0]}`);
  // La carte n'est pas exposée en production : on la retrouve par son conteneur MapLibre.
  await page.waitForFunction(() => document.querySelector('#map canvas'), null, { timeout: 30000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}02-france.png` });
  say(`première vue : ${page.url().split('#')[1] ?? '(sans position)'} après ${Date.now() - t0} ms`);

  // Indice de pousse sur tout le pays
  await page.getByRole('button', { name: 'Cèpes', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('#legend .legend-hint')].some((p) => /cases de \d+ km/.test(p.textContent)), null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2500);
  say(`indice cèpes, France : ${await status(page)}`);
  await page.screenshot({ path: `${OUT}03-france-cepes.png` });
  say(`fichiers météo lus : ${log.meteo.length} (${log.meteo.slice(0, 3).join(', ')}…) ; appels directs à Open-Meteo : ${log.openMeteo.length}`);
  for (const name of ['Girolles', 'Trompettes', 'Chanterelles en tube', 'Morilles']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(1200);
    say(`indice ${name} : ${(await status(page)).slice(0, 110)}`);
  }
  await page.screenshot({ path: `${OUT}04-france-morilles.png` });

  // Carrés de 4,5 km : les Alpes du Nord au zoom 9, puis au zoom 10,5 (étiquettes)
  await page.getByRole('button', { name: 'Cèpes', exact: true }).click();
  await page.goto(`${SITE}#carte=9/45.6/6.4`);
  await page.waitForTimeout(7000);
  say(`carrés de 4,5 km (Savoie, zoom 9) : ${await status(page)}`);
  await page.screenshot({ path: `${OUT}06-carres-4km-savoie.png` });
  await page.goto(`${SITE}#carte=10.5/44.1/3.6`);
  await page.waitForTimeout(7000);
  say(`carrés de 4,5 km (Cévennes, zoom 10,5) : ${await status(page)}`);
  await page.screenshot({ path: `${OUT}07-carres-4km-cevennes.png` });
  say(`archives après ces vues : ${archives(log)}`);
  await page.getByRole('button', { name: 'Cèpes', exact: true }).click(); // on retire le champignon
  await page.waitForTimeout(500);
  await page.goto(`${SITE}#carte=5.5/46.6/2.4`);
  await page.waitForTimeout(3000);

  // Pluie cumulée
  const meteoToggle = page.getByRole('switch', { name: 'Afficher la grille météo' });
  if (!(await meteoToggle.isChecked())) await meteoToggle.check();
  await page.getByText('Pluie cumulée sur 20 jours', { exact: true }).click();
  await page.waitForTimeout(2500);
  say(`pluie, France : ${await status(page)}`);
  await page.screenshot({ path: `${OUT}05-france-pluie.png` });
  await meteoToggle.uncheck();

  // Sols et bilans dans plusieurs régions (zoom 11,5, clic au centre de la carte)
  const places = [
    ['annecy', 'Annecy, Semnoz (Préalpes calcaires)', 45.83, 6.1],
    ['fontainebleau', 'Fontainebleau (sables, Île-de-France)', 48.42, 2.65],
    ['landes', 'Landes de Gascogne (sables)', 44.2, -0.75],
    ['auvergne', 'Chaîne des Puys (roches volcaniques)', 45.75, 2.95],
    ['bretagne', 'Huelgoat (granites, Bretagne)', 48.37, -3.75],
    ['vosges', 'Gérardmer (Vosges)', 48.06, 6.9],
    ['picardie', 'Forêt de Compiègne (limons, sables)', 49.37, 2.9],
    ['corse', 'Vizzavona (Corse)', 42.12, 9.13],
    ['var', 'Massif des Maures (Var)', 43.27, 6.35],
    ['nord', 'Forêt de Mormal (Nord)', 50.2, 3.75],
  ];
  await page.getByRole('switch', { name: 'Afficher la nature du sol' }).check();
  await page.getByRole('button', { name: 'Cèpes', exact: true }).click();
  for (const [slug, name, lat, lon] of places) {
    const before = log.openMeteo.length;
    const archivesBefore = log.archives.length;
    await page.goto(`${SITE}#carte=11.5/${lat}/${lon}`);
    await page.waitForTimeout(9000);
    await page.mouse.click(820, 470);
    await page.waitForSelector('#spot .verdict, #spot .spot__status', { timeout: 20000 }).catch(() => {});
    await page.waitForSelector('#spot .verdict', { timeout: 15000 }).catch(() => {});
    const spot = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('#spot .spot__row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 150)),
      rules: [...document.querySelectorAll('#spot .spot__section')].find((s) => s.querySelector('.spot__title')?.textContent === 'Droit de cueillir')?.textContent.replace(/\s+/g, ' ').slice(17, 150) ?? '',
      meteo: [...document.querySelectorAll('#spot .spot__summary')].map((p) => p.textContent).join(' | '),
      title: [...document.querySelectorAll('#spot .spot__title')].map((t) => t.textContent).join(' / '),
      verdicts: [...document.querySelectorAll('#spot .verdict')].map((v) => `${v.querySelector('strong')?.textContent} : ${v.querySelector('.level-pill')?.textContent}`).join(' ; '),
      note: document.querySelector('#spot .spot__note')?.textContent.slice(-90) ?? '',
      status: document.querySelector('#spot .spot__status')?.textContent ?? '',
    }));
    say(`\n${name}\n  ${spot.rows.join('\n  ')}\n  droit : ${spot.rules}\n  météo : ${spot.meteo}\n  verdicts : ${spot.verdicts}\n  ${spot.status}${spot.note}\n  grille : ${(await status(page)).slice(0, 190)}\n  archives : ${archives(log, archivesBefore)}\n  Open-Meteo direct : ${log.openMeteo.length - before}`);
    await page.screenshot({ path: `${OUT}10-${slug}.png` });
  }

  // Carrés de 500 m (zoom 13) en forêt
  await page.locator('#spot .panel__close').click().catch(() => {});
  await page.goto(`${SITE}#carte=13.2/45.83/6.1`);
  await page.waitForFunction(() => [...document.querySelectorAll('#legend .legend-hint')].some((p) => /carrés? de 500 m avec arbres hôtes/.test(p.textContent)), null, { timeout: 45000 }).catch(() => {});
  say(`\ncarrés de 500 m (Semnoz) : ${await status(page)}`);
  await page.screenshot({ path: `${OUT}20-carres-500m.png` });

  // À propos
  await page.goto(`${SITE}a-propos.html`);
  await page.waitForTimeout(1500);
  const about = await page.evaluate(() => ({
    cap: [...document.querySelectorAll('.cap li')].map((li) => li.textContent.replace(/\s+/g, ' ')).join(' ; '),
    version: document.querySelector('[data-terms-date]')?.textContent,
    stored: [...document.querySelectorAll('[data-stored-list] li')].map((li) => li.textContent).join(' | '),
  }));
  say(`\nÀ propos : conditions du ${about.version} ; centres antipoison : ${about.cap}\n  gardé dans le navigateur : ${about.stored}`);
  await page.locator('#identifier').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}30-a-propos.png` });

  say(`\narchives sur toute la visite : ${archives(log)}`);
  say(`anciennes tuiles en fichiers séparés demandées : ${log.loose.length}`);
  say(`requêtes en échec : ${log.failed.length ? log.failed.slice(0, 8).join(' ; ') : 'aucune'}`);
  say(`erreurs JavaScript : ${log.errors.length ? log.errors.slice(0, 8).join(' ; ') : 'aucune'}`);
  say(`appels directs à Open-Meteo sur toute la visite : ${log.openMeteo.length}${log.openMeteo.length ? ` (${log.openMeteo[0]})` : ''}`);
  await context.close();
}

// ── Téléphone ────────────────────────────────────────────────────────────────
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const page = await context.newPage();
  const log = newLog();
  watch(page, log);
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await accept(page);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}40-mobile-france.png` });
  await page.locator('#legend-toggle').tap();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Girolles', exact: true }).tap();
  await page.waitForTimeout(5000);
  say(`\ntéléphone, girolles : ${await status(page)}`);
  await page.locator('#legend .panel__close').tap();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}41-mobile-france-girolles.png` });
  await page.goto(`${SITE}#carte=12/44.2/-0.75`);
  await page.waitForTimeout(8000);
  await page.touchscreen.tap(195, 330);
  await page.waitForSelector('#spot .verdict', { timeout: 25000 }).catch(() => {});
  await page.screenshot({ path: `${OUT}42-mobile-bilan-landes.png` });
  say(`téléphone, archives : ${archives(log)}`);
  say(`téléphone : appels directs à Open-Meteo ${log.openMeteo.length}, erreurs ${log.errors.length ? log.errors.slice(0, 4).join(' ; ') : 'aucune'}, échecs ${log.failed.length ? log.failed.slice(0, 4).join(' ; ') : 'aucun'}`);
  await context.close();
}

await browser.close();
writeFileSync(`${OUT}rapport.txt`, `${lines.join('\n')}\n`);

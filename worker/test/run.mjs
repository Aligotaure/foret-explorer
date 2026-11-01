// Tests du serveur de mesure, sans Cloudflare : le Durable Object tourne sur node:sqlite.
//   node test/run.mjs        (Node 22.18 ou plus : les fichiers .ts sont lus directement)
// Écrit aussi des aperçus du tableau de bord dans test/apercus/ (données fictives).
import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const { default: worker, MetricsStore, parsePayload } = await import('../src/index.ts');
const { parisDay, addDays } = await import('../src/days.ts');

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── Faux environnement Cloudflare ───────────────────────────────────────────
function sqlStorage(db) {
  return {
    exec(query, ...bindings) {
      const statement = db.prepare(query);
      const rows = /^\s*(select|with)/i.test(query) ? statement.all(...bindings).map((r) => ({ ...r })) : (statement.run(...bindings), []);
      return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
    },
  };
}
function namespace() {
  const db = new DatabaseSync(':memory:');
  let instance = null;
  return {
    db,
    idFromName: (name) => ({ name }),
    get: () => ({
      fetch: (input, init) => {
        instance ??= new MetricsStore({ storage: { sql: sqlStorage(db) } }, {});
        return instance.fetch(new Request(input, init));
      },
    }),
  };
}

const ORIGIN = 'https://aligotaure.github.io';
const PATH = 'tableau-de-bord-test-42';
const PASSWORD = 'cèpes-et-morilles-2026';
const STORE = namespace();
const env = { STORE, ALLOWED_ORIGINS: ORIGIN, ADMIN_PATH: PATH, ADMIN_PASSWORD: PASSWORD };
const call = (path, init = {}, extraEnv = {}) => worker.fetch(new Request(`https://mesures.example${path}`, init), { ...env, ...extraEnv });
const beacon = (body, origin = ORIGIN) =>
  call('/collect', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

// ── Collecte ────────────────────────────────────────────────────────────────
let r = await beacon({ v: 1, c: { 'app.sessions': 1, 'openMeteo.requests': 2, 'openMeteo.locations': 40, 'openMeteo.calls10': 600, 'ign.tiles.forest': 80, inconnu: 3 } });
check('collecte : envoi valide accepté (204, CORS)', r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === ORIGIN, String(r.status));
r = await beacon({ v: 1, c: { 'openMeteo.calls10': 150, 'ign.tiles.forest': 20 } });
const today = parisDay();
const saved = Object.fromEntries(STORE.db.prepare('SELECT metric, n FROM counts WHERE day = ?').all(today).map((x) => [x.metric, x.n]));
check('collecte : totaux du jour additionnés', saved['openMeteo.calls10'] === 750 && saved['ign.tiles.forest'] === 100 && saved['app.sessions'] === 1, JSON.stringify(saved));
check('collecte : compteur inconnu ignoré', !('inconnu' in saved));
r = await beacon({ v: 1, c: { 'ign.tiles.forest': 1 } }, 'https://pirate.example');
check('collecte : autre origine refusée (403)', r.status === 403 && !r.headers.get('Access-Control-Allow-Origin'), String(r.status));
r = await beacon({ v: 1, c: { 'app.sessions': 50 } });
check('collecte : valeur hors plafond refusée (400)', r.status === 400, String(r.status));
r = await beacon('pas du json');
check('collecte : corps illisible refusé (400)', r.status === 400, String(r.status));
r = await beacon('x'.repeat(9000));
check('collecte : envoi trop gros refusé (413)', r.status === 413, String(r.status));
r = await call('/collect', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
check('collecte : pré-vérification CORS', r.status === 204 && r.headers.get('Access-Control-Allow-Methods') === 'POST');
check('collecte : analyse des envois', parsePayload('{"v":2,"c":{}}') === null && JSON.stringify(parsePayload('{"v":1,"c":{"app.spots":2,"app.sessions":0}}')) === '{"app.spots":2}');

// ── Chemin secret et connexion ──────────────────────────────────────────────
r = await call('/');
check('racine : 404', r.status === 404);
r = await call('/tableau-de-bord-mauvais-chemin');
check('mauvais chemin : 404, rien ne trahit la page', r.status === 404);
r = await call(`/${PATH}`);
let body = await r.text();
check('chemin secret : page de connexion, sans chiffres', r.status === 200 && /type="password"/.test(body) && !/Open-Meteo/.test(body));
check('en-têtes de sécurité', r.headers.get('X-Robots-Tag') === 'noindex, nofollow' && /default-src 'none'/.test(r.headers.get('Content-Security-Policy') ?? '') && r.headers.get('Cache-Control') === 'no-store');
const form = (password, ip = '203.0.113.7') =>
  call(`/${PATH}/connexion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip },
    body: new URLSearchParams({ motdepasse: password }),
  });
r = await form('mauvais');
body = await r.text();
check('mauvais mot de passe : 401', r.status === 401 && /Mot de passe incorrect/.test(body) && !r.headers.get('Set-Cookie'));
r = await form(PASSWORD);
const cookie = r.headers.get('Set-Cookie') ?? '';
check('bon mot de passe : session signée, cookie protégé', r.status === 303 && r.headers.get('Location') === `/${PATH}` && /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Strict/.test(cookie) && cookie.includes(`Path=/${PATH}`), cookie.slice(0, 60));
const session = cookie.split(';')[0];
r = await call(`/${PATH}?jours=7`, { headers: { Cookie: session } });
body = await r.text();
check('tableau de bord : affiché avec la session', r.status === 200 && /Appels Open-Meteo aujourd’hui/.test(body) && /75/.test(body) && /aria-current="page">7 jours/.test(body));
r = await call(`/${PATH}`, { headers: { Cookie: session.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) } });
body = await r.text();
check('cookie falsifié : retour à la connexion', /type="password"/.test(body));
r = await call(`/${PATH}`, { headers: { Cookie: session } }, { ADMIN_PASSWORD: 'un-autre-mot-de-passe' });
check('mot de passe changé : anciennes sessions invalides', /type="password"/.test(await r.text()));
r = await call(`/${PATH}/export.json`, { headers: { Cookie: session } });
const exported = await r.json();
check('export JSON avec la session', r.status === 200 && Array.isArray(exported.compteurs) && exported.compteurs.length >= 3);
r = await call(`/${PATH}/export.json`);
check('export JSON sans session : 404', r.status === 404);
r = await call(`/${PATH}/deconnexion`, { method: 'POST', headers: { Cookie: session } });
check('déconnexion : cookie effacé', r.status === 303 && /Max-Age=0/.test(r.headers.get('Set-Cookie') ?? ''));

// Limitation des essais : 8 échecs par quart d'heure et par adresse
for (let i = 0; i < 8; i++) await form(`faux-${i}`, '198.51.100.9');
r = await form(PASSWORD, '198.51.100.9');
check('9e essai depuis la même adresse : bloqué (429), même avec le bon mot de passe', r.status === 429 && !r.headers.get('Set-Cookie'), String(r.status));
r = await form(PASSWORD, '203.0.113.50');
check('autre adresse : connexion possible', r.status === 303);
const keys = STORE.db.prepare('SELECT key FROM failures').all().map((x) => x.key);
check('aucune adresse IP enregistrée (empreintes seulement)', keys.every((k) => !k.includes('198.51') && (k === '*' || /^[0-9a-f]{24}$/.test(k))), keys.join(','));

r = await call(`/${PATH}`, {}, { ADMIN_PASSWORD: 'court' });
check('mot de passe trop court : connexion désactivée, message clair', /ADMIN_PASSWORD/.test(await r.text()));
r = await call(`/${PATH}`, {}, { ADMIN_PATH: 'court' });
check('chemin trop court : tableau de bord désactivé (404)', r.status === 404);

// ── Aperçus avec 90 jours de données fictives ────────────────────────────────
const OUT = fileURLToPath(new URL('./apercus/', import.meta.url));
mkdirSync(OUT, { recursive: true });
STORE.db.exec('DELETE FROM counts');
const insert = STORE.db.prepare('INSERT INTO counts (day, metric, n) VALUES (?, ?, ?)');
for (let i = 0; i < 90; i++) {
  const day = addDays(today, -i);
  const autumn = Math.max(0.15, Math.sin(((90 - i) / 90) * Math.PI)) * (i % 7 === 1 || i % 7 === 2 ? 1.8 : 1);
  const visits = Math.round(6 + 30 * autumn);
  const put = (metric, n) => n > 0 && insert.run(day, metric, Math.round(n));
  put('app.sessions', visits);
  put('app.sessionsMobile', visits * 0.6);
  put('app.spots', visits * 2.2);
  put('openMeteo.requests', visits * 3);
  put('openMeteo.locations', visits * 38);
  put('openMeteo.calls10', visits * 38 * 15);
  put('openMeteo.cacheHits', visits * 55);
  put('ign.altitude.requests', visits * 4);
  put('ign.altitude.points', visits * 260);
  put('ign.altitude.cacheHits', visits * 300);
  put('ign.geocoding.requests', visits * 1.4);
  put('ign.tiles.forest', visits * 140);
  put('ign.tiles.plan', visits * 210);
  put('ign.tiles.ortho', visits * 25);
  put('ign.fonts', visits * 2);
  put('pages.geology', visits * 30);
  if (i === 3) put('openMeteo.errors', 4);
}
const login = await form(PASSWORD, '203.0.113.60');
const fresh = (login.headers.get('Set-Cookie') ?? '').split(';')[0];
for (const days of [7, 30, 90]) {
  const page = await (await call(`/${PATH}?jours=${days}`, { headers: { Cookie: fresh } })).text();
  writeFileSync(`${OUT}tableau-${days}.html`, page);
}
writeFileSync(`${OUT}connexion.html`, await (await call(`/${PATH}`)).text());
STORE.db.exec('DELETE FROM counts');
writeFileSync(`${OUT}vide.html`, await (await call(`/${PATH}`, { headers: { Cookie: fresh } })).text());

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications OK — aperçus dans test/apercus/`);
process.exit(failed ? 1 : 0);

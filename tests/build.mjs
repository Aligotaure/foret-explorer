// Vérifie le découpage du site construit (dist/), que les tests de bout en bout ne voient pas (ils
// tournent sur le serveur de développement) :
//  - la page d'entrée et la vue Analytics n'embarquent pas le code de la carte (MapLibre) ;
//  - l'en-tête de la page précharge bien le fichier de la carte quand elle s'ouvre sur la carte.
// Il relit aussi le contenu de la vue Analytics (src/analyticsData.ts) : c'est `npm run check` que la
// publication lance, pas les tests de bout en bout.
//
//   npm run check     # typecheck, build, puis ce contrôle
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const DIST = new URL('../dist/', import.meta.url);
const read = (file) => readFileSync(new URL(file, DIST), 'utf8');
/** Marque du code de MapLibre (nom d'une classe CSS qu'il pose sur la carte). */
const MAPLIBRE = 'maplibregl-canvas';
/** Au-delà, un fichier chargé d'office a sûrement avalé une bibliothèque. */
const MAX_EAGER_BYTES = 100_000;

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Fichiers chargés d'office avec `file` : lui-même et ses imports statiques, de proche en proche. */
function eagerFiles(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  // `from"./x.js"` et `import"./x.js"` ; un import à la demande s'écrit `import("./x.js")`.
  for (const [, dep] of read(file).matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)) eagerFiles(`assets/${dep}`, seen);
  return seen;
}
const size = (files) => [...files].reduce((sum, file) => sum + statSync(new URL(file, DIST)).size, 0);
const kilo = (bytes) => `${(bytes / 1000).toFixed(1)} ko`;

if (!existsSync(new URL('index.html', DIST))) {
  console.error('dist/index.html introuvable : lancer « npm run build » d’abord.');
  process.exit(1);
}
const html = read('index.html');
const assets = readdirSync(new URL('assets/', DIST));

// Code de la carte : le fichier chargé à la demande qui contient MapLibre.
const mapFile = assets.find((name) => /^mapView-.+\.js$/.test(name));
check('le code de la carte est un fichier à part, avec MapLibre', Boolean(mapFile) && read(`assets/${mapFile}`).includes(MAPLIBRE), mapFile ?? 'aucun fichier mapView-*.js');

// Page d'entrée : son script et tout ce qu'il importe d'office.
const entry = html.match(/<script type="module"[^>]*\ssrc="\.\/(assets\/[^"]+\.js)"/)?.[1];
const linked = [...html.matchAll(/<link rel="modulepreload"[^>]*\shref="\.\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const eager = new Set();
for (const file of [entry, ...linked].filter(Boolean)) eagerFiles(file, eager);
check('page d’entrée : un script d’entrée trouvé', Boolean(entry), entry ?? 'aucun <script type="module" src>');
check(
  'page d’entrée : ni MapLibre ni le code de la carte chargés d’office',
  eager.size > 0 && ![...eager].some((file) => file === `assets/${mapFile}` || read(file).includes(MAPLIBRE)),
  [...eager].join(', '),
);
check(`page d’entrée : moins de ${kilo(MAX_EAGER_BYTES)} de code chargé d’office`, size(eager) < MAX_EAGER_BYTES, kilo(size(eager)));

// Vue Analytics : chargée à la demande, sans rien de la carte.
const analyticsFile = assets.find((name) => /^analyticsView-.+\.js$/.test(name));
const analytics = analyticsFile ? eagerFiles(`assets/${analyticsFile}`) : new Set();
check(
  'vue Analytics : un fichier à part, sans MapLibre ni code de la carte',
  analytics.size > 0 && ![...analytics].some((file) => file === `assets/${mapFile}` || read(file).includes(MAPLIBRE)),
  analyticsFile ? [...analytics].join(', ') : 'aucun fichier analyticsView-*.js',
);
check(`vue Analytics : moins de ${kilo(MAX_EAGER_BYTES)} de code`, analytics.size > 0 && size(analytics) < MAX_EAGER_BYTES, kilo(size(analytics)));

// En-tête : la vue Analytics est décidée avant le premier affichage, sinon la carte est préchargée.
// Le script est exécuté pour de bon, adresse par adresse (le lire ne prouverait rien : un simple
// commentaire contient déjà « vue=analytics »).
const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
function head(hash) {
  const preloaded = [];
  const root = { dataset: {} };
  try {
    vm.runInNewContext(inline, {
      location: { hash },
      document: { documentElement: root, head: { append: (link) => preloaded.push(`${link.rel}:${link.href}`) }, createElement: () => ({}) },
    });
  } catch (error) {
    return `erreur : ${error.message}`;
  }
  return `${root.dataset.view ?? 'carte'} ${preloaded.join(',') || 'rien'}`;
}
const onMap = `carte modulepreload:./assets/${mapFile}`;
const mapHashes = ['', '#carte=11.5/45.92/6.19', '#vue=analyticsx', '#revue=analytics', '#carte=6/46/2&vue=carte'];
const analyticsHashes = ['#vue=analytics', '#carte=11.5/45.92/6.19&vue=analytics', '#vue=analytics&carte=6/46/2'];
const wrong = [...mapHashes.filter((hash) => head(hash) !== onMap), ...analyticsHashes.filter((hash) => head(hash) !== 'analytics rien')];
check(
  'en-tête : la carte est préchargée quand la page s’ouvre sur elle, jamais pour la vue Analytics',
  Boolean(inline) && Boolean(mapFile) && wrong.length === 0 && !html.includes('__MAP_CHUNK__'),
  wrong.length ? wrong.map((hash) => `« ${hash} » → ${head(hash)}`).join(' ; ') : `./assets/${mapFile}`,
);
// L'ordre des feuilles de style compte : style.css corrige des règles de MapLibre.
const cssFile = html.match(/<link rel="stylesheet"[^>]*\shref="\.\/(assets\/[^"]+\.css)"/)?.[1];
const css = cssFile ? read(cssFile) : '';
check(
  'feuille de style : MapLibre avant les règles du site, vue Analytics comprise',
  css.indexOf('.maplibregl-map') >= 0 && css.indexOf('.maplibregl-map') < css.indexOf('.topbar') && css.indexOf('.topbar') < css.indexOf('.analytics__'),
  cssFile ?? 'aucune feuille de style',
);

// Contenu de la vue Analytics : ce que les types laissent passer (date qui n'existe pas, texte laissé
// vide, valeur négative). Les deux fichiers n'importent que des types : TypeScript les traduit seuls.
const load = (file) => {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
};
const { ANALYTICS } = await load('analyticsData.ts');
const { checkAnalytics } = await load('analyticsCheck.ts');
const problems = checkAnalytics(ANALYTICS);
check('contenu de la vue Analytics (src/analyticsData.ts) : rien à corriger', problems.length === 0, problems.join(' | '));

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications du build OK`);
process.exit(failed ? 1 : 0);

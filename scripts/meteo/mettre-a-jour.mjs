// Met à jour les fichiers météo communs (public/data/meteo/) : pluie et températures des 30 derniers
// jours complets pour chaque case de la grille commune (≈ 18 km) sur la France métropolitaine.
// La carte lit ces fichiers au lieu d'appeler Open-Meteo depuis chaque navigateur.
//
// Progressif, pour ne jamais approcher les limites d'Open-Meteo (gratuit, non commercial : moins de
// 10 000 appels par jour, 5 000 par heure, 600 par minute, 300 000 par mois) :
//   - seuls les jours manquants sont demandés : une case à jour la veille ne coûte qu'un appel
//     (Open-Meteo compte un appel par point jusqu'à 14 jours ; les 2 derniers jours connus sont
//     redemandés car le modèle les retouche un peu) ; une case nouvelle coûte 2,2 appels (31 jours) ;
//   - chaque passage a un budget, et l'état (appels dépensés sur l'heure, le jour, le mois glissants)
//     est gardé d'un passage à l'autre dans le fichier d'état ;
//   - un rythme de PAR_MINUTE appels pondérés par minute au plus ; arrêt net sur une erreur 429.
// Sans fichiers sur place, on repart de ceux du site en ligne (--amorce).
//
// Usage : node scripts/meteo/mettre-a-jour.mjs [options]
//   --dossier public/data/meteo    fichiers publiés (index.json, b/<bloc>.json)
//   --etat .meteo-etat.json        état des passages (non publié)
//   --cases scripts/meteo/cases-france.json
//   --budget 3000                  appels pondérés au plus pour ce passage (0 : aucun appel)
//   --amorce URL                   dossier météo du site en ligne, lu si --dossier est vide
//   --simuler                      séries fictives au lieu d'Open-Meteo (tests)
//   --maintenant ISO               date et heure simulées (tests)
// Écrit dans $GITHUB_OUTPUT : change (des données ont été ajoutées), complet (toutes les cases à
// jour), publier (il est temps de republier le site).
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK, KEPT_DAYS, METEO_FORMAT, STEP_LAT, STEP_LON, addDays, blockOf, cellId, daysBetween, parisDate } from '../../src/meteoGrid.ts';
import { openMeteoCalls10 } from '../../src/metricsSchema.ts';

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const VARIABLES = ['precipitation_sum', 'temperature_2m_max', 'temperature_2m_min'];
const PAR_REQUETE = 100; // points par requête (URL d'environ 2 Ko)
const PAR_MINUTE = 450; // Open-Meteo : 600
const PAR_HEURE = 4000; // Open-Meteo : 5 000
const PAR_JOUR = 8000; // sur 24 h glissantes ; Open-Meteo : 10 000
const PAR_MOIS = 240_000; // sur 30 jours glissants ; Open-Meteo : 300 000
const RELIRE = 2; // derniers jours connus redemandés
const PUBLIER_APRES_H = 6; // republier au moins toutes les 6 h tant que le tour n'est pas fini
const USER_AGENT = 'foret-explorer/meteo-commune (+https://github.com/Aligotaure/foret-explorer)';

// ── Options ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const k = args.indexOf(`--${name}`);
  return k >= 0 && args[k + 1] && !args[k + 1].startsWith('--') ? args[k + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const dossier = option('dossier', 'public/data/meteo');
const fichierEtat = option('etat', '.meteo-etat.json');
const fichierCases = option('cases', 'scripts/meteo/cases-france.json');
const budget = Number(option('budget', '3000'));
const amorce = option('amorce', '');
const simuler = flag('simuler');
const maintenant = new Date(option('maintenant', new Date().toISOString()));
const now = () => (flag('maintenant') ? maintenant.getTime() : Date.now());
const sleep = (ms) => (simuler ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

const today = parisDate(maintenant);
const lastDay = addDays(today, -1); // dernier jour complet
const firstDay = addDays(today, -KEPT_DAYS);

// ── Cases à couvrir ──────────────────────────────────────────────────────────

const liste = JSON.parse(readFileSync(fichierCases, 'utf8'));
if (Math.abs(liste.pasLat - STEP_LAT) > 1e-9 || Math.abs(liste.pasLon - STEP_LON) > 1e-9) {
  console.error(`${fichierCases} est fait pour des cases de ${liste.pasLat}° × ${liste.pasLon}°, pas ${STEP_LAT}° × ${STEP_LON}° : relancez scripts/meteo/cases.mjs.`);
  process.exit(1);
}
/** @type {{ id: string, i: number, j: number, lat: number, lon: number }[]} */
const cases = liste.cases.map(([i, j, lat, lon]) => ({ id: cellId(i, j), i, j, lat, lon }));

// ── État des passages ────────────────────────────────────────────────────────

let etat = { v: 1, appels: [], publie: null };
try {
  etat = { ...etat, ...JSON.parse(readFileSync(fichierEtat, 'utf8')) };
} catch {
  /* premier passage */
}
etat.appels = (etat.appels ?? []).filter(([t]) => now() - t < 30 * 86_400_000);
const depense = (ms) => etat.appels.filter(([t]) => now() - t < ms).reduce((s, [, n]) => s + n, 0);

// ── Données déjà là (dossier, sinon site en ligne) ───────────────────────────

/** id → { lat, lon, z, c, jours: Map(date → [pluie, tmax, tmin]) } */
const donnees = new Map();

function lireBloc(bloc) {
  if (bloc?.v !== METEO_FORMAT || !Array.isArray(bloc.dates)) return;
  for (const [id, cell] of Object.entries(bloc.cells ?? {})) {
    const jours = new Map();
    bloc.dates.forEach((date, k) => {
      const v = [cell.p?.[k] ?? null, cell.x?.[k] ?? null, cell.n?.[k] ?? null];
      if (v.some((x) => x !== null)) jours.set(date, v);
    });
    donnees.set(id, { lat: cell.lat, lon: cell.lon, z: cell.z, c: cell.c, jours });
  }
}

async function amorcer(url) {
  const base = url.endsWith('/') ? url : `${url}/`;
  try {
    const index = await (await fetch(`${base}index.json`, { headers: { 'user-agent': USER_AGENT } })).json();
    if (index?.v !== METEO_FORMAT || Math.abs(index.pasLat - STEP_LAT) > 1e-9 || Math.abs(index.pasLon - STEP_LON) > 1e-9) {
      console.log('Site en ligne : pas de fichiers météo compatibles, on part de zéro.');
      return;
    }
    for (const b of index.blocs ?? []) {
      const r = await fetch(`${base}b/${b}.json`, { headers: { 'user-agent': USER_AGENT } });
      if (r.ok) lireBloc(await r.json());
    }
    console.log(`Site en ligne : ${donnees.size} cases reprises (mise à jour du ${index.maj}).`);
  } catch (e) {
    console.log(`Site en ligne injoignable (${e.message}) : on part de zéro.`);
  }
}

if (existsSync(join(dossier, 'index.json'))) {
  for (const f of existsSync(join(dossier, 'b')) ? readdirSync(join(dossier, 'b')) : []) {
    if (f.endsWith('.json')) lireBloc(JSON.parse(readFileSync(join(dossier, 'b', f), 'utf8')));
  }
  console.log(`${donnees.size} cases reprises du dossier ${dossier}.`);
} else if (amorce) {
  await amorcer(amorce);
}

// ── Ce qu'il faut demander ───────────────────────────────────────────────────

/** Jours passés à demander pour une case (0 : à jour). */
function joursManquants(cas) {
  const d = donnees.get(cas.id);
  // Point de relevé déplacé (liste des cases refaite) : on repart de zéro pour cette case.
  if (!d?.c || Math.abs(d.lat - cas.lat) > 1e-4 || Math.abs(d.lon - cas.lon) > 1e-4) return KEPT_DAYS;
  if (d.c >= lastDay) return 0;
  return Math.min(KEPT_DAYS, Math.max(1, daysBetween(d.c, today) + RELIRE - 1));
}

const besoins = cases.map((cas) => ({ cas, jours: joursManquants(cas), depuis: donnees.get(cas.id)?.c ?? '' })).filter((b) => b.jours > 0);
// Les cases déjà suivies d'abord (les plus en retard en tête), les nouvelles ensuite.
besoins.sort((a, b) => (a.depuis ? 0 : 1) - (b.depuis ? 0 : 1) || a.depuis.localeCompare(b.depuis) || a.jours - b.jours);

/** Requêtes : points qui demandent le même nombre de jours, par paquets de PAR_REQUETE. */
const requetes = [];
for (const jours of [...new Set(besoins.map((b) => b.jours))]) {
  const lot = besoins.filter((b) => b.jours === jours).map((b) => b.cas);
  for (let k = 0; k < lot.length; k += PAR_REQUETE) requetes.push({ jours, points: lot.slice(k, k + PAR_REQUETE) });
}
// Même ordre que les besoins : la requête qui contient la case la plus prioritaire passe d'abord.
const rang = new Map(besoins.map((b, k) => [b.cas.id, k]));
requetes.sort((a, b) => Math.min(...a.points.map((p) => rang.get(p.id))) - Math.min(...b.points.map((p) => rang.get(p.id))));

const poids = (r) => openMeteoCalls10(r.points.length, r.jours + 1, VARIABLES.length) / 10;
const aFaire = requetes.reduce((s, r) => s + poids(r), 0);
console.log(
  `${today} : ${cases.length} cases, ${besoins.length} à mettre à jour (${Math.round(aFaire)} appels pondérés) ; ` +
    `déjà dépensé : ${Math.round(depense(3_600_000))} sur l'heure, ${Math.round(depense(86_400_000))} sur 24 h, ${Math.round(depense(30 * 86_400_000))} sur 30 jours.`,
);

// ── Appels ───────────────────────────────────────────────────────────────────

/** Série fictive mais plausible (tests) : quelques épisodes pluvieux, températures selon l'altitude. */
function serieSimulee(p, jours) {
  const dates = Array.from({ length: jours + 1 }, (_, k) => addDays(today, k - jours));
  const h = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const z = Math.round(200 + (h(`${p.lat}${p.lon}`) % 1500));
  return {
    elevation: z,
    daily: {
      time: dates,
      precipitation_sum: dates.map((d) => (h(`${d}${Math.round(p.lat * 4)}`) % 9 === 0 ? 12 + (h(d) % 25) : h(d + p.lon) % 3)),
      temperature_2m_max: dates.map((d) => +(16 - z / 200 + (h(d) % 50) / 10).toFixed(1)),
      temperature_2m_min: dates.map((d) => +(7 - z / 200 + (h(d) % 30) / 10).toFixed(1)),
    },
  };
}

async function appeler(r) {
  if (simuler) return r.points.map((p) => serieSimulee(p, r.jours));
  const url = new URL(OPEN_METEO);
  url.searchParams.set('latitude', r.points.map((p) => p.lat.toFixed(4)).join(','));
  url.searchParams.set('longitude', r.points.map((p) => p.lon.toFixed(4)).join(','));
  url.searchParams.set('daily', VARIABLES.join(','));
  url.searchParams.set('past_days', String(r.jours));
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('timezone', 'Europe/Paris');
  for (let essai = 1; ; essai++) {
    let reponse;
    try {
      reponse = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(90_000) });
    } catch (e) {
      if (essai >= 3) throw new Error(`réseau : ${e.message}`);
      console.log(`  réseau (${e.cause?.code ?? e.message}), nouvel essai dans ${20 * essai} s`);
      await sleep(20_000 * essai);
      continue;
    }
    if (reponse.ok) {
      const data = await reponse.json();
      return Array.isArray(data) ? data : [data];
    }
    const texte = (await reponse.text()).slice(0, 200);
    if (reponse.status === 429) throw Object.assign(new Error(`limite d'Open-Meteo atteinte : ${texte}`), { limite: true });
    if (reponse.status < 500 || essai >= 3) throw new Error(`HTTP ${reponse.status} : ${texte}`);
    console.log(`  HTTP ${reponse.status}, nouvel essai dans ${30 * essai} s`);
    await sleep(30_000 * essai);
  }
}

const arrondi = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

function ranger(cas, item) {
  const d = item?.daily;
  if (!Array.isArray(d?.time)) return false;
  const ancien = donnees.get(cas.id);
  const garder = ancien && Math.abs(ancien.lat - cas.lat) <= 1e-4 && Math.abs(ancien.lon - cas.lon) <= 1e-4;
  const jours = garder ? ancien.jours : new Map();
  let dernier = garder ? ancien.c : '';
  d.time.forEach((date, k) => {
    if (date >= today || date < firstDay) return; // aujourd'hui est incomplet
    const v = [arrondi(d.precipitation_sum?.[k]), arrondi(d.temperature_2m_max?.[k]), arrondi(d.temperature_2m_min?.[k])];
    if (v.every((x) => x === null)) return;
    jours.set(date, v);
    if (!dernier || date > dernier) dernier = date;
  });
  if (!dernier) return false;
  donnees.set(cas.id, { lat: cas.lat, lon: cas.lon, z: Math.round(item.elevation ?? ancien?.z ?? 0), c: dernier, jours });
  return true;
}

let depenseIci = 0;
let rangees = 0;
let arret = '';
for (const r of requetes) {
  const w = poids(r);
  const limites = [
    [budget - depenseIci, 'budget du passage'],
    [PAR_HEURE - depense(3_600_000), "plafond de l'heure"],
    [PAR_JOUR - depense(86_400_000), 'plafond des 24 h'],
    [PAR_MOIS - depense(30 * 86_400_000), 'plafond des 30 jours'],
  ];
  const bloquant = limites.find(([reste]) => reste < w);
  if (bloquant) {
    arret = bloquant[1];
    break;
  }
  let items;
  try {
    items = await appeler(r);
  } catch (e) {
    arret = e.message;
    if (!e.limite) etat.appels.push([now(), w]); // une erreur réseau a pu être comptée quand même
    break;
  }
  etat.appels.push([now(), w]);
  depenseIci += w;
  r.points.forEach((p, k) => {
    if (ranger(p, items[k])) rangees++;
  });
  await sleep((w / PAR_MINUTE) * 60_000);
}
console.log(`${rangees} cases mises à jour, ${Math.round(depenseIci)} appels pondérés${arret ? ` ; arrêt : ${arret}` : ''}.`);

// ── Écriture des fichiers ────────────────────────────────────────────────────

const dates = Array.from({ length: KEPT_DAYS }, (_, k) => addDays(firstDay, k));
const blocs = new Map();
for (const cas of cases) {
  const d = donnees.get(cas.id);
  if (!d?.c) continue;
  const valeurs = (k) => dates.map((date) => d.jours.get(date)?.[k] ?? null);
  const cell = { lat: d.lat, lon: d.lon, z: d.z, c: d.c, p: valeurs(0), x: valeurs(1), n: valeurs(2) };
  if (cell.p.every((x) => x === null)) continue; // plus rien dans la fenêtre des 30 jours
  const b = blockOf(cas);
  if (!blocs.has(b)) blocs.set(b, {});
  blocs.get(b)[cas.id] = cell;
}

if (!blocs.size) {
  // Rien à publier (premier passage sans réponse d'Open-Meteo, amorce impossible) : sans index, la
  // carte se rabat sur Open-Meteo en direct.
  console.log('Aucune case connue : pas de fichiers écrits.');
  writeFileSync(fichierEtat, JSON.stringify(etat));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'change=false\ncomplet=false\npublier=false\n');
  process.exit(0);
}
mkdirSync(join(dossier, 'b'), { recursive: true });
for (const f of readdirSync(join(dossier, 'b'))) if (!blocs.has(f.replace(/\.json$/, ''))) rmSync(join(dossier, 'b', f));
for (const [b, cells] of blocs) writeFileSync(join(dossier, 'b', `${b}.json`), JSON.stringify({ v: METEO_FORMAT, dates, cells }));

const presentes = [...blocs.values()].flatMap((cells) => Object.values(cells));
const aJour = presentes.filter((c) => c.c >= lastDay).length;
const index = {
  v: METEO_FORMAT,
  pasLat: STEP_LAT,
  pasLon: STEP_LON,
  bloc: BLOCK,
  jours: KEPT_DAYS,
  dernierJour: aJour * 2 >= presentes.length ? lastDay : (presentes.map((c) => c.c).sort().at(-1) ?? ''),
  maj: new Date(now()).toISOString(),
  cases: presentes.length,
  aJour,
  blocs: [...blocs.keys()].sort(),
  source: 'Open-Meteo (open-meteo.com), CC BY 4.0 : modèles météo, pas de pluviomètres',
};
writeFileSync(join(dossier, 'index.json'), JSON.stringify(index));

const complet = aJour === cases.length;
const change = rangees > 0;
const ilYaH = etat.publie ? (now() - Date.parse(etat.publie)) / 3_600_000 : Infinity;
const publier = change && (complet || ilYaH >= PUBLIER_APRES_H);
if (publier) etat.publie = new Date(now()).toISOString();
writeFileSync(fichierEtat, JSON.stringify(etat));

console.log(
  `${presentes.length} cases dans ${blocs.size} fichiers, ${aJour} à jour du ${lastDay}` +
    `${complet ? ' : tour complet' : ''}${publier ? ' ; à publier' : ''}.`,
);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `change=${change}\ncomplet=${complet}\npublier=${publier}\n`);

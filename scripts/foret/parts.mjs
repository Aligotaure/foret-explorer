// Écrit, pour chaque carré de 4,5 km de la grille météo (src/meteoGrid.ts), la part de sa surface
// couverte par chaque type de forêt de la BD Forêt® V2. La carte s'en sert pour n'allumer un carré
// d'indice qu'à la mesure des arbres hôtes qu'il contient (src/forestShare.ts) : sans ce fichier,
// un carré posé sur une ville ou sur la mer affichait le même pourcentage qu'une forêt.
//
// Source : tuiles vectorielles de l'IGN (LANDCOVER-TMS.FORESTINVENTORY.V2, zoom 10, sans clé,
// Licence Ouverte Etalab 2.0), lues par scripts/foret/mvt.mjs (aucune dépendance). 889 tuiles pour la
// France métropolitaine, ≈ 320 Mo, une à deux minutes ; elles sont gardées dans .cache/foret/ (une
// relance ne retélécharge rien). Mesuré le 13/11/2026 : mêmes parts qu'au zoom 12 à 0,1 point près.
//
// Méthode : chaque anneau de polygone est découpé par le rectangle du carré, lui-même borné à
// l'emprise de la tuile (les tuiles débordent de 80 unités sur leurs voisines : sans cette borne, la
// marge serait comptée deux fois). Les aires s'additionnent d'une tuile à l'autre.
//
// Part bâtie (champ `bati` du fichier) : même calcul sur les zones bâties et les zones d'activité du
// Plan IGN (tuiles vectorielles PLAN.IGN, couche `bati_zone_surf`, mêmes tuiles du zoom 10, ≈ 85 Mo,
// gardées dans .cache/plan/). La carte s'en sert pour ne pas allumer un carré qui est d'abord une
// ville, même s'il contient un bois.
//
// Toutes les aires sont comptées en fraction de tuile, pas en unités de tuile : les tuiles du Plan
// IGN n'ont pas toutes 4 096 unités de côté (9 tuiles des Alpes du Nord en ont 256 à 2 048 pour la
// couche bâtie ; comptées en unités, Grenoble ressortait bâtie à 1 %).
//
// À relancer si la grille change (src/meteoGrid.ts, scripts/meteo/cases-france.json) ou si l'IGN
// publie une nouvelle BD Forêt. Le fichier produit est versionné (public/foret/parts.json).
//
// Usage : node scripts/foret/parts.mjs [--sortie public/foret/parts.json] [--cache .cache/foret]
//         [--cache-plan .cache/plan]
//         [--tuiles 10/529/364,10/530/364]   (essai sur quelques tuiles : les autres carrés restent vides)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { aire, aireDans, tileBounds, tileOf } from './geometrie.mjs';
import { lireCouche } from './mvt.mjs';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const option = (nom, defaut) => {
  const k = process.argv.indexOf(`--${nom}`);
  return k > 0 && process.argv[k + 1] ? process.argv[k + 1] : defaut;
};
const SORTIE = join(RACINE, option('sortie', 'public/foret/parts.json'));
const CACHE = join(RACINE, option('cache', '.cache/foret'));
const CACHE_PLAN = join(RACINE, option('cache-plan', '.cache/plan'));
const SEULEMENT = option('tuiles', '');
const ZOOM = 10;
const SERVICE = 'https://data.geopf.fr/tms/1.0.0/LANDCOVER-TMS.FORESTINVENTORY.V2';
const COUCHE = 'formation_vegetale';
const SERVICE_PLAN = 'https://data.geopf.fr/tms/1.0.0/PLAN.IGN';
const COUCHE_BATI = 'bati_zone_surf';
/** Symboles de la couche comptés comme bâtis : zones d'habitat et zones industrielles ou d'activité. */
const SYMBOLES_BATIS = new Set(['ZONE_BATI', 'ZONE_INDUS_ACTI']);
const USER_AGENT = 'foret-explorer (parts de foret par carre)';
const DE_FRONT = 6;
const ESSAIS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// La grille est celle de la carte : src/meteoGrid.ts n'a aucun import, TypeScript le traduit seul
// (comme tests/build.mjs le fait pour le contenu de la vue Analytics).
const source = readFileSync(join(RACINE, 'src/meteoGrid.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { BASE_STEP_LAT, BASE_STEP_LON, METEO_FACTOR, SUB_COUNT, cellId } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

// Carrés avec de la terre française : ceux dont cases-france.json connaît l'altitude.
const liste = JSON.parse(readFileSync(join(RACINE, 'scripts/meteo/cases-france.json'), 'utf8'));
const carres = new Map(); // « bi:bj » → { case, k, aires par code, surface vue }
for (const [i, j, , , altitudes] of liste.cases) {
  for (let k = 0; k < SUB_COUNT; k++) {
    if (Array.isArray(altitudes) && altitudes[k] === null) continue;
    const bi = i * METEO_FACTOR + Math.floor(k / METEO_FACTOR);
    const bj = j * METEO_FACTOR + (k % METEO_FACTOR);
    carres.set(`${bi}:${bj}`, { cell: cellId(i, j), k, aires: new Map(), bati: 0, vu: 0, plein: 0 });
  }
}

// Tuiles qui touchent au moins un de ces carrés.
const tuiles = new Set();
for (const id of carres.keys()) {
  const [bi, bj] = id.split(':').map(Number);
  const [x0, y0] = tileOf(bj * BASE_STEP_LON, (bi + 1) * BASE_STEP_LAT, ZOOM);
  const [x1, y1] = tileOf((bj + 1) * BASE_STEP_LON - 1e-9, bi * BASE_STEP_LAT + 1e-9, ZOOM);
  for (let x = Math.floor(x0); x <= Math.floor(x1); x++) for (let y = Math.floor(y0); y <= Math.floor(y1); y++) tuiles.add(`${ZOOM}/${x}/${y}`);
}
const aLire = SEULEMENT ? SEULEMENT.split(',').map((t) => t.trim()).filter(Boolean) : [...tuiles].sort();
console.log(`${carres.size} carrés de 4,5 km, ${tuiles.size} tuiles du zoom ${ZOOM}${SEULEMENT ? ` (essai : ${aLire.length})` : ''}`);

mkdirSync(CACHE, { recursive: true });
mkdirSync(CACHE_PLAN, { recursive: true });
let octets = 0;
let telechargees = 0;
let vides = 0;
/** Tuiles du Plan IGN rendues vides par le service : anormal sur terre, donc ni gardées ni tues. */
const planVides = [];

/**
 * Contenu d'une tuile (cache d'abord). `videPossible` : une réponse 404 ou 204 veut dire « rien à cet
 * endroit » (BD Forêt : aucune forêt) et se garde ; sinon c'est une erreur passagère du service, à
 * retenter (le Plan IGN couvre toute la terre : le 14/11/2026, une tuile du Loiret est revenue vide
 * une fois, puis pleine). Rend un tampon vide si la tuile reste introuvable.
 */
async function tuile(service, cache, nom, videPossible) {
  const fichier = join(cache, `${nom.replaceAll('/', '_')}.pbf`);
  if (existsSync(fichier) && (videPossible || readFileSync(fichier).length)) return readFileSync(fichier);
  for (let essai = 1; ; essai++) {
    try {
      const reponse = await fetch(`${service}/${nom}.pbf`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(90_000) });
      if (reponse.status === 404 || reponse.status === 204) {
        if (!videPossible) throw new Error(`vide (HTTP ${reponse.status})`);
        writeFileSync(fichier, Buffer.alloc(0));
        return Buffer.alloc(0);
      }
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
      const contenu = Buffer.from(await reponse.arrayBuffer());
      writeFileSync(fichier, contenu);
      telechargees++;
      return contenu;
    } catch (error) {
      if (essai >= ESSAIS) {
        if (!videPossible && /^vide/.test(error.message)) {
          planVides.push(nom);
          return Buffer.alloc(0);
        }
        throw new Error(`tuile ${nom} : ${error.message}`);
      }
      await sleep(1500 * essai);
    }
  }
}

/**
 * Ajoute aux carrés les aires des polygones d'une couche d'une tuile : `ajoute(carré, valeur, aire)`
 * pour chaque polygone gardé par `garde(valeur)`. `surface` : cette passe compte aussi la surface du
 * carré vue par les tuiles (une seule passe doit le faire). Aires en fraction de tuile (divisées par
 * le carré du côté de la couche, qui change d'une tuile et d'un service à l'autre). Rend le nombre
 * de polygones gardés.
 */
function compter(nom, contenu, nomCouche, propriete, garde, ajoute, surface) {
  const [z, x, y] = nom.split('/').map(Number);
  const couche = contenu.length ? lireCouche(contenu, nomCouche, propriete) : null;
  const E = couche?.extent ?? 4096;
  const objets = [];
  for (const o of couche?.objets ?? []) {
    let total = 0;
    let [xmin, ymin, xmax, ymax] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of o.rings) {
      total += aire(ring);
      for (const [px, py] of ring) {
        if (px < xmin) xmin = px;
        if (px > xmax) xmax = px;
        if (py < ymin) ymin = py;
        if (py > ymax) ymax = py;
      }
    }
    if (!total || !o.valeur || !garde(o.valeur)) continue;
    objets.push({ code: o.valeur, rings: o.rings, sens: total < 0 ? -1 : 1, xmin, ymin, xmax, ymax });
  }
  const b = tileBounds(z, x, y);
  const enTuile = (lon, lat) => {
    const [tx, ty] = tileOf(lon, lat, z);
    return [(tx - x) * E, (ty - y) * E];
  };
  for (let bi = Math.floor(b.south / BASE_STEP_LAT); bi <= Math.floor((b.north - 1e-12) / BASE_STEP_LAT); bi++) {
    for (let bj = Math.floor(b.west / BASE_STEP_LON); bj <= Math.floor((b.east - 1e-12) / BASE_STEP_LON); bj++) {
      const carre = carres.get(`${bi}:${bj}`);
      if (!carre) continue;
      const [fx0, fy1] = enTuile(bj * BASE_STEP_LON, bi * BASE_STEP_LAT); // coin sud-ouest : y vers le bas
      const [fx1, fy0] = enTuile((bj + 1) * BASE_STEP_LON, (bi + 1) * BASE_STEP_LAT);
      const [x0, y0, x1, y1] = [Math.max(0, fx0), Math.max(0, fy0), Math.min(E, fx1), Math.min(E, fy1)];
      if (x1 <= x0 || y1 <= y0) continue;
      if (surface) {
        carre.plein = ((fx1 - fx0) * (fy1 - fy0)) / (E * E);
        carre.vu += ((x1 - x0) * (y1 - y0)) / (E * E);
      }
      for (const o of objets) {
        if (o.xmax < x0 || o.xmin > x1 || o.ymax < y0 || o.ymin > y1) continue;
        let a = 0;
        for (const ring of o.rings) a += aireDans(ring, x0, y0, x1, y1);
        a *= o.sens;
        if (a > 0) ajoute(carre, o.code, a / (E * E));
      }
    }
  }
  return objets.length;
}
const ajouteForet = (carre, code, a) => carre.aires.set(code, (carre.aires.get(code) ?? 0) + a);
const ajouteBati = (carre, _symbole, a) => {
  carre.bati += a;
};

// Téléchargement à plusieurs de front ; le calcul, lui, est fait tuile par tuile dès qu'elle arrive.
const debut = Date.now();
let rang = 0;
let faites = 0;
await Promise.all(
  Array.from({ length: DE_FRONT }, async () => {
    while (rang < aLire.length) {
      const nom = aLire[rang++];
      const contenu = await tuile(SERVICE, CACHE, nom, true);
      octets += contenu.length;
      if (!compter(nom, contenu, COUCHE, 'code_tfv', () => true, ajouteForet, true)) vides++;
      const plan = await tuile(SERVICE_PLAN, CACHE_PLAN, nom, false);
      octets += plan.length;
      compter(nom, plan, COUCHE_BATI, 'symbo', (symbole) => SYMBOLES_BATIS.has(symbole), ajouteBati, false);
      if (++faites % 50 === 0 || faites === aLire.length) {
        console.log(`${faites}/${aLire.length} tuiles, ${(octets / 1e6).toFixed(0)} Mo, ${Math.round((Date.now() - debut) / 1000)} s`);
      }
    }
  }),
);

// Parts en pour cent entiers, les plus grandes d'abord ; une part de moins de 0,5 % n'est pas gardée.
const codes = [...new Set([...carres.values()].flatMap((c) => [...c.aires.keys()]))].sort();
const rangDe = new Map(codes.map((code, k) => [code, k]));
const cases = {};
const bati = {};
let incomplets = 0;
let boises = 0;
let recouverts = 0;
let urbains = 0;
for (const carre of carres.values()) {
  if (!SEULEMENT && (carre.plein === 0 || carre.vu / carre.plein < 0.999)) incomplets++;
  // Aux limites de départements, des polygones de la BD Forêt se recouvrent : la somme peut alors
  // dépasser la surface du carré (72 carrés le 13/11/2026, 114 % au pire). On la ramène à 100 %.
  const somme = [...carre.aires.values()].reduce((s, a) => s + a, 0);
  const surface = Math.max(carre.plein || 1, somme);
  if (somme > (carre.plein || 1) * 1.005) recouverts++;
  const parts = [...carre.aires]
    .map(([code, a]) => [rangDe.get(code), Math.round((a / surface) * 100)])
    .filter(([, part]) => part >= 1)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (parts.length) boises++;
  (cases[carre.cell] ??= Array.from({ length: SUB_COUNT }, () => null))[carre.k] = parts.flat();
  // Part bâtie, en pour cent entiers (zones d'habitat et d'activité peuvent se recouvrir : 100 au plus).
  const partBatie = Math.min(100, Math.round((carre.bati / (carre.plein || 1)) * 100));
  if (partBatie >= 25) urbains++;
  (bati[carre.cell] ??= Array.from({ length: SUB_COUNT }, () => null))[carre.k] = partBatie;
}
if (incomplets) throw new Error(`${incomplets} carrés ne sont pas couverts en entier par les tuiles lues`);
if (planVides.length) console.warn(`⚠ ${planVides.length} tuile(s) du Plan IGN rendue(s) vide(s) par le service, part bâtie comptée nulle : ${planVides.join(', ')}. Relancer plus tard.`);

const resultat = {
  v: 1,
  genere: new Date().toISOString().slice(0, 10),
  source: `IGN, BD Forêt® V2 (tuiles vectorielles ${SERVICE.split('/').pop()}, zoom ${ZOOM}) ; part bâtie : IGN, Plan IGN (tuiles vectorielles ${SERVICE_PLAN.split('/').pop()}, couche ${COUCHE_BATI}, zoom ${ZOOM})`,
  pasLat: BASE_STEP_LAT,
  pasLon: BASE_STEP_LON,
  codes,
  cases,
  bati,
};
mkdirSync(dirname(SORTIE), { recursive: true });
writeFileSync(SORTIE, `${JSON.stringify(resultat)}\n`);
console.log(
  `${carres.size} carrés (${boises} avec au moins 1 % de forêt), ${codes.length} types, ${telechargees} tuiles téléchargées, ` +
    `${vides} sans forêt, ${recouverts} carrés ramenés à 100 %, ${urbains} carrés bâtis à 25 % ou plus, ${Math.round((Date.now() - debut) / 1000)} s ; écrit : ${SORTIE} (${(readFileSync(SORTIE).length / 1000).toFixed(0)} ko)`,
);

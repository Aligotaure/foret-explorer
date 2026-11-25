// Écrit, pour chaque carré de 4,5 km de la grille météo (src/meteoGrid.ts) et pour chaque champignon,
// ce que la carte y dessinerait en carrés de 500 m : combien, et ce que vaut le meilleur (arbres
// hôtes × sol). La carte en tire tout ce qu'elle montre plus large que les carrés de 500 m (carrés de
// 4,5 km, cases de 18 km, pastilles : src/forestShare.ts), pour qu'une vue large n'annonce jamais
// autre chose que ce qu'on trouve en zoomant. Il écrit aussi la part bâtie de chaque carré.
//
// La règle n'est pas recopiée ici : Vite (déjà une dépendance du projet) fabrique une version de
// src/partsBuild.ts lisible par Node, dans .cache/parts/, et c'est `surveySquare` de src/fineRule.ts,
// celle de la carte, qui juge chaque carré. Le script ne fait que lui apporter ce que la carte lit
// dans ses tuiles : la forêt et le sol sous les 3 × 3 points de chaque carré de 500 m (releve.mjs).
//
// Sources :
//  - forêts : tuiles vectorielles de l'IGN (LANDCOVER-TMS.FORESTINVENTORY.V2, sans clé, Licence
//    Ouverte Etalab 2.0), lues par scripts/foret/mvt.mjs, au zoom SURVEY_TILE_ZOOM (11) : celui que
//    lit le relevé de la carte, à tous les zooms d'affichage (l'IGN simplifie ses tuiles à chaque
//    zoom ; avec celles du zoom 10, 3 carrés sur 15 différaient un peu de la carte près d'Amiens).
//    3 556 tuiles pour la France métropolitaine, ≈ 440 Mo, gardées dans .cache/foret/ (une relance
//    ne retélécharge rien). Une tuile rendue vide n'est crue que si sa tuile mère du zoom 10 n'a pas
//    de forêt à cet endroit (`tuileForet`) : en rafale, le service répond parfois « rien ici » à tort ;
//  - sols : l'archive des tuiles du site (scripts/geologie/, zoom 11), prise dans
//    public/data/geologie/ si elle y est, sinon téléchargée une fois depuis le site en ligne dans
//    .cache/geologie/ (143 Mo) ;
//  - part bâtie (champ `bati`) : zones bâties et zones d'activité du Plan IGN (tuiles vectorielles
//    PLAN.IGN, couche `bati_zone_surf`, 889 tuiles du zoom 10, ≈ 85 Mo, gardées dans .cache/plan/).
//    Chaque anneau est découpé par le rectangle du carré, lui-même borné à l'emprise de la tuile (les
//    tuiles débordent de 80 unités sur leurs voisines : sans cette borne, la marge serait comptée
//    deux fois). Aires comptées en fraction de tuile, pas en unités : les tuiles du Plan IGN n'ont
//    pas toutes 4 096 unités de côté (9 tuiles des Alpes du Nord en ont 256 à 2 048 ; comptées en
//    unités, Grenoble ressortait bâtie à 1 %).
//
// À relancer quand ce dont le résultat dépend change : arbres hôtes ou sols d'un champignon
// (src/mushrooms.ts), seuils des carrés de 500 m (src/config.ts), règles des sols
// (scripts/geologie/), grille (src/meteoGrid.ts, scripts/meteo/cases-france.json), nouvelle BD Forêt.
// `npm run test:france` échoue tant que le fichier n'a pas été refait avec les règles du code
// (empreinte `regles`). Le fichier produit est versionné (public/foret/parts.json). Une minute
// tuiles en cache, un quart d'heure sinon (16 minutes le 25/11/2026).
//
// Usage : node scripts/foret/parts.mjs [--sortie public/foret/parts.json] [--cache .cache/foret]
//         [--cache-plan .cache/plan] [--sols chemin/geologie.pmtiles]
//         [--tuiles 10/529/364,10/530/364]   (essai sur quelques tuiles : les autres carrés restent vides)
import { createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PMTiles } from 'pmtiles';
import { build } from 'vite';
import { aire, aireDans, tileBounds, tileOf } from './geometrie.mjs';
import { lireCouche } from './mvt.mjs';
import { creerTreillis, ordreDeTrace, tracerTuile } from './releve.mjs';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const option = (nom, defaut) => {
  const k = process.argv.indexOf(`--${nom}`);
  return k > 0 && process.argv[k + 1] ? process.argv[k + 1] : defaut;
};
const SORTIE = join(RACINE, option('sortie', 'public/foret/parts.json'));
const CACHE = join(RACINE, option('cache', '.cache/foret'));
const CACHE_PLAN = join(RACINE, option('cache-plan', '.cache/plan'));
const SOLS_DU_BUILD = join(RACINE, 'public/data/geologie/geologie.pmtiles');
const SOLS_EN_CACHE = join(RACINE, '.cache/geologie/geologie.pmtiles');
const SOLS_EN_LIGNE = 'https://aligotaure.github.io/foret-explorer/data/geologie/geologie.pmtiles';
const SEULEMENT = option('tuiles', '');
const SERVICE = 'https://data.geopf.fr/tms/1.0.0/LANDCOVER-TMS.FORESTINVENTORY.V2';
const SERVICE_PLAN = 'https://data.geopf.fr/tms/1.0.0/PLAN.IGN';
const COUCHE_BATI = 'bati_zone_surf';
/** Symboles de la couche comptés comme bâtis : zones d'habitat et zones industrielles ou d'activité. */
const SYMBOLES_BATIS = new Set(['ZONE_BATI', 'ZONE_INDUS_ACTI']);
const USER_AGENT = 'foret-explorer (parts de foret par carre)';
const DE_FRONT = 6;
const ESSAIS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Le code de la carte, pour Node. (`configFile: false` : sans les réglages du site, faits pour ses pages.)
const dossierCode = join(RACINE, '.cache/parts');
await build({
  root: RACINE,
  configFile: false,
  logLevel: 'warn',
  build: { ssr: 'src/partsBuild.ts', outDir: dossierCode, emptyOutDir: true, copyPublicDir: false, rollupOptions: { output: { entryFileNames: 'partsBuild.mjs' } } },
});
const code = await import(pathToFileURL(join(dossierCode, 'partsBuild.mjs')).href);
const { BASE_STEP_LAT, BASE_STEP_LON, METEO_FACTOR, SUB_COUNT, FINE_DIVISIONS, FINE_OFFSETS, MUSHROOMS, SOIL_BY_ID, cellId } = code;
/**
 * Le script avance par tuiles du zoom 10 (celles de la part bâtie). Forêts et sols sont lus au zoom
 * où la carte les relève : chaque tuile du zoom 10 en contient quatre du zoom 11.
 */
const ZOOM = code.BDFORET.minZoom;
const ZOOM_FORETS = code.SURVEY_TILE_ZOOM;
const ZOOM_SOLS = code.GEOLOGY.maxZoom;
/** Tuiles du zoom `zoom` contenues dans la tuile `x`, `y` du zoom ZOOM. */
const filles = (x, y, zoom) => {
  const facteur = 2 ** (zoom - ZOOM);
  const liste = [];
  for (let dx = 0; dx < facteur; dx++) for (let dy = 0; dy < facteur; dy++) liste.push([x * facteur + dx, y * facteur + dy]);
  return liste;
};
const POINTS = FINE_OFFSETS.length;
// Le treillis de releve.mjs suppose des points à intervalles réguliers d'un carré à l'autre.
if (FINE_OFFSETS.some((f, k) => Math.abs(f - (k + 0.5) / POINTS) > 1e-12)) throw new Error('points des carrés de 500 m irréguliers : releve.mjs est à revoir');
const PAS_LAT = BASE_STEP_LAT / FINE_DIVISIONS / POINTS;
const PAS_LON = BASE_STEP_LON / FINE_DIVISIONS / POINTS;

// Carrés avec de la terre française : ceux dont cases-france.json connaît l'altitude.
const liste = JSON.parse(readFileSync(join(RACINE, 'scripts/meteo/cases-france.json'), 'utf8'));
const carres = new Map(); // « bi:bj » → { case, k, part bâtie, surface vue par les tuiles }
for (const [i, j, , , altitudes] of liste.cases) {
  for (let k = 0; k < SUB_COUNT; k++) {
    if (Array.isArray(altitudes) && altitudes[k] === null) continue;
    const bi = i * METEO_FACTOR + Math.floor(k / METEO_FACTOR);
    const bj = j * METEO_FACTOR + (k % METEO_FACTOR);
    carres.set(`${bi}:${bj}`, { cell: cellId(i, j), k, bi, bj, bati: 0, vu: 0, plein: 0 });
  }
}

// Tuiles qui touchent au moins un de ces carrés.
const tuiles = new Set();
for (const { bi, bj } of carres.values()) {
  const [x0, y0] = tileOf(bj * BASE_STEP_LON, (bi + 1) * BASE_STEP_LAT, ZOOM);
  const [x1, y1] = tileOf((bj + 1) * BASE_STEP_LON - 1e-9, bi * BASE_STEP_LAT + 1e-9, ZOOM);
  for (let x = Math.floor(x0); x <= Math.floor(x1); x++) for (let y = Math.floor(y0); y <= Math.floor(y1); y++) tuiles.add(`${ZOOM}/${x}/${y}`);
}
const aLire = SEULEMENT ? SEULEMENT.split(',').map((t) => t.trim()).filter(Boolean) : [...tuiles].sort();
console.log(`${carres.size} carrés de 4,5 km, ${tuiles.size} tuiles du zoom ${ZOOM} (forêts : leurs filles du zoom ${ZOOM_FORETS})${SEULEMENT ? ` (essai : ${aLire.length})` : ''}`);

// Deux treillis sur l'emprise des carrés, un carré de marge (la règle de ville regarde les voisins).
const lesBi = [...carres.values()].map((c) => c.bi);
const lesBj = [...carres.values()].map((c) => c.bj);
const min = (l) => l.reduce((a, b) => Math.min(a, b), Infinity);
const max = (l) => l.reduce((a, b) => Math.max(a, b), -Infinity);
const emprise = {
  south: (min(lesBi) - 1) * BASE_STEP_LAT,
  north: (max(lesBi) + 2) * BASE_STEP_LAT,
  west: (min(lesBj) - 1) * BASE_STEP_LON,
  east: (max(lesBj) + 2) * BASE_STEP_LON,
};
const forets = creerTreillis(emprise, PAS_LAT, PAS_LON);
const sols = creerTreillis(emprise, PAS_LAT, PAS_LON);
/** Valeurs d'un treillis : rang 1 à 255 de chaque texte (0 : rien). */
const rangs = () => {
  const liste = [];
  return { liste, de: (texte) => (liste.indexOf(texte) + 1 || liste.push(texte)) };
};
const codes = rangs();
const natures = rangs();

mkdirSync(CACHE, { recursive: true });
mkdirSync(CACHE_PLAN, { recursive: true });
let octets = 0;
let telechargees = 0;
let vides = 0;
/** Tuiles de forêt rendues vides à tort par le service, puis obtenues en les redemandant. */
let redemandees = 0;
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
 * Tuile de forêt du zoom ZOOM_FORETS. Une réponse « vide » n'est crue que si la tuile mère, au zoom
 * ZOOM, n'a pas de forêt à cet endroit : pendant un téléchargement en rafale, le service de l'IGN
 * répond parfois « rien ici » pour une tuile pleine (le 25/11/2026, des dizaines de tuiles sur 3 556 ;
 * 24 carrés de 4,5 km boisés à 40 % en ressortaient sans un seul carré de 500 m). La tuile est alors
 * redemandée ; si elle reste vide, le script s'arrête plutôt que d'écrire un trou dans le fichier.
 */
async function tuileForet(x, y) {
  const nom = `${ZOOM_FORETS}/${x}/${y}`;
  let contenu = await tuile(SERVICE, CACHE, nom, true);
  if (contenu.length || !(await mereBoisee(x, y))) return contenu;
  for (let essai = 1; essai <= ESSAIS; essai++) {
    await sleep(2000 * essai);
    rmSync(join(CACHE, `${nom.replaceAll('/', '_')}.pbf`), { force: true });
    contenu = await tuile(SERVICE, CACHE, nom, true);
    if (contenu.length) {
      redemandees++;
      return contenu;
    }
  }
  throw new Error(`tuile ${nom} : rendue vide par le service alors que sa tuile mère a de la forêt à cet endroit. Relancer plus tard.`);
}

/** La tuile mère (zoom ZOOM) a-t-elle de la forêt dans le quart que couvre la tuile x, y du zoom ZOOM_FORETS ? */
const meres = new Map();
async function mereBoisee(x, y) {
  const facteur = 2 ** (ZOOM_FORETS - ZOOM);
  const [mx, my] = [Math.floor(x / facteur), Math.floor(y / facteur)];
  const cle = `${ZOOM}/${mx}/${my}`;
  if (!meres.has(cle)) {
    const contenu = await tuile(SERVICE, CACHE, cle, true);
    meres.set(cle, contenu.length ? lireCouche(contenu, code.BDFORET.sourceLayer, 'code_tfv') : null);
  }
  const couche = meres.get(cle);
  if (!couche) return false;
  const cote = couche.extent / facteur;
  const [x0, y0] = [(x - mx * facteur) * cote, (y - my * facteur) * cote];
  // Plus qu'un liseré de bord : 1/10 000 de la tuile fille (≈ 1 ha au zoom 11).
  const seuil = (cote * cote) / 10_000;
  let surface = 0;
  for (const o of couche.objets) {
    const sens = o.rings.reduce((t, ring) => t + aire(ring), 0) < 0 ? -1 : 1;
    for (const ring of o.rings) surface += sens * aireDans(ring, x0, y0, x0 + cote, y0 + cote);
    if (surface > seuil) return true;
  }
  return false;
}

/**
 * Ajoute aux carrés l'aire bâtie d'une tuile du Plan IGN, et la surface du carré vue par les tuiles
 * (pour vérifier à la fin qu'aucun carré n'est resté à moitié lu). Aires en fraction de tuile
 * (divisées par le carré du côté de la couche, qui change d'une tuile à l'autre).
 */
function compterBati(nom, contenu) {
  const [z, x, y] = nom.split('/').map(Number);
  const couche = contenu.length ? lireCouche(contenu, COUCHE_BATI, 'symbo') : null;
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
    if (!total || !o.valeur || !SYMBOLES_BATIS.has(o.valeur)) continue;
    objets.push({ rings: o.rings, sens: total < 0 ? -1 : 1, xmin, ymin, xmax, ymax });
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
      carre.plein = ((fx1 - fx0) * (fy1 - fy0)) / (E * E);
      carre.vu += ((x1 - x0) * (y1 - y0)) / (E * E);
      for (const o of objets) {
        if (o.xmax < x0 || o.xmin > x1 || o.ymax < y0 || o.ymin > y1) continue;
        let a = 0;
        for (const ring of o.rings) a += aireDans(ring, x0, y0, x1, y1);
        a *= o.sens;
        if (a > 0) carre.bati += a / (E * E);
      }
    }
  }
}

// ── Téléchargement (à plusieurs de front) et part bâtie, tuile par tuile ───────────────────────────
const debut = Date.now();
let rang = 0;
let faites = 0;
await Promise.all(
  Array.from({ length: DE_FRONT }, async () => {
    while (rang < aLire.length) {
      const nom = aLire[rang++];
      const [, x, y] = nom.split('/').map(Number);
      for (const [fx, fy] of filles(x, y, ZOOM_FORETS)) octets += (await tuileForet(fx, fy)).length;
      const plan = await tuile(SERVICE_PLAN, CACHE_PLAN, nom, false);
      octets += plan.length;
      compterBati(nom, plan);
      if (++faites % 100 === 0 || faites === aLire.length) {
        console.log(`tuiles et part bâtie : ${faites}/${aLire.length} tuiles du zoom ${ZOOM}, ${(octets / 1e6).toFixed(0)} Mo, ${telechargees} téléchargées, ${Math.round((Date.now() - debut) / 1000)} s`);
      }
    }
  }),
);

// ── Forêts : tracées sur le treillis, dans l'ordre qui garde le même polygone que la carte ─────────
/** Tuiles du zoom `zoom` à tracer, dans l'ordre de `ordreDeTrace`. */
const aTracer = (zoom) => ordreDeTrace(aLire.flatMap((nom) => filles(...nom.split('/').map(Number).slice(1), zoom)));
let polygones = 0;
for (const [x, y] of aTracer(ZOOM_FORETS)) {
  const contenu = await tuileForet(x, y);
  const traces = contenu.length ? tracerTuile(forets, ZOOM_FORETS, x, y, lireCouche(contenu, code.BDFORET.sourceLayer, 'code_tfv'), codes.de) : 0;
  if (!traces) vides++;
  polygones += traces;
}
console.log(`forêts : ${polygones} polygones, ${Math.round((Date.now() - debut) / 1000)} s`);

// ── Sols : l'archive du site, lue sur le disque ────────────────────────────────────────────────────
let archive = option('sols', existsSync(SOLS_DU_BUILD) ? SOLS_DU_BUILD : SOLS_EN_CACHE);
if (!existsSync(archive)) {
  console.log(`sols : archive absente, téléchargée depuis ${SOLS_EN_LIGNE}…`);
  mkdirSync(dirname(archive), { recursive: true });
  const reponse = await fetch(SOLS_EN_LIGNE, { headers: { 'user-agent': USER_AGENT } });
  if (!reponse.ok || !reponse.body) throw new Error(`archive des sols : HTTP ${reponse.status}`);
  await pipeline(Readable.fromWeb(reponse.body), createWriteStream(`${archive}.partiel`));
  renameSync(`${archive}.partiel`, archive);
}
const fd = openSync(archive, 'r');
const lecture = new PMTiles({
  getKey: () => archive,
  getBytes: async (offset, length) => {
    const tampon = Buffer.alloc(length);
    const lus = readSync(fd, tampon, 0, length, offset);
    return { data: tampon.buffer.slice(tampon.byteOffset, tampon.byteOffset + lus) };
  },
});
const entete = await lecture.getHeader();
if (entete.maxZoom < ZOOM_SOLS) throw new Error(`${archive} : zoom ${ZOOM_SOLS} absent (dernier zoom : ${entete.maxZoom})`);
let tuilesSols = 0;
let polygonesSols = 0;
for (const [x, y] of aTracer(ZOOM_SOLS)) {
  const reponse = await lecture.getZxy(ZOOM_SOLS, x, y);
  if (!reponse?.data?.byteLength) continue; // mer, étranger : pas de tuile
  tuilesSols++;
  // (Seuls les sols que la carte connaît : elle ignore les autres valeurs, voir `sampleCells`.)
  polygonesSols += tracerTuile(sols, ZOOM_SOLS, x, y, lireCouche(Buffer.from(reponse.data), code.GEOLOGY.sourceLayer, 'sol'), (sol) => (SOIL_BY_ID.has(sol) ? natures.de(sol) : 0));
}
console.log(`sols : ${tuilesSols} tuiles du zoom ${ZOOM_SOLS}, ${polygonesSols} polygones, ${Math.round((Date.now() - debut) / 1000)} s`);

// ── Chaque carré de 4,5 km, jugé par la règle de la carte ──────────────────────────────────────────
// Un point relevé : { code, soil }, comme dans la carte. Les mêmes objets resservent partout.
const points = new Map();
const pointDe = (r, c) => {
  const f = forets.lit(r, c);
  const s = f ? sols.lit(r, c) : 0; // la carte ne lit le sol que sous une forêt
  const cle = f * 256 + s;
  let point = points.get(cle);
  if (!point) points.set(cle, (point = { code: f ? codes.liste[f - 1] : null, soil: s ? natures.liste[s - 1] : null }));
  return point;
};
const boise = (I, J) => {
  for (let dr = 0; dr < POINTS; dr++) for (let dc = 0; dc < POINTS; dc++) if (forets.lit(POINTS * I + dr, POINTS * J + dc)) return true;
  return false;
};
const fin = {};
const bati = {};
const compte = Object.fromEntries(MUSHROOMS.map((m) => [m.id, { allumes: 0, unSeul: 0, enVille: 0 }]));
let incomplets = 0;
let urbains = 0;
for (const carre of carres.values()) {
  if (!SEULEMENT && (carre.plein === 0 || carre.vu / carre.plein < 0.999)) incomplets++;
  // Part bâtie, en pour cent entiers (zones d'habitat et d'activité peuvent se recouvrir : 100 au plus).
  const partBatie = Math.min(100, Math.round((carre.bati / (carre.plein || 1)) * 100));
  if (partBatie >= 25) urbains++;
  (bati[carre.cell] ??= Array.from({ length: SUB_COUNT }, () => null))[carre.k] = partBatie;
  // (Comme la carte : `built` vaut la part du fichier divisée par cent, voir `coversOf` de forestShare.ts.)
  const ville = partBatie / 100 >= code.BUILT_MAX_COVER;
  // Ses carrés de 500 m, et la rangée qui les borde (voisins de la règle de ville).
  const cellules = [];
  let aDesArbres = false;
  for (let di = -1; di <= FINE_DIVISIONS; di++) {
    for (let dj = -1; dj <= FINE_DIVISIONS; dj++) {
      const I = carre.bi * FINE_DIVISIONS + di;
      const J = carre.bj * FINE_DIVISIONS + dj;
      if (!boise(I, J)) continue;
      const inner = di >= 0 && di < FINE_DIVISIONS && dj >= 0 && dj < FINE_DIVISIONS;
      aDesArbres ||= inner;
      const samples = [];
      // (Même ordre que la carte : du sud au nord, puis d'ouest en est.)
      for (let dr = 0; dr < POINTS; dr++) for (let dc = 0; dc < POINTS; dc++) samples.push(pointDe(POINTS * I + dr, POINTS * J + dc));
      cellules.push({ id: `${I}:${J}`, samples, inner });
    }
  }
  const releves = MUSHROOMS.map((m) => (aDesArbres ? code.surveySquare(m, ville, cellules) : { count: 0, best: 0 }));
  releves.forEach((r, n) => {
    if (!r.count) return;
    const c = compte[MUSHROOMS[n].id];
    c.allumes++;
    if (r.count === 1) c.unSeul++;
    if (ville) c.enVille++;
  });
  (fin[carre.cell] ??= Array.from({ length: SUB_COUNT }, () => null))[carre.k] = code.packSquare(releves);
}
if (incomplets) throw new Error(`${incomplets} carrés ne sont pas couverts en entier par les tuiles lues`);
if (planVides.length) console.warn(`⚠ ${planVides.length} tuile(s) du Plan IGN rendue(s) vide(s) par le service, part bâtie comptée nulle : ${planVides.join(', ')}. Relancer plus tard.`);

const resultat = {
  v: code.SHARE_FORMAT,
  genere: new Date().toISOString().slice(0, 10),
  source:
    `forêts : IGN, BD Forêt® V2 (tuiles vectorielles ${SERVICE.split('/').pop()}, zoom ${ZOOM_FORETS}) ; sols : BRGM, archive des tuiles du site (zoom ${ZOOM_SOLS}) ; ` +
    `part bâtie : IGN, Plan IGN (tuiles vectorielles ${SERVICE_PLAN.split('/').pop()}, couche ${COUCHE_BATI}, zoom ${ZOOM})`,
  pasLat: BASE_STEP_LAT,
  pasLon: BASE_STEP_LON,
  regles: code.rulesSignature(),
  champignons: MUSHROOMS.map((m) => m.id),
  fin,
  bati,
};
// Filet de plus : un carré qui avait quelque chose à dessiner dans le fichier précédent et n'a plus
// rien pour aucun champignon. Normal après un changement de règle ou de BD Forêt, pas autrement.
if (!SEULEMENT && existsSync(SORTIE)) {
  try {
    const avant = JSON.parse(readFileSync(SORTIE, 'utf8'));
    const perdus = [];
    if (avant.v === code.SHARE_FORMAT) for (const [id, lignes] of Object.entries(avant.fin ?? {})) lignes.forEach((ligne, k) => Array.isArray(ligne) && fin[id]?.[k] === 0 && perdus.push(`${id}/${k}`));
    if (perdus.length) console.warn(`⚠ ${perdus.length} carré(s) avaient quelque chose à dessiner dans le fichier précédent et n'ont plus rien : ${perdus.slice(0, 8).join(', ')}${perdus.length > 8 ? '…' : ''}`);
  } catch {
    /* fichier précédent illisible : rien à comparer */
  }
}
mkdirSync(dirname(SORTIE), { recursive: true });
writeFileSync(SORTIE, `${JSON.stringify(resultat)}\n`);
for (const m of MUSHROOMS) {
  const c = compte[m.id];
  console.log(`${m.label} : ${c.allumes} carrés avec au moins un carré de 500 m à dessiner (${c.unSeul} avec un seul, ${c.enVille} en ville)`);
}
console.log(
  `${carres.size} carrés, ${polygones} polygones de forêt (${codes.liste.length} types), ${telechargees} tuiles téléchargées${redemandees ? ` (dont ${redemandees} rendues vides à tort, redemandées)` : ''}, ${vides} sans forêt, ` +
    `${urbains} carrés bâtis à 25 % ou plus, règles ${resultat.regles}, ${Math.round((Date.now() - debut) / 1000)} s ; écrit : ${SORTIE} (${(readFileSync(SORTIE).length / 1000).toFixed(0)} ko)`,
);

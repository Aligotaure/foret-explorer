// Écrit la liste des cases météo communes qui touchent la France métropolitaine (Corse comprise) :
//   - pour chaque case, le point où relever la météo : le centre de la case s'il est sur le territoire,
//     sinon le point du territoire le plus proche du centre, parmi 9 × 9 points de la case ;
//   - l'altitude de ses 16 carrés de 4,5 km (4 × 4 cases de base, du sud au nord puis d'ouest en est),
//     pour que la carte ramène les températures de la case à l'altitude de chaque carré ; null pour
//     un carré sans terre française (mer, étranger).
//
// Départements : ADMIN EXPRESS COG CARTO (IGN, Licence Ouverte 2.0), WFS de la Géoplateforme ; altitudes :
// RGE ALTI (IGN), service de calcul altimétrique de la Géoplateforme (5 requêtes par seconde au plus).
// Sans clé, mais sans CORS pour le WFS : à lancer en ligne de commande, pas dans le navigateur.
// À relancer seulement si la taille des cases change (src/meteoGrid.ts) ; le fichier est versionné.
// Les points de relevé du fichier existant sont gardés tels quels (un point déplacé ferait redemander
// 30 jours de météo pour sa case).
//
// Usage : node scripts/meteo/cases.mjs [scripts/meteo/cases-france.json]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BASE_STEP_LAT, BASE_STEP_LON, METEO_FACTOR, STEP_LAT, STEP_LON, cellBox, cellId } from '../../src/meteoGrid.ts';

const sortie = process.argv[2] ?? new URL('./cases-france.json', import.meta.url).pathname;
const TYPE = 'ADMINEXPRESS-COG-CARTO-PE.LATEST:departement';
const url =
  'https://data.geopf.fr/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
  `&TYPENAMES=${TYPE}&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&COUNT=200`;
const ALTITUDE = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
const USER_AGENT = 'foret-explorer (liste des cases meteo)';
const SOUS = 9; // points testés par côté de case
const SOUS_CARRE = 5; // points testés par côté de carré de 4,5 km
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reponse = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
if (!reponse.ok) throw new Error(`WFS : HTTP ${reponse.status}`);
const fc = await reponse.json();
const metro = fc.features.filter((f) => !String(f.properties?.code_insee ?? '').startsWith('97'));
if (metro.length < 96) throw new Error(`${metro.length} départements métropolitains seulement (96 attendus)`);

// Polygones avec leur emprise ; ordre des coordonnées vérifié (lon, lat) sur le premier point.
const polygones = [];
for (const f of metro) {
  const g = f.geometry;
  for (const rings of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) {
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of rings[0]) [w, s, e, n] = [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)];
    polygones.push({ rings, w, s, e, n });
  }
}
const [x0, y0] = polygones[0].rings[0][0];
if (!(x0 > -6 && x0 < 10 && y0 > 41 && y0 < 52)) throw new Error(`coordonnées inattendues : ${x0}, ${y0} (lat/lon inversées ?)`);

const dedans = (rings, x, y) => {
  let hit = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xa, ya] = r[i];
      const [xb, yb] = r[j];
      if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) hit = !hit;
    }
  }
  return hit;
};
const terre = (x, y) => polygones.some((p) => x >= p.w && x <= p.e && y >= p.s && y <= p.n && dedans(p.rings, x, y));

/** Centre du rectangle s'il est sur le territoire, sinon le point du territoire le plus proche du centre parmi n × n. */
function pointTerre(south, west, dLat, dLon, n) {
  const lat0 = south + dLat / 2;
  const lon0 = west + dLon / 2;
  if (terre(lon0, lat0)) return [lat0, lon0];
  let choix = null;
  let meilleur = Infinity;
  for (let a = 0; a < n; a++) {
    for (let c = 0; c < n; c++) {
      const lat = south + ((a + 0.5) / n) * dLat;
      const lon = west + ((c + 0.5) / n) * dLon;
      const d = (lat - lat0) ** 2 + ((lon - lon0) * 0.7) ** 2;
      if (d < meilleur && terre(lon, lat)) [meilleur, choix] = [d, [lat, lon]];
    }
  }
  return choix;
}

// Points de relevé déjà choisis (fichier existant, même grille) : gardés.
const anciens = new Map();
if (existsSync(sortie)) {
  try {
    const ancien = JSON.parse(readFileSync(sortie, 'utf8'));
    if (Math.abs(ancien.pasLat - STEP_LAT) < 1e-9 && Math.abs(ancien.pasLon - STEP_LON) < 1e-9) {
      for (const [i, j, lat, lon] of ancien.cases) anciens.set(cellId(i, j), [lat, lon]);
    }
  } catch {
    /* fichier illisible : tout est recalculé */
  }
}

const cases = [];
/** Points dont il faut l'altitude : { c: indice de la case, k: indice du carré, lat, lon }. */
const demandes = [];
for (let i = Math.floor(41.2 / STEP_LAT); i <= Math.floor(51.2 / STEP_LAT); i++) {
  for (let j = Math.floor(-5.3 / STEP_LON); j <= Math.floor(9.7 / STEP_LON); j++) {
    const b = cellBox({ i, j });
    const choix = anciens.get(cellId(i, j)) ?? pointTerre(b.south, b.west, STEP_LAT, STEP_LON, SOUS);
    if (!choix) continue;
    const point = [+choix[0].toFixed(4), +choix[1].toFixed(4)];
    const c = cases.length;
    cases.push([i, j, point[0], point[1], Array(METEO_FACTOR * METEO_FACTOR).fill(null)]);
    let avecTerre = 0;
    for (let di = 0; di < METEO_FACTOR; di++) {
      for (let dj = 0; dj < METEO_FACTOR; dj++) {
        const south = (i * METEO_FACTOR + di) * BASE_STEP_LAT;
        const west = (j * METEO_FACTOR + dj) * BASE_STEP_LON;
        // Le carré qui contient le point de relevé a de la terre, même si ses 5 × 5 points la manquent.
        const contient = point[0] >= south && point[0] < south + BASE_STEP_LAT && point[1] >= west && point[1] < west + BASE_STEP_LON;
        const p = pointTerre(south, west, BASE_STEP_LAT, BASE_STEP_LON, SOUS_CARRE) ?? (contient ? point : null);
        if (!p) continue;
        avecTerre++;
        demandes.push({ c, k: di * METEO_FACTOR + dj, lat: p[0], lon: p[1] });
      }
    }
    if (!avecTerre) demandes.push({ c, k: 0, lat: point[0], lon: point[1] }); // ne devrait pas arriver
  }
}
console.log(`${cases.length} cases, ${anciens.size ? `${[...anciens.keys()].length} points de relevé repris, ` : ''}${demandes.length} carrés de 4,5 km avec de la terre.`);

// Altitudes par lots de 200 points (le service limite à 5 requêtes par seconde).
let inconnues = 0;
for (let start = 0; start < demandes.length; start += 200) {
  const lot = demandes.slice(start, start + 200);
  const u = new URL(ALTITUDE);
  u.searchParams.set('lon', lot.map((d) => d.lon.toFixed(5)).join('|'));
  u.searchParams.set('lat', lot.map((d) => d.lat.toFixed(5)).join('|'));
  u.searchParams.set('resource', 'ign_rge_alti_wld');
  u.searchParams.set('zonly', 'true');
  let valeurs = null;
  for (let essai = 1; !valeurs; essai++) {
    try {
      const r = await fetch(u, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data.elevations) || data.elevations.length !== lot.length) throw new Error('réponse incomplète');
      valeurs = data.elevations;
    } catch (e) {
      if (essai >= 5) throw new Error(`altitudes : ${e.message}`);
      await sleep(6000 * essai); // 429 : le service bloque 5 secondes
    }
  }
  lot.forEach((d, n) => {
    const z = typeof valeurs[n] === 'number' ? valeurs[n] : valeurs[n]?.z;
    // −99999 : hors couverture.
    if (typeof z === 'number' && z > -1000) cases[d.c][4][d.k] = Math.round(z);
    else inconnues++;
  });
  await sleep(300);
}
if (inconnues) console.log(`${inconnues} altitudes inconnues (hors couverture du RGE ALTI) : carrés laissés vides.`);

writeFileSync(
  sortie,
  `${JSON.stringify({
    v: 1,
    pasLat: STEP_LAT,
    pasLon: STEP_LON,
    source: `IGN, ADMIN EXPRESS COG CARTO (${TYPE}), ${metro.length} départements, et RGE ALTI (altitudes), ${new Date().toISOString().slice(0, 10)}`,
    // Par case : indices i et j, latitude et longitude du point de relevé, altitudes (m) de ses 16
    // carrés de 4,5 km (du sud au nord puis d'ouest en est ; null : pas de terre française).
    cases,
  })}\n`,
);
let [nombre, bas, haut] = [0, Infinity, -Infinity];
for (const c of cases) {
  for (const z of c[4]) {
    if (z === null) continue;
    nombre++;
    bas = Math.min(bas, z);
    haut = Math.max(haut, z);
  }
}
console.log(`${cases.length} cases de ${STEP_LAT}° × ${STEP_LON}° écrites dans ${sortie} ; ${nombre} carrés avec altitude, de ${bas} à ${haut} m.`);

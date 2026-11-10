// Écrit la liste des cases météo communes qui touchent la France métropolitaine (Corse comprise) et,
// pour chacune, le point où relever la météo : le centre de la case s'il est sur le territoire,
// sinon le point du territoire le plus proche du centre, parmi 9 × 9 points de la case.
//
// Départements : ADMIN EXPRESS COG CARTO (IGN, Licence Ouverte 2.0), WFS de la Géoplateforme (sans clé,
// sans CORS : à lancer en ligne de commande, pas dans le navigateur).
// À relancer seulement si la taille des cases change (src/meteoGrid.ts) ; le fichier est versionné.
//
// Usage : node scripts/meteo/cases.mjs [scripts/meteo/cases-france.json]
import { writeFileSync } from 'node:fs';
import { STEP_LAT, STEP_LON, cellBox } from '../../src/meteoGrid.ts';

const sortie = process.argv[2] ?? new URL('./cases-france.json', import.meta.url).pathname;
const TYPE = 'ADMINEXPRESS-COG-CARTO-PE.LATEST:departement';
const url =
  'https://data.geopf.fr/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
  `&TYPENAMES=${TYPE}&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&COUNT=200`;
const SOUS = 9; // points testés par côté de case

const reponse = await fetch(url, { headers: { 'user-agent': 'foret-explorer (liste des cases meteo)' } });
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

const cases = [];
for (let i = Math.floor(41.2 / STEP_LAT); i <= Math.floor(51.2 / STEP_LAT); i++) {
  for (let j = Math.floor(-5.3 / STEP_LON); j <= Math.floor(9.7 / STEP_LON); j++) {
    const b = cellBox({ i, j });
    let choix = terre(b.lon, b.lat) ? [b.lat, b.lon] : null;
    if (!choix) {
      let meilleur = Infinity;
      for (let a = 0; a < SOUS; a++) {
        for (let c = 0; c < SOUS; c++) {
          const lat = b.south + ((a + 0.5) / SOUS) * STEP_LAT;
          const lon = b.west + ((c + 0.5) / SOUS) * STEP_LON;
          const d = (lat - b.lat) ** 2 + ((lon - b.lon) * 0.7) ** 2;
          if (d < meilleur && terre(lon, lat)) [meilleur, choix] = [d, [lat, lon]];
        }
      }
    }
    if (choix) cases.push([i, j, +choix[0].toFixed(4), +choix[1].toFixed(4)]);
  }
}

writeFileSync(
  sortie,
  `${JSON.stringify({
    v: 1,
    pasLat: STEP_LAT,
    pasLon: STEP_LON,
    source: `IGN, ADMIN EXPRESS COG CARTO (${TYPE}), ${metro.length} départements, ${new Date().toISOString().slice(0, 10)}`,
    cases,
  })}\n`,
);
console.log(`${cases.length} cases de ${STEP_LAT}° × ${STEP_LON}° écrites dans ${sortie}.`);

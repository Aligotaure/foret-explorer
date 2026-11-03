// Sonde n°15 : nombre de cases météo nécessaires pour couvrir la France métropolitaine,
// selon leur taille (case retenue si un de ses 3 × 3 points tombe dans un département).
import { writeFileSync } from 'node:fs';
const WFS = 'https://data.geopf.fr/wfs';
const caps = await (await fetch(`${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities`)).text();
const names = [...caps.matchAll(/<(?:\w+:)?Name>([^<]*ADMINEXPRESS[^<]*)<\/(?:\w+:)?Name>/g)].map((m) => m[1]);
console.log('ADMIN EXPRESS :', names.filter((n) => /departement|region|pays/i.test(n)).join(', '));
const type = names.find((n) => /COG-CARTO.*LATEST.*:departement$/i.test(n)) ?? names.find((n) => /CARTO.*:departement$/i.test(n)) ?? names.find((n) => /:departement$/i.test(n));
console.log('type utilisé :', type);
const url = `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${type}&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&COUNT=200`;
const t0 = Date.now();
const fc = await (await fetch(url)).json();
const props0 = fc.features?.[0]?.properties ?? {};
console.log(`${fc.features?.length} départements en ${Date.now() - t0} ms ; champs : ${Object.keys(props0).join(', ')}`);
const metro = fc.features.filter((f) => !String(f.properties.code_insee ?? f.properties.insee_dep ?? f.properties.code ?? '').startsWith('97'));
console.log(`${metro.length} départements métropolitains`);
// GeoJSON en EPSG:4326 renvoyé en lon/lat ou lat/lon ? On teste sur Paris.
const polys = [];
for (const f of metro) {
  const g = f.geometry;
  const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const p of list) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [x, y] of p[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    polys.push({ rings: p, w, s, e, n });
  }
}
const sample = polys[0];
console.log('exemple de coordonnées :', JSON.stringify(sample.rings[0][0]));
const swap = Math.abs(sample.rings[0][0][0]) > 30; // lat en premier ?
const inside = (rings, x, y) => { let hit = false; for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xa, ya] = swap ? [r[i][1], r[i][0]] : r[i]; const [xb, yb] = swap ? [r[j][1], r[j][0]] : r[j]; if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) hit = !hit; } return hit; };
const box = (p) => (swap ? { w: p.s, e: p.n, s: p.w, n: p.e } : p);
const land = (x, y) => polys.some((p) => { const b = box(p); return x >= b.w && x <= b.e && y >= b.s && y <= b.n && inside(p.rings, x, y); });
const out = {};
for (const [dl, dg] of [[0.04, 0.056], [0.1, 0.14], [0.12, 0.168], [0.15, 0.21], [0.2, 0.28], [0.25, 0.35], [0.3, 0.42]]) {
  let count = 0;
  for (let i = Math.floor(41.2 / dl); i <= Math.floor(51.2 / dl); i++) {
    for (let j = Math.floor(-5.3 / dg); j <= Math.floor(9.7 / dg); j++) {
      let hit = false;
      for (const fy of [0.15, 0.5, 0.85]) for (const fx of [0.15, 0.5, 0.85]) if (!hit && land((j + fx) * dg, (i + fy) * dl)) hit = true;
      if (hit) count++;
    }
  }
  out[`${dl}x${dg}`] = count;
  console.log(`cases de ${dl}° × ${dg}° (≈ ${(dl * 111).toFixed(0)} km) : ${count}`);
}
writeFileSync('verif/masque.json', JSON.stringify({ type, cases: out }, null, 1));

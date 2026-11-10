#!/usr/bin/env node
// Ajoute la nature du sol (`sol`) à chaque formation géologique.
//
//   node classer.mjs entree.geojsonl sortie.geojsonl rapport.json
//
// Entrée : GeoJSONSeq (une entité par ligne) produit par ogr2ogr depuis S_FGEOL.
// Sortie : mêmes géométries, propriétés réduites à { sol, notation, descr } ; formations sans sol
// (eau, glace) et formations non classées retirées. Le rapport liste les surfaces par sol et les
// descriptions non classées, pour améliorer `regles.mjs`.
// Avec TABLE_DESCR=fichier.tsv, toutes les descriptions rencontrées sont ajoutées à ce fichier
// (surface en km², sol retenu, notation, description) : de quoi régler les règles sur toute la France.
import { appendFileSync, createReadStream, createWriteStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { classer } from './regles.mjs';

const [input, output, report] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage : node classer.mjs entree.geojsonl sortie.geojsonl [rapport.json]');
  process.exit(1);
}

/** Aire approximative (km²) d'une géométrie en degrés, pour le rapport. */
function areaKm2(geometry) {
  if (!geometry) return 0;
  const ring = (r) => {
    if (r.length < 3) return 0;
    const lat0 = (r.reduce((s, p) => s + p[1], 0) / r.length) * (Math.PI / 180);
    const kx = 111.32 * Math.cos(lat0);
    const ky = 110.57;
    let s = 0;
    for (let i = 0; i < r.length; i++) {
      const [x1, y1] = r[i];
      const [x2, y2] = r[(i + 1) % r.length];
      s += x1 * kx * (y2 * ky) - x2 * kx * (y1 * ky);
    }
    return Math.abs(s) / 2;
  };
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polygons.reduce((s, p) => s + ring(p[0]) - p.slice(1).reduce((h, r) => h + ring(r), 0), 0);
}

const stats = {};
const unclassified = {};
/** Toutes les descriptions : « notation | description » → { km2, sol }. */
const table = new Map();
const out = createWriteStream(output);
let total = 0;
let kept = 0;

const lines = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  total++;
  const feature = JSON.parse(line.replace(/^\x1e/, ''));
  const p = feature.properties ?? {};
  const descr = String(p.DESCR ?? p.descr ?? '').trim();
  const notation = String(p.NOTATION ?? p.notation ?? '').trim();
  const sol = classer(descr, notation);
  const area = areaKm2(feature.geometry);
  if (process.env.TABLE_DESCR) {
    const key = `${notation}\t${descr.replace(/\s+/g, ' ')}`;
    const row = table.get(key) ?? { km2: 0, sol: sol ?? '' };
    row.km2 += area;
    table.set(key, row);
  }
  if (!sol) {
    const key = `${notation} | ${descr}`;
    unclassified[key] = (unclassified[key] ?? 0) + area;
    continue;
  }
  kept++;
  const s = (stats[sol] ??= { polygones: 0, km2: 0, exemples: {} });
  s.polygones++;
  s.km2 += area;
  s.exemples[descr] = (s.exemples[descr] ?? 0) + area;
  feature.properties = { sol, notation, descr: descr.slice(0, 160) };
  delete feature.id;
  out.write(`${JSON.stringify(feature)}\n`);
}
out.end();

const round = (x) => Math.round(x * 10) / 10;
const summary = {
  formations: total,
  conservees: kept,
  sols: Object.fromEntries(
    Object.entries(stats)
      .sort((a, b) => b[1].km2 - a[1].km2)
      .map(([sol, s]) => [
        sol,
        {
          polygones: s.polygones,
          km2: round(s.km2),
          exemples: Object.entries(s.exemples)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([d, a]) => `${round(a)} km² — ${d.slice(0, 120)}`),
        },
      ]),
  ),
  nonClassees: Object.entries(unclassified)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([d, a]) => `${round(a)} km² — ${d.slice(0, 140)}`),
};
if (report) writeFileSync(report, JSON.stringify(summary, null, 2));
if (process.env.TABLE_DESCR) {
  appendFileSync(process.env.TABLE_DESCR, [...table].map(([key, row]) => `${row.km2.toFixed(2)}\t${row.sol}\t${key}\n`).join(''));
}
console.log(`${kept}/${total} formations classées`);
for (const [sol, s] of Object.entries(summary.sols)) console.log(`  ${sol.padEnd(10)} ${String(s.km2).padStart(8)} km²  ${s.polygones} polygones`);

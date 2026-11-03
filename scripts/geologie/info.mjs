#!/usr/bin/env node
// Écrit public/data/geologie/info.json : provenance, date, emprise, départements couverts et
// manquants (variable MANQUANTS), surfaces par nature de sol.
//
//   MANQUANTS="059 062" node info.mjs <dossier des tuiles> <dossier de travail> <départements…>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [sortie, travail, ...departements] = process.argv.slice(2);
if (!sortie || !travail) {
  console.error('usage : node info.mjs <tuiles> <travail> <départements…>');
  process.exit(1);
}

// metadata.json est écrit par le pilote MVT de GDAL (bounds = "ouest,sud,est,nord").
const meta = existsSync(join(sortie, 'metadata.json')) ? JSON.parse(readFileSync(join(sortie, 'metadata.json'), 'utf8')) : {};
const bounds = String(meta.bounds ?? '')
  .split(',')
  .map(Number)
  .filter(Number.isFinite);

const surfaces = {};
for (const d of departements) {
  const fichier = join(travail, `rapport-${d}.json`);
  if (!existsSync(fichier)) continue;
  const rapport = JSON.parse(readFileSync(fichier, 'utf8'));
  for (const [sol, s] of Object.entries(rapport.sols ?? {})) surfaces[sol] = Math.round((surfaces[sol] ?? 0) + s.km2);
}

const info = {
  source: 'BRGM, cartes géologiques harmonisées au 1/50 000 (BD Charm-50, 2019), Licence Ouverte 2.0',
  departements,
  manquants: (process.env.MANQUANTS ?? '').split(/\s+/).filter(Boolean),
  genere: new Date().toISOString().slice(0, 10),
  bounds: bounds.length === 4 ? bounds : null,
  minzoom: Number(meta.minzoom ?? 9),
  maxzoom: Number(meta.maxzoom ?? 12),
  couche: 'geologie',
  surfacesKm2: surfaces,
};
writeFileSync(join(sortie, 'info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`info.json : ${departements.length} départements, ${info.manquants.length} manquants, emprise ${info.bounds?.join(', ') ?? 'inconnue'}`);

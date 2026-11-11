#!/usr/bin/env node
// Écrit public/data/geologie/info.json : provenance, date, emprise et zooms (lus dans l'en-tête de
// geologie.pmtiles), départements couverts et manquants (variable MANQUANTS), surfaces par nature de sol.
//
//   MANQUANTS="059_062" node info.mjs <dossier de l'archive> <dossier de travail> <archives traitées…>
// Une archive du BRGM regroupée (« 059_062 ») compte pour chacun de ses départements.
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [sortie, travail, ...archives] = process.argv.slice(2);
if (!sortie || !travail) {
  console.error('usage : node info.mjs <tuiles> <travail> <archives traitées…>');
  process.exit(1);
}
const codes = (names) => names.flatMap((a) => a.split('_')).filter(Boolean).sort();
const departements = codes(archives);

// En-tête d'une archive PMTiles (version 3) : 127 octets, zooms aux octets 100 et 101, emprise en
// dix-millionièmes de degré à partir de l'octet 102, nombre de tuiles à l'octet 72.
const fichier = join(sortie, 'geologie.pmtiles');
const entete = Buffer.alloc(127);
const fd = openSync(fichier, 'r');
readSync(fd, entete, 0, 127, 0);
closeSync(fd);
if (entete.toString('latin1', 0, 7) !== 'PMTiles' || entete[7] !== 3) {
  console.error(`${fichier} n'est pas une archive PMTiles version 3.`);
  process.exit(1);
}
const degres = (offset) => entete.readInt32LE(offset) / 1e7;
const bounds = [degres(102), degres(106), degres(110), degres(114)];

const surfaces = {};
let formations = 0;
let classees = 0;
for (const f of readdirSync(travail).filter((name) => /^rapport-.*\.json$/.test(name))) {
  const rapport = JSON.parse(readFileSync(join(travail, f), 'utf8'));
  formations += rapport.formations ?? 0;
  classees += rapport.conservees ?? 0;
  for (const [sol, s] of Object.entries(rapport.sols ?? {})) surfaces[sol] = Math.round((surfaces[sol] ?? 0) + s.km2);
}

const info = {
  source: 'BRGM, cartes géologiques harmonisées au 1/50 000 (BD Charm-50, 2019), Licence Ouverte 2.0',
  departements,
  manquants: codes((process.env.MANQUANTS ?? '').split(/\s+/)),
  formations,
  classees,
  genere: new Date().toISOString().slice(0, 10),
  bounds,
  minzoom: entete[100],
  maxzoom: entete[101],
  couche: 'geologie',
  archive: { fichier: 'geologie.pmtiles', octets: statSync(fichier).size, tuiles: Number(entete.readBigUInt64LE(72)) },
  surfacesKm2: surfaces,
};
writeFileSync(join(sortie, 'info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(
  `info.json : ${departements.length} départements, ${info.manquants.length} manquants, zooms ${info.minzoom} à ${info.maxzoom}, ` +
    `${info.archive.tuiles} tuiles, ${Math.round(info.archive.octets / 1e6)} Mo, emprise ${bounds.join(', ')}`,
);

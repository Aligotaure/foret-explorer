// Reprend les fichiers « coupes datées » du site en ligne (index, puis chaque bloc qu'il cite) quand
// le cache de la publication est perdu : rien à recalculer, rien à demander à Zenodo. Tout est
// téléchargé et vérifié avant d'être écrit ; au moindre manque, rien n'est écrit et le script échoue
// (deploy.yml refait alors les fichiers). Un index sans bloc (celui que la publication écrit faute de
// mieux) ne compte pas.
//
// Usage : node scripts/coupes/reprendre.mjs <adresse de base, « / » final compris> <dossier de sortie>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORMAT } from './coupes.mjs';

const [base, sortie] = process.argv.slice(2);
if (!base || !sortie) throw new Error('usage : reprendre.mjs <adresse de base> <dossier>');

async function lire(adresse) {
  const reponse = await fetch(adresse, { signal: AbortSignal.timeout(120_000) });
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status} pour ${adresse}`);
  return reponse.json();
}

const index = await lire(`${base}index.json`);
if (index?.v !== FORMAT || !Array.isArray(index.blocs) || !index.blocs.length || !Number.isFinite(Date.parse(index.genere))) {
  throw new Error('pas de fichiers de coupes sur le site en ligne (index absent, vide ou d’un autre format)');
}
const blocs = [];
for (const id of index.blocs) {
  if (!/^-?\d+_-?\d+$/.test(id)) throw new Error(`nom de bloc inattendu : ${id}`);
  const bloc = await lire(`${base}b/${id}.json`);
  if (bloc?.v !== FORMAT || typeof bloc.cases !== 'object' || bloc.cases === null) throw new Error(`bloc ${id} illisible`);
  blocs.push([id, bloc]);
}
rmSync(sortie, { recursive: true, force: true });
mkdirSync(join(sortie, 'b'), { recursive: true });
for (const [id, bloc] of blocs) writeFileSync(join(sortie, 'b', `${id}.json`), JSON.stringify(bloc));
writeFileSync(join(sortie, 'index.json'), JSON.stringify(index));
console.log(`Coupes datées reprises du site en ligne : ${blocs.length} blocs, faites le ${index.genere.slice(0, 10)} (atlas ${index.atlas}).`);

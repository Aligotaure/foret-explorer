// Écrit les fichiers « coupes et dégâts datés » lus par la carte (src/cuts.ts) : pour chaque carré de
// 500 m, lesquels de ses neuf points sont sur une forêt coupée, brûlée ou abattue depuis moins de
// 10 ans, ou depuis 10 à 20 ans. Voir coupes.mjs pour le format, docs/donnees.md pour les mesures.
//
// Source : European Forest Disturbance Atlas (Viana-Soto, Senf et al.), publié sur Zenodo sous
// licence CC BY 4.0. Seule la couche « année de la dernière perturbation » de la France est
// téléchargée (≈ 49 Mo sur une archive de 5,2 Go : sa position est lue dans la table des matières
// de l'archive, puis demandée par plage d'octets). Aucune dépendance. Une à deux minutes.
//
// À relancer une fois par an (une version de l'atlas par an environ ; deploy.yml s'en charge), ou si
// la grille change (src/meteoGrid.ts, src/fineGrid.ts, public/foret/parts.json).
//
// Usage : node scripts/coupes/construire.mjs [--sortie public/data/coupes] [--parts public/foret/parts.json]
//         [--cache .cache/coupes] [--annee 2026]
//         [--image latest_disturbance_france.tif]   (image déjà sur place : rien n'est téléchargé)
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fabriquer, lecteur } from './coupes.mjs';
import { ouvrir } from './tiff.mjs';
import { extraire, lister } from './zip.mjs';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const option = (nom, defaut) => {
  const k = process.argv.indexOf(`--${nom}`);
  return k > 0 && process.argv[k + 1] ? process.argv[k + 1] : defaut;
};
const SORTIE = option('sortie', join(RACINE, 'public/data/coupes'));
const PARTS = option('parts', join(RACINE, 'public/foret/parts.json'));
const CACHE = option('cache', join(RACINE, '.cache/coupes'));
const ANNEE = Number(option('annee', new Date().getUTCFullYear()));
const IMAGE = option('image', null);

/** Une version quelconque de l'atlas : Zenodo en déduit la plus récente. */
const DERNIERE_VERSION = 'https://zenodo.org/api/records/21722408/versions/latest';
const ARCHIVE = 'France.zip';
const COUCHE = /^latest_disturbance_france_v\d+\.tif$/;
async function demander(url, entetes = {}) {
  let erreur;
  for (let essai = 1; essai <= 4; essai++) {
    try {
      const reponse = await fetch(url, { headers: entetes, signal: AbortSignal.timeout(600_000) });
      if (reponse.ok) return reponse;
      erreur = new Error(`HTTP ${reponse.status} pour ${url}`);
      if (reponse.status < 500 && reponse.status !== 429) break;
    } catch (e) {
      erreur = e;
    }
    await new Promise((suite) => setTimeout(suite, 5000 * essai));
  }
  throw erreur;
}

/** Télécharge la couche de la dernière version de l'atlas (ou la reprend du cache) ; rend son chemin et sa version. */
async function telecharger() {
  const fiche = await (await demander(DERNIERE_VERSION)).json();
  const version = String(fiche.metadata?.version ?? fiche.id);
  const archive = fiche.files?.find((f) => f.key === ARCHIVE);
  if (!archive?.links?.self || !archive.size) throw new Error(`atlas ${version} : ${ARCHIVE} introuvable dans la fiche Zenodo`);
  const lirePlage = async (debut, fin) => {
    const reponse = await demander(archive.links.self, { Range: `bytes=${debut}-${fin}` });
    const octets = Buffer.from(await reponse.arrayBuffer());
    if (reponse.status !== 206 || octets.length !== fin - debut + 1) throw new Error(`plage ${debut}-${fin} refusée (HTTP ${reponse.status}, ${octets.length} octets)`);
    return octets;
  };
  const entree = (await lister(lirePlage, archive.size)).find((e) => COUCHE.test(e.nom));
  if (!entree) throw new Error(`atlas ${version} : aucune couche ${COUCHE} dans ${ARCHIVE}`);
  mkdirSync(CACHE, { recursive: true });
  const chemin = join(CACHE, `${version}-${entree.crc}-${entree.nom}`);
  if (existsSync(chemin) && statSync(chemin).size === entree.taille) {
    console.log(`Atlas ${version} : ${entree.nom} déjà en cache.`);
  } else {
    console.log(`Atlas ${version} : téléchargement de ${entree.nom} (${Math.round(entree.compresse / 1e6)} Mo)…`);
    writeFileSync(chemin, await extraire(lirePlage, entree));
  }
  return { chemin, version };
}

const debut = Date.now();
const { chemin, version } = IMAGE ? { chemin: IMAGE, version: 'image locale' } : await telecharger();
const parts = JSON.parse(readFileSync(PARTS, 'utf8'));
const { index, blocs } = fabriquer({
  annee: lecteur(ouvrir(chemin)).annee,
  parts,
  anneeDeFabrication: ANNEE,
  atlas: version,
  genere: new Date().toISOString(),
});
if (!index.blocs.length) throw new Error('aucun point daté : image vide ou hors de France ?');

// On n'efface l'ancienne version qu'une fois la nouvelle calculée.
rmSync(join(SORTIE, 'b'), { recursive: true, force: true });
mkdirSync(join(SORTIE, 'b'), { recursive: true });
let octets = 0;
for (const [bloc, cases] of blocs) {
  const texte = JSON.stringify({ v: index.v, cases });
  octets += texte.length;
  writeFileSync(join(SORTIE, 'b', `${bloc}.json`), texte);
}
writeFileSync(join(SORTIE, 'index.json'), JSON.stringify(index));
console.log(
  `Coupes datées (atlas ${version}, jusqu'en ${index.dernierAn}) : ${index.blocs.length} blocs, ${Math.round(octets / 1024)} Ko avant compression ; ` +
    `${index.carres} carrés de 500 m lus, ${index.touches.recents} touchés depuis ${index.depuis}, ${index.touches.jeunes} de ${index.jeune[0]} à ${index.jeune[1]} ; ` +
    `${((Date.now() - debut) / 1000).toFixed(0)} s.`,
);

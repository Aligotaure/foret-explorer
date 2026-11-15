#!/usr/bin/env node
/**
 * Moyennes de France par champignon → `data/meteo/france.json` (le chiffre des puces, voir
 * src/franceStats.ts). Lancé à chaque publication du site (deploy.yml), une fois les fichiers météo
 * en place :
 *
 *   node scripts/meteo/france.mjs --meteo public/data/meteo --parts public/foret/parts.json \
 *     --sortie public/data/meteo/france.json
 *
 * Le calcul est celui de la carte : ce script n'en recopie rien, il fabrique avec Vite (déjà une
 * dépendance du projet) une version de `src/franceStats.ts` lisible par Node, dans `.cache/france/`,
 * puis l'appelle. En local, sans fichiers météo : les télécharger d'abord depuis le site en ligne,
 * avec `--amorce https://aligotaure.github.io/foret-explorer/data/meteo/` (dans `--meteo`).
 *
 * Il ne doit jamais bloquer la publication : son étape est en `continue-on-error`, et sans fichier
 * les puces n'affichent simplement pas de chiffre.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const k = args.indexOf(`--${name}`);
  return k >= 0 && args[k + 1] ? args[k + 1] : fallback;
};
const meteo = resolve(option('meteo', join(ROOT, 'public/data/meteo')));
const parts = resolve(option('parts', join(ROOT, 'public/foret/parts.json')));
const sortie = resolve(option('sortie', join(meteo, 'france.json')));
const amorce = option('amorce', '');
/** Jour du calcul (AAAA-MM-JJ), pour les tests ; sinon aujourd'hui, à l'heure de Paris. */
const jour = option('jour', '');

const lire = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Copie l'index et les blocs du site en ligne dans `--meteo` (essai en local). */
async function amorcer(base) {
  const get = async (name) => {
    const response = await fetch(new URL(name, base));
    if (!response.ok) throw new Error(`${name} : HTTP ${response.status}`);
    return response.text();
  };
  mkdirSync(join(meteo, 'b'), { recursive: true });
  const index = await get('index.json');
  writeFileSync(join(meteo, 'index.json'), index);
  for (const id of JSON.parse(index).blocs) writeFileSync(join(meteo, 'b', `${id}.json`), await get(`b/${id}.json`));
}

if (amorce) await amorcer(amorce.endsWith('/') ? amorce : `${amorce}/`);

// Le code de la carte, pour Node. (`configFile: false` : sans les réglages du site, faits pour ses pages.)
const outDir = join(ROOT, '.cache/france');
await build({
  root: ROOT,
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: 'src/franceStats.ts',
    outDir,
    emptyOutDir: true,
    copyPublicDir: false,
    rollupOptions: { output: { entryFileNames: 'franceStats.mjs' } },
  },
});
const code = await import(pathToFileURL(join(outDir, 'franceStats.mjs')).href);

const index = lire(join(meteo, 'index.json'));
if (!code.useForestShare(lire(parts))) throw new Error(`${parts} : format ou grille inattendus`);
const blocks = index.blocs.map((id) => lire(join(meteo, 'b', `${id}.json`)));
const stats = code.franceAverages(blocks, jour || code.statsDay());
const file = { v: code.FRANCE_STATS_FORMAT, maj: index.maj, jour: index.dernierJour, ...stats };
mkdirSync(dirname(sortie), { recursive: true });
writeFileSync(sortie, `${JSON.stringify(file)}\n`);

const lignes = Object.entries(stats.moyennes).map(([id, p]) => `${id} ${p} % (${stats.carres[id]} carrés)`);
console.log(`Moyennes de France (météo du ${index.dernierJour}, mois ${stats.mois}) : ${lignes.join(' · ') || 'aucun champignon de saison'}`);
console.log(`→ ${sortie}`);

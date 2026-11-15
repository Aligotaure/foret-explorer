// Moyennes de France par champignon (scripts/meteo/france.mjs, src/franceStats.ts) : le script de la
// publication, joué sur des fichiers météo fabriqués ici pour toutes les cases du fichier des parts de
// forêt. Sans réseau ; il lui faut Vite (dépendance du projet) :
//   npm run test:france
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const racine = fileURLToPath(new URL('..', import.meta.url));
const parts = JSON.parse(readFileSync(join(racine, 'public/foret/parts.json'), 'utf8'));
const cases = Object.keys(parts.cases);
const carresAvecTerre = Object.values(parts.cases).reduce((n, squares) => n + squares.filter(Boolean).length, 0);

const jourAvant = (jour, k) => new Date(Date.parse(`${jour}T00:00:00Z`) - k * 86_400_000).toISOString().slice(0, 10);
const BLOC = 8;

/**
 * Fichiers météo dans `dossier` pour toutes les cases du fichier des parts `fichier`, les 31 jours
 * finissant à `jour` : une grosse pluie il y a `pluieIlYA` jours (aucune si négatif), 14 °C le jour
 * et 8 °C la nuit au point de relevé (500 m), toutes les cases pareilles, leurs seize carrés à
 * `altitude` (null là où le fichier des parts n'a pas de terre).
 */
function fabriquer(dossier, jour, pluieIlYA, fichier = parts, altitude = 500) {
  const cases = Object.keys(fichier.cases);
  mkdirSync(join(dossier, 'b'), { recursive: true });
  const dates = Array.from({ length: 31 }, (_, k) => jourAvant(jour, 30 - k));
  const pluie = dates.map((_, k) => (30 - k === pluieIlYA ? 40 : pluieIlYA >= 0 && 30 - k === pluieIlYA + 2 ? 20 : 0));
  const blocs = new Map();
  for (const id of cases) {
    const [i, j] = id.split(':').map(Number);
    const bloc = `${Math.floor(i / BLOC)}_${Math.floor(j / BLOC)}`;
    if (!blocs.has(bloc)) blocs.set(bloc, {});
    blocs.get(bloc)[id] = {
      lat: 0,
      lon: 0,
      z: 500,
      c: jour,
      f: jourAvant(jour, 1),
      m: jour,
      p: pluie,
      x: dates.map(() => 14),
      n: dates.map(() => 8),
      a: fichier.cases[id].map((square) => (square ? altitude : null)),
    };
  }
  for (const [bloc, cells] of blocs) writeFileSync(join(dossier, 'b', `${bloc}.json`), JSON.stringify({ v: 1, dates, cells }));
  const index = { v: 1, pasLat: 0.16, pasLon: 0.224, bloc: BLOC, jours: 30, dernierJour: jourAvant(jour, 1), maj: `${jour}T01:40:00.000Z`, cases: cases.length, aJour: cases.length, blocs: [...blocs.keys()], source: 'essai' };
  writeFileSync(join(dossier, 'index.json'), JSON.stringify(index));
  return index;
}

/** `fichier` : un autre fichier des parts que celui du dépôt (essai) ; `altitude` : celle des carrés. */
function calculer(jour, pluieIlYA, { fichier = null, altitude = 500 } = {}) {
  const dossier = mkdtempSync(join(tmpdir(), 'france-'));
  try {
    const index = fabriquer(dossier, jour, pluieIlYA, fichier ?? parts, altitude);
    const sortie = join(dossier, 'france.json');
    let chemin = join(racine, 'public/foret/parts.json');
    if (fichier) {
      chemin = join(dossier, 'parts.json');
      writeFileSync(chemin, JSON.stringify(fichier));
    }
    const journal = execFileSync(process.execPath, [join(racine, 'scripts/meteo/france.mjs'), '--meteo', dossier, '--parts', chemin, '--sortie', sortie, '--jour', jour], { encoding: 'utf8' });
    return { index, journal, file: JSON.parse(readFileSync(sortie, 'utf8')), octets: readFileSync(sortie).length };
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

// ── Octobre, grosse pluie il y a 9 jours : pleine saison pour quatre champignons, pas pour les morilles.
const octobre = calculer('2026-10-20', 9);
const m = octobre.file.moyennes;
const n = octobre.file.carres;
check(
  'fichier publié : format, jour et mise à jour repris de l’index météo, mois du calcul, quelques centaines d’octets',
  octobre.file.v === 1 && octobre.file.jour === octobre.index.dernierJour && octobre.file.maj === octobre.index.maj && octobre.file.mois === 10 && octobre.octets < 400,
  `${octobre.octets} octets : ${JSON.stringify(octobre.file)}`,
);
check(
  'octobre : une moyenne pour les quatre champignons de saison, aucune pour les morilles (hors saison)',
  ['cepe', 'girolle', 'trompette', 'chanterelle'].every((id) => Number.isInteger(m[id]) && m[id] > 0 && m[id] <= 95) && !('morille' in m) && !('morille' in n),
  JSON.stringify(m),
);
check(
  'seuls les carrés où le champignon peut pousser sont comptés (arbres hôtes, hors villes) : moins que les carrés de France, et moins encore pour les chanterelles en tube',
  n.cepe > 10_000 && n.cepe < carresAvecTerre && n.chanterelle > 1_000 && n.chanterelle < n.cepe,
  `${carresAvecTerre} carrés avec de la terre ; comptés : ${JSON.stringify(n)}`,
);
check('le journal de la publication dit ce qui a été calculé', /Moyennes de France \(météo du 2026-10-19, mois 10\) : cepe \d+ %/.test(octobre.journal), octobre.journal.split('\n')[0]);

// ── Même mois, pas une goutte en 30 jours : la moyenne tombe à zéro, les carrés comptés sont les mêmes.
const sec = calculer('2026-10-20', -1);
check(
  'temps sec partout : moyennes à 0 %, mêmes carrés comptés',
  ['cepe', 'girolle', 'trompette', 'chanterelle'].every((id) => sec.file.moyennes[id] === 0 && sec.file.carres[id] === n[id]),
  JSON.stringify(sec.file.moyennes),
);

// ── Avril, même pluie : les morilles ont leur moyenne, les cèpes (hors saison) n'en ont pas.
const avril = calculer('2026-04-20', 9);
check(
  'avril : les saisons suivent le mois du calcul (morilles oui, cèpes non)',
  avril.file.mois === 4 && avril.file.moyennes.morille > 0 && !('cepe' in avril.file.moyennes),
  JSON.stringify(avril.file.moyennes),
);

// ── L'altitude de chaque carré compte : les mêmes fichiers, carrés à 2 500 m au lieu de 500 m
// (16 °C et 13 °C de moins : gel). Un calcul qui prendrait l'altitude du point de relevé pour tous
// les carrés rendrait les mêmes moyennes dans les deux cas.
const haut = calculer('2026-10-20', 9, { altitude: 2500 });
check(
  'altitude des carrés : à 2 500 m les moyennes s’effondrent (températures ramenées à l’altitude de chaque carré), mêmes carrés comptés',
  ['cepe', 'girolle', 'trompette', 'chanterelle'].every((id) => haut.file.moyennes[id] < m[id] / 2 && haut.file.carres[id] === n[id]),
  `500 m : ${JSON.stringify(m)} ; 2 500 m : ${JSON.stringify(haut.file.moyennes)}`,
);

// ── La qualité des arbres hôtes compte : deux cases d'essai, tous leurs carrés couverts à 100 % par
// des chênes décidus (hôte typique des cèpes, poids 1) ou par des chênes sempervirents (poids 0,6).
// Un calcul qui tiendrait tous les hôtes pour parfaits rendrait la même moyenne dans les deux cas.
const essai = (code) => {
  const deux = cases.slice(0, 2);
  return { v: 1, pasLat: parts.pasLat, pasLon: parts.pasLon, codes: [code], cases: Object.fromEntries(deux.map((id) => [id, Array.from({ length: 16 }, () => [0, 100])])), bati: Object.fromEntries(deux.map((id) => [id, Array(16).fill(0)])) };
};
const typique = calculer('2026-10-20', 9, { fichier: essai('FF1G01-01') });
const moinsBon = calculer('2026-10-20', 9, { fichier: essai('FF1G06-06') });
check(
  'qualité des hôtes : sous des chênes sempervirents (poids 0,6) la moyenne des cèpes est plus basse que sous des chênes décidus (poids 1), à météo égale',
  typique.file.carres.cepe === 32 && moinsBon.file.carres.cepe === 32 && moinsBon.file.moyennes.cepe < typique.file.moyennes.cepe - 5 && moinsBon.file.moyennes.cepe > 0,
  `chênes décidus : ${typique.file.moyennes.cepe} % ; chênes sempervirents : ${moinsBon.file.moyennes.cepe} % (${typique.file.carres.cepe} carrés)`,
);
// Meilleure forêt du carré (15/11/2026) : 60 % de chênes sempervirents (poids 0,6) et 5 % de chênes
// décidus (poids 1) valent comme une chênaie décidue pure ; avec 1 % de décidus seulement (sous le
// seuil de 2 %), comme des sempervirents purs. Un calcul à la moyenne des hôtes (0,63 et 0,61)
// rendrait deux chiffres intermédiaires.
const melange = (partDuMeilleur) => {
  const deux = cases.slice(0, 2);
  return { v: 1, pasLat: parts.pasLat, pasLon: parts.pasLon, codes: ['FF1G06-06', 'FF1G01-01'], cases: Object.fromEntries(deux.map((id) => [id, Array.from({ length: 16 }, () => [0, 60, 1, partDuMeilleur])])), bati: Object.fromEntries(deux.map((id) => [id, Array(16).fill(0)])) };
};
const avecBonneForet = calculer('2026-10-20', 9, { fichier: melange(5) });
const presqueSans = calculer('2026-10-20', 9, { fichier: melange(1) });
check(
  'meilleure forêt du carré : 5 % de chênes décidus parmi 60 % de sempervirents valent une chênaie décidue pure ; 1 % (sous le seuil de 2 %) ne compte pas',
  avecBonneForet.file.carres.cepe === 32 && avecBonneForet.file.moyennes.cepe === typique.file.moyennes.cepe && presqueSans.file.moyennes.cepe === moinsBon.file.moyennes.cepe && typique.file.moyennes.cepe > moinsBon.file.moyennes.cepe,
  `5 % de décidus : ${avecBonneForet.file.moyennes.cepe} % (chênaie décidue pure : ${typique.file.moyennes.cepe} %) ; 1 % : ${presqueSans.file.moyennes.cepe} % (sempervirents purs : ${moinsBon.file.moyennes.cepe} %)`,
);
// Une ville : mêmes carrés boisés à 100 %, mais bâtis à 15 % : aucun n'est compté, pas de moyenne.
const ville = essai('FF1G01-01');
for (const id of Object.keys(ville.bati)) ville.bati[id] = Array(16).fill(15);
const urbain = calculer('2026-10-20', 9, { fichier: ville });
check('carrés bâtis à 15 % ou plus : aucun n’est compté, le champignon n’a pas de moyenne', !('cepe' in urbain.file.moyennes) && !('cepe' in urbain.file.carres), JSON.stringify(urbain.file));

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications OK`);
process.exit(failed ? 1 : 0);

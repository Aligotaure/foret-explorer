// Moyennes de France par champignon (scripts/meteo/france.mjs, src/franceStats.ts) : le script de la
// publication, joué sur des fichiers météo fabriqués ici pour toutes les cases du fichier des parts de
// forêt. Puis la règle qui relie les échelles (src/fineRule.ts, src/forestShare.ts) : un carré de
// 4,5 km annonce ce que son meilleur carré de 500 m montrera, et le fichier versionné a été calculé
// avec les règles du code. Sans réseau ; il lui faut Vite (dépendance du projet) :
//   npm run test:france
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const racine = fileURLToPath(new URL('..', import.meta.url));
const parts = JSON.parse(readFileSync(join(racine, 'public/foret/parts.json'), 'utf8'));
const cases = Object.keys(parts.fin);
const carresAvecTerre = Object.values(parts.fin).reduce((n, squares) => n + squares.filter((square) => square !== null).length, 0);

const jourAvant = (jour, k) => new Date(Date.parse(`${jour}T00:00:00Z`) - k * 86_400_000).toISOString().slice(0, 10);
const BLOC = 8;

/**
 * Fichiers météo dans `dossier` pour toutes les cases du fichier des parts `fichier`, les 31 jours
 * finissant à `jour` : une grosse pluie il y a `pluieIlYA` jours (aucune si négatif), 14 °C le jour
 * et 8 °C la nuit au point de relevé (500 m), toutes les cases pareilles, leurs seize carrés à
 * `altitude` (null là où le fichier des parts n'a pas de terre).
 */
function fabriquer(dossier, jour, pluieIlYA, fichier = parts, altitude = 500) {
  const cases = Object.keys(fichier.fin);
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
      a: fichier.fin[id].map((square) => (square !== null ? altitude : null)),
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
  'seuls les carrés que la carte allume sont comptés (un carré de 500 m à dessiner au moins) : moins que les carrés de France, et moins encore pour les chanterelles en tube',
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

// ── Ce que vaut le meilleur carré de 500 m compte : deux cases d'essai, dans chacun de leurs carrés
// 40 carrés de 500 m à dessiner pour les cèpes, dont le meilleur vaut 1 (hêtraie sur bon sol) ou 0,6.
// Un calcul qui tiendrait tous les carrés pour parfaits rendrait la même moyenne dans les deux cas.
const rangCepe = parts.champignons.indexOf('cepe');
const essai = (carre) => {
  const deux = cases.slice(0, 2);
  return { v: 2, pasLat: parts.pasLat, pasLon: parts.pasLon, champignons: parts.champignons, fin: Object.fromEntries(deux.map((id) => [id, Array.from({ length: 16 }, () => carre)])), bati: Object.fromEntries(deux.map((id) => [id, Array(16).fill(0)])) };
};
const pourCepes = (nombre, meilleur) => parts.champignons.flatMap((_, k) => (k === rangCepe ? [nombre, meilleur] : [0, 0]));
const typique = calculer('2026-10-20', 9, { fichier: essai(pourCepes(40, 1000)) });
const moinsBon = calculer('2026-10-20', 9, { fichier: essai(pourCepes(40, 600)) });
check(
  'meilleur carré de 500 m : s’il vaut 0,6 (arbres × sol) la moyenne des cèpes est plus basse que s’il vaut 1, à météo égale',
  typique.file.carres.cepe === 32 && moinsBon.file.carres.cepe === 32 && moinsBon.file.moyennes.cepe < typique.file.moyennes.cepe - 5 && moinsBon.file.moyennes.cepe > 0,
  `meilleur à 1 : ${typique.file.moyennes.cepe} % ; à 0,6 : ${moinsBon.file.moyennes.cepe} % (${typique.file.carres.cepe} carrés)`,
);
// Un seul carré de 500 m à dessiner suffit à compter le carré (c'est lui que la carte allume), et le
// nombre ne change pas le pourcentage : c'est celui du meilleur.
const unSeul = calculer('2026-10-20', 9, { fichier: essai(pourCepes(1, 1000)) });
check(
  'un seul carré de 500 m à dessiner : le carré de 4,5 km est compté, au même pourcentage que s’il en avait quarante',
  unSeul.file.carres.cepe === 32 && unSeul.file.moyennes.cepe === typique.file.moyennes.cepe,
  `un seul : ${unSeul.file.moyennes.cepe} % ; quarante : ${typique.file.moyennes.cepe} %`,
);
// Rien à dessiner (plaine sans arbres hôtes, ou ville dont aucun bois ne tient à un massif) : pas compté.
const vide = calculer('2026-10-20', 9, { fichier: essai(0) });
check('carrés sans rien à dessiner : aucun n’est compté, le champignon n’a pas de moyenne', !('cepe' in vide.file.moyennes) && !('cepe' in vide.file.carres), JSON.stringify(vide.file));

// ── La règle qui relie les échelles ─────────────────────────────────────────────────────────────
// Le code de la carte, pour Node (comme le font les scripts) : la règle des carrés de 500 m, le
// format du fichier, l'indice et la météo. Une seule fabrication : les modules se partagent.
const dossierCode = mkdtempSync(join(tmpdir(), 'regle-'));
let regle;
try {
  const entree = (nom) => join(racine, 'src', `${nom}.ts`);
  await build({
    root: racine,
    configFile: false,
    logLevel: 'warn',
    build: {
      ssr: true,
      outDir: dossierCode,
      emptyOutDir: true,
      copyPublicDir: false,
      rollupOptions: {
        input: { fineRule: entree('fineRule'), forestShare: entree('forestShare'), mushrooms: entree('mushrooms'), weather: entree('weather') },
        output: { entryFileNames: '[name].mjs', chunkFileNames: 'morceaux/[name]-[hash].mjs' },
      },
    },
  });
  const charger = (nom) => import(pathToFileURL(join(dossierCode, `${nom}.mjs`)).href);
  regle = { ...(await charger('fineRule')), ...(await charger('forestShare')), ...(await charger('mushrooms')), ...(await charger('weather')) };
} finally {
  rmSync(dossierCode, { recursive: true, force: true });
}
const { MUSHROOMS, surveySquare, fineFactors, packSquare, rulesSignature, useForestShare, hostCover, isLit, scoreMushroom, squareScore, weatherCeiling, chanceOf, noEstimate, parseBlock, summarize, summaryAtAltitude, temperaturesAt } = regle;

check(
  'fichier versionné : calculé avec les règles du code (arbres hôtes, sols, seuils des carrés de 500 m). Sinon, le refaire : node scripts/foret/parts.mjs',
  parts.regles === rulesSignature(),
  `fichier ${parts.regles}, code ${rulesSignature()}`,
);
check('fichier versionné : les champignons du code, dans le même ordre', JSON.stringify(parts.champignons) === JSON.stringify(MUSHROOMS.map((m) => m.id)), parts.champignons.join(', '));

const cepe = MUSHROOMS.find((m) => m.id === 'cepe');
/** Neuf points, dont les `hotes` premiers sous une forêt `code` sur un sol `soil`. */
const points = (hotes, code = 'FF1-09-09', soil = null) => Array.from({ length: 9 }, (_, k) => (k < hotes ? { code, soil } : { code: null, soil: null }));
const carre500 = (id, samples, inner = true) => ({ id, samples, inner });
const vu = (m, ville, cellules) => {
  const r = surveySquare(m, ville, cellules);
  return `${r.count} · ${r.best.toFixed(3)}`;
};
check(
  'règle : hors des villes, trois points sur neuf sous un arbre hôte suffisent, deux non ; un carré qui borde le carré jugé n’est pas compté',
  vu(cepe, false, [carre500('10:10', points(3))]) === '1 · 1.000' && vu(cepe, false, [carre500('10:10', points(2))]) === '0 · 0.000' && vu(cepe, false, [carre500('10:10', points(9), false)]) === '0 · 0.000',
  [vu(cepe, false, [carre500('10:10', points(3))]), vu(cepe, false, [carre500('10:10', points(2))])].join(' | '),
);
check(
  'règle : le meilleur est le produit « arbres × sol » d’un carré à dessiner (hêtraie sur calcaire : 1 × 0,76 pour les cèpes) ; un meilleur arbre sur deux points seulement ne compte pas',
  vu(cepe, false, [carre500('10:10', points(4, 'FF1-09-09', 'calcaire'))]) === '1 · 0.760' && vu(cepe, false, [carre500('10:10', points(9, 'FF1G06-06')), carre500('10:11', points(2, 'FF1-09-09'))]) === '1 · 0.600',
  [vu(cepe, false, [carre500('10:10', points(4, 'FF1-09-09', 'calcaire'))]), vu(cepe, false, [carre500('10:10', points(9, 'FF1G06-06')), carre500('10:11', points(2, 'FF1-09-09'))])].join(' | '),
);
check(
  'règle de ville : un carré tout boisé mais isolé (un parc) ne compte pas ; tenu à un massif (deux voisins boisés, même hors du carré jugé) il compte ; quatre points sur neuf ne suffisent pas',
  vu(cepe, true, [carre500('10:10', points(9))]) === '0 · 0.000' &&
    vu(cepe, true, [carre500('10:10', points(9)), carre500('10:11', points(3), false), carre500('11:11', points(3), false)]) === '1 · 1.000' &&
    vu(cepe, true, [carre500('10:10', points(4)), carre500('10:11', points(9), false), carre500('11:11', points(9), false)]) === '0 · 0.000',
  vu(cepe, true, [carre500('10:10', points(9)), carre500('10:11', points(3), false), carre500('11:11', points(3), false)]),
);

// Un carré de 4,5 km d'essai, varié : une hêtraie sur calcaire, une sapinière sur granite, un mélange
// sur moraine, une chênaie verte, un bois trop petit pour être dessiné (deux points), sans sol connu
// par endroits. Pour chaque champignon de saison, à trois altitudes : ce que le carré de 4,5 km
// annonce (fichier écrit puis relu, comme le fait la carte) doit être ce que montre son meilleur
// carré de 500 m (calculé comme `scoreFineCell`), à un point près vers le haut (l'arrondi du fichier).
const melange = [{ code: 'FF31', soil: 'moraine' }, { code: 'FF31', soil: 'moraine' }, { code: 'FF32', soil: null }, { code: 'FF1-00-00', soil: 'limon' }, { code: 'FF2-52-52', soil: 'gres' }, { code: null, soil: null }, { code: null, soil: null }, { code: 'FO1', soil: 'humide' }, { code: 'FF1G01-01', soil: 'marne' }];
const terrain = [
  carre500('900:900', points(5, 'FF1-09-09', 'calcaire')),
  carre500('900:903', points(7, 'FF2G61-61', 'cristallin')),
  carre500('902:901', melange),
  carre500('904:904', points(9, 'FF1G06-06', 'eboulis')),
  carre500('906:906', points(2, 'FF1G01-01', 'gres')),
  carre500('907:902', points(3, 'FP', null)),
];
const celluleEssai = cases[0];
const fichierEssai = { v: 2, pasLat: parts.pasLat, pasLon: parts.pasLon, champignons: MUSHROOMS.map((m) => m.id), fin: { [celluleEssai]: Array.from({ length: 16 }, (_, k) => (k === 0 ? packSquare(MUSHROOMS.map((m) => surveySquare(m, false, terrain))) : 0)) }, bati: { [celluleEssai]: Array(16).fill(0) } };
const dossierMeteo = mkdtempSync(join(tmpdir(), 'regle-meteo-'));
let ecarts = [];
let compares = 0;
let plusHaut = 0;
try {
  for (const [jour, pluieIlYA] of [['2026-10-20', 9], ['2026-10-20', 4], ['2026-04-20', 9], ['2026-11-25', 12]]) {
    fabriquer(dossierMeteo, jour, pluieIlYA, fichierEssai);
    const bloc = JSON.parse(readFileSync(join(dossierMeteo, 'b', `${Math.floor(Number(celluleEssai.split(':')[0]) / BLOC)}_${Math.floor(Number(celluleEssai.split(':')[1]) / BLOC)}.json`), 'utf8'));
    const serie = parseBlock(bloc).get(celluleEssai);
    const w = summarize(serie, jour);
    const mois = Number(jour.slice(5, 7));
    if (!useForestShare(fichierEssai)) throw new Error('fichier d’essai refusé');
    for (const m of MUSHROOMS) {
      if (noEstimate(m, mois)) continue;
      const releve = surveySquare(m, false, terrain);
      const annonce = hostCover(celluleEssai, 0, m);
      for (const altitude of [200, 900, 1500]) {
        const gros = isLit(annonce) ? chanceOf(squareScore(m, weatherCeiling(m, w, mois), temperaturesAt(w, altitude), annonce.quality)) : 0;
        let fin = 0;
        for (const c of terrain) {
          const f = fineFactors(m, c.samples);
          if (!f || f.hosts < 3) continue; // hors des villes : trois points sur neuf
          fin = Math.max(fin, scoreMushroom(m, summaryAtAltitude(w, altitude), mois, { hostQuality: f.quality, soilFactor: f.soil }).chance);
        }
        compares++;
        if (gros > fin) plusHaut++;
        if (gros < fin || gros > fin + 1 || isLit(annonce) !== releve.count > 0) ecarts.push(`${m.id} ${jour} ${altitude} m : carré de 4,5 km ${gros} %, meilleur carré de 500 m ${fin} %`);
      }
    }
  }
} finally {
  rmSync(dossierMeteo, { recursive: true, force: true });
}
check(
  'échelles : le carré de 4,5 km annonce la chance estimée de son meilleur carré de 500 m (jamais moins, au plus un point de plus), pour chaque champignon de saison, quatre météos, trois altitudes',
  compares >= 30 && ecarts.length === 0,
  ecarts.slice(0, 3).join(' ; ') || `${compares} comparaisons, dont ${plusHaut} à un point au-dessus`,
);
useForestShare(parts);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications OK`);
process.exit(failed ? 1 : 0);

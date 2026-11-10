// Vérifie les règles de classement des sols (scripts/geologie/regles.mjs) sur la table de toutes les
// descriptions géologiques de France (tests/donnees/geologie-descriptions.tsv.gz : BRGM, 96
// départements, une ligne par description avec sa surface), et sert à les régler.
//
//   node tests/geologie.mjs                 vérifications (cas choisis, part du territoire classée)
//   node tests/geologie.mjs non [n]         plus grandes descriptions non classées (hors eau, glace, remblais)
//   node tests/geologie.mjs sol limon [n]   plus grandes descriptions d'un sol
//   node tests/geologie.mjs grep motif      descriptions qui contiennent le motif (sans accents)
//
// Pour refaire la table : TABLE_DESCR=table.tsv bash scripts/geologie/construire.sh (un quart d'heure,
// 2,7 Go téléchargés), puis additionner les surfaces par (notation, description).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { classer } from '../scripts/geologie/regles.mjs';

const [mode = 'verifier', a = '', b = ''] = process.argv.slice(2);
const table = gunzipSync(readFileSync(new URL('./donnees/geologie-descriptions.tsv.gz', import.meta.url))).toString('utf8');
const rows = table
  .split('\n')
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [km2, notation, ...descr] = l.split('\t');
    const d = descr.join('\t');
    return { km2: Number(km2), notation, descr: d, sol: classer(d, notation) };
  });
const sansAccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const km = (list) => list.reduce((s, r) => s + r.km2, 0);
const total = km(rows);
/** Sans sol par nature : eau, glace, remblais. */
const voulu = (r) => /^hydro$/i.test(r.notation) || /hydro|\blacs?\b|etang|\beaux?\b|glacier|neve|neige|glace|remblai|anthropique|terril/i.test(sansAccent(r.descr));
const show = (list, n) => {
  for (const r of list.slice(0, n)) console.log(`${r.km2.toFixed(0).padStart(6)}  ${(r.sol ?? '-').padEnd(10)} ${r.notation.slice(0, 10).padEnd(10)} ${r.descr.slice(0, 140)}`);
};

if (mode === 'non') {
  const reste = rows.filter((r) => !r.sol && !voulu(r));
  console.log(`${reste.length} descriptions non classées (hors eau, glace, remblais), ${Math.round(km(reste))} km²`);
  show(reste, Number(a) || 60);
} else if (mode === 'sol') {
  const list = rows.filter((r) => r.sol === a);
  console.log(`${a} : ${list.length} descriptions, ${Math.round(km(list))} km²`);
  show(list, Number(b) || 40);
} else if (mode === 'grep') {
  const re = new RegExp(a, 'i');
  const list = rows.filter((r) => re.test(sansAccent(r.descr)));
  console.log(`${list.length} descriptions, ${Math.round(km(list))} km²`);
  show(list, Number(b) || 40);
} else {
  let failed = 0;
  const check = (name, ok, detail = '') => {
    if (!ok) failed++;
    console.log(`${ok ? 'OK   ' : 'ÉCHEC'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };
  // Cas choisis dans toute la France : ce que le premier mot laisse croire n'est pas toujours le sol.
  const cas = [
    ['Calcaires massifs urgoniens (à rudistes, polypieds)', 'calcaire'],
    ['Craie blanche à silex', 'calcaire'],
    ['Craies à Acanthoceras rhotomagense', 'calcaire'],
    ['Santonien à Micraster coranguinum', 'calcaire'],
    ['Tufs calcaires', 'calcaire'],
    ['Brèches de pente calcaires', 'calcaire'],
    ['Marnes irisées inférieures (Keuper moyen)', 'marne'],
    ['Argiles de la Woëvre (Callovien inférieur à Oxfordien inférieur)', 'marne'],
    ['Schistes lustrés piémontais', 'marne'],
    ['Calcschistes dévoniens', 'marne'],
    ['Limon des plateaux', 'limon'],
    ['Lœss et limons des plateaux', 'limon'],
    ['Formations résiduelles à silex (argiles à silex s.s. et limons argileux rouges à silex), Cénozoïque', 'limon'],
    ['Argile à silex issue du Crétacé supérieur', 'limon'],
    ['Altérites : Faciès à silex', 'limon'],
    ['Altérites du crétacé sup. : argiles kaoliniques, silteuses à sableuses', 'limon'],
    ['Sables et graviers des terrasses', 'gres'],
    ['Espace interdunaire et dunes indiférenciées sub-actuelles (Sub-Atlantique)', 'gres'],
    ['Complexe dunaire indifférencié de type barkhane', 'gres'],
    ['Eocène detritique', 'gres'],
    ["Gaize d'Argonne (Albien supérieur)", 'gres'],
    ['Formations de Pont de Buis-Châteaulin: Wackes et shales à passées gréseuses', 'gres'],
    ['Granite porphyroïde à biotite', 'cristallin'],
    ['Altérites des granodiorites cadomiennes', 'cristallin'],
    ['UAA : Diatexites à biotite', 'cristallin'],
    ['Phyllades de la baie de Douarnenez: Briovérien', 'cristallin'],
    ['(méta)Trondhjémite de Douarnenez et tonalites subordonnées', 'cristallin'],
    ['Siltites, siltites ardoisières et argilites dominantes, non métamorphiques (Briovérien supérieur)', 'cristallin'],
    ['Schistes silteux, argileux et ampéliteux à graywackes ("schistes de Saint-Lô")', 'cristallin'],
    ['Volcanisme du Pliocène du Cézallier : Basaltes, basanites, indifférenciés', 'cristallin'],
    ['Coulées basaltiques du plateau', 'cristallin'],
    ['Coulées de laves trachytiques', 'cristallin'],
    ['Brèches volcaniques', 'cristallin'],
    ['Tufs rhyolitiques', 'cristallin'],
    ['Cônes de scories', 'cristallin'],
    ['Dépôts glaciaires (moraines) anciens (argiles, sables, galets, cailloux, blocs)', 'moraine'],
    ['Alluvions fluvio-glaciaires würmiennes', 'moraine'],
    ['Cônes de déjection', 'eboulis'],
    ['Coulées de solifluxion et colluvions', 'eboulis'],
    ['Colluvions alimentées par des roches volcaniques diverses (pyroclastites, scories basaltiques, basaltes)', 'eboulis'],
    ['Éboulis alimentés par des roches volcaniques diverses', 'eboulis'],
    ['Alluvions fluviatiles récentes', 'humide'],
    ['Alluvions fluviatiles anciennes (Pliocène inférieur), localement sous coulées basaltiques (Pardines)', 'humide'],
    ['Formations alluviales (sables et graviers) : alluvions anciennes', 'humide'],
    ['Réseau hydrologique', null],
    ['Glaciers et névés', null],
  ];
  const faux = cas.filter(([d, attendu]) => classer(d) !== attendu);
  check(`${cas.length} cas choisis`, faux.length === 0, faux.map(([d, attendu]) => `« ${d.slice(0, 50)} » → ${classer(d)} (attendu : ${attendu})`).join(' ; '));

  const classees = rows.filter((r) => r.sol);
  const reste = rows.filter((r) => !r.sol && !voulu(r));
  const part = (100 * km(classees)) / total;
  check('France entière : au moins 98,5 % de la surface classée', part >= 98.5, `${part.toFixed(1)} % de ${Math.round(total)} km², ${rows.length} descriptions`);
  check('moins de 3 000 km² sans sol hors eau, glace et remblais', km(reste) < 3000, `${Math.round(km(reste))} km², ${reste.length} descriptions`);
  const parSol = {};
  for (const r of classees) parSol[r.sol] = (parSol[r.sol] ?? 0) + r.km2;
  const sols = Object.entries(parSol).sort((x, y) => y[1] - x[1]);
  check('les 8 natures de sol sont toutes présentes', sols.length === 8, sols.map(([k, v]) => `${k} ${((100 * v) / total).toFixed(1)} %`).join(', '));
  // Garde-fous contre une règle trop gourmande : aucun sol ne dépasse le quart du pays.
  check('aucun sol ne couvre plus de 25 % du pays', sols.every(([, v]) => v / total < 0.25));
  const landes = rows.filter((r) => /sables (eoliens )?des landes/i.test(sansAccent(r.descr)));
  check('Sables des Landes → grès et sables', landes.length > 0 && landes.every((r) => r.sol === 'gres'), `${Math.round(km(landes))} km²`);
  const granites = rows.filter((r) => /^(leuco|monzo)?granites?\b/i.test(sansAccent(r.descr)));
  check('granites → roches cristallines', km(granites.filter((r) => r.sol === 'cristallin')) / km(granites) > 0.99, `${Math.round(km(granites))} km²`);
  console.log(failed ? `\n${failed} vérification(s) en échec` : '\ngeologie : toutes les vérifications OK');
  process.exit(failed ? 1 : 0);
}

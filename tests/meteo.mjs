// Vérifie scripts/meteo/mettre-a-jour.mjs avec des séries simulées (aucun appel à Open-Meteo) :
// budget respecté, une demande par case et par jour, jours manquants seulement, fenêtre de 30 jours
// complets et journée en cours provisoire, reprise après une panne, anciens fichiers.
//
//   node tests/meteo.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/meteo/mettre-a-jour.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'meteo-'));
const cases = [];
// Altitudes des 16 carrés de 4,5 km de chaque case (le dernier en mer), comme les écrit cases.mjs.
const sub = (i, j) => Array.from({ length: 16 }, (_, k) => (k === 15 ? null : 200 + 10 * k + i + j));
for (let i = 286; i < 296; i++) for (let j = 25; j < 37; j++) cases.push([i, j, +((i + 0.5) * 0.16).toFixed(4), +((j + 0.5) * 0.224).toFixed(4), sub(i, j)]);
writeFileSync(join(dir, 'cases.json'), JSON.stringify({ v: 1, pasLat: 0.16, pasLon: 0.224, source: 'test', cases }));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Un passage simulé à la date donnée ; renvoie le journal et les sorties pour GitHub. */
function run(when, budget, base = dir) {
  const out = join(base, `sortie-${when}`);
  writeFileSync(out, '');
  const log = execFileSync(
    process.execPath,
    [SCRIPT, '--simuler', '--maintenant', when, '--budget', String(budget), '--dossier', join(base, 'meteo'), '--etat', join(base, 'etat.json'), '--cases', join(dir, 'cases.json')],
    { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: out } },
  );
  const outputs = Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').map((l) => l.split('=')));
  return { log, outputs };
}
const index = (base = dir) => JSON.parse(readFileSync(join(base, 'meteo', 'index.json'), 'utf8'));
const blockFiles = (base = dir) => readdirSync(join(base, 'meteo', 'b')).map((f) => join(base, 'meteo', 'b', f));
const blocks = (base = dir) => blockFiles(base).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const spent = (base = dir) => JSON.parse(readFileSync(join(base, 'etat.json'), 'utf8')).appels.reduce((s, [, n]) => s + n, 0);

// 1. Premier passage : budget de 230 appels pour 120 nouvelles cases (2,2 appels chacune, par
//    requêtes de 100 points) : une seule requête passe. Grille trouée : on ne publie pas encore.
let r = run('2026-11-01T01:00:00Z', 230);
let ix = index();
check('premier passage : budget respecté', spent() <= 230 && ix.cases === 100, `${Math.round(spent())} appels, ${ix.cases} cases`);
check('premier passage : tour pas fini, état gardé, pas encore publié', r.outputs.complet === 'false' && r.outputs.publier === 'false' && r.outputs.garder === 'true', JSON.stringify(r.outputs));

// 1 bis. Tour toujours pas fini : rien à 2 h, publication de ce qu'on a au bout de 6 h.
r = run('2026-11-01T03:00:00Z', 0);
check('tour pas fini après 2 h : toujours pas publié, rien à garder', r.outputs.publier === 'false' && r.outputs.garder === 'false', JSON.stringify(r.outputs));
r = run('2026-11-01T07:30:00Z', 0);
check('tour pas fini après 6 h : publié quand même', r.outputs.publier === 'true' && r.outputs.garder === 'true', JSON.stringify(r.outputs));
r = run('2026-11-01T08:00:00Z', 0);
check('pas de seconde publication sans nouvelles données', r.outputs.publier === 'false', JSON.stringify(r.outputs));

// 2. Même jour, nouveau budget : le tour se termine.
r = run('2026-11-01T09:00:00Z', 3000);
ix = index();
check('second passage : toutes les cases, à jour de la veille', ix.cases === 120 && ix.aJour === 120 && ix.dernierJour === '2026-10-31', `${ix.cases} cases, ${ix.aJour} à jour du ${ix.dernierJour}`);
check('second passage : tour complet', r.outputs.complet === 'true' && r.outputs.publier === 'true', JSON.stringify(r.outputs));
const b = blocks()[0];
const cell = Object.values(b.cells)[0];
const [someId, someCell] = Object.entries(b.cells)[0];
const [ci, cj] = someId.split(':').map(Number);
check('fichiers : altitudes des 16 carrés de 4,5 km de chaque case', JSON.stringify(someCell.a) === JSON.stringify(sub(ci, cj)), JSON.stringify(someCell.a).slice(0, 60));
check(
  'fichiers : 30 jours complets, puis la journée en cours, provisoire',
  b.dates.length === 31 && b.dates[0] === '2026-10-02' && b.dates.at(-1) === '2026-11-01' && cell.p.length === 31 && cell.p.at(-1) !== null,
  `${b.dates[0]} … ${b.dates.at(-1)}`,
);
check('fichiers : dernier jour définitif, dernier jour connu, jour de la demande', cell.f === '2026-10-31' && cell.c === '2026-11-01' && cell.m === '2026-11-01', JSON.stringify({ f: cell.f, c: cell.c, m: cell.m }));

// 3. Encore le même jour : rien à faire, aucun appel.
let before = spent();
r = run('2026-11-01T11:00:00Z', 3000);
check('passage suivant le même jour : aucun appel, rien à publier', spent() === before && r.outputs.change === 'false' && r.outputs.publier === 'false' && r.outputs.garder === 'false', `${spent() - before} appels`);

// 4. Le lendemain, avant le passage du jour (GitHub en retard) : la veille reste là, provisoire.
r = run('2026-11-02T00:30:00Z', 0);
let next = Object.values(blocks()[0].cells)[0];
check(
  'lendemain, avant le passage : la veille est gardée comme estimation',
  next.c === '2026-11-01' && next.f === '2026-10-31' && index().dernierJour === '2026-10-31' && r.outputs.complet === 'false' && r.outputs.garder === 'false',
  JSON.stringify({ c: next.c, f: next.f, dernierJour: index().dernierJour }),
);

// 4 bis. Le passage du jour : un appel par case (jours manquants seulement), la veille devient définitive.
before = spent();
r = run('2026-11-02T01:00:00Z', 3000);
check('lendemain : un appel par case', spent() - before === 120 && /120 cases mises à jour/.test(r.log), `${spent() - before} appels`);
next = Object.values(blocks()[0].cells)[0];
check(
  'lendemain : fenêtre décalée d’un jour, veille définitive',
  blocks()[0].dates.at(-1) === '2026-11-02' && index().aJour === 120 && index().dernierJour === '2026-11-01' && next.f === '2026-11-01' && next.c === '2026-11-02',
  JSON.stringify({ c: next.c, f: next.f }),
);

// 5. Après 5 jours sans passage : toujours un appel par case (moins de 14 jours demandés).
before = spent();
run('2026-11-07T01:00:00Z', 3000);
check('après une panne de 5 jours : un appel par case', spent() - before === 120 && index().dernierJour === '2026-11-06', `${spent() - before} appels`);

// 6. Plafond de l'heure : 3 950 appels déjà dépensés il y a 5 minutes, il en faudrait 120 de plus.
const etat = JSON.parse(readFileSync(join(dir, 'etat.json'), 'utf8'));
etat.appels.push([Date.parse('2026-11-08T00:55:00Z'), 3950]);
writeFileSync(join(dir, 'etat.json'), JSON.stringify(etat));
r = run('2026-11-08T01:00:00Z', 100_000);
check('plafond de l’heure respecté', r.outputs.change === 'false' && /plafond de l'heure/.test(r.log), r.log.split('\n').find((l) => /arrêt/.test(l)) ?? '');

// 7. Fichiers d'avant la journée provisoire (ni `f` ni `m`, 30 dates) : repris, puis complétés d'un
//    appel par case le jour même.
const old = mkdtempSync(join(tmpdir(), 'meteo-ancien-'));
run('2026-11-01T01:00:00Z', 3000, old);
for (const f of blockFiles(old)) {
  const block = JSON.parse(readFileSync(f, 'utf8'));
  block.dates.pop();
  for (const c of Object.values(block.cells)) {
    for (const k of ['p', 'x', 'n']) c[k].pop();
    c.c = '2026-10-31';
    delete c.f;
    delete c.m;
  }
  writeFileSync(f, JSON.stringify(block));
}
before = spent(old);
r = run('2026-11-01T05:00:00Z', 3000, old);
const migrated = Object.values(blocks(old)[0].cells)[0];
check(
  'anciens fichiers : repris et complétés (un appel par case)',
  spent(old) - before === 120 && migrated.f === '2026-10-31' && migrated.c === '2026-11-01' && r.outputs.complet === 'true',
  `${spent(old) - before} appels, ${JSON.stringify({ f: migrated.f, c: migrated.c })}`,
);

console.log(failed ? `\n${failed} vérification(s) en échec` : '\nmeteo : toutes les vérifications OK');
process.exit(failed ? 1 : 0);

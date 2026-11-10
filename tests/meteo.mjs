// Vérifie scripts/meteo/mettre-a-jour.mjs avec des séries simulées (aucun appel à Open-Meteo) :
// budget respecté, jours manquants seulement, fenêtre de 30 jours complets, reprise après une panne.
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
for (let i = 286; i < 296; i++) for (let j = 25; j < 37; j++) cases.push([i, j, +((i + 0.5) * 0.16).toFixed(4), +((j + 0.5) * 0.224).toFixed(4)]);
writeFileSync(join(dir, 'cases.json'), JSON.stringify({ v: 1, pasLat: 0.16, pasLon: 0.224, source: 'test', cases }));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Un passage simulé à la date donnée ; renvoie le journal et les sorties pour GitHub. */
function run(when, budget) {
  const out = join(dir, `sortie-${when}`);
  writeFileSync(out, '');
  const log = execFileSync(
    process.execPath,
    [SCRIPT, '--simuler', '--maintenant', when, '--budget', String(budget), '--dossier', join(dir, 'meteo'), '--etat', join(dir, 'etat.json'), '--cases', join(dir, 'cases.json')],
    { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: out } },
  );
  const outputs = Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').map((l) => l.split('=')));
  return { log, outputs };
}
const index = () => JSON.parse(readFileSync(join(dir, 'meteo', 'index.json'), 'utf8'));
const blocks = () => readdirSync(join(dir, 'meteo', 'b')).map((f) => JSON.parse(readFileSync(join(dir, 'meteo', 'b', f), 'utf8')));
const spent = () => JSON.parse(readFileSync(join(dir, 'etat.json'), 'utf8')).appels.reduce((s, [, n]) => s + n, 0);

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
check(
  'fichiers : 30 jours complets, aujourd’hui exclu',
  b.dates.length === 30 && b.dates[0] === '2026-10-02' && b.dates.at(-1) === '2026-10-31' && cell.p.length === 30 && cell.c === '2026-10-31',
  `${b.dates[0]} … ${b.dates.at(-1)}`,
);

// 3. Encore le même jour : rien à faire, aucun appel.
let before = spent();
r = run('2026-11-01T11:00:00Z', 3000);
check('passage suivant le même jour : aucun appel, rien à publier', spent() === before && r.outputs.change === 'false' && r.outputs.publier === 'false' && r.outputs.garder === 'false', `${spent() - before} appels`);

// 4. Le lendemain : un appel par case (jours manquants seulement).
before = spent();
r = run('2026-11-02T01:00:00Z', 3000);
check('lendemain : un appel par case', spent() - before === 120 && /past_days|120 cases mises à jour/.test(r.log), `${spent() - before} appels`);
check('lendemain : fenêtre décalée d’un jour', blocks()[0].dates.at(-1) === '2026-11-01' && index().aJour === 120);

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

console.log(failed ? `\n${failed} vérification(s) en échec` : '\nmeteo : toutes les vérifications OK');
process.exit(failed ? 1 : 0);

// Parts de forêt et part bâtie par carré de 4,5 km : géométrie du calcul, lecteur de tuiles, et fichier versionné
// (public/foret/parts.json, écrit par scripts/foret/parts.mjs). Sans réseau, sans TypeScript :
//   npm run test:foret
import { readFileSync } from 'node:fs';
import { aire, aireDans, lonLatOf, tileBounds, tileOf } from '../scripts/foret/geometrie.mjs';
import { lireCouche } from '../scripts/foret/mvt.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const proche = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

// ── Géométrie ────────────────────────────────────────────────────────────────
const carre = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const trou = [[2, 2], [2, 6], [6, 6], [6, 2], [2, 2]]; // sens contraire du contour
check('aire signée : un carré de 10, son trou en sens contraire', aire(carre) === 100 && aire(trou) === -16, `${aire(carre)} et ${aire(trou)}`);
check('découpage : quart commun à deux carrés', aireDans(carre, 5, 5, 15, 15) === 25, String(aireDans(carre, 5, 5, 15, 15)));
check('découpage : anneau tout entier dans le rectangle, ou tout entier dehors', aireDans(carre, -5, -5, 20, 20) === 100 && aireDans(carre, 20, 20, 30, 30) === 0);
check(
  'découpage : le trou se retranche de lui-même (signe de l’anneau gardé)',
  aireDans(carre, 0, 0, 5, 5) + aireDans(trou, 0, 0, 5, 5) === 25 - 9,
  String(aireDans(carre, 0, 0, 5, 5) + aireDans(trou, 0, 0, 5, 5)),
);
const triangle = [[0, 0], [10, 0], [0, 10], [0, 0]];
check('découpage : triangle coupé en biais', proche(aireDans(triangle, 0, 0, 5, 5), 25), String(aireDans(triangle, 0, 0, 5, 5)));
const bords = tileBounds(10, 529, 364); // tuile au-dessus d'Annecy (CLAUDE.md : numérotation XYZ)
const [tx, ty] = tileOf(6.13, 45.9, 10);
const [lon, lat] = lonLatOf(tx, ty, 10);
check(
  'tuiles XYZ : Annecy dans la tuile 10/529/364, aller-retour degrés ↔ tuile',
  Math.floor(tx) === 529 && Math.floor(ty) === 364 && bords.west < 6.13 && bords.east > 6.13 && bords.south < 45.9 && bords.north > 45.9 && proche(lon, 6.13, 1e-9) && proche(lat, 45.9, 1e-9),
  JSON.stringify(bords),
);

// ── Lecteur de tuiles vectorielles : une tuile fabriquée à la main ──────────────
const varint = (n) => {
  const out = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
};
const champ = (numero, octets) => [...varint(numero * 8 + 2), ...varint(octets.length), ...octets];
const entier = (numero, valeur) => [...varint(numero * 8), ...varint(valeur)];
const texte = (s) => [...Buffer.from(s, 'utf8')];
const zigzag = (n) => (n < 0 ? -2 * n - 1 : 2 * n);
// Carré de 100 unités posé en (10, 20) : MoveTo, trois LineTo, ClosePath.
const geometrie = [
  ...varint((1 << 3) | 1), ...varint(zigzag(10)), ...varint(zigzag(20)),
  ...varint((3 << 3) | 2), ...varint(zigzag(100)), ...varint(zigzag(0)), ...varint(zigzag(0)), ...varint(zigzag(100)), ...varint(zigzag(-100)), ...varint(zigzag(0)),
  ...varint((1 << 3) | 7),
];
const objet = [...champ(2, [0, 0]), ...entier(3, 3), ...champ(4, geometrie)];
const point = [...entier(3, 1), ...champ(4, [...varint((1 << 3) | 1), 2, 2])]; // un point : ignoré
const couche = (nom) => [...entier(15, 2), ...champ(1, texte(nom)), ...champ(2, objet), ...champ(2, point), ...champ(3, texte('code_tfv')), ...champ(4, champ(1, texte('FF1-09-09'))), ...entier(5, 4096)];
const tuile = Buffer.from([...champ(3, couche('autre')), ...champ(3, couche('formation_vegetale'))]);
const lue = lireCouche(tuile, 'formation_vegetale', 'code_tfv');
check(
  'lecteur de tuiles : la bonne couche, le polygone refermé, son code, pas le point',
  lue?.extent === 4096 && lue.objets.length === 1 && lue.objets[0].valeur === 'FF1-09-09' && JSON.stringify(lue.objets[0].rings) === JSON.stringify([[[10, 20], [110, 20], [110, 120], [10, 120], [10, 20]]]),
  JSON.stringify(lue?.objets[0]),
);
check('lecteur de tuiles : couche absente → null', lireCouche(tuile, 'inconnue', 'code_tfv') === null);

// ── Fichier versionné ─────────────────────────────────────────────────────────
const parts = JSON.parse(lire('public/foret/parts.json'));
const liste = JSON.parse(lire('scripts/meteo/cases-france.json'));
const connus = new Set([...lire('src/forestClasses.ts').matchAll(/code: '([^']+)'/g)].map((m) => m[1]));
check('fichier : format 1, grille de la carte (carrés 4 fois plus petits que les cases)', parts.v === 1 && proche(parts.pasLat * 4, liste.pasLat) && proche(parts.pasLon * 4, liste.pasLon), `${parts.pasLat} × ${parts.pasLon}`);
check(
  'fichier : seulement des types de forêt de la nomenclature',
  connus.size === 32 && parts.codes.length > 20 && parts.codes.every((code) => connus.has(code)),
  parts.codes.filter((code) => !connus.has(code)).join(', ') || `${parts.codes.length} types sur ${connus.size}`,
);

let carres = 0;
let boises = 0;
const defauts = [];
for (const [i, j, , , altitudes] of liste.cases) {
  const id = `${i}:${j}`;
  const lignes = parts.cases[id];
  if (!Array.isArray(lignes) || lignes.length !== 16) {
    defauts.push(`${id} : case absente ou incomplète`);
    continue;
  }
  lignes.forEach((ligne, k) => {
    const terre = !Array.isArray(altitudes) || altitudes[k] !== null;
    if (!terre) {
      if (ligne !== null) defauts.push(`${id}/${k} : carré sans terre mais renseigné`);
      return;
    }
    carres++;
    if (!Array.isArray(ligne) || ligne.length % 2) return void defauts.push(`${id}/${k} : parts mal formées`);
    let total = 0;
    let precedent = 101;
    for (let n = 0; n < ligne.length; n += 2) {
      const [rang, part] = [ligne[n], ligne[n + 1]];
      if (!Number.isInteger(rang) || rang < 0 || rang >= parts.codes.length) defauts.push(`${id}/${k} : type n° ${rang}`);
      if (!Number.isInteger(part) || part < 1 || part > 100 || part > precedent) defauts.push(`${id}/${k} : part ${part} après ${precedent}`);
      precedent = part;
      total += part;
    }
    // Chaque part est arrondie au pour cent : la somme peut dépasser 100 de quelques unités.
    if (total > 104) defauts.push(`${id}/${k} : ${total} % de forêt`);
    if (total > 0) boises++;
  });
}
check('fichier : un carré par carré de terre française, parts entières, décroissantes, somme ≤ 100 %', defauts.length === 0, defauts.slice(0, 4).join(' ; ') || `${carres} carrés, ${boises} boisés`);
check('fichier : aucune case en trop', Object.keys(parts.cases).length === liste.cases.length, `${Object.keys(parts.cases).length} pour ${liste.cases.length}`);

/** Part de forêt (toutes formations) du carré qui contient un point, en %. */
function forêtEn(latitude, longitude) {
  const bi = Math.floor(latitude / parts.pasLat);
  const bj = Math.floor(longitude / parts.pasLon);
  const [ci, cj] = [Math.floor(bi / 4), Math.floor(bj / 4)];
  const ligne = parts.cases[`${ci}:${cj}`]?.[(bi - ci * 4) * 4 + (bj - cj * 4)];
  return ligne ? ligne.filter((_, n) => n % 2).reduce((s, v) => s + v, 0) : null;
}
const reperes = { Paris: forêtEn(48.86, 2.37), Fontainebleau: forêtEn(48.42, 2.65), Landes: forêtEn(44.15, -0.74), Beauce: forêtEn(48.2, 1.88) };
check(
  'fichier : repères connus (Paris et la Beauce presque sans forêt, Fontainebleau et les Landes très boisées)',
  reperes.Paris <= 2 && reperes.Beauce <= 5 && reperes.Fontainebleau >= 70 && reperes.Landes >= 60,
  JSON.stringify(reperes),
);

// ── Part bâtie (zones bâties et d'activité du Plan IGN) ──────────────────────────
const defautsBati = [];
let batis = 0;
for (const [id, lignes] of Object.entries(parts.cases)) {
  const bati = parts.bati?.[id];
  if (!Array.isArray(bati) || bati.length !== 16) {
    defautsBati.push(`${id} : part bâtie absente ou incomplète`);
    continue;
  }
  lignes.forEach((ligne, k) => {
    const part = bati[k];
    if (ligne === null) {
      if (part !== null) defautsBati.push(`${id}/${k} : carré sans terre mais part bâtie renseignée`);
    } else if (!Number.isInteger(part) || part < 0 || part > 100) defautsBati.push(`${id}/${k} : part bâtie ${part}`);
    else if (part >= 15) batis++;
  });
}
check(
  'fichier : une part bâtie entière (0 à 100 %) par carré de terre française, aucune case en trop',
  defautsBati.length === 0 && Object.keys(parts.bati ?? {}).length === liste.cases.length,
  defautsBati.slice(0, 4).join(' ; ') || `${batis} carrés bâtis à 15 % ou plus sur ${carres}`,
);
/** Part bâtie du carré qui contient un point, en %. */
function batiEn(latitude, longitude) {
  const bi = Math.floor(latitude / parts.pasLat);
  const bj = Math.floor(longitude / parts.pasLon);
  const [ci, cj] = [Math.floor(bi / 4), Math.floor(bj / 4)];
  return parts.bati?.[`${ci}:${cj}`]?.[(bi - ci * 4) * 4 + (bj - cj * 4)] ?? null;
}
// Grenoble et Chambéry sont dans des tuiles du Plan IGN dont la couche bâtie n'a pas 4 096 unités de
// côté : comptées en unités de tuile au lieu de fractions, elles ressortaient bâties à 1 %.
const villes = { Paris: batiEn(48.86, 2.37), Lyon: batiEn(45.76, 4.84), Nancy: batiEn(48.69, 6.18), Grenoble: batiEn(45.188, 5.724), Chambéry: batiEn(45.57, 5.92), Fontainebleau: batiEn(48.42, 2.65), Landes: batiEn(44.15, -0.74), Beauce: batiEn(48.2, 1.88) };
check(
  'fichier : repères bâtis (Paris, Lyon, Nancy, Grenoble et Chambéry surtout bâtis ; forêt de Fontainebleau, Landes et Beauce presque pas)',
  villes.Paris >= 80 && villes.Lyon >= 60 && villes.Nancy >= 60 && villes.Grenoble >= 60 && villes.Chambéry >= 60 && villes.Fontainebleau <= 10 && villes.Landes <= 10 && villes.Beauce <= 10,
  JSON.stringify(villes),
);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications des parts de forêt OK`);
process.exit(failed ? 1 : 0);

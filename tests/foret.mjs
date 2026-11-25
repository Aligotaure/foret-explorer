// Ce que chaque carré de 4,5 km contient (carrés de 500 m à dessiner par champignon, part bâtie) :
// géométrie du calcul, lecteur de tuiles, relevé sur le treillis des carrés de 500 m, et fichier
// versionné (public/foret/parts.json, écrit par scripts/foret/parts.mjs). Sans réseau, sans TypeScript :
//   npm run test:foret
// (La règle elle-même, celle de la carte, est vérifiée par `npm run test:france`, qui a Vite.)
import { readFileSync } from 'node:fs';
import { aire, aireDans, lonLatOf, tileBounds, tileOf } from '../scripts/foret/geometrie.mjs';
import { lireCouche } from '../scripts/foret/mvt.mjs';
import { creerTreillis, ordreDeTrace, polygones, remplir, tracerTuile, versTreillis } from '../scripts/foret/releve.mjs';

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

// ── Relevé des carrés de 500 m : points du treillis dans un polygone ─────────────
const dans = (rings) => {
  const points = [];
  remplir(rings, (x, y) => points.push(`${x},${y}`));
  return points.sort();
};
const plein = [[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]];
check(
  'treillis : un carré de 3 de côté contient neuf points (bords ouest et sud dedans, est et nord dehors)',
  dans([plein]).join(' ') === '0,0 0,1 0,2 1,0 1,1 1,2 2,0 2,1 2,2',
  dans([plein]).join(' '),
);
const perce = [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]];
check('treillis : un trou retire ses points', dans([plein, perce]).length === 8 && !dans([plein, perce]).includes('1,1'), dans([plein, perce]).join(' '));
// Anneaux regroupés en polygones comme MapLibre : même sens que le premier = nouveau polygone, sens
// contraire = trou du polygone en cours (même s'il est dehors : un morceau noté à l'envers au bord
// d'une tuile se lit alors comme de la forêt, par la règle pair-impair).
const ile = [[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]; // même sens que `plein`
const groupes = polygones([plein, perce, ile, [[5, 5], [5, 5], [5, 5]]]);
check(
  'treillis : anneaux regroupés en polygones comme MapLibre (un polygone par contour, ses trous avec lui, anneau sans surface ignoré)',
  groupes.length === 2 && groupes[0].length === 2 && groupes[1].length === 1 && polygones([plein]).length === 1,
  groupes.map((g) => `${g.length} anneau(x)`).join(' + '),
);
const avecMorceau = polygones([plein, [...ile].reverse()]); // l'île notée à l'envers : « trou » hors du contour
check(
  'treillis : un morceau noté dans le sens d’un trou, hors de son contour, reste de la forêt (ses quatre points s’ajoutent aux neuf du contour)',
  avecMorceau.length === 1 && avecMorceau[0].length === 2 && dans(avecMorceau[0]).length === 13 && dans(avecMorceau[0]).includes('10,10') && dans(avecMorceau[0]).includes('11,11'),
  dans(avecMorceau[0]).join(' '),
);
// La règle de la carte (`inside` de src/fineGrid.ts), recopiée ici pour comparer point par point.
const dedans = (rings, x, y) => {
  let hit = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xa, ya] = ring[i];
      const [xb, yb] = ring[j];
      if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) hit = !hit;
    }
  }
  return hit;
};
const etoile = Array.from({ length: 14 }, (_, k) => {
  const rayon = k % 2 ? 2.3 : 5.7;
  const angle = (k / 14) * 2 * Math.PI;
  return [5.1 + rayon * Math.cos(angle), 4.9 + rayon * Math.sin(angle)];
});
const attendus = [];
for (let y = -2; y <= 12; y++) for (let x = -2; x <= 12; x++) if (dedans([etoile], x, y)) attendus.push(`${x},${y}`);
check(
  'treillis : mêmes points que la règle de la carte (pair-impair) dans une étoile à sept branches',
  attendus.length > 20 && dans([etoile]).join(' ') === attendus.sort().join(' '),
  `${attendus.length} points attendus, ${dans([etoile]).length} trouvés`,
);
// Un tiers de carré de 500 m : 0,04° / 9 / 3 et 0,056° / 9 / 3.
const PAS_LAT = 0.04 / 27;
const PAS_LON = 0.056 / 27;
const [tx11, ty11] = tileOf(6.13, 45.9, 11).map(Math.floor);
const vers = versTreillis(11, tx11, ty11, 4096, PAS_LAT, PAS_LON);
const [colonneCoin, ligneCoin] = vers(0, 0);
const [lonCoin, latCoin] = lonLatOf(tx11, ty11, 11);
const [colonneMilieu, ligneMilieu] = vers(2048.5, 2048.5); // ordonnée non entière : calcul direct
const [lonMilieu, latMilieu] = lonLatOf(tx11 + 2048.5 / 4096, ty11 + 2048.5 / 4096, 11);
check(
  'treillis : un point de tuile tombe à sa longitude et à sa latitude (le point (r, c) est à (r + 0,5) × pas)',
  proche((colonneCoin + 0.5) * PAS_LON, lonCoin, 1e-9) && proche((ligneCoin + 0.5) * PAS_LAT, latCoin, 1e-9) && proche((colonneMilieu + 0.5) * PAS_LON, lonMilieu, 1e-9) && proche((ligneMilieu + 0.5) * PAS_LAT, latMilieu, 1e-9),
  `${lonCoin.toFixed(5)}, ${latCoin.toFixed(5)}`,
);
const bornes11 = tileBounds(11, tx11, ty11);
const treillis = creerTreillis(bornes11, PAS_LAT, PAS_LON);
treillis.pose(treillis.r0 + 5, treillis.c0 + 7, 3);
treillis.pose(treillis.r0 + 5, treillis.c0 + 7, 9);
treillis.pose(-1e6, 0, 1);
check('treillis : le dernier écrit l’emporte, un point hors de l’emprise est ignoré', treillis.lit(treillis.r0 + 5, treillis.c0 + 7) === 9 && treillis.lit(-1e6, 0) === 0);
check(
  'treillis : tuiles tracées du sud au nord et d’est en ouest (là où deux polygones se recouvrent, la carte garde celui de la tuile la plus au nord, puis la plus à l’ouest)',
  JSON.stringify(ordreDeTrace([[5, 1], [6, 1], [5, 2], [6, 2]])) === '[[6,2],[5,2],[6,1],[5,1]]',
  JSON.stringify(ordreDeTrace([[5, 1], [6, 1], [5, 2], [6, 2]])),
);
// La tuile fabriquée plus haut : un carré de 100 unités, soit ≈ 330 m au zoom 11 (deux points de côté).
const frais = creerTreillis(bornes11, PAS_LAT, PAS_LON);
const traces = tracerTuile(frais, 11, tx11, ty11, lue, (code) => (code === 'FF1-09-09' ? 7 : 0));
const anneau = lue.objets[0].rings.map((ring) => ring.map(([px, py]) => vers(px, py)));
let poses = 0;
let voulus = 0;
for (let r = frais.r0; r < frais.r0 + frais.lignes; r++) {
  for (let c = frais.c0; c < frais.c0 + frais.colonnes; c++) {
    if (frais.lit(r, c) === 7) poses++;
    if (dedans(anneau, c, r)) voulus++;
  }
}
check('treillis : une tuile tracée pose son code sur les points de son polygone, et seulement eux', traces === 1 && poses === voulus && poses >= 2 && poses <= 9, `${poses} points posés, ${voulus} attendus`);
check('treillis : un polygone dont la valeur est ignorée (rang 0) n’est pas tracé', tracerTuile(creerTreillis(bornes11, PAS_LAT, PAS_LON), 11, tx11, ty11, lue, () => 0) === 0);

// ── Fichier versionné ─────────────────────────────────────────────────────────
const parts = JSON.parse(lire('public/foret/parts.json'));
const liste = JSON.parse(lire('scripts/meteo/cases-france.json'));
const champignons = [...lire('src/mushrooms.ts').matchAll(/^    id: '([a-z]+)',$/gm)].map((m) => m[1]);
check('fichier : format 2, grille de la carte (carrés 4 fois plus petits que les cases)', parts.v === 2 && proche(parts.pasLat * 4, liste.pasLat) && proche(parts.pasLon * 4, liste.pasLon), `${parts.pasLat} × ${parts.pasLon}`);
check(
  'fichier : les champignons de la carte, dans l’ordre, et l’empreinte des règles du calcul',
  champignons.length === 5 && JSON.stringify(parts.champignons) === JSON.stringify(champignons) && /^[0-9a-f]{8}$/.test(parts.regles ?? ''),
  `${parts.champignons?.join(', ')} ; règles ${parts.regles}`,
);

const PAR_CARRE = 81; // carrés de 500 m dans un carré de 4,5 km
let carres = 0;
let boises = 0;
const defauts = [];
for (const [i, j, , , altitudes] of liste.cases) {
  const id = `${i}:${j}`;
  const lignes = parts.fin[id];
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
    if (ligne === 0) return;
    if (!Array.isArray(ligne) || ligne.length !== 2 * champignons.length) return void defauts.push(`${id}/${k} : mal formé`);
    let allume = false;
    for (let n = 0; n < ligne.length; n += 2) {
      const [nombre, meilleur] = [ligne[n], ligne[n + 1]];
      if (!Number.isInteger(nombre) || nombre < 0 || nombre > PAR_CARRE) defauts.push(`${id}/${k} : ${nombre} carrés de 500 m`);
      if (!Number.isInteger(meilleur) || meilleur < 0 || meilleur > 1000) defauts.push(`${id}/${k} : meilleur ${meilleur}`);
      if (nombre > 0 !== meilleur > 0) defauts.push(`${id}/${k} : ${nombre} carrés pour un meilleur de ${meilleur}`);
      allume ||= nombre > 0;
    }
    if (!allume) defauts.push(`${id}/${k} : rien à dessiner, devrait être écrit 0`);
    boises++;
  });
}
check(
  'fichier : un carré par carré de terre française ; par champignon, 0 à 81 carrés de 500 m à dessiner et leur meilleur « arbres × sol » en millièmes',
  defauts.length === 0,
  defauts.slice(0, 4).join(' ; ') || `${carres} carrés, ${boises} avec quelque chose à dessiner`,
);
check('fichier : aucune case en trop', Object.keys(parts.fin).length === liste.cases.length, `${Object.keys(parts.fin).length} pour ${liste.cases.length}`);

/** [carrés de 500 m à dessiner, meilleur « arbres × sol » en millièmes] du carré qui contient un point, pour un champignon. */
function carreEn(latitude, longitude, champignon) {
  const bi = Math.floor(latitude / parts.pasLat);
  const bj = Math.floor(longitude / parts.pasLon);
  const [ci, cj] = [Math.floor(bi / 4), Math.floor(bj / 4)];
  const ligne = parts.fin[`${ci}:${cj}`]?.[(bi - ci * 4) * 4 + (bj - cj * 4)];
  const rang = parts.champignons.indexOf(champignon);
  return ligne === null || ligne === undefined ? null : ligne === 0 ? [0, 0] : [ligne[2 * rang], ligne[2 * rang + 1]];
}
const reperes = { Paris: carreEn(48.86, 2.37, 'cepe'), Beauce: carreEn(48.2, 1.88, 'cepe'), Fontainebleau: carreEn(48.42, 2.65, 'cepe'), Landes: carreEn(44.15, -0.74, 'cepe') };
check(
  'fichier : repères connus pour les cèpes (rien à dessiner dans Paris, presque rien en Beauce, presque tout à Fontainebleau et dans les Landes)',
  reperes.Paris[0] === 0 && reperes.Beauce[0] <= 8 && reperes.Fontainebleau[0] >= 60 && reperes.Landes[0] >= 50 && reperes.Fontainebleau[1] >= 600,
  JSON.stringify(reperes),
);
// Le cas qui a fait changer la règle (25/11/2026, sud-ouest d'Amiens) : un bois de résineux isolé, que
// les carrés de 500 m dessinent à 78 % pour les chanterelles en tube, dans un carré de 4,5 km où les
// arbres hôtes ne couvrent que 1 % de la surface. Il doit allumer son carré.
const fricamps = carreEn(49.82, 1.99, 'chanterelle');
check('fichier : un bois isolé allume son carré (Fricamps, Somme : un carré de 500 m à dessiner pour les chanterelles en tube)', fricamps?.[0] >= 1 && fricamps[1] >= 600, JSON.stringify(fricamps));

// ── Part bâtie (zones bâties et d'activité du Plan IGN) ──────────────────────────
const defautsBati = [];
let batis = 0;
for (const [id, lignes] of Object.entries(parts.fin)) {
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

// Coupes et dégâts datés par carré de 500 m (scripts/coupes/) : projection, lecteur d'image, lecteur
// d'archive, et fabrication des fichiers, sur une image et une archive fabriquées ici. Sans réseau,
// sans TypeScript :
//   npm run test:coupes
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { BLOC, DIVISIONS, FACTEUR, POINTS, ecrire, fabriquer, lecteur, periodes } from '../scripts/coupes/coupes.mjs';
import { versLaea, versLatLon } from '../scripts/coupes/projection.mjs';
import { ouvrir } from '../scripts/coupes/tiff.mjs';
import { extraire, lister } from '../scripts/coupes/zip.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const dossier = mkdtempSync(join(tmpdir(), 'coupes-'));

// ── Projection ───────────────────────────────────────────────────────────────
// Point d'exemple de la note 7-2 de l'EPSG pour l'EPSG:3035.
const [ex, ey] = versLaea(50, 5);
check('projection : 50° N, 5° E au point d’exemple de l’EPSG', Math.abs(ex - 3962799.45) < 0.01 && Math.abs(ey - 2999718.85) < 0.01, `${ex.toFixed(2)} ; ${ey.toFixed(2)}`);
const [origineLat, origineLon] = versLatLon(4321000, 3210000);
check('projection : l’origine est à 52° N, 10° E', Math.abs(origineLat - 52) < 1e-9 && Math.abs(origineLon - 10) < 1e-9);
let ecart = 0;
for (const [lat, lon] of [[41.4, 9.2], [42.7, -1.8], [45.87102, 1.83953], [48.4, -4.9], [51.05, 2.4]]) {
  const [la, lo] = versLatLon(...versLaea(lat, lon));
  ecart = Math.max(ecart, Math.abs(la - lat), Math.abs(lo - lon));
}
check('projection : aller et retour aux quatre coins de la France à moins d’un centimètre', ecart < 1e-7, `${ecart.toExponential(1)}°`);

// ── Image fabriquée ──────────────────────────────────────────────────────────
/** Compression LZW du TIFF (codes de 9 à 12 bits, poids fort d'abord, largeur changée un code plus tôt). */
function lzw(octets) {
  const sortie = [];
  let tampon = 0;
  let nb = 0;
  const pousse = (code, bits) => {
    tampon = (tampon << bits) | code;
    nb += bits;
    while (nb >= 8) {
      sortie.push((tampon >>> (nb - 8)) & 255);
      nb -= 8;
    }
    tampon &= (1 << nb) - 1;
  };
  let table = new Map();
  let suivant = 258;
  let bits = 9;
  let prefixe = -1;
  pousse(256, bits);
  for (const octet of octets) {
    if (prefixe === -1) {
      prefixe = octet;
      continue;
    }
    const cle = prefixe * 256 + octet;
    const connu = table.get(cle);
    if (connu !== undefined) {
      prefixe = connu;
      continue;
    }
    pousse(prefixe, bits);
    table.set(cle, suivant++);
    if (suivant === 4094) {
      pousse(256, bits);
      table = new Map();
      suivant = 258;
      bits = 9;
    } else if (suivant > (1 << bits) - 1) bits++;
    prefixe = octet;
  }
  if (prefixe !== -1) {
    pousse(prefixe, bits);
    if (++suivant > (1 << bits) - 1 && bits < 12) bits++;
  }
  pousse(257, bits);
  if (nb) sortie.push((tampon << (8 - nb)) & 255);
  return Buffer.from(sortie);
}

/**
 * Écrit une image TIFF d'entiers de 16 bits en tuiles, géoréférencée en EPSG:3035 comme celles de
 * l'atlas. `compression` : 1 aucune, 5 LZW, 8 Deflate ; `predicteur` : 1 aucun, 2 différences.
 */
function ecrireTiff(chemin, { largeur, hauteur, tuile, valeurs, compression, predicteur, x0, y0, pas = 30, vide = -9999 }) {
  const enLargeur = Math.ceil(largeur / tuile);
  const enHauteur = Math.ceil(hauteur / tuile);
  const morceaux = [];
  const positions = [];
  const longueurs = [];
  let position = 8;
  for (let ty = 0; ty < enHauteur; ty++) {
    for (let tx = 0; tx < enLargeur; tx++) {
      const t = new Int16Array(tuile * tuile).fill(vide);
      for (let y = 0; y < tuile && ty * tuile + y < hauteur; y++) {
        for (let x = 0; x < tuile && tx * tuile + x < largeur; x++) t[y * tuile + x] = valeurs[(ty * tuile + y) * largeur + tx * tuile + x];
      }
      if (predicteur === 2) for (let y = 0; y < tuile; y++) for (let x = tuile - 1; x > 0; x--) t[y * tuile + x] -= t[y * tuile + x - 1];
      const brut = Buffer.from(t.buffer);
      const donnees = compression === 5 ? lzw(brut) : compression === 8 ? zlib.deflateSync(brut) : brut;
      morceaux.push(donnees);
      positions.push(position);
      longueurs.push(donnees.length);
      position += donnees.length;
    }
  }
  // Étiquettes : [numéro, type (3 court, 4 long, 12 double, 2 texte), valeurs].
  const etiquettes = [
    [256, 4, [largeur]],
    [257, 4, [hauteur]],
    [258, 3, [16]],
    [259, 3, [compression]],
    [262, 3, [1]],
    [277, 3, [1]],
    [284, 3, [1]],
    [317, 3, [predicteur]],
    [322, 3, [tuile]],
    [323, 3, [tuile]],
    [324, 4, positions],
    [325, 4, longueurs],
    [339, 3, [2]],
    [33550, 12, [pas, pas, 0]],
    [33922, 12, [0, 0, 0, x0, y0, 0]],
    [34735, 3, [1, 1, 0, 2, 1024, 0, 1, 1, 3072, 0, 1, 3035]],
    [42113, 2, `${vide}\0`],
  ];
  const TAILLE = { 2: 1, 3: 2, 4: 4, 12: 8 };
  const posIfd = position;
  const ifd = Buffer.alloc(2 + etiquettes.length * 12 + 4);
  ifd.writeUInt16LE(etiquettes.length, 0);
  const annexes = [];
  let posAnnexe = posIfd + ifd.length;
  etiquettes.forEach(([numero, type, v], k) => {
    const o = 2 + k * 12;
    const nombre = v.length;
    const corps = Buffer.alloc(nombre * TAILLE[type]);
    for (let n = 0; n < nombre; n++) {
      if (type === 2) corps[n] = v.charCodeAt(n);
      else if (type === 3) corps.writeUInt16LE(v[n], n * 2);
      else if (type === 4) corps.writeUInt32LE(v[n], n * 4);
      else corps.writeDoubleLE(v[n], n * 8);
    }
    ifd.writeUInt16LE(numero, o);
    ifd.writeUInt16LE(type, o + 2);
    ifd.writeUInt32LE(nombre, o + 4);
    if (corps.length <= 4) corps.copy(ifd, o + 8);
    else {
      ifd.writeUInt32LE(posAnnexe, o + 8);
      annexes.push(corps);
      posAnnexe += corps.length;
    }
  });
  const tete = Buffer.alloc(8);
  tete.write('II', 0, 'latin1');
  tete.writeUInt16LE(42, 2);
  tete.writeUInt32LE(posIfd, 4);
  writeFileSync(chemin, Buffer.concat([tete, ...morceaux, ifd, ...annexes]));
}

// Une case commune (286:8, en Limousin) et sa voisine de l'est, dans une image de 1 100 pixels de côté.
const PAS_LAT = 0.04;
const PAS_LON = 0.056;
const CASE = [286, 8];
const [coinX, coinY] = versLaea((CASE[0] + 1) * FACTEUR * PAS_LAT, CASE[1] * FACTEUR * PAS_LON); // coin nord-ouest de la case
const X0 = Math.round(coinX) - 3000;
const Y0 = Math.round(coinY) + 3000;
const COTE = 1100;
const valeurs = new Int16Array(COTE * COTE).fill(-9999);
/** Pixel de l'image sous un point. */
const pixel = (lat, lon) => {
  const [x, y] = versLaea(lat, lon);
  return [Math.floor((x - X0) / 30), Math.floor((Y0 - y) / 30)];
};
/** Coordonnées du point (iy, ix) du carré de 500 m (di, dj) du carré de 4,5 km numéro k d'une case. */
const point = ([i, j], k, di, dj, iy, ix) => [
  ((i * FACTEUR + Math.floor(k / FACTEUR)) * DIVISIONS + di + POINTS[iy]) * (PAS_LAT / DIVISIONS),
  ((j * FACTEUR + (k % FACTEUR)) * DIVISIONS + dj + POINTS[ix]) * (PAS_LON / DIVISIONS),
];
const pose = (lieu, an) => {
  const [col, lig] = pixel(...point(...lieu));
  valeurs[lig * COTE + col] = an;
  return [col, lig];
};
// Dans le carré 5 de la case : trois points d'un même carré de 500 m, et un point de son voisin.
pose([CASE, 5, 3, 4, 0, 0], 2024); // récent, premier point
pose([CASE, 5, 3, 4, 1, 2], 2017); // récent, à la borne
pose([CASE, 5, 3, 4, 2, 1], 2016); // jeune, à la borne
pose([CASE, 5, 3, 5, 2, 2], 2007); // jeune, à l'autre borne
pose([CASE, 5, 8, 8, 1, 1], 2006); // trop ancien : rien
pose([CASE, 2, 0, 0, 1, 1], 2020); // carré sans terre française : pas lu
// Un pixel daté juste à côté d'un point relevé ne compte pas pour lui.
const [colVoisin, ligVoisin] = pixel(...point(CASE, 10, 4, 4, 1, 1));
valeurs[ligVoisin * COTE + colVoisin + 1] = 2022;
// Sous la case (hors de tout carré lu) : des valeurs répétées, puis d'autres sans ordre (suite
// déterministe), pour éprouver la compression au-delà des 4 094 codes d'une table LZW.
for (let y = 900; y < 1000; y++) for (let x = 0; x < COTE; x++) valeurs[y * COTE + x] = 1985 + ((x * 7 + y * 13) % 40);
let graine = 20261125;
for (let y = 1000; y < 1060; y++) {
  for (let x = 0; x < COTE; x++) {
    graine = (Math.imul(graine, 1103515245) + 12345) >>> 0;
    valeurs[y * COTE + x] = 1985 + ((graine >>> 16) % 40);
  }
}

const base = { largeur: COTE, hauteur: COTE, tuile: 512, valeurs, x0: X0, y0: Y0 };
const images = {
  'LZW et différences (comme l’atlas)': { compression: 5, predicteur: 2 },
  'LZW sans différences': { compression: 5, predicteur: 1 },
  'Deflate et différences': { compression: 8, predicteur: 2 },
  'sans compression': { compression: 1, predicteur: 1 },
};
const parts = {
  pasLat: PAS_LAT,
  pasLon: PAS_LON,
  cases: {
    [`${CASE[0]}:${CASE[1]}`]: Array.from({ length: 16 }, (_, k) => (k === 2 ? null : [])),
    [`${CASE[0]}:${CASE[1] + 1}`]: Array.from({ length: 16 }, () => []),
  },
};
let reference = null;
for (const [nom, reglage] of Object.entries(images)) {
  const chemin = join(dossier, `image-${reglage.compression}-${reglage.predicteur}.tif`);
  ecrireTiff(chemin, { ...base, ...reglage });
  const image = ouvrir(chemin);
  // Chaque tuile relue pixel par pixel.
  let faux = 0;
  for (let n = 0; n < image.nbTuiles; n++) {
    const t = image.tuile(n);
    const ty = Math.floor(n / image.enLargeur);
    const tx = n % image.enLargeur;
    for (let y = 0; y < 512 && ty * 512 + y < COTE; y++) for (let x = 0; x < 512 && tx * 512 + x < COTE; x++) if (t[y * 512 + x] !== valeurs[(ty * 512 + y) * COTE + tx * 512 + x]) faux++;
  }
  check(`image ${nom} : relue à l’identique`, image.largeur === COTE && image.nbTuiles === 9 && faux === 0, `${faux} pixels faux`);
  const sortie = fabriquer({ annee: lecteur(image).annee, parts, anneeDeFabrication: 2026, atlas: 'essai', genere: '2026-11-25T00:00:00.000Z' });
  const texte = JSON.stringify([sortie.index, [...sortie.blocs]]);
  reference ??= texte;
  if (texte !== reference) check(`image ${nom} : mêmes fichiers qu’avec la première`, false);
}

// ── Fabrication ──────────────────────────────────────────────────────────────
const image = ouvrir(join(dossier, 'image-5-2.tif'));
const { annee } = lecteur(image);
const { index, blocs } = fabriquer({ annee, parts, anneeDeFabrication: 2026, atlas: 'essai', genere: '2026-11-25T00:00:00.000Z' });
check('périodes : moins de 10 ans, puis 10 à 20 ans, comptés depuis l’année de fabrication', JSON.stringify(periodes(2026)) === '{"depuis":2017,"jeune":[2007,2016]}' && index.depuis === 2017 && index.jeune[0] === 2007 && index.jeune[1] === 2016);
check('lecteur : l’année sous un point, null sans date ou hors de l’image', annee(...point(CASE, 5, 3, 4, 0, 0)) === 2024 && annee(...point(CASE, 0, 0, 0, 0, 0)) === null && annee(60, 30) === null);
const cle = `${CASE[0]}:${CASE[1]}`;
const bloc = `${Math.floor(CASE[0] / BLOC)}_${Math.floor(CASE[1] / BLOC)}`;
const texte = blocs.get(bloc)?.[cle] ?? '';
/** Les 18 bits d'un carré de 500 m, relus comme le fait la carte. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const bits = (k, di, dj) => {
  const o = (k * DIVISIONS * DIVISIONS + di * DIVISIONS + dj) * 3;
  return (ALPHABET.indexOf(texte[o]) << 12) | (ALPHABET.indexOf(texte[o + 1]) << 6) | ALPHABET.indexOf(texte[o + 2]);
};
check('fichier : une case tient en 16 × 81 carrés de trois caractères', texte.length === 16 * 81 * 3 && blocs.size === 1, `${texte.length} caractères, ${blocs.size} bloc(s)`);
check(
  'carré : points récents (bits 0 à 8) et jeunes (bits 9 à 17), dans l’ordre du relevé de la carte',
  bits(5, 3, 4) === ((1 << 0) | (1 << 5) | (1 << (9 + 7))),
  bits(5, 3, 4).toString(2),
);
check('carré voisin : son point jeune, rien d’autre', bits(5, 3, 5) === 1 << (9 + 8), bits(5, 3, 5).toString(2));
check('plus de 20 ans : rien', bits(5, 8, 8) === 0);
check('carré de 4,5 km sans terre française : pas lu', bits(2, 0, 0) === 0);
check('pixel daté à côté du point relevé : rien pour ce point', bits(10, 4, 4) === 0);
let autres = 0;
for (let k = 0; k < 16; k++) for (let di = 0; di < 9; di++) for (let dj = 0; dj < 9; dj++) if (bits(k, di, dj) && !(k === 5 && di === 3 && (dj === 4 || dj === 5))) autres++;
check('aucun autre carré daté dans la case', autres === 0, `${autres} carrés datés en trop`);
check('case sans aucun point daté : absente du fichier', ![...blocs.values()].some((b) => `${CASE[0]}:${CASE[1] + 1}` in b));
check('index : grille, dernière année, blocs', index.v === 1 && index.divisions === 9 && index.bloc === 8 && index.pasLat === PAS_LAT && index.dernierAn === 2024 && index.blocs.join() === bloc && index.carres === 31 * 81, JSON.stringify({ ...index, source: undefined }));
check('écriture : 18 bits en trois caractères', ecrire(0) === 'AAA' && ecrire((1 << 18) - 1) === '___' && ecrire(1) === 'AAB' && ecrire(1 << 9) === 'AIA');

// ── Mêmes réglages que la carte ──────────────────────────────────────────────
check('neuf points par carré : ceux de src/fineGrid.ts', /const OFFSETS = \[1 \/ 6, 1 \/ 2, 5 \/ 6\] as const;/.test(lire('src/fineGrid.ts')) && POINTS.length === 3);
check('découpage : FINE_DIVISIONS de src/config.ts', new RegExp(`export const FINE_DIVISIONS = ${DIVISIONS};`).test(lire('src/config.ts')));
const grille = lire('src/meteoGrid.ts');
check('cases et blocs : METEO_FACTOR et BLOCK de src/meteoGrid.ts', new RegExp(`export const METEO_FACTOR = ${FACTEUR};`).test(grille) && new RegExp(`export const BLOCK = ${BLOC};`).test(grille));
const vraiesParts = JSON.parse(lire('public/foret/parts.json'));
check('grille de public/foret/parts.json : celle de l’essai', vraiesParts.pasLat === PAS_LAT && vraiesParts.pasLon === PAS_LON);

// ── Archive zip ──────────────────────────────────────────────────────────────
/** Archive fabriquée : fichiers compressés ou non, table des matières classique ou zip64. */
function archive(fichiers, zip64) {
  const morceaux = [];
  const entrees = [];
  let position = 0;
  for (const { nom, contenu, methode } of fichiers) {
    const donnees = methode === 8 ? zlib.deflateRawSync(contenu) : contenu;
    const nomOctets = Buffer.from(nom, 'utf8');
    const tete = Buffer.alloc(30);
    tete.writeUInt32LE(0x04034b50, 0);
    tete.writeUInt16LE(methode, 8);
    tete.writeUInt32LE(zlib.crc32(contenu), 14);
    tete.writeUInt32LE(donnees.length, 18);
    tete.writeUInt32LE(contenu.length, 22);
    tete.writeUInt16LE(nomOctets.length, 26);
    morceaux.push(tete, nomOctets, donnees);
    entrees.push({ nomOctets, methode, crc: zlib.crc32(contenu), compresse: donnees.length, taille: contenu.length, position });
    position += 30 + nomOctets.length + donnees.length;
  }
  const debutTable = position;
  for (const e of entrees) {
    const extra = zip64 ? Buffer.alloc(12) : Buffer.alloc(0);
    if (zip64) {
      extra.writeUInt16LE(1, 0);
      extra.writeUInt16LE(8, 2);
      extra.writeBigUInt64LE(BigInt(e.position), 4);
    }
    const t = Buffer.alloc(46);
    t.writeUInt32LE(0x02014b50, 0);
    t.writeUInt16LE(e.methode, 10);
    t.writeUInt32LE(e.crc, 16);
    t.writeUInt32LE(e.compresse, 20);
    t.writeUInt32LE(e.taille, 24);
    t.writeUInt16LE(e.nomOctets.length, 28);
    t.writeUInt16LE(extra.length, 30);
    t.writeUInt32LE(zip64 ? 0xffffffff : e.position, 42);
    morceaux.push(t, e.nomOctets, extra);
    position += 46 + e.nomOctets.length + extra.length;
  }
  const tailleTable = position - debutTable;
  if (zip64) {
    const fin64 = Buffer.alloc(56);
    fin64.writeUInt32LE(0x06064b50, 0);
    fin64.writeBigUInt64LE(44n, 4);
    fin64.writeBigUInt64LE(BigInt(entrees.length), 24);
    fin64.writeBigUInt64LE(BigInt(entrees.length), 32);
    fin64.writeBigUInt64LE(BigInt(tailleTable), 40);
    fin64.writeBigUInt64LE(BigInt(debutTable), 48);
    const repere = Buffer.alloc(20);
    repere.writeUInt32LE(0x07064b50, 0);
    repere.writeBigUInt64LE(BigInt(position), 8);
    repere.writeUInt32LE(1, 16);
    morceaux.push(fin64, repere);
  }
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(zip64 ? 0xffff : entrees.length, 8);
  fin.writeUInt16LE(zip64 ? 0xffff : entrees.length, 10);
  fin.writeUInt32LE(zip64 ? 0xffffffff : tailleTable, 12);
  fin.writeUInt32LE(zip64 ? 0xffffffff : debutTable, 16);
  morceaux.push(fin);
  return Buffer.concat(morceaux);
}
const couche = readFileSync(join(dossier, 'image-5-2.tif'));
const fichiers = [
  { nom: 'disturbance_agent_france_v30.tif', contenu: Buffer.from('autre couche, non lue'), methode: 0 },
  { nom: 'latest_disturbance_france_v30.tif', contenu: couche, methode: 8 },
  { nom: 'annual_disturbance_france_v30.tif', contenu: Buffer.alloc(70_000, 7), methode: 8 },
];
for (const zip64 of [false, true]) {
  const sorte = zip64 ? 'zip64 (plus de 4 Go)' : 'classique';
  const octets = archive(fichiers, zip64);
  const demandes = [];
  const lirePlage = async (debut, fin) => {
    demandes.push(fin - debut + 1);
    return octets.subarray(debut, fin + 1);
  };
  const liste = await lister(lirePlage, octets.length);
  const entree = liste.find((e) => /^latest_disturbance_france_v\d+\.tif$/.test(e.nom));
  check(`archive ${sorte} : table des matières lue par la fin`, liste.length === 3 && entree?.taille === couche.length && liste[2].nom === 'annual_disturbance_france_v30.tif', liste.map((e) => e.nom).join(', '));
  const contenu = entree ? await extraire(lirePlage, entree) : Buffer.alloc(0);
  const lus = demandes.reduce((s, n) => s + n, 0);
  check(`archive ${sorte} : la couche sort entière, sans lire les autres fichiers`, contenu.equals(couche) && lus < octets.length + 65536 && demandes.length <= 4, `${demandes.length} demandes`);
  const abime = Buffer.from(octets);
  abime[entree.position + 30 + entree.nom.length + 40] ^= 0xff;
  let refuse = false;
  try {
    await extraire(async (debut, fin) => abime.subarray(debut, fin + 1), entree);
  } catch {
    refuse = true;
  }
  check(`archive ${sorte} : un téléchargement abîmé est refusé`, refuse);
  // Fichier non compressé : sa taille ne change pas quand un octet change, seule la somme de contrôle le voit.
  const stocke = liste.find((e) => e.methode === 0);
  const fausse = Buffer.from(octets);
  fausse[stocke.position + 30 + stocke.nom.length + 3] ^= 0xff;
  let intact = false;
  let refuseAussi = false;
  try {
    intact = (await extraire(lirePlage, stocke)).equals(fichiers[0].contenu);
    await extraire(async (debut, fin) => fausse.subarray(debut, fin + 1), stocke);
  } catch {
    refuseAussi = true;
  }
  check(`archive ${sorte} : un octet changé est refusé par la somme de contrôle`, intact && refuseAussi);
}

// ── Reprise depuis le site en ligne (cache de la publication perdu) ──────────
// Un faux site, servi ici : l'index et le bloc fabriqués plus haut, puis des pannes.
const SCRIPTS = fileURLToPath(new URL('../scripts/coupes/', import.meta.url));
let site = {};
const serveur = createServer((demande, reponse) => {
  const corps = site[demande.url];
  reponse.writeHead(corps === undefined ? 404 : 200, { 'content-type': 'application/json' });
  reponse.end(corps ?? '');
});
await new Promise((pret) => serveur.listen(0, '127.0.0.1', pret));
const adresse = `http://127.0.0.1:${serveur.address().port}/`;
const lancer = (script, ...options) =>
  new Promise((fini) => execFile(process.execPath, [join(SCRIPTS, script), ...options], (erreur, sortie) => fini({ ok: !erreur, sortie })));
const enLigne = { '/index.json': JSON.stringify(index), [`/b/${bloc}.json`]: JSON.stringify({ v: 1, cases: blocs.get(bloc) }) };
const repris = join(dossier, 'repris');
site = enLigne;
const reprise = await lancer('reprendre.mjs', adresse, repris);
check(
  'reprise : l’index et ses blocs sont recopiés tels quels',
  reprise.ok && readFileSync(join(repris, 'index.json'), 'utf8') === enLigne['/index.json'] && readFileSync(join(repris, 'b', `${bloc}.json`), 'utf8') === enLigne[`/b/${bloc}.json`] && readdirSync(join(repris, 'b')).length === 1,
  reprise.sortie.trim(),
);
const intact = () => existsSync(join(repris, 'index.json')) && readdirSync(join(repris, 'b')).length === 1;
site = { '/index.json': JSON.stringify({ ...index, blocs: [], genere: '' }) };
const vide = await lancer('reprendre.mjs', adresse, repris);
site = { '/index.json': enLigne['/index.json'] };
const troue = await lancer('reprendre.mjs', adresse, repris);
site = {};
const absent = await lancer('reprendre.mjs', adresse, repris);
check('reprise : index sans bloc, bloc manquant ou site sans fichiers, le script échoue sans rien toucher', !vide.ok && !troue.ok && !absent.ok && intact(), `${vide.ok} ${troue.ok} ${absent.ok}`);
await new Promise((ferme) => serveur.close(ferme));

// ── Index sans bloc, écrit faute de mieux par la publication ─────────────────
const faute = join(dossier, 'faute-de-mieux');
mkdirSync(faute);
const premier = await lancer('construire.mjs', '--vide', '--sortie', faute);
const ecrit = existsSync(join(faute, 'index.json')) ? JSON.parse(readFileSync(join(faute, 'index.json'), 'utf8')) : null;
check('index faute de mieux : même grille, aucun bloc, aucune date', premier.ok && ecrit?.v === 1 && ecrit.divisions === 9 && ecrit.bloc === 8 && ecrit.blocs.length === 0 && ecrit.genere === '' && ecrit.pasLat === PAS_LAT, JSON.stringify(ecrit));
const second = await lancer('construire.mjs', '--vide', '--sortie', repris);
check('index faute de mieux : ne remplace jamais de vrais fichiers', second.ok && intact() && readFileSync(join(repris, 'index.json'), 'utf8') === enLigne['/index.json']);

rmSync(dossier, { recursive: true, force: true });
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications réussies`);
process.exit(failed ? 1 : 0);

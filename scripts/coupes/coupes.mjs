// Coupes et dégâts datés, par carré de 500 m : ce que la carte lit pour baisser la chance estimée là
// où la forêt a été coupée, brûlée ou abattue il y a peu (src/cuts.ts).
//
// Source : « année de la dernière perturbation » de l'atlas européen des perturbations forestières
// (une image de la France, pixels de 30 m, EPSG:3035). La carte relève forêts et sols en neuf points
// par carré de 500 m (src/fineGrid.ts) : on lit l'année sous ces mêmes neuf points, pour que la carte
// sache, point par point, si l'arbre hôte qu'elle y voit est encore debout.
//
// Deux périodes, comptées depuis l'année de fabrication : « récent » (moins de 10 ans) et « jeune »
// (10 à 20 ans). Un carré tient en 18 bits (neuf points × deux périodes), écrits en trois caractères.
import { versLaea } from './projection.mjs';

/** Découpage d'un carré de 4,5 km et points relevés dans un carré de 500 m : ceux de src/fineGrid.ts. */
export const DIVISIONS = 9;
export const POINTS = [1 / 6, 1 / 2, 5 / 6];
/** Côté d'une case commune en carrés de 4,5 km, et d'un bloc (un fichier) en cases : ceux de src/meteoGrid.ts. */
export const FACTEUR = 4;
export const BLOC = 8;
export const FORMAT = 1;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Bornes des deux périodes pour une année de fabrication. */
export function periodes(annee) {
  return { depuis: annee - 9, jeune: [annee - 19, annee - 10] };
}

/** 18 bits (points récents, puis points jeunes décalés de 9) en trois caractères. */
export const ecrire = (valeur) => ALPHABET[(valeur >> 12) & 63] + ALPHABET[(valeur >> 6) & 63] + ALPHABET[valeur & 63];

/**
 * Lecteur de l'image : `annee(lat, lon)` rend l'année sous un point, ou null (pas de date, ou hors de
 * l'image). Les tuiles décodées sont gardées par centaines : les carrés sont lus de proche en proche.
 */
export function lecteur(image) {
  const [ex, ey] = image.tags.get(33550);
  const ancre = image.tags.get(33922);
  const x0 = ancre[3] - ancre[0] * ex;
  const y0 = ancre[4] + ancre[1] * ey;
  const vide = Number(image.tags.get(42113));
  const cles = image.tags.get(34735) ?? [];
  let epsg = null;
  for (let k = 4; k + 3 < cles.length; k += 4) if (cles[k] === 3072) epsg = cles[k + 3];
  if (epsg !== 3035) throw new Error(`image en EPSG:${epsg} : ce script ne lit que l'EPSG:3035`);
  if (image.bits !== 16 || image.format !== 2) throw new Error('image : des années en entiers de 16 bits sont attendues');
  const GARDEES = 256;
  const tuiles = new Map();
  const tuile = (n) => {
    let t = tuiles.get(n);
    if (t === undefined) {
      t = image.tuile(n);
      tuiles.set(n, t);
      if (tuiles.size > GARDEES) tuiles.delete(tuiles.keys().next().value);
    }
    return t;
  };
  return {
    annee(lat, lon) {
      const [x, y] = versLaea(lat, lon);
      const col = Math.floor((x - x0) / ex);
      const lig = Math.floor((y0 - y) / ey);
      if (col < 0 || lig < 0 || col >= image.largeur || lig >= image.hauteur) return null;
      const t = tuile(Math.floor(lig / image.hTuile) * image.enLargeur + Math.floor(col / image.lTuile));
      if (!t) return null;
      const v = t[(lig % image.hTuile) * image.lTuile + (col % image.lTuile)];
      return v === vide ? null : v;
    },
  };
}

/**
 * Fabrique l'index et les blocs. `parts` : le fichier public/foret/parts.json, qui donne la grille
 * et dit quels carrés de 4,5 km ont de la terre française (les autres ne sont pas lus).
 * `annee(lat, lon)` : l'année sous un point, ou null.
 */
export function fabriquer({ annee, parts, anneeDeFabrication, atlas, genere }) {
  const { depuis, jeune } = periodes(anneeDeFabrication);
  const pasLat = parts.pasLat / DIVISIONS;
  const pasLon = parts.pasLon / DIVISIONS;
  const blocs = new Map();
  let dernierAn = 0;
  let carres = 0;
  const touches = { recents: 0, jeunes: 0 };
  const cases = Object.entries(parts.cases)
    .map(([cle, liste]) => ({ cle, liste, ij: cle.split(':').map(Number) }))
    .sort((a, b) => a.ij[0] - b.ij[0] || a.ij[1] - b.ij[1]);
  for (const { cle, liste, ij: [i, j] } of cases) {
    let texte = '';
    let rien = true;
    // Les 16 carrés de 4,5 km dans l'ordre de `subBox` (sud → nord, puis ouest → est), et dans chacun
    // ses 81 carrés de 500 m dans le même ordre.
    for (let k = 0; k < FACTEUR * FACTEUR; k++) {
      const bi = i * FACTEUR + Math.floor(k / FACTEUR);
      const bj = j * FACTEUR + (k % FACTEUR);
      const terre = liste[k] !== null && liste[k] !== undefined;
      for (let di = 0; di < DIVISIONS; di++) {
        for (let dj = 0; dj < DIVISIONS; dj++) {
          let valeur = 0;
          if (terre) {
            carres++;
            const sud = (bi * DIVISIONS + di) * pasLat;
            const ouest = (bj * DIVISIONS + dj) * pasLon;
            POINTS.forEach((fy, iy) => {
              POINTS.forEach((fx, ix) => {
                const an = annee(sud + fy * pasLat, ouest + fx * pasLon);
                if (an === null) return;
                if (an > dernierAn) dernierAn = an;
                const point = iy * POINTS.length + ix;
                if (an >= depuis) valeur |= 1 << point;
                else if (an >= jeune[0]) valeur |= 1 << (point + 9);
              });
            });
            if (valeur & 0x1ff) touches.recents++;
            if (valeur >> 9) touches.jeunes++;
          }
          if (valeur) rien = false;
          texte += ecrire(valeur);
        }
      }
    }
    if (rien) continue; // case sans aucun point daté : absente du fichier, donc « rien »
    const bloc = `${Math.floor(i / BLOC)}_${Math.floor(j / BLOC)}`;
    if (!blocs.has(bloc)) blocs.set(bloc, {});
    blocs.get(bloc)[cle] = texte;
  }
  const index = {
    v: FORMAT,
    pasLat: parts.pasLat,
    pasLon: parts.pasLon,
    divisions: DIVISIONS,
    bloc: BLOC,
    points: POINTS.map((p) => +p.toFixed(4)),
    depuis,
    jeune,
    dernierAn: dernierAn || null,
    genere,
    atlas,
    source: 'European Forest Disturbance Atlas (Viana-Soto, Senf et al., Zenodo), CC BY 4.0 : année de la dernière perturbation, Landsat, 30 m',
    carres,
    touches,
    blocs: [...blocs.keys()].sort(),
  };
  return { index, blocs };
}

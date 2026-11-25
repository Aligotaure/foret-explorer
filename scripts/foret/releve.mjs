// Relevé des carrés de 500 m sur toute la France, comme la carte le fait dans la vue (src/fineGrid.ts) :
// elle lit ce qu'il y a sous 3 × 3 points de chaque carré, aux 1/6, 1/2 et 5/6 de son côté. Ces points
// forment un treillis régulier : le point (ligne r, colonne c) est à la latitude (r + 0,5) × pasLat et
// à la longitude (c + 0,5) × pasLon, pasLat et pasLon valant un tiers de carré. Le carré de 500 m
// (I, J) tient donc les lignes 3I à 3I + 2 et les colonnes 3J à 3J + 2.
//
// Aucune dépendance, aucun import : les tests (tests/foret.mjs) chargent ce fichier seul.

/**
 * Treillis de points sur une emprise (degrés) : une valeur de 0 à 255 par point (0 : rien).
 * `pose(r, c, v)` remplace ce qui s'y trouvait : le dernier polygone tracé l'emporte. Les polygones
 * voisins de la BD Forêt et des sols se recouvrent souvent d'un liseré (chacun est simplifié à part) ;
 * pour garder le même que la carte, tracer les tuiles dans l'ordre de `ordreDeTrace`.
 */
export function creerTreillis({ south, north, west, east }, pasLat, pasLon) {
  const r0 = Math.floor(south / pasLat);
  const c0 = Math.floor(west / pasLon);
  const lignes = Math.ceil(north / pasLat) - r0 + 1;
  const colonnes = Math.ceil(east / pasLon) - c0 + 1;
  const valeurs = new Uint8Array(lignes * colonnes);
  const rang = (r, c) => (r < r0 || c < c0 || r >= r0 + lignes || c >= c0 + colonnes ? -1 : (r - r0) * colonnes + (c - c0));
  return {
    pasLat,
    pasLon,
    r0,
    c0,
    lignes,
    colonnes,
    valeurs,
    lit: (r, c) => {
      const k = rang(r, c);
      return k < 0 ? 0 : valeurs[k];
    },
    pose: (r, c, v) => {
      const k = rang(r, c);
      if (k >= 0) valeurs[k] = v;
    },
  };
}

/**
 * Ordre dans lequel tracer des tuiles ([x, y] d'un même zoom) pour retrouver, là où deux polygones se
 * recouvrent, celui que garde le relevé de la carte (`CellIndex` de src/fineGrid.ts : le premier que
 * rend MapLibre). MapLibre rend les tuiles du nord au sud puis d'ouest en est, et dans chaque tuile
 * ses objets du dernier au premier : le gagnant est donc le dernier objet de la tuile la plus au
 * nord, puis la plus à l'ouest. Comme le dernier tracé l'emporte ici, on trace les tuiles du sud au
 * nord et d'est en ouest, et dans chaque tuile les objets dans leur ordre (`tracerTuile`).
 * Mesuré le 25/11/2026 dans les Landes : 6 points sur 18 468 différaient de la carte avec « le premier
 * tracé l'emporte », tous dans un tel liseré.
 */
export const ordreDeTrace = (tuiles) => [...tuiles].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

/**
 * Points du treillis situés dans un polygone : `pose(colonne, ligne)` pour chacun. `rings` : tous ses
 * anneaux, en coordonnées du treillis ([colonne, ligne], nombres réels). Règle pair-impair (les trous
 * sont gérés), la même que `inside` de src/fineGrid.ts : un point posé pile sur un bord ouest ou sud
 * est dedans, sur un bord est ou nord il est dehors.
 */
export function remplir(rings, pose) {
  const passages = new Map(); // ligne → abscisses où un bord la coupe
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xa, ya] = ring[i];
      const [xb, yb] = ring[j];
      if (ya === yb) continue; // un bord horizontal ne compte jamais
      const bas = Math.min(ya, yb);
      const haut = Math.max(ya, yb);
      for (let y = Math.ceil(bas); y < haut; y++) {
        const x = ((xb - xa) * (y - ya)) / (yb - ya) + xa;
        const liste = passages.get(y);
        if (liste) liste.push(x);
        else passages.set(y, [x]);
      }
    }
  }
  for (const [y, xs] of passages) {
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]); x < xs[k + 1]; x++) pose(x, y);
  }
}

/**
 * Passage des unités d'une tuile XYZ (côté `extent`, y vers le bas) aux coordonnées du treillis :
 * rend `(px, py) => [colonne, ligne]`. Les latitudes sont calculées une fois par ordonnée entière
 * (les sommets d'une tuile vectorielle sont des entiers), marge de 256 unités comprise.
 */
export function versTreillis(z, x, y, extent, pasLat, pasLon) {
  const n = 2 ** z;
  const MARGE = 256;
  const ligneDe = new Float64Array(extent + 2 * MARGE + 1);
  for (let k = 0; k < ligneDe.length; k++) {
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + (k - MARGE) / extent)) / n))) * 180) / Math.PI;
    ligneDe[k] = lat / pasLat - 0.5;
  }
  const ligneExacte = (py) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n))) * 180) / Math.PI / pasLat - 0.5;
  return (px, py) => [
    (((x + px / extent) / n) * 360 - 180) / pasLon - 0.5,
    Number.isInteger(py) && py >= -MARGE && py <= extent + MARGE ? ligneDe[py + MARGE] : ligneExacte(py),
  ];
}

/**
 * Regroupe les anneaux d'un objet de tuile en polygones, comme le fait MapLibre (`classifyRings` de
 * @mapbox/vector-tile) : le premier anneau donne le sens des contours ; un anneau de même sens ouvre
 * un polygone, un anneau de sens contraire est un trou du polygone en cours. Un anneau sans surface
 * est ignoré. Chaque polygone se remplit à part (`remplir`) : c'est ainsi que la carte les lit.
 */
export function polygones(rings) {
  if (rings.length <= 1) return [rings];
  const liste = [];
  let polygone;
  let sens;
  for (const ring of rings) {
    let somme = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) somme += (ring[i][0] - ring[j][0]) * (ring[j][1] + ring[i][1]);
    if (somme === 0) continue;
    if (sens === undefined) sens = somme < 0;
    if (sens === somme < 0) {
      if (polygone) liste.push(polygone);
      polygone = [ring];
    } else polygone.push(ring);
  }
  if (polygone) liste.push(polygone);
  return liste;
}

/** Trace sur le treillis tous les polygones d'une couche de tuile (`lireCouche` de mvt.mjs) : `rangDe(valeur)` de 1 à 255, 0 pour l'ignorer. */
export function tracerTuile(treillis, z, x, y, couche, rangDe) {
  if (!couche) return 0;
  const vers = versTreillis(z, x, y, couche.extent, treillis.pasLat, treillis.pasLon);
  let traces = 0;
  const E = couche.extent;
  // MapLibre ne range un objet dans l'index d'une tuile que par ses anneaux qui en touchent le cœur :
  // un objet tout entier dans la marge (les 80 unités qui débordent sur la tuile voisine) n'est jamais
  // rendu par cette tuile, c'est la voisine qui le porte.
  const toucheLeCoeur = (ring) => {
    let [xmin, ymin, xmax, ymax] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [px, py] of ring) {
      if (px < xmin) xmin = px;
      if (px > xmax) xmax = px;
      if (py < ymin) ymin = py;
      if (py > ymax) ymax = py;
    }
    return xmin < E && ymin < E && xmax >= 0 && ymax >= 0;
  };
  for (const o of couche.objets) {
    const v = o.valeur ? rangDe(o.valeur) : 0;
    if (!v || !o.rings.some(toucheLeCoeur)) continue;
    for (const polygone of polygones(o.rings)) {
      remplir(
        polygone.map((ring) => ring.map(([px, py]) => vers(px, py))),
        (c, r) => treillis.pose(r, c, v),
      );
    }
    traces++;
  }
  return traces;
}

// Géométrie du calcul des parts de forêt (scripts/foret/parts.mjs) : aires, découpage d'un anneau
// par un rectangle, conversions entre tuiles XYZ et degrés. Aucune dépendance, aucun import : les
// tests (tests/foret.mjs) chargent ce fichier seul.

/** Aire signée d'un anneau [[x, y], …] (formule du lacet). */
export function aire(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return s / 2;
}

/** Découpe d'un anneau par un demi-plan (Sutherland-Hodgman) : garde(p) dit de quel côté, coupe(a, b) rend le point de passage. */
function couper(ring, garde, coupe) {
  const out = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    const ga = garde(a);
    const gb = garde(b);
    if (ga && gb) out.push(b);
    else if (ga && !gb) out.push(coupe(a, b));
    else if (!ga && gb) out.push(coupe(a, b), b);
  }
  return out;
}

/**
 * Aire signée de la partie d'un anneau située dans le rectangle [x0, x1] × [y0, y1]. Le signe est
 * celui de l'anneau : un trou, de sens contraire à son contour, se retranche tout seul.
 */
export function aireDans(ring, x0, y0, x1, y1) {
  const enX = (x) => (a, b) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const enY = (y) => (a, b) => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];
  let r = couper(ring, (p) => p[0] >= x0, enX(x0));
  if (r.length < 3) return 0;
  r = couper(r, (p) => p[0] <= x1, enX(x1));
  if (r.length < 3) return 0;
  r = couper(r, (p) => p[1] >= y0, enY(y0));
  if (r.length < 3) return 0;
  r = couper(r, (p) => p[1] <= y1, enY(y1));
  return r.length < 3 ? 0 : aire(r);
}

/** Position (flottante) d'un point dans la grille des tuiles XYZ du zoom `z`. */
export function tileOf(lon, lat, z) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

/** Longitude et latitude d'une position (flottante) de la grille des tuiles. */
export function lonLatOf(x, y, z) {
  const n = 2 ** z;
  return [(x / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI];
}

/** Emprise d'une tuile, en degrés. */
export function tileBounds(z, x, y) {
  const [west, north] = lonLatOf(x, y, z);
  const [east, south] = lonLatOf(x + 1, y + 1, z);
  return { west, south, east, north };
}

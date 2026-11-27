// EPSG:3035 (ETRS89 / Lambert azimutale équivalente d'Europe, ellipsoïde GRS80) : la projection des
// cartes de l'atlas européen des perturbations forestières. Les deux sens, sans dépendance.
// Formules de la note d'orientation 7-2 de l'EPSG (méthode 9820), vérifiées sur son point d'exemple
// (50° N, 5° E ↔ 3 962 799,45 m ; 2 999 718,85 m) par tests/coupes.mjs.
const A = 6378137;
const F = 1 / 298.257222101;
const E2 = 2 * F - F * F;
const E = Math.sqrt(E2);
const RAD = Math.PI / 180;
const q = (s) => (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
const QP = q(1);
const PHI0 = 52 * RAD;
const LAM0 = 10 * RAD;
const BETA0 = Math.asin(q(Math.sin(PHI0)) / QP);
const SB0 = Math.sin(BETA0);
const CB0 = Math.cos(BETA0);
const RQ = A * Math.sqrt(QP / 2);
const D = (A * (Math.cos(PHI0) / Math.sqrt(1 - E2 * Math.sin(PHI0) ** 2))) / (RQ * CB0);
const FE = 4321000;
const FN = 3210000;
const E4 = E2 * E2;
const E6 = E4 * E2;
const C2 = E2 / 3 + (31 * E4) / 180 + (517 * E6) / 5040;
const C4 = (23 * E4) / 360 + (251 * E6) / 3780;
const C6 = (761 * E6) / 45360;

/** Latitude et longitude (degrés) vers [x, y] en mètres. */
export function versLaea(lat, lon) {
  const beta = Math.asin(q(Math.sin(lat * RAD)) / QP);
  const dl = lon * RAD - LAM0;
  const sb = Math.sin(beta);
  const cb = Math.cos(beta);
  const b = RQ * Math.sqrt(2 / (1 + SB0 * sb + CB0 * cb * Math.cos(dl)));
  return [FE + b * D * cb * Math.sin(dl), FN + (b / D) * (CB0 * sb - SB0 * cb * Math.cos(dl))];
}

/** [x, y] en mètres vers [latitude, longitude] en degrés. */
export function versLatLon(x, y) {
  const dx = (x - FE) / D;
  const dy = D * (y - FN);
  const rho = Math.sqrt(dx * dx + dy * dy);
  if (rho === 0) return [PHI0 / RAD, LAM0 / RAD];
  const c = 2 * Math.asin(rho / (2 * RQ));
  const sc = Math.sin(c);
  const cc = Math.cos(c);
  const beta = Math.asin(cc * SB0 + (dy * sc * CB0) / rho);
  const lon = (LAM0 + Math.atan2((x - FE) * sc, D * rho * CB0 * cc - D * D * (y - FN) * SB0 * sc)) / RAD;
  const lat = (beta + C2 * Math.sin(2 * beta) + C4 * Math.sin(4 * beta) + C6 * Math.sin(6 * beta)) / RAD;
  return [lat, lon];
}

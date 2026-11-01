/**
 * Mesure de la consommation des API (Open-Meteo, Géoplateforme IGN, tuiles de géologie).
 *
 * Les compteurs restent en mémoire et partent, groupés, vers le serveur de mesure (Cloudflare,
 * `worker/`) quand il est configuré (`VITE_METRICS_URL` au moment du build) : au plus un envoi
 * par minute, plus un au moment de quitter la page. Aucun identifiant, aucun cookie : le serveur
 * n'additionne que des totaux par jour. Le signal « Global Privacy Control » du navigateur coupe
 * l'envoi.
 */
import { METRICS_URL } from './config';
import type { MetricName } from './metricsSchema';

const pending = new Map<MetricName, number>();
/** Totaux depuis l'ouverture de la page (console de développement, tests). */
const totals = new Map<MetricName, number>();
let enabled = false;

export function track(name: MetricName, n = 1): void {
  if (!(n > 0)) return;
  pending.set(name, (pending.get(name) ?? 0) + n);
  totals.set(name, (totals.get(name) ?? 0) + n);
}

/** Totaux de la visite en cours. */
export function sessionTotals(): Record<string, number> {
  return Object.fromEntries(totals);
}

function takePayload(): string | null {
  if (!pending.size) return null;
  const counts: Record<string, number> = {};
  for (const [name, n] of pending) counts[name] = Math.round(n);
  pending.clear();
  return JSON.stringify({ v: 1, c: counts });
}

/** Envoie les compteurs en attente (sendBeacon quand la page se ferme, sinon fetch). */
export function flush(closing = false): void {
  if (!enabled) return;
  const body = takePayload();
  if (!body) return;
  const url = `${METRICS_URL}/collect`;
  // text/plain : requête « simple », sans pré-vérification CORS.
  if (closing && navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return;
  void fetch(url, {
    method: 'POST',
    body,
    keepalive: true,
    credentials: 'omit',
    headers: { 'Content-Type': 'text/plain' },
  }).catch(() => {
    /* serveur injoignable : ces compteurs sont perdus, la carte continue */
  });
}

const privacySignal = (): boolean => (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

/** Compte la visite et programme les envois. */
export function startMetrics(mobile: boolean): void {
  track('app.sessions');
  if (mobile) track('app.sessionsMobile');
  enabled = Boolean(METRICS_URL) && !privacySignal();
  if (!enabled) return;
  window.setTimeout(() => flush(), 15_000);
  window.setInterval(() => flush(), 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', () => flush(true));
}

/** Requêtes de tuiles et de polices faites par MapLibre (appelé par `transformRequest`). */
export function trackMapRequest(url: string, resourceType?: string): void {
  if (resourceType === 'Glyphs') return track('ign.fonts');
  if (resourceType !== 'Tile') return;
  if (url.includes('LANDCOVER-TMS.FORESTINVENTORY.V2')) track('ign.tiles.forest');
  else if (url.includes('/data/geologie/')) track('pages.geology');
  else if (url.includes('LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2')) track('ign.tiles.plan');
  else if (url.includes('LAYER=ORTHOIMAGERY.ORTHOPHOTOS')) track('ign.tiles.ortho');
  else if (url.includes('LAYER=LANDCOVER.FORESTINVENTORY.V2')) track('ign.tiles.forestRaster');
}

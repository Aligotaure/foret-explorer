/**
 * Météo des 20 derniers jours (Open-Meteo, sans clé, CORS ouvert) et altitude (Géoplateforme IGN).
 *
 * Open-Meteo renvoie, pour chaque point, les cumuls de pluie et les températures min/max par jour,
 * déjà ramenées à l'altitude du point (modèle numérique de terrain à 90 m, ou `elevation` fourni).
 * Plusieurs points par requête → réponse sous forme de tableau, dans le même ordre.
 */
import { ALTITUDE_BATCH, ALTITUDE_SPACING_MS, ALTITUDE_URL, OPEN_METEO_URL, PAST_DAYS } from './config';
import { track } from './metrics';
import { openMeteoCalls10 } from './metricsSchema';

export interface DailySeries {
  /** Dates (AAAA-MM-JJ) du plus ancien au plus récent ; le dernier jour est aujourd'hui. */
  dates: string[];
  rain: number[];
  tmax: (number | null)[];
  tmin: (number | null)[];
  /** Altitude utilisée par Open-Meteo pour ses températures (m). */
  elevation: number;
}

export interface RainEvent {
  /** Pluie cumulée sur 3 jours (mm). */
  amount: number;
  /** Jours écoulés depuis le jour le plus arrosé de l'épisode. */
  daysAgo: number;
  date: string;
}

export interface PastDay {
  date: string;
  daysAgo: number;
  rain: number;
  tmin: number | null;
  tmax: number | null;
}

export interface WeatherSummary {
  elevation: number;
  /** Jours passés, du plus ancien au plus récent (aujourd'hui exclu). */
  days: PastDay[];
  rain20: number;
  rain7: number;
  rain3: number;
  /** Épisodes pluvieux d'au moins EVENT_MIN_MM sur 3 jours, du plus récent au plus ancien. */
  events: RainEvent[];
  /** Moyenne des (min + max) / 2 sur les 7 derniers jours (°C). */
  tmean7: number | null;
  /** Minimum des 5 derniers jours (°C). */
  tmin5: number | null;
  frost: boolean;
}

/** Pluie minimale sur 3 jours pour parler d'« épisode » (mm). */
export const EVENT_MIN_MM = 15;
/** En dessous de ce minimum (°C), on considère qu'il a gelé. */
export const FROST_C = -1;

const round1 = (x: number): number => Math.round(x * 10) / 10;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Date du jour à Paris (AAAA-MM-JJ) : sert de clé de cache. */
export function todayKey(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now);
}

export function summarize(series: DailySeries): WeatherSummary {
  const n = series.dates.length - 1; // le dernier jour (aujourd'hui) est incomplet
  const days: PastDay[] = [];
  for (let i = 0; i < n; i++) {
    days.push({
      date: series.dates[i] ?? '',
      daysAgo: n - i,
      rain: series.rain[i] ?? 0,
      tmin: series.tmin[i] ?? null,
      tmax: series.tmax[i] ?? null,
    });
  }
  const rains = days.map((d) => d.rain);

  // Épisodes : maxima locaux des cumuls glissants sur 3 jours (fenêtre qui se termine au jour i).
  const windows = rains.map((_, i) => sum(rains.slice(Math.max(0, i - 2), i + 1)));
  const found: { index: number; event: RainEvent }[] = [];
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i] ?? 0;
    if (w < EVENT_MIN_MM) continue;
    if (w < Math.max(...windows.slice(Math.max(0, i - 2), i + 3))) continue;
    const previous = found[found.length - 1];
    if (previous && i - previous.index <= 2) continue; // même épisode
    // Jour le plus arrosé de la fenêtre : c'est lui qui « déclenche » la pousse.
    let peak = i;
    for (let j = Math.max(0, i - 2); j <= i; j++) if ((rains[j] ?? 0) > (rains[peak] ?? 0)) peak = j;
    found.push({ index: i, event: { amount: round1(w), daysAgo: n - peak, date: days[peak]?.date ?? '' } });
  }
  const events = found.map((f) => f.event).sort((a, b) => a.daysAgo - b.daysAgo);

  const last = (k: number): PastDay[] => days.slice(Math.max(0, n - k));
  const means = last(7)
    .map((d) => (d.tmin !== null && d.tmax !== null ? (d.tmin + d.tmax) / 2 : null))
    .filter((x): x is number => x !== null);
  const mins = last(5)
    .map((d) => d.tmin)
    .filter((x): x is number => x !== null);
  const tmin5 = mins.length ? Math.min(...mins) : null;

  return {
    elevation: series.elevation,
    days,
    rain20: round1(sum(rains)),
    rain7: round1(sum(last(7).map((d) => d.rain))),
    rain3: round1(sum(last(3).map((d) => d.rain))),
    events,
    tmean7: means.length ? round1(sum(means) / means.length) : null,
    tmin5,
    frost: tmin5 !== null && tmin5 <= FROST_C,
  };
}

interface OpenMeteoDaily {
  elevation?: number;
  daily?: {
    time?: string[];
    precipitation_sum?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
  };
}

function parse(item: OpenMeteoDaily): DailySeries {
  const d = item.daily ?? {};
  return {
    dates: d.time ?? [],
    rain: (d.precipitation_sum ?? []).map((x) => x ?? 0),
    tmax: d.temperature_2m_max ?? [],
    tmin: d.temperature_2m_min ?? [],
    elevation: item.elevation ?? 0,
  };
}

export interface WeatherPoint {
  lat: number;
  lon: number;
  /** Altitude réelle du point (m) : Open-Meteo y ramène les températures. */
  elevation?: number;
}

/** Pluie et températures des PAST_DAYS derniers jours pour une liste de points (une seule requête). */
export async function fetchDaily(points: readonly WeatherPoint[], signal?: AbortSignal): Promise<DailySeries[]> {
  if (!points.length) return [];
  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set('latitude', points.map((p) => p.lat.toFixed(4)).join(','));
  url.searchParams.set('longitude', points.map((p) => p.lon.toFixed(4)).join(','));
  if (points.every((p) => typeof p.elevation === 'number')) {
    url.searchParams.set('elevation', points.map((p) => Math.round(p.elevation ?? 0)).join(','));
  }
  const variables = ['precipitation_sum', 'temperature_2m_max', 'temperature_2m_min'];
  url.searchParams.set('daily', variables.join(','));
  url.searchParams.set('past_days', String(PAST_DAYS));
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('timezone', 'Europe/Paris');
  track('openMeteo.requests');
  track('openMeteo.locations', points.length);
  track('openMeteo.calls10', openMeteoCalls10(points.length, PAST_DAYS + 1, variables.length));
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Météo : HTTP ${response.status}`);
    const data = (await response.json()) as OpenMeteoDaily | OpenMeteoDaily[];
    return (Array.isArray(data) ? data : [data]).map(parse);
  } catch (error) {
    if (!signal?.aborted) track('openMeteo.errors');
    throw error;
  }
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

const parseElevation = (value: unknown): number | null => {
  const z = typeof value === 'number' ? value : (value as { z?: unknown } | null)?.z;
  // L'API renvoie -99999 hors de sa couverture.
  return typeof z === 'number' && z > -1000 ? Math.round(z) : null;
};

/**
 * Altitudes IGN (RGE ALTI) d'une liste de points, en mètres : requêtes de ALTITUDE_BATCH points,
 * l'une après l'autre (limite de 5 requêtes par seconde). `onBatch` reçoit chaque lot dès son arrivée.
 */
export async function fetchAltitudes(
  points: readonly { lon: number; lat: number }[],
  signal?: AbortSignal,
  onBatch?: (start: number, values: (number | null)[]) => void,
): Promise<(number | null)[]> {
  const out: (number | null)[] = [];
  for (let start = 0; start < points.length; start += ALTITUDE_BATCH) {
    if (start > 0) await sleep(ALTITUDE_SPACING_MS, signal);
    const chunk = points.slice(start, start + ALTITUDE_BATCH);
    const url = new URL(ALTITUDE_URL);
    url.searchParams.set('lon', chunk.map((p) => p.lon.toFixed(5)).join('|'));
    url.searchParams.set('lat', chunk.map((p) => p.lat.toFixed(5)).join('|'));
    url.searchParams.set('resource', 'ign_rge_alti_wld');
    url.searchParams.set('zonly', 'true');
    track('ign.altitude.requests');
    track('ign.altitude.points', chunk.length);
    let values: (number | null)[];
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`Altitude : HTTP ${response.status}`);
      const data = (await response.json()) as { elevations?: unknown[] };
      values = chunk.map((_, i) => parseElevation(data.elevations?.[i]));
    } catch (error) {
      if (!signal?.aborted) track('ign.altitude.errors');
      throw error;
    }
    out.push(...values);
    onBatch?.(start, values);
  }
  return out;
}

/** Altitude IGN (RGE ALTI) d'un point, en mètres. */
export async function fetchAltitude(lon: number, lat: number, signal?: AbortSignal): Promise<number | null> {
  const [z] = await fetchAltitudes([{ lon, lat }], signal);
  return z ?? null;
}

// ── Grille de cellules pour la carte ─────────────────────────────────────────

export interface GridCell {
  id: string;
  lat: number;
  lon: number;
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Pas de base ≈ 4,5 km, doublé tant que la vue contient trop de cellules. */
export const BASE_STEP_LAT = 0.04;
export const BASE_STEP_LON = 0.056;

export function cellsForBounds(
  bounds: { west: number; south: number; east: number; north: number },
  maxCells = 120,
): GridCell[] {
  let factor = 1;
  for (;;) {
    const dLat = BASE_STEP_LAT * factor;
    const dLon = BASE_STEP_LON * factor;
    const i0 = Math.floor(bounds.south / dLat);
    const i1 = Math.floor(bounds.north / dLat);
    const j0 = Math.floor(bounds.west / dLon);
    const j1 = Math.floor(bounds.east / dLon);
    const count = (i1 - i0 + 1) * (j1 - j0 + 1);
    if (count > maxCells && factor < 64) {
      factor *= 2;
      continue;
    }
    const cells: GridCell[] = [];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const south = i * dLat;
        const west = j * dLon;
        cells.push({
          id: `${factor}:${i}:${j}`,
          south: +south.toFixed(5),
          north: +(south + dLat).toFixed(5),
          west: +west.toFixed(5),
          east: +(west + dLon).toFixed(5),
          lat: +(south + dLat / 2).toFixed(4),
          lon: +(west + dLon / 2).toFixed(4),
        });
      }
    }
    return cells;
  }
}

// ── Cache du jour (mémoire + localStorage) ───────────────────────────────────

const CACHE_KEY = 'foret-explorer:meteo';
let cacheDay = '';
const cache = new Map<string, DailySeries>();

function loadCache(day: string): void {
  if (cacheDay === day) return;
  cacheDay = day;
  cache.clear();
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const saved = raw ? (JSON.parse(raw) as { day?: string; cells?: Record<string, DailySeries> }) : null;
    if (saved?.day === day && saved.cells) for (const [k, v] of Object.entries(saved.cells)) cache.set(k, v);
  } catch {
    /* cache indisponible : on refera les requêtes */
  }
}

function saveCache(): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ day: cacheDay, cells: Object.fromEntries(cache) }));
  } catch {
    /* quota dépassé ou stockage bloqué : le cache reste en mémoire */
  }
}

/** Météo des cellules (cache du jour, puis requêtes groupées pour les manquantes). */
export async function weatherForCells(cells: readonly GridCell[], signal?: AbortSignal): Promise<Map<string, DailySeries>> {
  loadCache(todayKey());
  const key = (c: GridCell): string => `${c.lat},${c.lon}`;
  const missing = cells.filter((c) => !cache.has(key(c)));
  track('openMeteo.cacheHits', cells.length - missing.length);
  for (let k = 0; k < missing.length; k += 100) {
    const chunk = missing.slice(k, k + 100);
    const series = await fetchDaily(chunk, signal);
    chunk.forEach((c, i) => {
      const s = series[i];
      if (s) cache.set(key(c), s);
    });
  }
  if (missing.length) saveCache();
  const out = new Map<string, DailySeries>();
  for (const c of cells) {
    const s = cache.get(key(c));
    if (s) out.set(c.id, s);
  }
  return out;
}

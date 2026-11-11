/**
 * Météo des 30 derniers jours et altitude (Géoplateforme IGN).
 *
 * La météo vient des fichiers communs publiés avec le site (`data/meteo/`, voir meteoGrid.ts et
 * scripts/meteo/) : une série par case d'environ 18 km, mise à jour chaque nuit par une tâche GitHub
 * qui seule interroge Open-Meteo. La carte n'appelle Open-Meteo elle-même que si ces fichiers sont
 * injoignables ou en retard de plus de METEO_MAX_LATE_DAYS jours, ou pour un point hors de la France
 * métropolitaine.
 *
 * Les températures d'Open-Meteo sont données à l'altitude du point de relevé ; `atAltitude` les
 * ramène à l'altitude voulue (−0,65 °C par 100 m). La pluie, elle, reste celle de la case.
 */
import {
  ALTITUDE_BATCH,
  ALTITUDE_SPACING_MS,
  ALTITUDE_URL,
  DIRECT_MAX_CELLS,
  DIRECT_PAST_DAYS,
  METEO_BASE,
  METEO_MAX_LATE_DAYS,
  OPEN_METEO_URL,
} from './config';
import {
  BLOCK,
  KEPT_DAYS,
  METEO_FORMAT,
  STEP_LAT,
  STEP_LON,
  SUB_COUNT,
  addDays,
  blockOf,
  cellAt,
  cellBox,
  cellId,
  parisDate,
  subIndexAt,
  type BlockFile,
  type CellRef,
  type MeteoIndexFile,
} from './meteoGrid';
import { track } from './metrics';
import { openMeteoCalls10 } from './metricsSchema';

export interface DailySeries {
  /** Jours complets (AAAA-MM-JJ), du plus ancien au plus récent ; aujourd'hui n'y est jamais. */
  dates: string[];
  rain: (number | null)[];
  tmax: (number | null)[];
  tmin: (number | null)[];
  /** Altitude à laquelle les températures sont données (m). */
  elevation: number;
  /**
   * Fichiers communs seulement : altitude (m) de chacun des carrés de 4,5 km de la case, dans l'ordre
   * de `subBox` (null : carré sans terre française).
   */
  subAltitudes?: readonly (number | null)[];
  /**
   * Fichiers communs seulement : dernier jour définitif. Un jour plus récent est une estimation
   * (relevé pris en cours de journée, complété par la prévision), remplacée à la mise à jour suivante.
   */
  finalUntil?: string;
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
  /** Null : jour inconnu (données pas encore à jour). */
  rain: number | null;
  tmin: number | null;
  tmax: number | null;
  /** Valeurs provisoires (prévision au moment du relevé), en attendant la mise à jour du jour. */
  estimated: boolean;
}

export interface WeatherSummary {
  elevation: number;
  /** Les KEPT_DAYS derniers jours, du plus ancien à hier. */
  days: PastDay[];
  /** Dernier jour connu (null : aucun). */
  lastDate: string | null;
  /** Le dernier jour connu est une estimation (voir `PastDay.estimated`). */
  estimated: boolean;
  rain30: number;
  /** Pluie des 20 derniers jours : c'est elle qui mesure l'humidité du sol dans l'indice. */
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
/** Gradient thermique standard (°C par mètre). */
export const LAPSE_RATE = 0.0065;

const round1 = (x: number): number => Math.round(x * 10) / 10;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Date du jour à Paris (AAAA-MM-JJ). */
export const todayKey = (now = new Date()): string => parisDate(now);

/** Résumé des KEPT_DAYS jours qui précèdent `today` ; un jour absent des données reste inconnu. */
export function summarize(series: DailySeries, today = todayKey()): WeatherSummary {
  const position = new Map(series.dates.map((d, i) => [d, i] as const));
  const days: PastDay[] = [];
  for (let k = KEPT_DAYS; k >= 1; k--) {
    const date = addDays(today, -k);
    const i = position.get(date);
    days.push({
      date,
      daysAgo: k,
      rain: i === undefined ? null : (series.rain[i] ?? null),
      tmin: i === undefined ? null : (series.tmin[i] ?? null),
      tmax: i === undefined ? null : (series.tmax[i] ?? null),
      estimated: i !== undefined && series.finalUntil !== undefined && date > series.finalUntil,
    });
  }
  const rains = days.map((d) => d.rain ?? 0);
  const n = days.length;

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
    found.push({ index: i, event: { amount: round1(w), daysAgo: days[peak]?.daysAgo ?? 0, date: days[peak]?.date ?? '' } });
  }
  const events = found.map((f) => f.event).sort((a, b) => a.daysAgo - b.daysAgo);

  const last = (k: number): PastDay[] => days.slice(Math.max(0, n - k));
  const rainOf = (list: PastDay[]): number => round1(sum(list.map((d) => d.rain ?? 0)));
  const means = last(7)
    .map((d) => (d.tmin !== null && d.tmax !== null ? (d.tmin + d.tmax) / 2 : null))
    .filter((x): x is number => x !== null);
  const mins = last(5)
    .map((d) => d.tmin)
    .filter((x): x is number => x !== null);
  const tmin5 = mins.length ? Math.min(...mins) : null;
  const known = days.filter((d) => d.rain !== null);

  return {
    elevation: series.elevation,
    days,
    lastDate: known[known.length - 1]?.date ?? null,
    estimated: known[known.length - 1]?.estimated ?? false,
    rain30: rainOf(days),
    rain20: rainOf(last(20)),
    rain7: rainOf(last(7)),
    rain3: rainOf(last(3)),
    events,
    tmean7: means.length ? round1(sum(means) / means.length) : null,
    tmin5,
    frost: tmin5 !== null && tmin5 <= FROST_C,
  };
}

/** Températures ramenées à l'altitude `z` (la pluie ne change pas). */
export function atAltitude(series: DailySeries, z: number | null): DailySeries {
  if (z === null || !Number.isFinite(series.elevation)) return series;
  const shift = -LAPSE_RATE * (z - series.elevation);
  const move = (t: number | null): number | null => (t === null ? null : Math.round((t + shift) * 10) / 10);
  return { ...series, tmax: series.tmax.map(move), tmin: series.tmin.map(move), elevation: z };
}

/**
 * Même résumé, températures ramenées à l'altitude `z` : le décalage est le même chaque jour, donc
 * inutile de tout recalculer (la grille le fait pour les 16 carrés de chaque case).
 */
export function summaryAtAltitude(w: WeatherSummary, z: number | null): WeatherSummary {
  if (z === null || !Number.isFinite(w.elevation) || z === w.elevation) return w;
  const shift = -LAPSE_RATE * (z - w.elevation);
  const move = (t: number | null): number | null => (t === null ? null : round1(t + shift));
  const tmin5 = move(w.tmin5);
  return {
    ...w,
    elevation: z,
    days: w.days.map((d) => ({ ...d, tmin: move(d.tmin), tmax: move(d.tmax) })),
    tmean7: move(w.tmean7),
    tmin5,
    frost: tmin5 !== null && tmin5 <= FROST_C,
  };
}

/** Altitude médiane des carrés de 4,5 km d'une case (null : inconnue). */
export function medianAltitude(series: DailySeries): number | null {
  const zs = (series.subAltitudes ?? []).filter((z): z is number => z !== null).sort((a, b) => a - b);
  if (!zs.length) return null;
  const mid = zs.length >> 1;
  return zs.length % 2 ? (zs[mid] ?? null) : Math.round(((zs[mid - 1] ?? 0) + (zs[mid] ?? 0)) / 2);
}

// ── Fichiers météo communs ────────────────────────────────────────────────────

export interface SharedStatus {
  /** Fichiers communs lus (sinon : appels directs à Open-Meteo). */
  shared: boolean;
  /** Dernière mise à jour des fichiers (ISO 8601). */
  updated: string | null;
}

/** L'index est relu de temps en temps (la page peut rester ouverte d'un jour à l'autre). */
const INDEX_TTL_MS = 20 * 60_000;
const INDEX_RETRY_MS = 60_000;
let indexEntry: { at: number; ttl: number; promise: Promise<MeteoIndexFile | null> } | null = null;

function loadIndex(): Promise<MeteoIndexFile | null> {
  if (indexEntry && Date.now() - indexEntry.at < indexEntry.ttl) return indexEntry.promise;
  const entry: { at: number; ttl: number; promise: Promise<MeteoIndexFile | null> } = {
    at: Date.now(),
    ttl: INDEX_TTL_MS,
    promise: Promise.resolve(null),
  };
  entry.promise = (async () => {
    track('pages.meteo');
    try {
      const response = await fetch(`${METEO_BASE}index.json`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const index = (await response.json()) as MeteoIndexFile;
      // Fichiers d'une autre grille (site en ligne plus récent ou plus ancien) : on ne s'en sert pas.
      const same =
        index.v === METEO_FORMAT && Math.abs(index.pasLat - STEP_LAT) < 1e-9 && Math.abs(index.pasLon - STEP_LON) < 1e-9 && index.bloc === BLOCK;
      if (!same || !Array.isArray(index.blocs) || !(index.cases > 0)) return null;
      // Mise à jour en panne depuis plusieurs jours : mieux vaut interroger Open-Meteo directement.
      if (!(index.dernierJour >= addDays(todayKey(), -1 - METEO_MAX_LATE_DAYS))) {
        track('pages.meteo.errors');
        return null;
      }
      return index;
    } catch {
      track('pages.meteo.errors');
      entry.ttl = INDEX_RETRY_MS;
      return null;
    }
  })();
  indexEntry = entry;
  return entry.promise;
}

const blocks = new Map<string, Promise<Map<string, DailySeries> | null>>();

function parseBlock(file: BlockFile): Map<string, DailySeries> {
  const out = new Map<string, DailySeries>();
  if (file?.v !== METEO_FORMAT || !Array.isArray(file.dates)) return out;
  const n = file.dates.length;
  for (const [id, c] of Object.entries(file.cells ?? {})) {
    if (c?.p?.length !== n || c.x?.length !== n || c.n?.length !== n) continue;
    // Seulement jusqu'au dernier jour complet de la case.
    const keep = file.dates.map((d) => typeof c.c === 'string' && d <= c.c);
    out.set(id, {
      dates: file.dates.filter((_, k) => keep[k]),
      rain: c.p.filter((_, k) => keep[k]),
      tmax: c.x.filter((_, k) => keep[k]),
      tmin: c.n.filter((_, k) => keep[k]),
      elevation: typeof c.z === 'number' ? c.z : 0,
      ...(Array.isArray(c.a) && c.a.length === SUB_COUNT ? { subAltitudes: c.a.map((z) => (typeof z === 'number' ? z : null)) } : {}),
      ...(typeof c.f === 'string' ? { finalUntil: c.f } : {}),
    });
  }
  return out;
}

function loadBlock(index: MeteoIndexFile, id: string): Promise<Map<string, DailySeries> | null> {
  const key = `${index.maj}|${id}`;
  let promise = blocks.get(key);
  if (!promise) {
    promise = (async () => {
      track('pages.meteo');
      // La date de mise à jour dans l'adresse : un bloc d'hier resté dans le cache du navigateur
      // n'est jamais relu avec l'index d'aujourd'hui.
      const response = await fetch(`${METEO_BASE}b/${id}.json?v=${encodeURIComponent(index.maj)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseBlock((await response.json()) as BlockFile);
    })().catch(() => {
      track('pages.meteo.errors');
      blocks.delete(key); // on réessaiera
      return null;
    });
    blocks.set(key, promise);
  }
  return promise;
}

/** Séries des cases demandées dans les fichiers communs (null : fichiers injoignables). */
async function sharedSeries(cells: readonly CellRef[]): Promise<{ series: Map<string, DailySeries>; updated: string } | null> {
  const index = await loadIndex();
  if (!index) return null;
  const available = new Set(index.blocs);
  const wanted = [...new Set(cells.map(blockOf))].filter((b) => available.has(b));
  const loaded = await Promise.all(wanted.map((b) => loadBlock(index, b)));
  const series = new Map<string, DailySeries>();
  for (const block of loaded) for (const [id, s] of block ?? []) series.set(id, s);
  return { series, updated: index.maj };
}

// ── Open-Meteo en direct (secours) ───────────────────────────────────────────

interface OpenMeteoDaily {
  elevation?: number;
  daily?: {
    time?: string[];
    precipitation_sum?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
  };
}

function parse(item: OpenMeteoDaily, today: string): DailySeries {
  const d = item.daily ?? {};
  const time = d.time ?? [];
  const keep = time.map((date) => date < today); // aujourd'hui est incomplet
  return {
    dates: time.filter((_, k) => keep[k]),
    rain: (d.precipitation_sum ?? []).filter((_, k) => keep[k]),
    tmax: (d.temperature_2m_max ?? []).filter((_, k) => keep[k]),
    tmin: (d.temperature_2m_min ?? []).filter((_, k) => keep[k]),
    elevation: item.elevation ?? 0,
  };
}

export interface WeatherPoint {
  lat: number;
  lon: number;
  /** Altitude réelle du point (m) : Open-Meteo y ramène les températures. */
  elevation?: number;
}

/** Pluie et températures des `pastDays` derniers jours pour une liste de points (une seule requête). */
export async function fetchDaily(points: readonly WeatherPoint[], signal?: AbortSignal, pastDays = DIRECT_PAST_DAYS): Promise<DailySeries[]> {
  if (!points.length) return [];
  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set('latitude', points.map((p) => p.lat.toFixed(4)).join(','));
  url.searchParams.set('longitude', points.map((p) => p.lon.toFixed(4)).join(','));
  if (points.every((p) => typeof p.elevation === 'number')) {
    url.searchParams.set('elevation', points.map((p) => Math.round(p.elevation ?? 0)).join(','));
  }
  const variables = ['precipitation_sum', 'temperature_2m_max', 'temperature_2m_min'];
  url.searchParams.set('daily', variables.join(','));
  url.searchParams.set('past_days', String(pastDays));
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('timezone', 'Europe/Paris');
  track('openMeteo.requests');
  track('openMeteo.locations', points.length);
  track('openMeteo.calls10', openMeteoCalls10(points.length, pastDays + 1, variables.length));
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Météo : HTTP ${response.status}`);
    const data = (await response.json()) as OpenMeteoDaily | OpenMeteoDaily[];
    const today = todayKey();
    return (Array.isArray(data) ? data : [data]).map((item) => parse(item, today));
  } catch (error) {
    if (!signal?.aborted) track('openMeteo.errors');
    throw error;
  }
}

// Cache du jour des appels directs (mémoire + localStorage).
const CACHE_KEY = 'foret-explorer:meteo';
let cacheDay = '';
const cache = new Map<string, DailySeries>();

function loadCache(day: string): void {
  if (cacheDay === day) return;
  cacheDay = day;
  cache.clear();
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const saved = raw ? (JSON.parse(raw) as { v?: number; day?: string; cells?: Record<string, DailySeries> }) : null;
    if (saved?.v === 2 && saved.day === day && saved.cells) for (const [k, v] of Object.entries(saved.cells)) cache.set(k, v);
  } catch {
    /* cache indisponible : on refera les requêtes */
  }
}

function saveCache(): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ v: 2, day: cacheDay, cells: Object.fromEntries(cache) }));
  } catch {
    /* quota dépassé ou stockage bloqué : le cache reste en mémoire */
  }
}

// ── Grille de la carte ───────────────────────────────────────────────────────

export interface GridCell extends CellRef {
  id: string;
  lat: number;
  lon: number;
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Cases communes qui touchent la vue ; null s'il y en a plus de `max`. */
export function cellsForBounds(bounds: { west: number; south: number; east: number; north: number }, max: number): GridCell[] | null {
  const a = cellAt(bounds.south, bounds.west);
  const b = cellAt(bounds.north, bounds.east);
  if ((b.i - a.i + 1) * (b.j - a.j + 1) > max) return null;
  const cells: GridCell[] = [];
  for (let i = a.i; i <= b.i; i++) {
    for (let j = a.j; j <= b.j; j++) cells.push({ i, j, id: cellId(i, j), ...cellBox({ i, j }) });
  }
  return cells;
}

export interface CellsWeather extends SharedStatus {
  series: Map<string, DailySeries>;
  /** Appels directs seulement : trop de cases à l'écran, rien n'a été demandé. */
  tooMany: boolean;
}

/**
 * Météo des cases : fichiers communs ; s'ils sont injoignables, Open-Meteo en direct (au plus
 * DIRECT_MAX_CELLS cases, cache du jour), comme avant les fichiers communs.
 */
export async function weatherForCells(cells: readonly GridCell[], signal?: AbortSignal): Promise<CellsWeather> {
  const shared = await sharedSeries(cells);
  if (shared) {
    const series = new Map<string, DailySeries>();
    for (const c of cells) {
      const s = shared.series.get(c.id);
      if (s) series.set(c.id, s);
    }
    return { series, shared: true, updated: shared.updated, tooMany: false };
  }
  if (cells.length > DIRECT_MAX_CELLS) return { series: new Map(), shared: false, updated: null, tooMany: true };
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
  const series = new Map<string, DailySeries>();
  for (const c of cells) {
    const s = cache.get(key(c));
    if (s) series.set(c.id, s);
  }
  return { series, shared: false, updated: null, tooMany: false };
}

/** Open-Meteo n'a besoin que de la case météo : coordonnées arrondies à 0,01° (≈ 1 km) pour la vie privée. */
const round2 = (x: number): number => Math.round(x * 100) / 100;

export interface PointWeather extends SharedStatus {
  series: DailySeries;
}

/**
 * Météo d'un point, températures à l'altitude `altitude` : la case commune qui le contient, sinon
 * (fichiers injoignables, point hors de France) un appel direct à Open-Meteo.
 */
export async function weatherAt(lat: number, lon: number, altitude: number | null, signal?: AbortSignal): Promise<PointWeather | null> {
  const cell = cellAt(lat, lon);
  const shared = await sharedSeries([cell]);
  const s = shared?.series.get(cellId(cell.i, cell.j));
  // Altitude IGN indisponible : celle du carré de 4,5 km qui contient le point.
  if (s && shared) return { series: atAltitude(s, altitude ?? s.subAltitudes?.[subIndexAt(lat, lon)] ?? null), shared: true, updated: shared.updated };
  const [direct] = await fetchDaily(
    [{ lat: round2(lat), lon: round2(lon), ...(altitude !== null ? { elevation: altitude } : {}) }],
    signal,
  );
  return direct ? { series: direct, shared: false, updated: null } : null;
}

// ── Altitude (IGN) ───────────────────────────────────────────────────────────

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

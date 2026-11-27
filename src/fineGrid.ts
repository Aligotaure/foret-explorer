/**
 * Grille fine de l'indice de pousse : carrés d'environ 500 m, à partir du zoom FINE_MIN_ZOOM.
 *
 * Chaque case de base de 4,5 km (0,04° × 0,056°) est découpée en FINE_DIVISIONS × FINE_DIVISIONS
 * carrés ; ils s'emboîtent donc exactement dans les cases météo communes (meteoGrid.ts). Pour chacun :
 *  - forêts et sols relevés sur 3 × 3 points, dans les tuiles déjà affichées ;
 *  - altitude IGN au centre, gardée dans le navigateur (elle ne change pas) ;
 *  - météo de la case commune qui le contient, températures ramenées à l'altitude du carré
 *    (−0,65 °C par 100 m). La pluie reste celle de la case.
 */
import type { MultiPolygon, Polygon, Position } from 'geojson';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { FINE_DIVISIONS, FINE_MAX_CELLS } from './config';
import type { CutPoints } from './cuts';
import { FINE_OFFSETS, FINE_POINTS, fineFactors, type Sample } from './fineRule';
import { LAYERS, surveyForest } from './mapStyle';
import { cutModulation, cutWeight, scoreMushroom, type Level, type Mushroom } from './mushrooms';
import { BASE_STEP_LAT, BASE_STEP_LON, cellId, cellOfBase } from './meteoGrid';
import { SOIL_BY_ID, type SoilId } from './soils';
import type { WeatherSummary } from './weather';

// La règle elle-même (ce qu'on relève, quels carrés dessiner) est dans fineRule.ts, sans rien de la
// carte : le script des parts de forêt l'applique à toute la France.
export { FINE_POINTS, fineCellsToDraw, hostShare, type FineCandidate, type Sample } from './fineRule';

export const FINE_STEP_LAT = BASE_STEP_LAT / FINE_DIVISIONS;
export const FINE_STEP_LON = BASE_STEP_LON / FINE_DIVISIONS;

export interface FineCell {
  /** « I:J », indices du carré dans la grille fine mondiale. */
  id: string;
  /** Identifiant de la case météo commune qui le contient. */
  parentId: string;
  lat: number;
  lon: number;
  west: number;
  south: number;
  east: number;
  north: number;
}

interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Carrés qui touchent la vue ; null s'il y en a plus de `max`. */
export function fineCellsForBounds(b: Bounds, max = FINE_MAX_CELLS): FineCell[] | null {
  const i0 = Math.floor(b.south / FINE_STEP_LAT);
  const i1 = Math.floor(b.north / FINE_STEP_LAT);
  const j0 = Math.floor(b.west / FINE_STEP_LON);
  const j1 = Math.floor(b.east / FINE_STEP_LON);
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > max) return null;
  const cells: FineCell[] = [];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const south = (i * BASE_STEP_LAT) / FINE_DIVISIONS;
      const west = (j * BASE_STEP_LON) / FINE_DIVISIONS;
      const parent = cellOfBase(Math.floor(i / FINE_DIVISIONS), Math.floor(j / FINE_DIVISIONS));
      cells.push({
        id: `${i}:${j}`,
        parentId: cellId(parent.i, parent.j),
        south: +south.toFixed(6),
        north: +(south + FINE_STEP_LAT).toFixed(6),
        west: +west.toFixed(6),
        east: +(west + FINE_STEP_LON).toFixed(6),
        lat: +(south + FINE_STEP_LAT / 2).toFixed(5),
        lon: +(west + FINE_STEP_LON / 2).toFixed(5),
      });
    }
  }
  return cells;
}

// ── Relevé des forêts et des sols ────────────────────────────────────────────

interface IndexedPolygon {
  value: string;
  /**
   * Arêtes du polygone (tous ses anneaux), rangées par bande de latitude d'un carré fin : xa, ya, xb,
   * yb à la suite. Un point n'est comparé qu'aux arêtes de sa bande.
   */
  bands: Map<number, number[]>;
}

/**
 * Range les arêtes par bande. Depuis le 15/11/2026 : avec les carrés de 500 m dès le zoom 11, une vue
 * compte 3 000 à 5 000 carrés et des forêts de dizaines de milliers de sommets ; comparer chacun des
 * neuf points d'un carré à tous les sommets de chaque forêt qui le touche bloquait la page 1 à 3 s.
 * Une arête horizontale ne compte jamais dans la règle pair-impair : elle n'est pas rangée.
 */
function edgesByBand(rings: Position[][]): Map<number, number[]> {
  const bands = new Map<number, number[]>();
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (!a || !b) continue;
      const [xa = 0, ya = 0] = a;
      const [xb = 0, yb = 0] = b;
      if (ya === yb) continue;
      const from = Math.floor(Math.min(ya, yb) / FINE_STEP_LAT);
      const to = Math.floor(Math.max(ya, yb) / FINE_STEP_LAT);
      for (let band = from; band <= to; band++) {
        let list = bands.get(band);
        if (!list) bands.set(band, (list = []));
        list.push(xa, ya, xb, yb);
      }
    }
  }
  return bands;
}

/**
 * Point dans un polygone (règle pair-impair : les trous sont gérés), d'après les arêtes de sa bande :
 * toute arête que coupe l'horizontale du point est dans cette bande.
 */
function inside(edges: readonly number[] | undefined, x: number, y: number): boolean {
  if (!edges) return false;
  let hit = false;
  for (let k = 0; k < edges.length; k += 4) {
    const xa = edges[k] as number;
    const ya = edges[k + 1] as number;
    const xb = edges[k + 2] as number;
    const yb = edges[k + 3] as number;
    if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) hit = !hit;
  }
  return hit;
}

/**
 * Polygones affichés d'une couche, rangés par carré fin : chaque point relevé ne teste que les
 * polygones dont l'emprise touche son carré. Une seule requête MapLibre pour toute la vue.
 */
class CellIndex {
  private readonly buckets = new Map<string, IndexedPolygon[]>();

  constructor(map: MapLibreMap, layer: string, property: string) {
    if (!map.getLayer(layer)) return;
    for (const feature of map.queryRenderedFeatures({ layers: [layer] })) {
      const value = feature.properties?.[property];
      if (typeof value !== 'string') continue;
      const geometry = feature.geometry as Polygon | MultiPolygon;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
      for (const rings of polygons) {
        if (!rings[0]?.length) continue;
        // Emprise de tous les anneaux, pas du seul contour : au bord des tuiles, l'IGN note parfois
        // un petit morceau de forêt dans le sens d'un trou, hors du contour. Le lire comme un trou du
        // polygone (règle pair-impair) le compte bien comme de la forêt, mais encore faut-il le
        // ranger dans les carrés qu'il touche. (Avant le 25/11/2026 : emprise du contour seul, et ces
        // morceaux manquaient, un point sur 18 000 dans les Landes.)
        let west = Infinity;
        let south = Infinity;
        let east = -Infinity;
        let north = -Infinity;
        for (const ring of rings) {
          for (const [x = 0, y = 0] of ring) {
            if (x < west) west = x;
            if (x > east) east = x;
            if (y < south) south = y;
            if (y > north) north = y;
          }
        }
        const entry = { value, bands: edgesByBand(rings) };
        for (let i = Math.floor(south / FINE_STEP_LAT); i <= Math.floor(north / FINE_STEP_LAT); i++) {
          // (Aucune arête dans cette bande : le polygone n'y contient aucun point.)
          if (!entry.bands.has(i)) continue;
          for (let j = Math.floor(west / FINE_STEP_LON); j <= Math.floor(east / FINE_STEP_LON); j++) {
            const key = `${i}:${j}`;
            const bucket = this.buckets.get(key);
            if (bucket) bucket.push(entry);
            else this.buckets.set(key, [entry]);
          }
        }
      }
    }
  }

  valueAt(cellId: string, x: number, y: number): string | null {
    const bucket = this.buckets.get(cellId);
    if (!bucket) return null;
    const band = Math.floor(y / FINE_STEP_LAT);
    for (const p of bucket) if (inside(p.bands.get(band), x, y)) return p.value;
    return null;
  }
}

const OFFSETS = FINE_OFFSETS;

// ── Relevés gardés (mémoire, puis navigateur) ────────────────────────────────
//
// Le relevé d'un carré entièrement vu ne change pas : forêts de la BD Forêt et sols du BRGM sont des
// données fixes. Il est gardé pour la visite, et depuis le 14/11/2026 d'une visite à l'autre : une
// vue déjà relevée se redessine alors sans attendre les tuiles des forêts (2,6 s mesurées entre un
// zoom et l'arrivée des carrés, dont l'essentiel à attendre ces tuiles).
// Garde-fous : un carré sous une tuile de forêt ou de sol en panne n'est pas gardé (il resterait
// « sans forêt » pendant des semaines) ; tout est oublié au bout de SURVEY_MAX_DAYS, et dès que
// SURVEY_VERSION change (à changer avec les règles des sols ou la nomenclature des forêts).

const SURVEY_KEY = 'foret-explorer:releves';
/** 2 depuis le 25/11/2026 : le relevé lit les forêts du zoom SURVEY_TILE_ZOOM, plus celles du zoom affiché. */
const SURVEY_VERSION = 2;
/**
 * Une dizaine d'écrans de 1280 × 800 au zoom 11 (3 000 carrés par vue), près de cent au zoom 12,3
 * (448 carrés gardés pour une vue des Alpes, le 14/11/2026). ≈ 30 caractères par carré : 1,2 million
 * de caractères au plus dans le navigateur. 20 000 avant le 15/11/2026, quand les carrés de 500 m
 * n'arrivaient qu'au zoom 12.
 */
const SURVEY_MAX_ENTRIES = 40_000;
const SURVEY_MAX_DAYS = 30;
/** L'écriture attend ce délai de calme : elle récrit tout le cache, sur le fil qui dessine la carte. */
const SURVEY_SAVE_DELAY_MS = 3000;
const DAY_MS = 86_400_000;

interface StoredSurveys {
  v?: number;
  /** Jour de la première écriture (AAAA-MM-JJ). */
  d?: string;
  /** Codes de forêt et sols cités : chaque point est écrit par leurs rangs. */
  c?: string[];
  g?: string[];
  s?: Record<string, string>;
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const NONE = '-';

const rankOf = (value: string | null, list: string[]): string | null => {
  if (value === null) return NONE;
  let k = list.indexOf(value);
  if (k < 0) k = list.push(value) - 1;
  return DIGITS[k] ?? null;
};

/** Neuf points en 18 caractères (2 si tous les points se valent) ; null si cela ne s'écrit pas. */
export function packSamples(samples: readonly Sample[], codes: string[], soils: string[]): string | null {
  if (samples.length !== OFFSETS.length ** 2) return null;
  let out = '';
  for (const s of samples) {
    const code = rankOf(s.code, codes);
    const soil = rankOf(s.soil, soils);
    if (code === null || soil === null) return null;
    out += code + soil;
  }
  const first = out.slice(0, 2);
  for (let k = 2; k < out.length; k += 2) if (out.slice(k, k + 2) !== first) return out;
  return first;
}

export function unpackSamples(text: string, codes: readonly string[], soils: readonly string[]): Sample[] | null {
  const points = OFFSETS.length ** 2;
  if (text.length !== 2 && text.length !== 2 * points) return null;
  const read = (char: string | undefined, list: readonly string[]): string | null | undefined => {
    if (char === NONE) return null;
    return char === undefined ? undefined : list[DIGITS.indexOf(char)];
  };
  const samples: Sample[] = [];
  for (let k = 0; k < points; k++) {
    const at = text.length === 2 ? 0 : 2 * k;
    const code = read(text[at], codes);
    const soil = read(text[at + 1], soils);
    if (code === undefined || soil === undefined) return null;
    if (soil !== null && !SOIL_BY_ID.has(soil)) return null;
    samples.push({ code, soil: soil as SoilId | null });
  }
  return samples;
}

let samplesCache: Map<string, Sample[]> | null = null;
let surveysSince: string | undefined;
let saveTimer: number | undefined;

const today = (): string => new Date().toISOString().slice(0, 10);

/** Relevés complets déjà faits, ceux des visites précédentes compris. */
function surveyCache(): Map<string, Sample[]> {
  if (samplesCache) return samplesCache;
  const cache = new Map<string, Sample[]>();
  samplesCache = cache;
  try {
    const raw = localStorage.getItem(SURVEY_KEY);
    const saved = raw ? (JSON.parse(raw) as StoredSurveys) : null;
    const age = saved?.d ? (Date.now() - Date.parse(saved.d)) / DAY_MS : NaN;
    // (Âge en valeur absolue : une horloge remise à l'heure ne doit pas faire oublier le cache.)
    if (saved?.v === SURVEY_VERSION && saved.s && Array.isArray(saved.c) && Array.isArray(saved.g) && Math.abs(age) <= SURVEY_MAX_DAYS) {
      surveysSince = saved.d;
      for (const [id, text] of Object.entries(saved.s)) {
        const samples = typeof text === 'string' ? unpackSamples(text, saved.c, saved.g) : null;
        if (samples) cache.set(id, samples);
      }
    }
  } catch {
    /* stockage indisponible ou contenu illisible : les relevés seront refaits */
  }
  return cache;
}

function saveSurveys(): void {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  const cache = surveyCache();
  // Les plus anciens d'abord dans la Map : on les oublie si le cache devient trop gros.
  for (const key of cache.keys()) {
    if (cache.size <= SURVEY_MAX_ENTRIES) break;
    cache.delete(key);
  }
  const codes: string[] = [];
  const soils: string[] = [];
  const s: Record<string, string> = {};
  for (const [id, samples] of cache) {
    const text = packSamples(samples, codes, soils);
    if (text) s[id] = text;
  }
  surveysSince ??= today();
  try {
    localStorage.setItem(SURVEY_KEY, JSON.stringify({ v: SURVEY_VERSION, d: surveysSince, c: codes, g: soils, s } satisfies StoredSurveys));
  } catch {
    /* quota dépassé ou stockage indisponible : les relevés restent en mémoire pour la visite */
  }
}

function scheduleSave(): void {
  if (saveTimer !== undefined) return;
  saveTimer = window.setTimeout(saveSurveys, SURVEY_SAVE_DELAY_MS);
}
// (Page quittée avant le délai : on écrit tout de suite.)
window.addEventListener('pagehide', () => {
  if (saveTimer !== undefined) saveSurveys();
});

/** Oublie tous les relevés gardés, en mémoire et dans le navigateur (tests : repartir d'une vue jamais vue). */
export function forgetSurveys(): void {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  samplesCache = new Map();
  surveysSince = undefined;
  try {
    localStorage.removeItem(SURVEY_KEY);
  } catch {
    /* stockage indisponible */
  }
}

/** Emprise des tuiles de forêt ou de sol que la carte n'a pas pu lire (réseau, service en panne). */
const failedTiles = new Map<string, Bounds>();

/**
 * Une tuile des forêts ou des sols vient d'être lue (`ok`) ou a échoué. Tant qu'elle n'a pas été
 * relue, les carrés qu'elle couvre sont relevés mais pas gardés : sans elle ils paraissent sans forêt.
 */
export function noteSurveyTile(source: string, tile: { z: number; x: number; y: number }, ok: boolean): void {
  const key = `${source}/${tile.z}/${tile.x}/${tile.y}`;
  if (ok) {
    failedTiles.delete(key);
    return;
  }
  const n = 2 ** tile.z;
  const lat = (row: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  failedTiles.set(key, { west: (tile.x / n) * 360 - 180, east: ((tile.x + 1) / n) * 360 - 180, north: lat(tile.y), south: lat(tile.y + 1) });
}

const underFailedTile = (c: FineCell): boolean => {
  for (const t of failedTiles.values()) if (c.west < t.east && c.east > t.west && c.south < t.north && c.north > t.south) return true;
  return false;
};

/** Relevés déjà gardés parmi ces carrés, sans rien demander à la carte. */
export function knownSamples(cells: readonly FineCell[]): Map<string, Sample[]> {
  const cache = surveyCache();
  const out = new Map<string, Sample[]>();
  for (const c of cells) {
    const cached = cache.get(c.id);
    if (cached) out.set(c.id, cached);
  }
  return out;
}

/** Les neuf points du carré sont dans la vue : son relevé y serait complet. */
const fullyVisible = (c: FineCell, view: Bounds): boolean => {
  const dx = (c.east - c.west) * (OFFSETS[0] ?? 0);
  const dy = (c.north - c.south) * (OFFSETS[0] ?? 0);
  return c.west + dx >= view.west && c.east - dx <= view.east && c.south + dy >= view.south && c.north - dy <= view.north;
};

/**
 * Vue déjà relevée : tous ses carrés entièrement visibles sont gardés (ceux du bord de l'écran,
 * relevés en partie, ne le sont jamais). Elle peut être redessinée sans attendre les tuiles.
 */
export function isSurveyed(cells: readonly FineCell[], view: Bounds): boolean {
  const cache = surveyCache();
  let known = 0;
  for (const c of cells) {
    if (cache.has(c.id)) known++;
    else if (fullyVisible(c, view)) return false;
  }
  return known > 0;
}

/**
 * Forêts et sols de chaque carré, d'après les tuiles affichées (attendre qu'elles soient chargées).
 * Un carré à cheval sur le bord de l'écran n'est relevé que sur ses points visibles.
 */
export function sampleCells(map: MapLibreMap, cells: readonly FineCell[]): Map<string, Sample[]> {
  const cache = surveyCache();
  const out = new Map<string, Sample[]>();
  const todo = cells.filter((c) => {
    const cached = cache.get(c.id);
    if (cached) out.set(c.id, cached);
    return !cached;
  });
  if (!todo.length) return out;

  // Les forêts du zoom SURVEY_TILE_ZOOM, quel que soit le zoom affiché (voir `surveyForest`).
  const forests = new CellIndex(map, surveyForest(map.getZoom()).layer, 'code_tfv');
  const soils = new CellIndex(map, LAYERS.geologyHit, 'sol');
  const view = map.getBounds();
  let kept = false;
  for (const c of todo) {
    const samples: Sample[] = [];
    let complete = true;
    // Position exacte des points, d'après le rang du carré dans la grille, et non d'après ses bords
    // (arrondis au millionième de degré pour le dessin, soit 5 cm : assez pour faire basculer un
    // point posé sur une lisière, un sur dix mille, et s'écarter du relevé fait pour toute la France).
    const [i = 0, j = 0] = c.id.split(':').map(Number);
    for (const fy of OFFSETS) {
      for (const fx of OFFSETS) {
        const x = (j + fx) * FINE_STEP_LON;
        const y = (i + fy) * FINE_STEP_LAT;
        if (!view.contains([x, y])) {
          complete = false;
          continue;
        }
        const code = forests.valueAt(c.id, x, y);
        const soil = code ? soils.valueAt(c.id, x, y) : null;
        samples.push({ code, soil: soil && SOIL_BY_ID.has(soil) ? (soil as SoilId) : null });
      }
    }
    if (!samples.length) continue;
    out.set(c.id, samples);
    if (complete && !underFailedTile(c)) {
      cache.set(c.id, samples);
      kept = true;
    }
  }
  if (kept) scheduleSave();
  return out;
}

export const hasForest = (samples: readonly Sample[] | undefined): boolean => Boolean(samples?.some((s) => s.code));

// ── Altitudes (cache permanent dans le navigateur) ───────────────────────────

const ALTITUDE_KEY = 'foret-explorer:altitudes';
const ALTITUDE_MAX_ENTRIES = 40_000;
let altitudes: Map<string, number | null> | null = null;

/** Altitudes connues des carrés (null : hors couverture du RGE ALTI). */
export function altitudeCache(): Map<string, number | null> {
  if (altitudes) return altitudes;
  altitudes = new Map();
  try {
    const raw = localStorage.getItem(ALTITUDE_KEY);
    const saved = raw ? (JSON.parse(raw) as { v?: number; z?: Record<string, number | null> }) : null;
    if (saved?.v === 1 && saved.z) for (const [k, v] of Object.entries(saved.z)) altitudes.set(k, v);
  } catch {
    /* stockage indisponible : les altitudes seront redemandées */
  }
  return altitudes;
}

export function saveAltitudes(): void {
  const cache = altitudeCache();
  // Les plus anciennes d'abord dans la Map : on les oublie si le cache devient trop gros.
  for (const key of cache.keys()) {
    if (cache.size <= ALTITUDE_MAX_ENTRIES) break;
    cache.delete(key);
  }
  try {
    localStorage.setItem(ALTITUDE_KEY, JSON.stringify({ v: 1, z: Object.fromEntries(cache) }));
  } catch {
    /* quota dépassé : le cache reste en mémoire pour la visite */
  }
}

// ── Indice d'un carré ─────────────────────────────────────────────────────────

export interface FineScore {
  level: Level;
  score: number;
  /** Part des points du carré sous un arbre hôte (0–1). */
  coverage: number;
}

/**
 * Indice d'un carré pour un champignon : qualité moyenne des arbres hôtes présents et sol
 * moyen sous ces arbres (`fineFactors`). Null si aucun point du carré n'est sous un arbre hôte (le
 * choix des carrés à dessiner se fait avant : `fineCellsToDraw`).
 *
 * `cuts` : points du carré où un satellite a vu la forêt coupée ou détruite (cuts.ts ; absent ou
 * null : inconnu, rien ne baisse). Les coupes baissent l'indice du carré de 500 m, ici seulement :
 * fineRule.ts n'en sait rien, donc ni le choix des carrés (`fineCellsToDraw`) ni ce que les carrés
 * de 4,5 km annoncent n'en tiennent compte.
 */
export function scoreFineCell(m: Mushroom, w: WeatherSummary, month: number, samples: readonly Sample[], cuts?: CutPoints | null): FineScore | null {
  const f = fineFactors(m, samples);
  if (!f) return null;
  const cutFactor = cutFactorOf(m, samples, f.hosts, cuts);
  const { score, level } = scoreMushroom(m, w, month, { hostQuality: f.quality, soilFactor: f.soil, ...(cutFactor === undefined ? {} : { cutFactor }) });
  return { score, level, coverage: f.hosts / samples.length };
}

/**
 * Ce qui reste de l'indice d'un carré une fois ses coupes comptées (undefined : rien n'est connu, ou
 * le champignon n'y est pas sensible). Chaque point hôte compte pour ce qu'il vaut encore
 * (`cutWeight`) : un carré dont les hôtes sont tous coupés depuis peu garde un cinquième de son
 * indice, un carré coupé seulement hors de ses hôtes le garde entier. Un carré relevé en partie
 * (bord de l'écran) ne sait plus quel point est lequel : la part touchée du carré s'applique à tous.
 */
function cutFactorOf(m: Mushroom, samples: readonly Sample[], hosts: number, cuts: CutPoints | null | undefined): number | undefined {
  if (!cuts || !m.cuts || !(cuts.recent || cuts.young)) return undefined;
  if (samples.length !== FINE_POINTS) return cutModulation(m, bits(cuts.recent) / FINE_POINTS, bits(cuts.young) / FINE_POINTS);
  let standing = 0;
  samples.forEach((s, k) => {
    if (!s.code || (m.hosts[s.code] ?? 0) <= 0) return;
    standing += cutWeight(m, Boolean((cuts.recent >> k) & 1), Boolean((cuts.young >> k) & 1));
  });
  return standing / hosts;
}

/** Nombre de points (bits) d'un carré. */
function bits(mask: number): number {
  let n = 0;
  for (let b = mask; b; b >>= 1) n += b & 1;
  return n;
}

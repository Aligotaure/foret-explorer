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
import { FINE_DIVISIONS, FINE_MAX_CELLS, FINE_MIN_HOST_SHARE, FINE_TOWN_MIN_HOST_SHARE, FINE_TOWN_MIN_NEIGHBOURS } from './config';
import { LAYERS } from './mapStyle';
import { scoreMushroom, soilModulation, type Level, type Mushroom } from './mushrooms';
import { BASE_STEP_LAT, BASE_STEP_LON, cellId, cellOfBase } from './meteoGrid';
import { SOIL_BY_ID, type SoilId } from './soils';
import type { WeatherSummary } from './weather';

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

/** Ce qu'il y a sous un des 3 × 3 points du carré. */
export interface Sample {
  code: string | null;
  soil: SoilId | null;
}

interface IndexedPolygon {
  rings: Position[][];
  value: string;
}

/** Point dans un polygone (règle pair-impair : les trous sont gérés). */
function inside(rings: Position[][], x: number, y: number): boolean {
  let hit = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (!a || !b) continue;
      const [xa = 0, ya = 0] = a;
      const [xb = 0, yb = 0] = b;
      if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) hit = !hit;
    }
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
        const outer = rings[0];
        if (!outer?.length) continue;
        let west = Infinity;
        let south = Infinity;
        let east = -Infinity;
        let north = -Infinity;
        for (const [x = 0, y = 0] of outer) {
          if (x < west) west = x;
          if (x > east) east = x;
          if (y < south) south = y;
          if (y > north) north = y;
        }
        const entry = { rings, value };
        for (let i = Math.floor(south / FINE_STEP_LAT); i <= Math.floor(north / FINE_STEP_LAT); i++) {
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
    for (const p of this.buckets.get(cellId) ?? []) if (inside(p.rings, x, y)) return p.value;
    return null;
  }
}

const OFFSETS = [1 / 6, 1 / 2, 5 / 6] as const;
/** Relevés complets (carré entièrement visible) : ils ne changent pas, on les garde pour la visite. */
const samplesCache = new Map<string, Sample[]>();

/**
 * Forêts et sols de chaque carré, d'après les tuiles affichées (attendre qu'elles soient chargées).
 * Un carré à cheval sur le bord de l'écran n'est relevé que sur ses points visibles.
 */
export function sampleCells(map: MapLibreMap, cells: readonly FineCell[]): Map<string, Sample[]> {
  const out = new Map<string, Sample[]>();
  const todo = cells.filter((c) => {
    const cached = samplesCache.get(c.id);
    if (cached) out.set(c.id, cached);
    return !cached;
  });
  if (!todo.length) return out;

  const forests = new CellIndex(map, LAYERS.forestHit, 'code_tfv');
  const soils = new CellIndex(map, LAYERS.geologyHit, 'sol');
  const view = map.getBounds();
  if (samplesCache.size > 60_000) samplesCache.clear();
  for (const c of todo) {
    const samples: Sample[] = [];
    let complete = true;
    for (const fy of OFFSETS) {
      for (const fx of OFFSETS) {
        const x = c.west + fx * (c.east - c.west);
        const y = c.south + fy * (c.north - c.south);
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
    if (complete) samplesCache.set(c.id, samples);
  }
  return out;
}

export const hasForest = (samples: readonly Sample[] | undefined): boolean => Boolean(samples?.some((s) => s.code));

/** Points relevés dans un carré entièrement visible (3 × 3). */
const POINTS = OFFSETS.length ** 2;

/**
 * Part des neuf points d'un carré qui sont sous un arbre hôte du champignon (0 à 1). Un carré à
 * cheval sur le bord de l'écran n'est relevé qu'en partie : on compte quand même sur neuf, sinon il
 * se dessinerait sur la foi d'un seul point visible, puis disparaîtrait une fois entier à l'écran.
 */
export function hostShare(m: Mushroom, samples: readonly Sample[]): number {
  let hosts = 0;
  for (const s of samples) if (s.code !== null && (m.hosts[s.code] ?? 0) > 0) hosts++;
  return hosts / POINTS;
}

/** Un carré candidat au dessin : sa part d'arbres hôtes, et s'il est en ville (carré de 4,5 km d'abord bâti). */
export interface FineCandidate {
  id: string;
  share: number;
  town: boolean;
}

/**
 * Carrés de 500 m à dessiner parmi ceux qui ont des arbres hôtes. Hors des villes : une part
 * FINE_MIN_HOST_SHARE de points sous un arbre hôte suffit. En ville, il faut en plus que le carré
 * soit franchement boisé et tienne à un massif (voir FINE_TOWN_MIN_*) : avant le 14/11/2026, le
 * moindre parc urbain posait un carré coloré au milieu des rues.
 * Seuls les voisins connus comptent : au bord de l'écran, un carré de ville n'apparaît que lorsque
 * son massif est assez visible (le contraire ferait revenir les parcs le long des bords).
 */
export function fineCellsToDraw(candidates: readonly FineCandidate[]): Set<string> {
  const wooded = new Set(candidates.filter((c) => c.share >= FINE_MIN_HOST_SHARE).map((c) => c.id));
  const kept = new Set<string>();
  for (const c of candidates) {
    if (!wooded.has(c.id)) continue;
    if (!c.town) {
      kept.add(c.id);
      continue;
    }
    if (c.share < FINE_TOWN_MIN_HOST_SHARE) continue;
    const [i = 0, j = 0] = c.id.split(':').map(Number);
    let neighbours = 0;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        if (wooded.has(`${i + di}:${j + dj}`)) neighbours++;
      }
    }
    if (neighbours >= FINE_TOWN_MIN_NEIGHBOURS) kept.add(c.id);
  }
  return kept;
}

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
 * moyen sous ces arbres. Null si aucun point du carré n'est sous un arbre hôte (le choix des
 * carrés à dessiner se fait avant : `fineCellsToDraw`).
 */
export function scoreFineCell(m: Mushroom, w: WeatherSummary, month: number, samples: readonly Sample[]): FineScore | null {
  let hosts = 0;
  let quality = 0;
  let soil = 0;
  for (const s of samples) {
    const weight = s.code ? (m.hosts[s.code] ?? 0) : 0;
    if (weight <= 0) continue;
    hosts++;
    quality += weight;
    soil += s.soil ? soilModulation(m.soils[s.soil]) : 1;
  }
  if (!hosts) return null;
  const { score, level } = scoreMushroom(m, w, month, { hostQuality: quality / hosts, soilFactor: soil / hosts });
  return { score, level, coverage: hosts / samples.length };
}

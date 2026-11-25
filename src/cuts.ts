/**
 * Coupes et dégâts datés par satellite, par carré de 500 m.
 *
 * La BD Forêt a été dessinée sur des photos de 2007 à 2018 : une forêt coupée, brûlée ou abattue par
 * le vent depuis y figure encore comme une forêt en place. L'atlas européen des perturbations
 * forestières (Landsat, pixels de 30 m, CC BY 4.0) date ces événements année par année ;
 * `scripts/coupes/construire.mjs` en tire, pour chacun des neuf points que la carte relève dans un
 * carré de 500 m (fineGrid.ts), s'il est sur une forêt touchée depuis moins de 10 ans (« récent ») ou
 * depuis 10 à 20 ans (« jeune »). Fichiers rangés comme ceux de la météo : un index, puis un fichier
 * par bloc de cases communes, lu seulement pour la vue.
 *
 * Ce que vaut la donnée (contrôle du 25/11/2026 sur dix points tirés au hasard, comparés aux photos
 * aériennes de l'IGN : huit coupes réelles, deux fausses alertes ; les auteurs annoncent 18 % de
 * fausses alertes et 20 % d'événements manqués) : assez pour baisser une chance estimée et le dire,
 * pas pour éteindre un carré. Voir docs/donnees.md.
 */
import { CUTS_BASES, FINE_DIVISIONS } from './config';
import { BASE_STEP_LAT, BASE_STEP_LON, BLOCK, METEO_FACTOR, blockId, cellId } from './meteoGrid';
import { track } from './metrics';

/** Version du format : la carte ignore un fichier qu'elle ne connaît pas. */
const CUTS_FORMAT = 1;
/** Neuf points par carré (3 × 3, voir `OFFSETS` de fineGrid.ts), trois caractères par carré. */
const POINTS = 9;
const CHARS = 3;
const OFFSETS = [1 / 6, 1 / 2, 5 / 6];

interface CutsIndexFile {
  v: number;
  pasLat: number;
  pasLon: number;
  divisions: number;
  bloc: number;
  points: number[];
  /** Première année de la période « récent » ; bornes de la période « jeune ». */
  depuis: number;
  jeune: [number, number];
  /** Dernière année connue de l'atlas (il a un à deux ans de retard). */
  dernierAn: number | null;
  genere: string;
  blocs: string[];
}

interface CutsBlockFile {
  v: number;
  /** Par case commune : ses 16 × 81 carrés de 500 m, trois caractères chacun. */
  cases: Record<string, string>;
}

/** Points d'un carré touchés : un bit par point, dans l'ordre du relevé (sud → nord, puis ouest → est). */
export interface CutPoints {
  recent: number;
  young: number;
}

/** Périodes des fichiers chargés, pour les phrases. */
export interface CutPeriods {
  since: number;
  young: readonly [number, number];
}

const NONE: CutPoints = { recent: 0, young: 0 };
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VALUE = new Int8Array(128).fill(-1);
for (let k = 0; k < ALPHABET.length; k++) VALUE[ALPHABET.charCodeAt(k)] = k;

let base = '';
let index: CutsIndexFile | null = null;
let indexLoading: Promise<CutsIndexFile | null> | null = null;
/** Dernier échec de l'index : on attend avant de le redemander (pas à chaque déplacement de la carte). */
let failedAt = 0;
const RETRY_MS = 60_000;
/** Blocs lus (null : en panne pour cette visite), et lectures en cours. */
const blocks = new Map<string, Record<string, string> | null>();
const loading = new Map<string, Promise<void>>();

function usable(file: CutsIndexFile): boolean {
  return (
    file.v === CUTS_FORMAT &&
    file.pasLat === BASE_STEP_LAT &&
    file.pasLon === BASE_STEP_LON &&
    file.divisions === FINE_DIVISIONS &&
    file.bloc === BLOCK &&
    Array.isArray(file.points) &&
    file.points.length === OFFSETS.length &&
    file.points.every((p, k) => Math.abs(p - (OFFSETS[k] ?? -1)) < 0.001) &&
    Number.isInteger(file.depuis) &&
    Array.isArray(file.jeune) &&
    Array.isArray(file.blocs)
  );
}

async function loadIndex(): Promise<CutsIndexFile | null> {
  if (index) return index;
  if (failedAt && Date.now() - failedAt < RETRY_MS) return null;
  indexLoading ??= (async () => {
    for (const candidate of CUTS_BASES) {
      track('pages.coupes');
      try {
        const response = await fetch(`${candidate}index.json`, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const file = (await response.json()) as CutsIndexFile;
        if (!usable(file)) throw new Error('format ou grille inattendus');
        base = candidate;
        index = file;
        return file;
      } catch (error) {
        track('pages.coupes.errors');
        console.warn('[coupes]', error);
      }
    }
    failedAt = Date.now();
    indexLoading = null;
    return null;
  })();
  return indexLoading;
}

function loadBlock(file: CutsIndexFile, id: string): Promise<void> {
  if (blocks.has(id)) return Promise.resolve();
  // Bloc absent de l'index : aucune case datée dedans.
  if (!file.blocs.includes(id)) {
    blocks.set(id, {});
    return Promise.resolve();
  }
  let pending = loading.get(id);
  if (!pending) {
    pending = (async () => {
      track('pages.coupes');
      try {
        const response = await fetch(`${base}b/${id}.json?v=${encodeURIComponent(file.genere)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const block = (await response.json()) as CutsBlockFile;
        if (block.v !== CUTS_FORMAT || typeof block.cases !== 'object' || block.cases === null) throw new Error('format inattendu');
        blocks.set(id, block.cases);
      } catch (error) {
        track('pages.coupes.errors');
        console.warn('[coupes]', error);
        blocks.set(id, null);
      } finally {
        loading.delete(id);
      }
    })();
    loading.set(id, pending);
  }
  return pending;
}

/**
 * Charge les fichiers des cases communes données (« i:j »). Ne rejette jamais : sans eux, ou sans
 * certains d'entre eux, la carte fait sans (voir `cutPointsOf`).
 */
export async function loadCuts(cells: Iterable<string>): Promise<void> {
  const file = await loadIndex();
  if (!file) return;
  const wanted = new Set<string>();
  for (const cell of cells) {
    const [i = 0, j = 0] = cell.split(':').map(Number);
    wanted.add(blockId(Math.floor(i / BLOCK), Math.floor(j / BLOCK)));
  }
  await Promise.all([...wanted].map((id) => loadBlock(file, id)));
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/**
 * Points touchés du carré de 500 m d'indices (i, j) dans la grille fine. null : inconnu (fichiers pas
 * chargés, ou en panne) ; on ne baisse alors rien.
 */
export function cutPoints(i: number, j: number): CutPoints | null {
  if (!index) return null;
  const bi = Math.floor(i / FINE_DIVISIONS);
  const bj = Math.floor(j / FINE_DIVISIONS);
  const ci = Math.floor(bi / METEO_FACTOR);
  const cj = Math.floor(bj / METEO_FACTOR);
  const block = blocks.get(blockId(Math.floor(ci / BLOCK), Math.floor(cj / BLOCK)));
  if (!block) return null;
  const text = block[cellId(ci, cj)];
  if (!text) return NONE;
  const sub = mod(bi, METEO_FACTOR) * METEO_FACTOR + mod(bj, METEO_FACTOR);
  const o = (sub * FINE_DIVISIONS * FINE_DIVISIONS + mod(i, FINE_DIVISIONS) * FINE_DIVISIONS + mod(j, FINE_DIVISIONS)) * CHARS;
  const a = VALUE[text.charCodeAt(o)] ?? -1;
  const b = VALUE[text.charCodeAt(o + 1)] ?? -1;
  const c = VALUE[text.charCodeAt(o + 2)] ?? -1;
  if (a < 0 || b < 0 || c < 0) return NONE;
  const bits = (a << 12) | (b << 6) | c;
  return bits ? { recent: bits & 0x1ff, young: bits >> POINTS } : NONE;
}

/** Même chose pour un carré désigné par son identifiant « i:j » (`FineCell.id`). */
export function cutPointsOf(fineId: string): CutPoints | null {
  const [i = 0, j = 0] = fineId.split(':').map(Number);
  return cutPoints(i, j);
}

/** Même chose pour le carré de 500 m qui contient un point. */
export function cutPointsAt(lat: number, lon: number): CutPoints | null {
  return cutPoints(Math.floor((lat * FINE_DIVISIONS) / BASE_STEP_LAT), Math.floor((lon * FINE_DIVISIONS) / BASE_STEP_LON));
}

/** Périodes des fichiers chargés (null : pas chargés). */
export function cutPeriods(): CutPeriods | null {
  return index ? { since: index.depuis, young: index.jeune } : null;
}

/** Nombre de points touchés (0 à 9). */
export function countPoints(bits: number): number {
  let n = 0;
  for (let b = bits & 0x1ff; b; b >>= 1) n += b & 1;
  return n;
}

/** Part d'un carré en mots, d'après le nombre de ses neuf points touchés : pas de faux chiffre précis. */
export function shareWords(points: number): string {
  if (points <= 2) return 'une petite partie';
  if (points <= 4) return 'environ un tiers';
  if (points === 5) return 'environ la moitié';
  if (points <= 7) return 'environ deux tiers';
  return 'presque tout';
}

/** Oublie tout (tests). */
export function forgetCuts(): void {
  index = null;
  indexLoading = null;
  failedAt = 0;
  base = '';
  blocks.clear();
  loading.clear();
}

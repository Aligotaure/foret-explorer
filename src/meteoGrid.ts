/**
 * Grille météo commune à toute la France : des fichiers produits chaque jour par
 * `scripts/meteo/mettre-a-jour.mjs` (tâche GitHub `meteo.yml`) et lus par la carte, qui n'appelle
 * donc plus Open-Meteo elle-même.
 *
 * Une case commune regroupe METEO_FACTOR × METEO_FACTOR cases de base (0,04° × 0,056°, ≈ 4,5 km) ;
 * les carrés de 500 m de la grille fine (9 × 9 par case de base) s'y emboîtent exactement. Les
 * cases sont rangées par blocs de BLOCK × BLOCK, un fichier par bloc. La pluie et les températures
 * sont relevées en un point par case ; l'altitude de chacun de ses 16 carrés de 4,5 km est connue
 * (fichiers), ce qui permet d'y ramener les températures.
 *
 * Ce module est aussi lu tel quel par Node (scripts) : pas d'import, rien que des types effaçables.
 */

/** Case de base (≈ 4,5 km), celle de la grille fine. */
export const BASE_STEP_LAT = 0.04;
export const BASE_STEP_LON = 0.056;
/** Côté d'une case commune, en cases de base : 4 × 4,5 km ≈ 18 km (choix mesuré, voir CLAUDE.md). */
export const METEO_FACTOR = 4;
export const STEP_LAT = BASE_STEP_LAT * METEO_FACTOR;
export const STEP_LON = BASE_STEP_LON * METEO_FACTOR;
/** Côté approximatif d'une case, pour les textes (km). */
export const CELL_KM = Math.round(STEP_LAT * 111.2);
/** Côté d'un bloc (un fichier), en cases communes. */
export const BLOCK = 8;
/** Jours complets gardés dans les fichiers (la journée en cours s'y ajoute, provisoire). */
export const KEPT_DAYS = 30;
/** Version du format des fichiers : la carte ignore un format qu'elle ne connaît pas. */
export const METEO_FORMAT = 1;

export interface CellRef {
  i: number;
  j: number;
}

export const cellId = (i: number, j: number): string => `${i}:${j}`;
export const blockId = (bi: number, bj: number): string => `${bi}_${bj}`;

/** Case commune qui contient un point. */
export function cellAt(lat: number, lon: number): CellRef {
  return { i: Math.floor(lat / STEP_LAT), j: Math.floor(lon / STEP_LON) };
}

/** Case commune qui contient une case de base (indices de la grille de 0,04° × 0,056°). */
export const cellOfBase = (bi: number, bj: number): CellRef => ({
  i: Math.floor(bi / METEO_FACTOR),
  j: Math.floor(bj / METEO_FACTOR),
});

/** Numéro (ordre de `subBox`) du carré de 4,5 km de sa case commune qui contient un point. */
export function subIndexAt(lat: number, lon: number): number {
  const mod = (a: number): number => ((a % METEO_FACTOR) + METEO_FACTOR) % METEO_FACTOR;
  return mod(Math.floor(lat / BASE_STEP_LAT)) * METEO_FACTOR + mod(Math.floor(lon / BASE_STEP_LON));
}

/** Bloc (fichier) d'une case. */
export const blockOf = (c: CellRef): string => blockId(Math.floor(c.i / BLOCK), Math.floor(c.j / BLOCK));

export interface CellBox {
  south: number;
  north: number;
  west: number;
  east: number;
  /** Centre de la case. */
  lat: number;
  lon: number;
}

export function cellBox(c: CellRef): CellBox {
  const south = c.i * STEP_LAT;
  const west = c.j * STEP_LON;
  return {
    south: +south.toFixed(5),
    north: +(south + STEP_LAT).toFixed(5),
    west: +west.toFixed(5),
    east: +(west + STEP_LON).toFixed(5),
    lat: +(south + STEP_LAT / 2).toFixed(5),
    lon: +(west + STEP_LON / 2).toFixed(5),
  };
}

/** Nombre de carrés de 4,5 km (cases de base) dans une case commune. */
export const SUB_COUNT = METEO_FACTOR * METEO_FACTOR;

/**
 * Carré de 4,5 km numéro `k` d'une case commune : rangés du sud au nord, puis d'ouest en est
 * (k = ligne × METEO_FACTOR + colonne), dans le même ordre que les altitudes des fichiers.
 */
export function subBox(c: CellRef, k: number): { south: number; north: number; west: number; east: number } {
  const south = (c.i * METEO_FACTOR + Math.floor(k / METEO_FACTOR)) * BASE_STEP_LAT;
  const west = (c.j * METEO_FACTOR + (k % METEO_FACTOR)) * BASE_STEP_LON;
  return {
    south: +south.toFixed(5),
    north: +(south + BASE_STEP_LAT).toFixed(5),
    west: +west.toFixed(5),
    east: +(west + BASE_STEP_LON).toFixed(5),
  };
}

// ── Fichiers ─────────────────────────────────────────────────────────────────

/** Une case dans un fichier de bloc : valeurs alignées sur `dates` (null : jour inconnu). */
export interface StoredCell {
  /** Point où la météo est relevée (dans la case, sur le territoire), et son altitude (m). */
  lat: number;
  lon: number;
  z: number;
  /**
   * Dernier jour connu (AAAA-MM-JJ) et dernier jour définitif : entre les deux, la journée du dernier
   * passage de la mise à jour, telle qu'Open-Meteo la donnait alors (heures écoulées et prévision
   * pour la fin du jour). Le lendemain, la carte s'en sert comme estimation de la veille tant que
   * le passage du jour n'a pas eu lieu. `f` absent (anciens fichiers) : tout est définitif.
   */
  c: string;
  f?: string;
  /** Jour de la dernière demande à Open-Meteo (pour la mise à jour : une demande par jour). */
  m?: string;
  /** Pluie (mm), températures maximale et minimale (°C), une décimale. */
  p: (number | null)[];
  x: (number | null)[];
  n: (number | null)[];
  /**
   * Altitude (m) des SUB_COUNT carrés de 4,5 km de la case, dans l'ordre de `subBox` ; null : carré
   * sans terre française (mer, étranger). Absent des fichiers les plus anciens.
   */
  a?: (number | null)[];
}

export interface BlockFile {
  v: number;
  dates: string[];
  cells: Record<string, StoredCell>;
}

export interface MeteoIndexFile {
  v: number;
  /** Pas de la grille et taille des blocs : la carte vérifie qu'ils sont les siens. */
  pasLat: number;
  pasLon: number;
  bloc: number;
  jours: number;
  /** Dernier jour complet de la plupart des cases. */
  dernierJour: string;
  /** Dernière mise à jour (ISO 8601). */
  maj: string;
  cases: number;
  aJour: number;
  blocs: string[];
  source: string;
}

// ── Dates (jours civils, AAAA-MM-JJ) ─────────────────────────────────────────

const DAY_MS = 86_400_000;
const toUtc = (date: string): number => Date.parse(`${date}T00:00:00Z`);

/** Date décalée de `k` jours. */
export const addDays = (date: string, k: number): string => new Date(toUtc(date) + k * DAY_MS).toISOString().slice(0, 10);

/** Nombre de jours de `from` à `to` (positif si `to` est après). */
export const daysBetween = (from: string, to: string): number => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);

/** Date du jour à Paris (AAAA-MM-JJ). */
export function parisDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now);
}

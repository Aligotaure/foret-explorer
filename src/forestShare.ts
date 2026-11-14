/**
 * Arbres hôtes de chaque carré de 4,5 km : la part de sa surface couverte par chaque type de forêt
 * (BD Forêt), calculée une fois par `scripts/foret/parts.mjs` et versionnée (`public/foret/parts.json`).
 *
 * Sans elle, l'indice des cases et des carrés ne regardait que la météo : un carré posé sur une
 * ville ou sur la mer affichait le même pourcentage qu'une forêt, et le bilan au clic disait tout
 * autre chose. Avec elle, un carré n'est coloré que s'il contient des arbres hôtes du champignon, et
 * son indice vaut pour ces forêts-là.
 */
import { BUILT_MAX_COVER, FOREST_SHARE_URL, HOST_MIN_COVER } from './config';
import { BASE_STEP_LAT, BASE_STEP_LON, SUB_COUNT } from './meteoGrid';
import type { Mushroom } from './mushrooms';

/** Fichier des parts : par case commune, ses carrés dans l'ordre de `subBox`. */
interface ShareFile {
  v: number;
  pasLat: number;
  pasLon: number;
  /** Codes BD Forêt (`code_tfv`) ; les parts les désignent par leur rang. */
  codes: string[];
  /** Un carré : [rang du code, part en %, rang, part, …] ; null : carré sans terre française. */
  cases: Record<string, (number[] | null)[]>;
  /** Part bâtie de chaque carré, en %, dans le même ordre (absente d'un fichier d'avant le 14/11/2026). */
  bati?: Record<string, (number | null)[]>;
}

export interface HostCover {
  /** Part de la surface sous des arbres hôtes du champignon (0 à 1). */
  cover: number;
  /** Qualité moyenne de ces hôtes (poids de `Mushroom.hosts`, 0 à 1). */
  quality: number;
  /** Part de la surface bâtie (0 à 1 ; 0 si le fichier ne la donne pas). */
  built: number;
}

/**
 * Un carré est-il allumé pour ce champignon ? Il lui faut assez d'arbres hôtes, et ne pas être
 * d'abord une ville : un bois de banlieue ne colore pas 20 km² de quartiers. Même règle pour la
 * carte (meteoLayer.ts) et pour le bilan d'un coin dont la forêt n'est pas connue (spot.ts).
 */
export const isLit = (host: HostCover): boolean => host.cover >= HOST_MIN_COVER && host.built < BUILT_MAX_COVER;

let file: ShareFile | null = null;
let loading: Promise<boolean> | null = null;
/** Fichier lu mais d'un autre format ou d'une autre grille : inutile de le redemander. */
let unusable = false;
/** Dernier échec de réseau : on attend un peu avant de redemander (pas à chaque déplacement de la carte). */
let failedAt = 0;
const RETRY_MS = 30_000;
const cache = new Map<string, (HostCover | null)[]>();

/**
 * Charge le fichier (une seule fois par visite s'il arrive). Rend faux s'il manque ou n'est pas à ce
 * format : la grille se dessine alors comme avant, sans tenir compte de la forêt, et la légende le
 * dit. Un échec de réseau (fréquent en forêt) est retenté au plus toutes les 30 secondes.
 */
export function loadForestShare(): Promise<boolean> {
  if (file) return Promise.resolve(true);
  if (unusable || (failedAt && Date.now() - failedAt < RETRY_MS)) return Promise.resolve(false);
  loading ??= fetch(FOREST_SHARE_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<ShareFile>;
    })
    .then((data) => {
      if (data.v !== 1 || data.pasLat !== BASE_STEP_LAT || data.pasLon !== BASE_STEP_LON || !Array.isArray(data.codes) || !data.cases) {
        unusable = true;
        throw new Error('format ou grille inattendus');
      }
      file = data;
      return true;
    })
    .catch((error: unknown) => {
      console.warn('[parts de forêt]', error);
      failedAt = Date.now();
      loading = null;
      return false;
    });
  return loading;
}

/** Arbres hôtes des carrés d'une case, pour un champignon (null : case absente du fichier). */
function coversOf(cellId: string, m: Mushroom): (HostCover | null)[] | null {
  if (!file) return null;
  const key = `${m.id}|${cellId}`;
  let list = cache.get(key);
  if (!list) {
    const squares = file.cases[cellId];
    if (!squares) return null;
    const weights = file.codes.map((code) => m.hosts[code] ?? 0);
    const builtOf = file.bati?.[cellId];
    list = Array.from({ length: SUB_COUNT }, (_, k) => {
      const parts = squares[k];
      if (!parts) return null;
      let cover = 0;
      let weighted = 0;
      for (let n = 0; n + 1 < parts.length; n += 2) {
        const weight = weights[parts[n] ?? -1] ?? 0;
        if (weight <= 0) continue;
        const share = (parts[n + 1] ?? 0) / 100;
        cover += share;
        weighted += share * weight;
      }
      return { cover: Math.min(1, cover), quality: cover > 0 ? weighted / cover : 0, built: (builtOf?.[k] ?? 0) / 100 };
    });
    cache.set(key, list);
  }
  return list;
}

/** Arbres hôtes du carré `k` d'une case ; null : inconnu (fichier absent, carré hors du fichier). */
export function hostCover(cellId: string, k: number, m: Mushroom): HostCover | null {
  return coversOf(cellId, m)?.[k] ?? null;
}

/**
 * Arbres hôtes d'une case entière : moyenne de ses carrés (ceux sans terre française ne comptent
 * pas), et numéro de son carré allumé le plus boisé en hôtes (−1 : aucun carré allumé). Il dit où
 * poser une pastille, et de quoi ne pas éteindre une case dont un seul carré est une vraie forêt.
 * null : inconnu.
 */
export function hostCoverOfCell(cellId: string, m: Mushroom): (HostCover & { best: number }) | null {
  const list = coversOf(cellId, m);
  if (!list) return null;
  let count = 0;
  let cover = 0;
  let weighted = 0;
  let built = 0;
  let best = -1;
  let bestCover = -1;
  list.forEach((c, k) => {
    if (!c) return;
    count++;
    cover += c.cover;
    weighted += c.cover * c.quality;
    built += c.built;
    if (isLit(c) && c.cover > bestCover) {
      bestCover = c.cover;
      best = k;
    }
  });
  if (!count) return null;
  return { cover: cover / count, quality: cover > 0 ? weighted / cover : 0, built: built / count, best };
}

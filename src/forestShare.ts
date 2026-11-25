/**
 * Ce que chaque carré de 4,5 km contient pour chaque champignon : combien de ses carrés de 500 m la
 * carte dessinerait en zoomant, et ce que vaut le meilleur d'entre eux (arbres hôtes × sol). Calculé
 * une fois pour toute la France par `scripts/foret/parts.mjs`, qui applique la règle des carrés de
 * 500 m (fineRule.ts) aux forêts de la BD Forêt et aux sols du site, et versionné
 * (`public/foret/parts.json`).
 *
 * Tout ce qui se montre plus large que les carrés de 500 m le lit : carrés de 4,5 km, cases de 18 km,
 * pastilles, « meilleure chance de la vue », bandeau « risque de chou blanc », moyennes de France,
 * bilan d'un coin dont la forêt n'est pas connue. Un carré de 4,5 km est allumé dès qu'un de ses
 * carrés de 500 m serait dessiné, et son pourcentage est celui du meilleur : en zoomant, on trouve
 * ce que la vue large annonçait, ni plus ni moins.
 *
 * Avant le 25/11/2026 le fichier donnait la part de surface de chaque type de forêt, et un carré ne
 * s'allumait qu'à 10 % d'arbres hôtes : un bois isolé, dessiné en carrés de 500 m, disparaissait un
 * cran de zoom plus haut ; et son pourcentage ignorait le sol, que les carrés de 500 m comptent.
 */
import { FINE_DIVISIONS, FOREST_SHARE_URL } from './config';
import type { SquareSurvey } from './fineRule';
import { BASE_STEP_LAT, BASE_STEP_LON, SUB_COUNT } from './meteoGrid';
import type { Mushroom } from './mushrooms';

/** Format du fichier (`v`). 1 : parts de surface par type de forêt, jusqu'au 25/11/2026. */
export const SHARE_FORMAT = 2;
/**
 * Le meilleur « arbres × sol » d'un carré est écrit en millièmes, arrondi au-dessus : le carré de
 * 4,5 km n'annonce jamais moins que son meilleur carré de 500 m (au plus 0,1 % de plus).
 */
const BEST_UNIT = 1000;
const FINE_PER_SQUARE = FINE_DIVISIONS ** 2;

/** Fichier des parts : par case commune, ses carrés dans l'ordre de `subBox`. */
interface ShareFile {
  v: number;
  pasLat: number;
  pasLon: number;
  /** Champignons du fichier (`Mushroom.id`), dans l'ordre des paires de `fin`. */
  champignons: string[];
  /**
   * Un carré : par champignon, [nombre de carrés de 500 m à dessiner, meilleur « arbres × sol » en
   * millièmes], à la suite ; 0 : rien à dessiner pour aucun champignon ; null : pas de terre française.
   */
  fin: Record<string, (number[] | 0 | null)[]>;
  /** Part bâtie de chaque carré, en %, dans le même ordre. */
  bati?: Record<string, (number | null)[]>;
  /** Empreinte des règles qui ont servi au calcul (`rulesSignature` de fineRule.ts). */
  regles?: string;
}

/** Un carré de 4,5 km tel que le fichier l'écrit (voir `ShareFile.fin`) ; `surveys` dans l'ordre des champignons. */
export function packSquare(surveys: readonly SquareSurvey[]): number[] | 0 {
  if (surveys.every((s) => !s.count)) return 0;
  // (− 1e-9 : 0,9 × 1 000 fait 900,0000000000001, qui ne doit pas devenir 901.)
  return surveys.flatMap((s) => (s.count ? [s.count, Math.min(BEST_UNIT, Math.ceil(s.best * BEST_UNIT - 1e-9))] : [0, 0]));
}

export interface HostCover {
  /**
   * Part des carrés de 500 m du carré que la carte dessinerait pour ce champignon (0 à 1) : assez
   * d'arbres hôtes, et en ville seulement les vrais massifs. 0 : rien à y dessiner.
   */
  cover: number;
  /**
   * Ce que vaut le meilleur de ces carrés de 500 m : qualité de ses arbres hôtes × sol (0 à 1), la
   * part de l'indice que la météo multiplie.
   */
  quality: number;
  /** Part de la surface bâtie (0 à 1 ; 0 si le fichier ne la donne pas). */
  built: number;
}

/**
 * Un carré est-il allumé pour ce champignon ? Dès qu'un de ses carrés de 500 m serait dessiné. Même
 * règle pour la carte (meteoLayer.ts) et pour le bilan d'un coin dont la forêt n'est pas connue
 * (spot.ts). Les villes n'ont plus de règle à part ici : celle des carrés de 500 m (un parc isolé
 * n'en pose pas, un massif oui) est déjà dans le compte.
 */
export const isLit = (host: HostCover): boolean => host.cover > 0;

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
 * format : la grille se dessine alors sans tenir compte de la forêt, et la légende le dit. Un échec
 * de réseau (fréquent en forêt) est retenté au plus toutes les 30 secondes.
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
      if (!useForestShare(data)) {
        unusable = true;
        throw new Error('format ou grille inattendus');
      }
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

/**
 * Prend ce contenu pour fichier des parts (faux s'il n'est pas à ce format ou d'une autre grille).
 * Sert au chargement, et au calcul des moyennes de France, qui lit le fichier sur le disque.
 */
export function useForestShare(data: unknown): boolean {
  const d = data as ShareFile | null;
  if (!d || d.v !== SHARE_FORMAT || d.pasLat !== BASE_STEP_LAT || d.pasLon !== BASE_STEP_LON || !Array.isArray(d.champignons) || !d.fin) return false;
  file = d;
  cache.clear();
  return true;
}

/** Les carrés d'une case pour un champignon (null : case absente du fichier, ou champignon que le fichier ne connaît pas). */
function coversOf(cellId: string, m: Mushroom): (HostCover | null)[] | null {
  if (!file) return null;
  const key = `${m.id}|${cellId}`;
  let list = cache.get(key);
  if (!list) {
    const squares = file.fin[cellId];
    const rank = file.champignons.indexOf(m.id);
    if (!squares || rank < 0) return null;
    const builtOf = file.bati?.[cellId];
    list = Array.from({ length: SUB_COUNT }, (_, k) => {
      const square = squares[k];
      if (square === null || square === undefined) return null;
      const count = square === 0 ? 0 : (square[2 * rank] ?? 0);
      const best = square === 0 ? 0 : (square[2 * rank + 1] ?? 0);
      return { cover: Math.min(1, count / FINE_PER_SQUARE), quality: Math.min(1, best / BEST_UNIT), built: (builtOf?.[k] ?? 0) / 100 };
    });
    cache.set(key, list);
  }
  return list;
}

/** Le carré `k` d'une case pour un champignon ; null : inconnu (fichier absent, carré hors du fichier). */
export function hostCover(cellId: string, k: number, m: Mushroom): HostCover | null {
  return coversOf(cellId, m)?.[k] ?? null;
}

/**
 * Une case entière : moyenne de ses carrés (ceux sans terre française ne comptent pas), et numéro de
 * son carré allumé qui a le plus de carrés de 500 m à dessiner (−1 : aucun carré allumé). Il dit de
 * quoi ne pas éteindre une case dont un seul carré a un bois. null : inconnu.
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

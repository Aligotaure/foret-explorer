/**
 * La règle des carrés de 500 m, sans rien de la carte ni du navigateur : ce qu'on relève dans un
 * carré, s'il est à dessiner pour un champignon, et ce que valent ses arbres et son sol.
 *
 * Elle est lue par la carte (fineGrid.ts, meteoLayer.ts) et, telle quelle, par
 * `scripts/foret/parts.mjs`, qui l'applique une fois à toute la France (`surveySquare`) pour dire ce
 * que chaque carré de 4,5 km contient. Les échelles larges (carrés de 4,5 km, cases de 18 km,
 * pastilles, bandeau « risque de chou blanc », moyennes de France, bilan d'un coin dont la forêt est
 * inconnue) lisent ce résultat (forestShare.ts) : elles n'annoncent jamais autre chose que ce que les
 * carrés de 500 m montreront en zoomant.
 *
 * Avant le 25/11/2026 les carrés de 4,5 km suivaient leur propre règle, une part de surface (10 %
 * d'arbres hôtes) : un bois de 25 ha dessiné à 78 % en carrés de 500 m disparaissait un cran de zoom
 * plus haut (retour de Clément, sud-ouest d'Amiens, chanterelles en tube).
 */
import { BUILT_MAX_COVER, FINE_DIVISIONS, FINE_MIN_HOST_SHARE, FINE_TOWN_MIN_HOST_SHARE, FINE_TOWN_MIN_NEIGHBOURS } from './config';
import { MUSHROOMS, soilModulation, type Mushroom } from './mushrooms';
import type { SoilId } from './soils';

/** Ce qu'il y a sous un des 3 × 3 points du carré. */
export interface Sample {
  code: string | null;
  soil: SoilId | null;
}

/**
 * Où tombent les points relevés sur le côté d'un carré. Sur toute la France ils forment un treillis
 * régulier (un point tous les tiers de carré) : `scripts/foret/releve.mjs` s'en sert.
 */
export const FINE_OFFSETS = [1 / 6, 1 / 2, 5 / 6] as const;
/** Points relevés dans un carré entièrement visible (3 × 3). */
export const FINE_POINTS = FINE_OFFSETS.length ** 2;

/**
 * Part des neuf points d'un carré qui sont sous un arbre hôte du champignon (0 à 1). Un carré à
 * cheval sur le bord de l'écran n'est relevé qu'en partie : on compte quand même sur neuf, sinon il
 * se dessinerait sur la foi d'un seul point visible, puis disparaîtrait une fois entier à l'écran.
 */
export function hostShare(m: Mushroom, samples: readonly Sample[]): number {
  let hosts = 0;
  for (const s of samples) if (s.code !== null && (m.hosts[s.code] ?? 0) > 0) hosts++;
  return hosts / FINE_POINTS;
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

/** Ce que valent les arbres et le sol d'un carré pour un champignon. */
export interface FineFactors {
  /** Nombre de points sous un arbre hôte. */
  hosts: number;
  /** Qualité moyenne des arbres hôtes présents (poids de `Mushroom.hosts`, 0 à 1). */
  quality: number;
  /** Facteur de sol moyen sous ces arbres (`soilModulation` ; 1 là où le sol n'est pas connu). */
  soil: number;
}

/** Arbres hôtes et sol d'un carré ; null si aucun de ses points n'est sous un arbre hôte. */
export function fineFactors(m: Mushroom, samples: readonly Sample[]): FineFactors | null {
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
  return hosts ? { hosts, quality: quality / hosts, soil: soil / hosts } : null;
}

// ── Un carré de 4,5 km, vu par ses carrés de 500 m ────────────────────────────

/**
 * Un carré de 500 m relevé, pour `surveySquare`. `inner` : il est dans le carré de 4,5 km jugé ;
 * sinon il le borde, et ne sert qu'à la règle de ville (qui regarde les huit voisins).
 */
export interface SurveyedCell {
  id: string;
  samples: readonly Sample[];
  inner: boolean;
}

/** Ce que la carte dessinerait dans un carré de 4,5 km pour un champignon. */
export interface SquareSurvey {
  /** Nombre de ses carrés de 500 m à dessiner (0 à FINE_DIVISIONS²). */
  count: number;
  /**
   * Parmi eux, le meilleur produit « qualité des arbres hôtes × sol » (0 à 1) : la part de l'indice
   * qui ne dépend pas de la météo. Multipliée par celle-ci, elle donne l'indice du meilleur carré de
   * 500 m du carré, donc celui que le carré de 4,5 km doit annoncer.
   */
  best: number;
}

/**
 * Applique la règle des carrés de 500 m à un carré de 4,5 km : `cells` = ses FINE_DIVISIONS² carrés
 * (`inner`) et ceux qui les bordent, chacun avec ses neuf points ; `town` : le carré de 4,5 km est
 * d'abord bâti (BUILT_MAX_COVER). Mêmes fonctions, dans le même ordre, que `MeteoLayer.fineToDraw`
 * et `scoreFineCell`.
 */
export function surveySquare(m: Mushroom, town: boolean, cells: readonly SurveyedCell[]): SquareSurvey {
  const candidates: FineCandidate[] = [];
  for (const c of cells) {
    const share = hostShare(m, c.samples);
    if (share) candidates.push({ id: c.id, share, town });
  }
  const kept = fineCellsToDraw(candidates);
  let count = 0;
  let best = 0;
  for (const c of cells) {
    if (!c.inner || !kept.has(c.id)) continue;
    const f = fineFactors(m, c.samples);
    if (!f) continue;
    count++;
    best = Math.max(best, f.quality * f.soil);
  }
  return { count, best };
}

/**
 * Empreinte de tout ce dont dépend le résultat de `surveySquare` : découpage et seuils des carrés de
 * 500 m, arbres hôtes et sols de chaque champignon. `scripts/foret/parts.mjs` l'écrit dans le fichier
 * des parts ; `npm run test:france` la compare à celle du code : si elles diffèrent, le fichier est
 * à refaire (sinon les carrés de 4,5 km n'annonceraient plus ce que les carrés de 500 m montrent).
 */
export function rulesSignature(): string {
  const sorted = (o: Readonly<Record<string, number>>): [string, number][] => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const text = JSON.stringify([
    FINE_DIVISIONS,
    FINE_OFFSETS,
    FINE_MIN_HOST_SHARE,
    FINE_TOWN_MIN_HOST_SHARE,
    FINE_TOWN_MIN_NEIGHBOURS,
    BUILT_MAX_COVER,
    [0, 0.5, 1].map(soilModulation),
    MUSHROOMS.map((m) => [m.id, sorted(m.hosts), sorted(m.soils)]),
  ]);
  // FNV-1a sur 32 bits : il s'agit de voir un changement, pas de s'en protéger.
  let hash = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) {
    hash ^= text.charCodeAt(k);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

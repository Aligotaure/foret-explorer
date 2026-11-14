/**
 * Moyenne de France par champignon : le chiffre affiché sur chaque puce (« Trompettes 46 % »).
 *
 * Demande de Clément du 15/11/2026 : aider à choisir un champignon avant d'avoir rien affiché, sans
 * compter « les endroits où de toute façon il y a 0 % de chance d'en trouver, comme les villes ».
 * C'est la moyenne des chances estimées sur les carrés de 4,5 km où le champignon peut pousser :
 * ceux que la carte peut allumer (`isLit` : assez d'arbres hôtes, pas d'abord une ville). Chaque
 * carré compte pour un, calculé comme la carte le calcule (`squareScore`).
 *
 * Calculée à la publication du site, pas dans le navigateur (`scripts/meteo/france.mjs`, étape de
 * `deploy.yml`) : il y faut les fichiers météo de toute la France (45 fichiers, 325 ko compressés,
 * 0,1 à 0,25 s de calcul), alors que la carte n'en charge aucun tant qu'aucun champignon n'est
 * choisi. Le navigateur ne lit qu'un fichier de quelques centaines d'octets, `data/meteo/france.json`.
 * S'il manque ou date, les puces n'affichent pas de chiffre.
 *
 * Une moyenne nationale écrase les régions (les cèpes à 18 % le 14/11/2026, avec 500 carrés à 70 %
 * ou plus) : elle classe les champignons entre eux, elle ne dit rien d'un coin. D'où la légende sous
 * les puces, et la carte.
 */
import { METEO_BASE, METEO_MAX_LATE_DAYS } from './config';
import { hostCover, isLit } from './forestShare';
import { addDays, parisDate, type BlockFile } from './meteoGrid';
import { MUSHROOMS, chanceOf, currentMonth, noEstimate, squareScore, weatherCeiling, type MushroomId } from './mushrooms';
import { parseBlock, summarize, temperaturesAt } from './weather';

/** (Pour le script de publication : il fournit le fichier des parts de forêt lu sur le disque.) */
export { useForestShare } from './forestShare';

export const FRANCE_STATS_FORMAT = 1;

/** `data/meteo/france.json`. */
export interface FranceStatsFile {
  v: number;
  /** Mise à jour des fichiers météo dont le calcul est tiré (ISO 8601) et leur dernier jour complet. */
  maj: string;
  jour: string;
  /** Mois du calcul (1 à 12) : les saisons en dépendent. */
  mois: number;
  /** Par champignon de saison : chance estimée moyenne (%) et nombre de carrés comptés. */
  moyennes: Partial<Record<MushroomId, number>>;
  carres: Partial<Record<MushroomId, number>>;
}

/**
 * Le calcul, à partir des blocs météo de toute la France. Le fichier des parts de forêt doit avoir
 * été fourni (`useForestShare`). Un champignon sans estimation ce mois-ci (`noEstimate`) n'a pas
 * de moyenne ; un champignon sans aucun carré compté non plus.
 */
export function franceAverages(blocks: readonly BlockFile[], today: string): Pick<FranceStatsFile, 'mois' | 'moyennes' | 'carres'> {
  const month = Number(today.slice(5, 7));
  const shown = MUSHROOMS.filter((m) => !noEstimate(m, month));
  const sum = new Map<MushroomId, number>();
  const count = new Map<MushroomId, number>();
  for (const block of blocks) {
    for (const [cellId, series] of parseBlock(block)) {
      if (!series.subAltitudes) continue;
      const w = summarize(series, today);
      for (const m of shown) {
        const ceiling = weatherCeiling(m, w, month);
        series.subAltitudes.forEach((z, k) => {
          if (z === null) return;
          const host = hostCover(cellId, k, m);
          if (!host || !isLit(host)) return;
          sum.set(m.id, (sum.get(m.id) ?? 0) + chanceOf(squareScore(m, ceiling, temperaturesAt(w, z), host.quality)));
          count.set(m.id, (count.get(m.id) ?? 0) + 1);
        });
      }
    }
  }
  const moyennes: FranceStatsFile['moyennes'] = {};
  const carres: FranceStatsFile['carres'] = {};
  for (const m of shown) {
    const n = count.get(m.id) ?? 0;
    if (!n) continue;
    moyennes[m.id] = Math.round((sum.get(m.id) ?? 0) / n);
    carres[m.id] = n;
  }
  return { mois: month, moyennes, carres };
}

/** Jour (heure de Paris) du calcul : celui dont la carte tire ses résumés météo. */
export const statsDay = (now = new Date()): string => parisDate(now);

// ── Lecture par la carte ──────────────────────────────────────────────────────

let loading: Promise<FranceStatsFile['moyennes'] | null> | null = null;

/**
 * Moyennes à afficher (null : pas de fichier, fichier d'un autre format, trop ancien, ou calculé un
 * autre mois, les saisons ayant pu changer). Lu une fois par visite. En développement, d'abord le
 * fichier local s'il a été fabriqué (`node scripts/meteo/france.mjs`), sinon celui du site en ligne.
 */
export function loadFranceStats(): Promise<FranceStatsFile['moyennes'] | null> {
  loading ??= (async () => {
    const urls = import.meta.env.DEV ? [new URL('data/meteo/france.json', document.baseURI).href, `${METEO_BASE}france.json`] : [`${METEO_BASE}france.json`];
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) continue;
        const file = (await response.json()) as FranceStatsFile;
        const fresh = typeof file.jour === 'string' && file.jour >= addDays(statsDay(), -1 - METEO_MAX_LATE_DAYS);
        if (file.v !== FRANCE_STATS_FORMAT || !file.moyennes || !fresh || file.mois !== currentMonth()) continue;
        return file.moyennes;
      } catch {
        /* absent, illisible ou hors réseau : pas de chiffre sur les puces */
      }
    }
    return null;
  })();
  return loading;
}

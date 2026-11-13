/**
 * Champignons recherchés et indice de pousse.
 *
 * L'indice combine des règles de cueilleur, pas un modèle scientifique validé :
 *   saison × pluie (délai depuis la dernière grosse pluie + humidité du sol)
 *   × température (moyenne des 7 derniers jours à l'altitude du coin, gel)
 *   × arbre hôte × nature du sol (quand on les connaît, c.-à-d. pour un coin précis).
 * Chaque facteur vaut de 0 à 1 ; les raisons affichées expliquent le résultat.
 */
import { CLASS_BY_CODE } from './forestClasses';
import { SOIL_BY_ID, type SoilId } from './soils';
import type { WeatherSummary } from './weather';

export type MushroomId = 'cepe' | 'girolle' | 'trompette' | 'chanterelle' | 'morille';

export interface Mushroom {
  id: MushroomId;
  label: string;
  /** Au singulier, pour les phrases (« Bon délai pour le cèpe »). */
  singular: string;
  latin: string;
  /** Types BD Forêt hôtes → poids (1 : hôte typique ; moins : mélange, forêt ouverte…). */
  hosts: Readonly<Record<string, number>>;
  soils: Readonly<Record<SoilId, number>>;
  /** Poids par mois (1–12) ; absent = hors saison. */
  season: Readonly<Partial<Record<number, number>>>;
  /** Moyenne idéale sur 7 jours (°C) et largeur de la pente de part et d'autre. */
  temp: readonly [number, number];
  tempRamp: number;
  /** Délai après la pluie (jours) : début, plein, fin du plein, fin. */
  lag: readonly [number, number, number, number];
  /** Facteur appliqué en cas de gel récent. */
  frost: number;
  /** Résumé pour la fiche « Je cherche… ». */
  summary: string;
  /** Arbres en clair, quand les libellés BD Forêt ne parlent pas (« autre feuillu pur »). */
  trees?: string;
  /** Confusion dangereuse ou précaution propre à l'espèce (affichée en encadré dans la fiche). */
  caution?: string;
  /**
   * Fiche de l'espèce type sur MycoDB (photos, description). L'entrée est souvent un groupe d'espèces :
   * le lien nomme donc l'espèce visée. Adresses écrites en dur et vérifiées à la main le 13/11/2026 :
   * MycoDB répond 200 même pour une fiche qui n'existe pas, et interdit les robots (voir CLAUDE.md).
   */
  sheet: { species: string; url: string };
}

const mycodb = (genus: string, species: string): Mushroom['sheet'] => ({
  species: `${genus} ${species}`,
  url: `https://www.mycodb.fr/fiche.php?genre=${genus}&espece=${species}`,
});

/** Rappel affiché dans chaque fiche : l'indice ne dit rien de la comestibilité. */
export const GENERAL_CAUTION =
  'L’indice dit où chercher, pas ce qui se mange. Au moindre doute, faites contrôler la récolte par un pharmacien ou une société mycologique.';

/** Hôtes communs : feuillus et conifères « à cèpes ». */
const BROADLEAF = { 'FF1G01-01': 1, 'FF1-09-09': 1, 'FF1-10-10': 1, 'FF1-00-00': 0.85, 'FF1-00': 0.5, FO1: 0.4 };
const CONIFER = { 'FF2G61-61': 1, 'FF2-52-52': 0.75, 'FF2-00-00': 0.8, 'FF2-80-80': 0.6, 'FF2-81-81': 0.5, 'FF2-00': 0.5, FO2: 0.4 };
const MIXED = { FF31: 0.9, FF32: 0.9, FO3: 0.4 };

export const MUSHROOMS: readonly Mushroom[] = [
  {
    id: 'cepe',
    label: 'Cèpes',
    singular: 'le cèpe',
    latin: 'Boletus edulis et proches',
    hosts: { ...BROADLEAF, ...CONIFER, ...MIXED, 'FF1G06-06': 0.6, 'FF2-51-51': 0.6 },
    soils: { cristallin: 1, gres: 1, limon: 0.8, moraine: 0.8, eboulis: 0.6, calcaire: 0.6, marne: 0.5, humide: 0.2 },
    season: { 5: 0.2, 6: 0.5, 7: 0.8, 8: 1, 9: 1, 10: 1, 11: 0.7, 12: 0.3 },
    temp: [10, 19],
    tempRamp: 5,
    lag: [4, 7, 14, 21],
    frost: 0.35,
    summary:
      'Sous chênes, hêtres, châtaigniers, sapins et épicéas adultes, plutôt sur sol acide et drainant. ' +
      'Pousse 1 à 2 semaines après une grosse pluie, par temps doux.',
    caution: 'Ne pas confondre avec le bolet de Satan (pores et pied rouges, toxique).',
    sheet: mycodb('Boletus', 'edulis'),
  },
  {
    id: 'girolle',
    label: 'Girolles',
    singular: 'la girolle',
    latin: 'Cantharellus cibarius et proches',
    hosts: { ...BROADLEAF, ...CONIFER, ...MIXED },
    soils: { cristallin: 1, gres: 1, limon: 0.8, moraine: 0.8, eboulis: 0.6, calcaire: 0.5, marne: 0.5, humide: 0.3 },
    season: { 5: 0.3, 6: 0.7, 7: 1, 8: 1, 9: 1, 10: 0.8, 11: 0.5, 12: 0.2 },
    temp: [11, 21],
    tempRamp: 5,
    lag: [5, 9, 18, 25],
    frost: 0.35,
    summary:
      'Dans la mousse sous feuillus et sapins, surtout sur sol acide. Plus lente que le cèpe : ' +
      '1 à 3 semaines après la pluie, et la pousse dure longtemps.',
    caution:
      'Ne pas confondre avec la fausse girolle ni le clitocybe de l’olivier (toxique), qui ont de vraies lames sous le chapeau.',
    sheet: mycodb('Cantharellus', 'cibarius'),
  },
  {
    id: 'trompette',
    label: 'Trompettes',
    singular: 'la trompette',
    latin: 'Craterellus cornucopioides',
    hosts: { 'FF1-09-09': 1, 'FF1G01-01': 0.9, 'FF1-10-10': 0.7, 'FF1-00-00': 0.9, FF31: 0.9, FF32: 0.6, 'FF1-00': 0.5, 'FF2G61-61': 0.3, FO1: 0.3 },
    soils: { calcaire: 1, marne: 1, limon: 0.8, moraine: 0.8, eboulis: 0.7, gres: 0.5, cristallin: 0.4, humide: 0.3 },
    season: { 8: 0.6, 9: 1, 10: 1, 11: 0.9, 12: 0.5, 1: 0.2 },
    temp: [7, 16],
    tempRamp: 5,
    lag: [6, 10, 20, 28],
    frost: 0.6,
    summary:
      'Trompettes de la mort, en troupes sous les hêtres et les chênes, sur sol calcaire ou argileux ' +
      'riche. Champignon d’arrière-saison, après des pluies répétées.',
    sheet: mycodb('Craterellus', 'cornucopioides'),
  },
  {
    id: 'chanterelle',
    label: 'Chanterelles en tube',
    singular: 'la chanterelle en tube',
    latin: 'Craterellus tubaeformis',
    hosts: { 'FF2G61-61': 1, 'FF2-00-00': 0.9, FF32: 0.9, 'FF2-52-52': 0.6, 'FF2-80-80': 0.5, 'FF2-81-81': 0.5, 'FF2G58-58': 0.5, 'FF1-09-09': 0.5, FF31: 0.6, 'FF2-00': 0.5, 'FF2-63-63': 0.4, FO2: 0.4 },
    soils: { cristallin: 1, gres: 1, moraine: 0.9, humide: 0.7, limon: 0.6, eboulis: 0.6, marne: 0.5, calcaire: 0.5 },
    season: { 9: 0.6, 10: 1, 11: 1, 12: 0.8, 1: 0.4, 2: 0.1 },
    temp: [3, 12],
    tempRamp: 4,
    lag: [5, 8, 18, 26],
    frost: 0.9,
    summary:
      'Chanterelles grises, en masse dans les sapinières et pessières moussues sur sol acide et frais. ' +
      'Les plus tardives : supportent le froid et les petites gelées.',
    caution:
      'Vérifier les plis sous le chapeau : de petits champignons bruns à vraies lames poussent au même endroit, et certains sont mortels.',
    sheet: mycodb('Craterellus', 'tubaeformis'),
  },
  {
    id: 'morille',
    label: 'Morilles',
    singular: 'la morille',
    latin: 'Morchella spp.',
    hosts: {
      'FF1-49-49': 1, // « autre feuillu pur » : frênaies surtout, ormes, érables
      FP: 1, // peupleraies
      'FF1-00-00': 0.9, // mélanges de feuillus, ripisylves
      'FF1-00': 0.8, // feuillus en îlots, haies
      FF0: 0.8, // forêt sans couvert arboré : coupes, chablis, places de feu
      FF31: 0.7,
      'FF2G61-61': 0.6, // morilles de montagne, en lisière et dans les coupes
      FF32: 0.6,
      'FF2-63-63': 0.4,
      'FF2-00-00': 0.4,
      FO1: 0.4,
      'FF1-09-09': 0.3,
      'FF1G01-01': 0.3,
    },
    soils: { calcaire: 1, humide: 0.9, marne: 0.9, moraine: 0.8, eboulis: 0.7, limon: 0.6, gres: 0.5, cristallin: 0.3 },
    season: { 2: 0.3, 3: 0.8, 4: 1, 5: 1, 6: 0.7, 7: 0.3 },
    temp: [8, 15],
    tempRamp: 4,
    lag: [3, 7, 16, 24],
    frost: 0.6,
    trees: 'frênes, ormes, peupliers, bords de rivière ; en montagne, sapins et épicéas, surtout dans les coupes',
    summary:
      'Au printemps, quand le sol se réchauffe : sous les frênes et les peupliers, dans les forêts de bord de rivière ' +
      'et les vieux vergers ; en montagne, en lisière et dans les coupes. Une à deux semaines après une pluie douce.',
    caution:
      'La gyromitre, mortelle, pousse en même temps sous les conifères : chapeau plissé en cervelle, pas creusé d’alvéoles. ' +
      'Les morilles se mangent toujours cuites, au moins 20 minutes, jamais crues.',
    sheet: mycodb('Morchella', 'esculenta'),
  },
];

export const MUSHROOM_BY_ID: ReadonlyMap<MushroomId, Mushroom> = new Map(MUSHROOMS.map((m) => [m.id, m]));

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Saison en clair (« juin à novembre ») : les mois où le poids de saison atteint 0,5. */
export function seasonText(m: Mushroom): string {
  const months = Object.entries(m.season)
    .filter(([, w]) => (w ?? 0) >= 0.5)
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);
  const first = months[0];
  const last = months[months.length - 1];
  return first && last ? `${MONTHS[first - 1]} à ${MONTHS[last - 1]}` : '—';
}

/** Types BD Forêt à afficher pour un champignon (hôtes assez typiques). */
export function hostCodes(m: Mushroom, minWeight = 0.5): string[] {
  return Object.entries(m.hosts)
    .filter(([, w]) => w >= minWeight)
    .map(([code]) => code);
}

export type Level = 0 | 1 | 2 | 3;
export const LEVELS: readonly { label: string; color: string; range: string }[] = [
  { label: 'Défavorable', color: '#9a9ab8', range: 'moins de 35 %' },
  { label: 'Peu probable', color: '#e9c46a', range: '35 à 50 %' },
  { label: 'Possible', color: '#e07a1f', range: '50 à 70 %' },
  { label: 'Favorable', color: '#a33b0b', range: '70 % et plus' },
];

export function levelOf(score: number): Level {
  if (score >= 0.5) return 3;
  if (score >= 0.28) return 2;
  if (score >= 0.12) return 1;
  return 0;
}

/**
 * Chance estimée d'en trouver (%), tirée de l'indice (saison × pluie × température × arbre hôte ×
 * sol, entre 0 et 1) par une échelle calée sur les niveaux : 0,12 → 35 %, 0,28 → 50 %, 0,5 → 70 %,
 * 1 → 95 % (jamais 100 %), linéaire entre deux repères. Une règle de cueilleur mise en pourcentage,
 * pas une probabilité mesurée : à recaler avec des sorties réelles.
 */
const CHANCE_SCALE: readonly (readonly [number, number])[] = [[0, 0], [0.12, 35], [0.28, 50], [0.5, 70], [1, 95]];
export function chanceOf(score: number): number {
  const s = clamp(score);
  for (let k = 1; k < CHANCE_SCALE.length; k++) {
    const [s0, p0] = CHANCE_SCALE[k - 1] ?? [0, 0];
    const [s1, p1] = CHANCE_SCALE[k] ?? [1, 95];
    // Arrondi vers le bas : 69,8 % reste « 50 à 70 % », comme son niveau.
    if (s <= s1) return Math.floor(p0 + ((s - s0) / (s1 - s0)) * (p1 - p0) + 1e-9);
  }
  return 95;
}
/**
 * En dessous de cette chance (%), inutile de se déplacer sans connaître un coin précis : la carte ne
 * met en avant (étiquettes, pastilles de la vue d'ensemble) que les secteurs au-dessus.
 */
export const CHANCE_THRESHOLD = 50;

export interface MushroomScore {
  id: MushroomId;
  score: number;
  /** Chance estimée (%), voir `chanceOf`. */
  chance: number;
  level: Level;
  reasons: string[];
  /**
   * Ce qui ramène l'indice à zéro quoi que dise la météo (« hors saison (mars à juin) », « pas un
   * arbre hôte ici ») : le bilan le dit en une ligne au lieu de dérouler des raisons sans effet.
   */
  blocker?: string;
}

export interface SpotContext {
  /** Code BD Forêt au point (null : hors forêt ; undefined : inconnu). */
  forestCode?: string | null;
  /** La forêt n'est pas connue à ce zoom (tuiles pas encore chargées) : le dire, sans rien retrancher. */
  forestUnknown?: boolean;
  /** Nature du sol au point (null : hors de la zone couverte). */
  soil?: SoilId | null;
  /**
   * Carré de la grille fine : qualité des arbres hôtes présents (0–1) et facteur de sol déjà
   * moyenné sur ces arbres. Remplacent `forestCode` et `soil`, sans phrase d'explication.
   */
  hostQuality?: number;
  soilFactor?: number;
}

const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x));

/** 0 en dehors de [a, d], 1 entre b et c, linéaire entre les deux. */
export function trapezoid(x: number, [a, b, c, d]: readonly [number, number, number, number]): number {
  if (x <= a || x >= d) return 0;
  if (x < b) return (x - a) / (b - a);
  if (x <= c) return 1;
  return (d - x) / (d - c);
}

const days = (n: number): string => `${n} jour${n > 1 ? 's' : ''}`;
const mm = (x: number): string => `${Math.round(x)} mm`;

function rainFactor(m: Mushroom, w: WeatherSummary, reasons: string[]): number {
  let best = 0;
  let bestEvent = w.events[0];
  for (const e of w.events) {
    const strength = clamp((e.amount - 10) / 25);
    const value = strength * trapezoid(e.daysAgo, m.lag);
    if (value > best) {
      best = value;
      bestEvent = e;
    }
  }
  const moisture = clamp((w.rain20 - 15) / 45);
  const [, start, end] = m.lag;

  if (!bestEvent) {
    reasons.push(`Pas de grosse pluie depuis ${days(w.days.length)} (${mm(w.rain30)} au total).`);
  } else {
    // La pluie qui pèse le plus dans l'indice peut être une vieille pluie dont le délai est dépassé,
    // alors qu'une plus récente n'a pas encore fait pousser : c'est elle qu'on commente (le bloc météo
    // du bilan la cite aussi, et « revenez dans N jours » sert plus que « le sol sèche »).
    const coming = w.events.find((x) => x.daysAgo < start);
    const e = bestEvent.daysAgo > end && coming ? coming : bestEvent;
    const head = `Pluie de ${mm(e.amount)} il y a ${days(e.daysAgo)}`;
    if (e.daysAgo < start) reasons.push(`${head} : encore tôt, pousse attendue d’ici ${days(start - e.daysAgo)}.`);
    else if (e.daysAgo <= end) reasons.push(`${head} : bon délai pour ${m.singular} (${start} à ${end} jours).`);
    else reasons.push(`${head} : délai dépassé, le sol sèche.`);
  }
  return clamp(0.7 * best + 0.3 * moisture);
}

function tempFactor(m: Mushroom, w: WeatherSummary, reasons: string[]): number {
  if (w.tmean7 === null) return 0.5;
  const [lo, hi] = m.temp;
  let f = trapezoid(w.tmean7, [lo - m.tempRamp, lo, hi, hi + m.tempRamp]);
  const where = w.elevation ? ` à ${Math.round(w.elevation)} m` : '';
  const verdict = w.tmean7 < lo - m.tempRamp ? 'trop froid' : w.tmean7 < lo ? 'un peu froid' : w.tmean7 <= hi ? 'idéal' : 'trop chaud';
  reasons.push(
    `${Math.round(w.tmean7)} °C en moyenne sur 7 jours${where} : ${verdict} (${verdict === 'idéal' ? '' : 'idéal '}${lo} à ${hi} °C).`,
  );
  if (w.frost && w.tmin5 !== null) {
    f *= m.frost;
    reasons.push(`Gel récent (${Math.round(w.tmin5)} °C)${m.frost >= 0.8 ? ', supporté' : ' : pousse freinée'}.`);
  }
  return f;
}

/** Indice de pousse d'un champignon pour une météo, et si possible un coin précis. */
export function scoreMushroom(m: Mushroom, w: WeatherSummary, month: number, ctx: SpotContext = {}): MushroomScore {
  const reasons: string[] = [];
  let blocker: string | undefined;
  const season = m.season[month] ?? 0;
  if (season === 0) blocker = `hors saison (${seasonText(m)})`;
  if (season < 0.5) reasons.push(season === 0 ? 'Hors saison.' : 'Tout début ou fin de saison.');

  let score = season * rainFactor(m, w, reasons) * tempFactor(m, w, reasons);

  if (ctx.forestCode !== undefined) {
    const host = ctx.forestCode ? (m.hosts[ctx.forestCode] ?? 0) : 0;
    const forest = ctx.forestCode ? CLASS_BY_CODE.get(ctx.forestCode)?.short : null;
    if (!ctx.forestCode) reasons.push('Pas de forêt cartographiée ici.');
    else if (host >= 0.8) reasons.push(`Forêt hôte : ${forest?.toLowerCase()}.`);
    else if (host > 0) reasons.push(`Forêt peu typique (${forest?.toLowerCase()}).`);
    else reasons.push(`Pas un arbre hôte (${forest?.toLowerCase()}).`);
    if (host === 0) blocker ??= ctx.forestCode ? 'pas un arbre hôte ici' : 'pas de forêt ici';
    score *= host;
  } else if (ctx.forestUnknown) {
    reasons.push('Forêt inconnue à ce zoom : météo seule. Zoomez pour en tenir compte.');
  }
  if (ctx.soil) {
    const pref = m.soils[ctx.soil];
    const soil = SOIL_BY_ID.get(ctx.soil);
    const word = pref >= 0.9 ? 'favorable' : pref >= 0.6 ? 'correct' : 'peu favorable';
    reasons.push(`Sol : ${soil?.label.toLowerCase()} (${word}).`);
    score *= soilModulation(pref);
  }
  if (ctx.hostQuality !== undefined) score *= ctx.hostQuality;
  if (ctx.soilFactor !== undefined) score *= ctx.soilFactor;

  score = clamp(score);
  return { id: m.id, score, chance: chanceOf(score), level: levelOf(score), reasons, ...(blocker ? { blocker } : {}) };
}

/** Le sol module sans exclure : la géologie n'est qu'une tendance. */
export const soilModulation = (pref: number): number => 0.4 + 0.6 * pref;

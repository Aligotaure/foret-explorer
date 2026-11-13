/**
 * Format du contenu de la vue « Analytics » (src/analyticsData.ts). Aucun import.
 *
 * Les noms de champs sont en anglais, comme le reste du code ; chacun est décrit en français.
 * `npm run check` refuse un champ oublié, mal nommé ou du mauvais type ; src/analyticsCheck.ts relit
 * le reste (une date qui n'existe pas, un texte laissé vide).
 */
type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type Month = `0${Exclude<Digit, '0'>}` | '10' | '11' | '12';
type Day = `0${Exclude<Digit, '0'>}` | `${'1' | '2'}${Digit}` | '30' | '31';

/**
 * Date au format AAAA-MM-JJ (années 2000) : le 5 novembre 2026 s'écrit "2026-11-05".
 * L'ordre français ("05-11-2026") est refusé : il publierait une autre date. Le `${number}` évite que
 * le compilateur, devant une date refusée, n'en propose une autre (« Did you mean "2005-11-02" ? ») :
 * avec une liste fermée de dates, il le faisait.
 */
export type IsoDate = `20${Digit}${number}-${Month}-${Day}`;

/** Lien de contact : le texte du lien et son adresse, toujours en https. */
export interface Contact {
  label: string;
  url: `https://${string}`;
}

/** Un pari : ce qu'on croit, comment on le mesure, ce qui tranche et quand. */
export interface Bet {
  /** L'hypothèse, en une phrase. */
  hypothesis: string;
  /** Le KPI visé. */
  kpi: string;
  /** Le seuil qui tranche. */
  threshold: string;
  /** La date du verdict : prévue pour un pari en cours, réelle pour un pari tranché. */
  verdictDate: IsoDate;
}

/** Issue d'un pari : validé, invalidé ou non concluant. */
export type Outcome = 'validated' | 'invalidated' | 'inconclusive';

/** Un pari tranché : le pari, ce qui a été mesuré, l'issue et ce qui a été décidé ensuite. */
export interface SettledBet extends Bet {
  /** Le résultat mesuré, en clair. */
  result: string;
  outcome: Outcome;
  /** La décision prise ensuite. */
  decision: string;
}

/**
 * Graphique d'une analyse : des barres horizontales, une par libellé, toutes sur la même échelle qui
 * part de zéro. Convient aux étapes d'un entonnoir, à une comparaison (A / B) et à une courte série
 * dans le temps (une barre par semaine).
 */
export interface Chart {
  type: 'bars';
  /** Unité écrite après chaque valeur, par exemple "%". Facultatif. */
  unit?: string;
  /** Les barres, dans l'ordre d'affichage. Valeurs positives. */
  points: readonly { label: string; value: number }[];
}

export interface Analysis {
  /** La question posée. */
  question: string;
  /** Le graphique, ou null s'il n'y en a pas. */
  chart: Chart | null;
  /** La lecture : ce que disent les chiffres. */
  reading: string;
  /** La décision prise. */
  decision: string;
  /** La taille de l'échantillon, en clair, avec son unité et sa période. */
  sampleSize: string;
  /** La date de l'analyse. */
  date: IsoDate;
}

export interface AnalyticsData {
  /** Phrase d'en-tête ; "" tant qu'elle n'est pas écrite. */
  headline: string;
  /** Lien de contact, ou null. */
  contact: Contact | null;
  /** Pari en cours, ou null. */
  currentBet: Bet | null;
  /** Analyses, la plus récente en premier. */
  analyses: readonly Analysis[];
  /** Paris tranchés, le plus récent en premier. */
  settledBets: readonly SettledBet[];
}

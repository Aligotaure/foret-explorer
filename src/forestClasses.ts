/**
 * Nomenclature BD Forêt® V2 : 32 types de formation végétale (champ `code_tfv`).
 *
 * - Codes : vérifiés dans les données (métadonnées des tuiles + WFS, 31/10/2026).
 * - Libellés : libellés officiels (`tfv`), apostrophes normalisées. Les données
 *   contiennent des variantes sans apostrophe (« dun autre pin pur ») : toujours
 *   se fier à `code_tfv`, jamais au libellé.
 * - Couleurs : celles du style officiel IGN
 *   (annexes/ressources/vectorTiles/styles/BDFORET/LANDCOVER-FORESTINVENTORY-V2.json).
 */

export type GroupId = 'feuillus' | 'coniferes' | 'mixtes' | 'ouvertes' | 'autres';

export interface ForestClass {
  /** Valeur du champ `code_tfv`. */
  code: string;
  /** Libellé officiel complet. */
  label: string;
  /** Libellé court affiché dans la légende, sous le titre du groupe. */
  short: string;
  /** Couleur officielle IGN. */
  color: string;
  group: GroupId;
}

export interface ForestGroup {
  id: GroupId;
  label: string;
}

export const GROUPS: readonly ForestGroup[] = [
  { id: 'feuillus', label: 'Forêts fermées de feuillus' },
  { id: 'coniferes', label: 'Forêts fermées de conifères' },
  { id: 'mixtes', label: 'Forêts fermées mixtes' },
  { id: 'ouvertes', label: 'Forêts ouvertes' },
  { id: 'autres', label: 'Sans couvert arboré, peupleraies, landes' },
];

/** Couleur des codes inconnus (ne devrait pas arriver : les 32 codes sont listés). */
export const FALLBACK_COLOR = '#9e9e9e';

export const FOREST_CLASSES: readonly ForestClass[] = [
  // Forêts fermées de feuillus
  { code: 'FF1-00', label: 'Forêt fermée de feuillus purs en îlots', short: 'Feuillus purs en îlots', color: '#008C4D', group: 'feuillus' },
  { code: 'FF1G01-01', label: 'Forêt fermée de chênes décidus purs', short: 'Chênes décidus purs', color: '#004D2E', group: 'feuillus' },
  { code: 'FF1G06-06', label: 'Forêt fermée de chênes sempervirents purs', short: 'Chênes sempervirents purs', color: '#668040', group: 'feuillus' },
  { code: 'FF1-09-09', label: 'Forêt fermée de hêtre pur', short: 'Hêtre pur', color: '#00FF80', group: 'feuillus' },
  { code: 'FF1-10-10', label: 'Forêt fermée de châtaignier pur', short: 'Châtaignier pur', color: '#40FF1C', group: 'feuillus' },
  { code: 'FF1-14-14', label: 'Forêt fermée de robinier pur', short: 'Robinier pur', color: '#915633', group: 'feuillus' },
  { code: 'FF1-49-49', label: 'Forêt fermée d’un autre feuillu pur', short: 'Autre feuillu pur', color: '#AFCA59', group: 'feuillus' },
  { code: 'FF1-00-00', label: 'Forêt fermée à mélange de feuillus', short: 'Mélange de feuillus', color: '#00D92F', group: 'feuillus' },

  // Forêts fermées de conifères
  { code: 'FF2-00', label: 'Forêt fermée de conifères purs en îlots', short: 'Conifères purs en îlots', color: '#8080FF', group: 'coniferes' },
  { code: 'FF2-51-51', label: 'Forêt fermée de pin maritime pur', short: 'Pin maritime pur', color: '#BF26FF', group: 'coniferes' },
  { code: 'FF2-52-52', label: 'Forêt fermée de pin sylvestre pur', short: 'Pin sylvestre pur', color: '#9926FF', group: 'coniferes' },
  { code: 'FF2G53-53', label: 'Forêt fermée de pin laricio ou pin noir pur', short: 'Pin laricio ou pin noir pur', color: '#4D33FF', group: 'coniferes' },
  { code: 'FF2-57-57', label: 'Forêt fermée de pin d’Alep pur', short: 'Pin d’Alep pur', color: '#FF1AFF', group: 'coniferes' },
  { code: 'FF2G58-58', label: 'Forêt fermée de pin à crochets ou pin cembro pur', short: 'Pin à crochets ou pin cembro pur', color: '#734DE6', group: 'coniferes' },
  { code: 'FF2-81-81', label: 'Forêt fermée d’un autre pin pur', short: 'Autre pin pur', color: '#A666FF', group: 'coniferes' },
  { code: 'FF2-80-80', label: 'Forêt fermée à mélange de pins purs', short: 'Mélange de pins purs', color: '#D999FF', group: 'coniferes' },
  { code: 'FF2G61-61', label: 'Forêt fermée de sapin ou épicéa', short: 'Sapin ou épicéa', color: '#1AE6E6', group: 'coniferes' },
  { code: 'FF2-63-63', label: 'Forêt fermée de mélèze pur', short: 'Mélèze pur', color: '#4D80FF', group: 'coniferes' },
  { code: 'FF2-64-64', label: 'Forêt fermée de douglas pur', short: 'Douglas pur', color: '#3399FF', group: 'coniferes' },
  { code: 'FF2-91-91', label: 'Forêt fermée d’un autre conifère pur autre que pin', short: 'Autre conifère pur (hors pins)', color: '#00929F', group: 'coniferes' },
  { code: 'FF2-90-90', label: 'Forêt fermée à mélange d’autres conifères', short: 'Mélange d’autres conifères', color: '#59FFFF', group: 'coniferes' },
  { code: 'FF2-00-00', label: 'Forêt fermée à mélange de conifères', short: 'Mélange de conifères', color: '#404DFF', group: 'coniferes' },

  // Forêts fermées mixtes
  { code: 'FF31', label: 'Forêt fermée à mélange de feuillus prépondérants et conifères', short: 'Feuillus prépondérants et conifères', color: '#FF6633', group: 'mixtes' },
  { code: 'FF32', label: 'Forêt fermée à mélange de conifères prépondérants et feuillus', short: 'Conifères prépondérants et feuillus', color: '#FF4033', group: 'mixtes' },

  // Forêts ouvertes (couvert arboré de 10 à 40 %)
  { code: 'FO1', label: 'Forêt ouverte de feuillus purs', short: 'Feuillus purs', color: '#CCFFBF', group: 'ouvertes' },
  { code: 'FO2', label: 'Forêt ouverte de conifères purs', short: 'Conifères purs', color: '#99B3CC', group: 'ouvertes' },
  { code: 'FO3', label: 'Forêt ouverte à mélange de feuillus et conifères', short: 'Mélange de feuillus et conifères', color: '#FFD138', group: 'ouvertes' },

  // Autres formations
  { code: 'FF0', label: 'Forêt fermée sans couvert arboré', short: 'Forêt fermée sans couvert arboré', color: '#E5C45D', group: 'autres' },
  { code: 'FO0', label: 'Forêt ouverte sans couvert arboré', short: 'Forêt ouverte sans couvert arboré', color: '#B3B3B3', group: 'autres' },
  { code: 'FP', label: 'Peupleraie', short: 'Peupleraie', color: '#FFFF00', group: 'autres' },
  { code: 'LA4', label: 'Lande', short: 'Lande', color: '#FFE6BF', group: 'autres' },
  { code: 'LA6', label: 'Formation herbacée', short: 'Formation herbacée', color: '#FFF9A5', group: 'autres' },
];

export const ALL_CODES: readonly string[] = FOREST_CLASSES.map((c) => c.code);

export const CLASS_BY_CODE: ReadonlyMap<string, ForestClass> = new Map(
  FOREST_CLASSES.map((c) => [c.code, c]),
);

export function codesOfGroup(group: GroupId): string[] {
  return FOREST_CLASSES.filter((c) => c.group === group).map((c) => c.code);
}

export interface Preset {
  id: string;
  label: string;
  codes: readonly string[];
}

/** Sélections rapides proposées au-dessus de la légende (« tout / rien » : case « Tous les types »). */
export const PRESETS: readonly Preset[] = [
  { id: 'chenes', label: 'Chênes', codes: ['FF1G01-01', 'FF1G06-06'] },
  { id: 'feuillus', label: 'Feuillus', codes: [...codesOfGroup('feuillus'), 'FO1'] },
  { id: 'coniferes', label: 'Conifères', codes: [...codesOfGroup('coniferes'), 'FO2'] },
];

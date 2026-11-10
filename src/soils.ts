/**
 * Grandes natures de sol déduites de la carte géologique (roche ou dépôt sous-jacent).
 *
 * La géologie ne donne pas le sol lui-même, mais sa tendance : un calcaire donne en général un
 * sol calcaire, un grès ou un granite un sol acide. La correspondance avec les formations de la
 * carte BRGM est faite par `scripts/geologie/classer.mjs` (champ `sol` des tuiles).
 */

export type SoilId = 'calcaire' | 'marne' | 'limon' | 'gres' | 'cristallin' | 'moraine' | 'eboulis' | 'humide';

export type PatternKind = 'bricks' | 'dashes' | 'ticks' | 'dots' | 'crosses' | 'triangles' | 'scree' | 'waves';

export interface SoilClass {
  id: SoilId;
  label: string;
  /** Ce que ça donne comme sol, en quelques mots. */
  ground: string;
  /** Champignons que ce sol favorise (affichés entre parenthèses dans la légende). */
  mushrooms: string;
  /** Motif dessiné sur la carte (conventions des cartes géologiques quand elles existent). */
  pattern: PatternKind;
}

export const SOIL_CLASSES: readonly SoilClass[] = [
  {
    id: 'calcaire',
    label: 'Calcaires et dolomies',
    ground: 'sol calcaire, souvent caillouteux et sec',
    mushrooms: 'trompettes, pieds-de-mouton, morilles, cèpes d’été sous feuillus',
    pattern: 'bricks',
  },
  {
    id: 'marne',
    label: 'Marnes et argiles',
    ground: 'sol lourd et frais, souvent calcaire',
    mushrooms: 'trompettes, pieds-de-mouton, morilles',
    pattern: 'dashes',
  },
  {
    // Grands plateaux du Bassin parisien, du Nord, de Normandie… : limons décalcifiés sur craie ou calcaire.
    id: 'limon',
    label: 'Limons, lœss et argiles à silex',
    ground: 'sol profond et frais, souvent acide en surface',
    mushrooms: 'cèpes, girolles, trompettes sous chênes et hêtres',
    pattern: 'ticks',
  },
  {
    id: 'gres',
    label: 'Grès, molasses et sables',
    ground: 'sol plutôt acide et drainant',
    mushrooms: 'cèpes, girolles, chanterelles en tube',
    pattern: 'dots',
  },
  {
    id: 'cristallin',
    label: 'Roches cristallines et schistes',
    ground: 'sol acide',
    mushrooms: 'cèpes, girolles, chanterelles en tube',
    pattern: 'crosses',
  },
  {
    id: 'moraine',
    label: 'Moraines et dépôts glaciaires',
    ground: 'sol mélangé, souvent décalcifié en surface',
    mushrooms: 'cèpes, girolles ; trompettes et morilles s’il reste du calcaire',
    pattern: 'triangles',
  },
  {
    id: 'eboulis',
    label: 'Éboulis et colluvions',
    ground: 'sol de pente caillouteux, variable',
    mushrooms: 'pieds-de-mouton ; trompettes sur calcaire',
    pattern: 'scree',
  },
  {
    id: 'humide',
    label: 'Alluvions, tourbes et zones humides',
    ground: 'sol frais à gorgé d’eau',
    mushrooms: 'morilles sur les alluvions, sous frênes et peupliers ; chanterelles en tube en bordure',
    pattern: 'waves',
  },
];

export const SOIL_BY_ID: ReadonlyMap<string, SoilClass> = new Map(SOIL_CLASSES.map((s) => [s.id, s]));

/** Nom de l'image MapLibre du motif d'un sol. */
export const patternImageId = (id: SoilId): string => `sol-${id}`;

/**
 * Dessine le motif d'un sol sur un canevas carré (tuile répétée sur la carte).
 * Trait foncé doublé de blanc : lisible sur les couleurs claires comme foncées des forêts.
 */
export function drawPattern(kind: PatternKind, size: number, ratio = 2): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * ratio;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(ratio, ratio);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const shapes = new Path2D();
  const s = size;
  switch (kind) {
    case 'bricks': // conventions : calcaire = briques
      for (const y of [0, s / 2, s]) {
        shapes.moveTo(0, y);
        shapes.lineTo(s, y);
      }
      for (const [x, y0, y1] of [
        [s / 4, 0, s / 2],
        [(3 * s) / 4, s / 2, s],
      ] as const) {
        shapes.moveTo(x, y0);
        shapes.lineTo(x, y1);
      }
      break;
    case 'dashes': // marnes = tirets
      for (const [x, y] of [
        [2, s / 4],
        [s / 2 + 2, (3 * s) / 4],
      ] as const) {
        shapes.moveTo(x, y);
        shapes.lineTo(x + s / 2 - 4, y);
      }
      break;
    case 'ticks': // limons et lœss = petits traits verticaux
      for (const [x, y] of [
        [s / 4, s / 4],
        [(3 * s) / 4, (3 * s) / 4],
      ] as const) {
        shapes.moveTo(x, y - 2.5);
        shapes.lineTo(x, y + 2.5);
      }
      break;
    case 'dots': // grès = points
      for (const [x, y] of [
        [s / 4, s / 4],
        [(3 * s) / 4, (3 * s) / 4],
      ] as const) {
        shapes.moveTo(x + 1.2, y);
        shapes.arc(x, y, 1.2, 0, Math.PI * 2);
      }
      break;
    case 'crosses': // roches cristallines = croix
      for (const [x, y] of [
        [s / 4, s / 4],
        [(3 * s) / 4, (3 * s) / 4],
      ] as const) {
        shapes.moveTo(x - 2.5, y);
        shapes.lineTo(x + 2.5, y);
        shapes.moveTo(x, y - 2.5);
        shapes.lineTo(x, y + 2.5);
      }
      break;
    case 'triangles': // moraines = petits triangles
      for (const [x, y] of [
        [s / 4, s / 3],
        [(3 * s) / 4, (5 * s) / 6],
      ] as const) {
        shapes.moveTo(x, y - 2.5);
        shapes.lineTo(x + 2.5, y + 2);
        shapes.lineTo(x - 2.5, y + 2);
        shapes.closePath();
      }
      break;
    case 'scree': // éboulis = petits angles
      for (const [x, y, a] of [
        [s / 5, s / 4, 0],
        [(3 * s) / 5, s / 2, 1],
        [s / 3, (4 * s) / 5, 2],
      ] as const) {
        const d = 2.2 + a * 0.3;
        shapes.moveTo(x - d, y + d);
        shapes.lineTo(x, y - d);
        shapes.lineTo(x + d, y + d);
      }
      break;
    case 'waves': // zones humides = vagues
      for (const y of [s / 4, (3 * s) / 4]) {
        shapes.moveTo(0, y);
        shapes.bezierCurveTo(s / 4, y - 2.5, s / 4, y - 2.5, s / 2, y);
        shapes.bezierCurveTo((3 * s) / 4, y + 2.5, (3 * s) / 4, y + 2.5, s, y);
      }
      break;
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 3;
  ctx.stroke(shapes);
  ctx.strokeStyle = 'rgba(22, 22, 48, 0.9)';
  ctx.lineWidth = 1.2;
  ctx.stroke(shapes);
  if (kind === 'dots') {
    ctx.fillStyle = 'rgba(22, 22, 48, 0.9)';
    ctx.fill(shapes);
  }
  return canvas;
}

/**
 * Relecture du contenu de la vue « Analytics » : ce que les types ne voient pas (une date qui
 * n'existe pas, un texte laissé vide, une valeur négative). Les problèmes sont rendus en clair,
 * avec le nom du champ fautif.
 *
 * En développement, la vue les affiche en tête de page ; `npm run check` (tests/build.mjs) et les
 * tests de bout en bout échouent s'il en reste dans src/analyticsData.ts. Un bloc pas encore rempli
 * ("", null ou []) n'est pas un problème. Aucun import hors des types : tests/build.mjs le charge seul.
 */
import type { AnalyticsData, Bet } from './analyticsTypes';

/** Vrai si « AAAA-MM-JJ » est une date du calendrier (le 31 février n'en est pas une). */
export function isCalendarDate(date: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts) return false;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/**
 * Les valeurs sont lues comme inconnues : en développement, les types ne sont pas vérifiés, et un
 * nombre à la place d'un texte (ou un champ oublié) doit donner un message, pas une panne.
 */
export function checkAnalytics(data: AnalyticsData): string[] {
  const problems: string[] = [];
  const text = (field: string, value: unknown): void => {
    if (typeof value !== 'string') problems.push(`${field} : texte attendu, entre guillemets`);
    else if (!value.trim()) problems.push(`${field} : texte vide`);
  };
  const date = (field: string, value: unknown): void => {
    if (typeof value !== 'string' || !isCalendarDate(value)) {
      problems.push(`${field} : « ${String(value)} » n’est pas une date du calendrier (AAAA-MM-JJ)`);
    }
  };
  const bet = (field: string, value: Bet): void => {
    text(`${field}.hypothesis`, value.hypothesis);
    text(`${field}.kpi`, value.kpi);
    text(`${field}.threshold`, value.threshold);
    date(`${field}.verdictDate`, value.verdictDate);
  };

  if (typeof data.headline !== 'string') problems.push('headline : texte attendu, entre guillemets ("" tant qu’il n’est pas écrit)');
  if (data.contact) {
    text('contact.label', data.contact.label);
    if (typeof data.contact.url !== 'string' || !/^https:\/\/[^\s/.]+\.[^\s/]+/.test(data.contact.url)) {
      problems.push(`contact.url : « ${String(data.contact.url)} » n’est pas une adresse https complète`);
    }
  }
  if (data.currentBet) bet('currentBet', data.currentBet);
  (data.analyses ?? []).forEach((analysis, i) => {
    const field = `analyses[${i}]`;
    text(`${field}.question`, analysis.question);
    text(`${field}.reading`, analysis.reading);
    text(`${field}.decision`, analysis.decision);
    text(`${field}.sampleSize`, analysis.sampleSize);
    date(`${field}.date`, analysis.date);
    if (!analysis.chart) return;
    const points = Array.isArray(analysis.chart.points) ? analysis.chart.points : [];
    if (!points.length) problems.push(`${field}.chart.points : aucune barre (sans graphique, écrire chart: null)`);
    points.forEach((point, j) => {
      text(`${field}.chart.points[${j}].label`, point.label);
      if (typeof point.value !== 'number' || !Number.isFinite(point.value) || point.value < 0) {
        problems.push(`${field}.chart.points[${j}].value : ${String(point.value)} n’est pas un nombre positif`);
      }
    });
  });
  (data.settledBets ?? []).forEach((settled, i) => {
    const field = `settledBets[${i}]`;
    bet(field, settled);
    text(`${field}.result`, settled.result);
    text(`${field}.decision`, settled.decision);
    if (!['validated', 'invalidated', 'inconclusive'].includes(settled.outcome)) {
      problems.push(`${field}.outcome : « ${String(settled.outcome)} » n’est ni "validated", ni "invalidated", ni "inconclusive"`);
    }
  });
  return problems;
}

/**
 * Relecture du contenu de la vue « Analytics » : ce que `npm run check` ne voit pas (une date qui
 * n'existe pas, un texte laissé vide, une valeur négative). Les problèmes sont rendus en clair,
 * avec le nom du champ fautif.
 *
 * En développement, la vue les affiche en tête de page ; les tests de bout en bout échouent s'il en
 * reste dans src/analyticsData.ts. Un bloc pas encore rempli ("", null ou []) n'est pas un problème.
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

export function checkAnalytics(data: AnalyticsData): string[] {
  const problems: string[] = [];
  const text = (field: string, value: string): void => {
    if (!value.trim()) problems.push(`${field} : texte vide`);
  };
  const date = (field: string, value: string): void => {
    if (!isCalendarDate(value)) problems.push(`${field} : « ${value} » n’est pas une date du calendrier (AAAA-MM-JJ)`);
  };
  const bet = (field: string, value: Bet): void => {
    text(`${field}.hypothesis`, value.hypothesis);
    text(`${field}.kpi`, value.kpi);
    text(`${field}.threshold`, value.threshold);
    date(`${field}.verdictDate`, value.verdictDate);
  };

  if (data.contact) {
    text('contact.label', data.contact.label);
    if (!/^https:\/\/[^\s/.]+\.[^\s/]+/.test(data.contact.url)) {
      problems.push(`contact.url : « ${data.contact.url} » n’est pas une adresse https complète`);
    }
  }
  if (data.currentBet) bet('currentBet', data.currentBet);
  data.analyses.forEach((analysis, i) => {
    const field = `analyses[${i}]`;
    text(`${field}.question`, analysis.question);
    text(`${field}.reading`, analysis.reading);
    text(`${field}.decision`, analysis.decision);
    text(`${field}.sampleSize`, analysis.sampleSize);
    date(`${field}.date`, analysis.date);
    if (!analysis.chart) return;
    if (!analysis.chart.points.length) {
      problems.push(`${field}.chart.points : aucune barre (sans graphique, écrire chart: null)`);
    }
    analysis.chart.points.forEach((point, j) => {
      text(`${field}.chart.points[${j}].label`, point.label);
      if (!Number.isFinite(point.value) || point.value < 0) {
        problems.push(`${field}.chart.points[${j}].value : ${point.value} n’est pas un nombre positif`);
      }
    });
  });
  data.settledBets.forEach((settled, i) => {
    const field = `settledBets[${i}]`;
    bet(field, settled);
    text(`${field}.result`, settled.result);
    text(`${field}.decision`, settled.decision);
  });
  return problems;
}

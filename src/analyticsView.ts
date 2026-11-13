/**
 * Vue « Analytics » : comment le produit est piloté. Structure seulement : rien n'est mesuré ici.
 *
 * Tout le contenu vient de src/analyticsData.ts, modifié à la main (format : src/analyticsTypes.ts).
 * Un bloc vide affiche un état vide ; un contenu mal écrit n'empêche jamais l'affichage (une date
 * impossible est montrée telle quelle, un graphique sans barre est omis).
 *
 * Module chargé par main.ts à la première ouverture de la vue. Il n'importe rien de la carte : ni
 * MapLibre ni un module qui en dépend. Sa feuille de style (analytics.css) arrive avec la page.
 */
import { checkAnalytics, isCalendarDate } from './analyticsCheck';
import { ANALYTICS } from './analyticsData';
import type { AnalyticsData, Analysis, Bet, Chart, Outcome, SettledBet } from './analyticsTypes';
import { byId, h } from './dom';

const OUTCOMES: Readonly<Record<Outcome, { label: string; sign: string }>> = {
  validated: { label: 'Validé', sign: '✓' },
  invalidated: { label: 'Invalidé', sign: '✕' },
  inconclusive: { label: 'Non concluant', sign: '≈' },
};

/** « 12 novembre 2026 ». Une date mal écrite est affichée telle quelle plutôt que masquée ou fausse. */
function dateLabel(date: string): HTMLElement {
  if (!isCalendarDate(date)) return h('span', {}, date);
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  // En UTC d'un bout à l'autre : le jour affiché ne dépend pas du fuseau du visiteur.
  const text = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return h('time', { datetime: date }, text);
}

/** « 12,5 % », « 1 240 visites » : nombre à la française, espace fine insécable avant l'unité. */
function valueLabel(value: number, unit?: string): string {
  const text = value.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  return unit?.trim() ? `${text} ${unit.trim()}` : text;
}

let sections = 0;

function section(title: string, content: HTMLElement): HTMLElement {
  const id = `analytics-section-${++sections}`;
  return h('section', { class: 'analytics__section', 'aria-labelledby': id }, h('h2', { id, class: 'analytics__title' }, title), content);
}

const empty = (text: string): HTMLElement => h('p', { class: 'analytics__empty' }, text);

const fact = (label: string, value: Node | string): HTMLElement =>
  h('div', {}, h('dt', { class: 'analytics__label' }, label), h('dd', {}, value));

const labelled = (label: string, text: string): HTMLElement =>
  h('div', {}, h('p', { class: 'analytics__label' }, label), h('p', {}, text));

function header(data: AnalyticsData): HTMLElement {
  const headline = data.headline.trim();
  const contact = data.contact;
  // Seule une adresse https devient un lien (jamais « javascript: » ni une adresse relative).
  const link =
    contact && /^https:\/\//i.test(contact.url)
      ? h(
          'a',
          { class: 'analytics__contact', href: contact.url, target: '_blank', rel: 'noopener noreferrer' },
          contact.label.trim() || 'Me contacter',
          h('span', { 'aria-hidden': 'true' }, '↗'),
        )
      : null;
  return h(
    'header',
    { class: 'analytics__header' },
    h('p', { class: 'analytics__eyebrow' }, headline ? 'Forêt Explorer · Analytics' : 'Forêt Explorer'),
    h('h1', { class: 'analytics__headline' }, headline || 'Analytics'),
    link,
  );
}

function currentBet(bet: Bet | null): HTMLElement {
  if (!bet) return empty('Aucun pari en cours pour le moment.');
  return h(
    'div',
    { class: 'analytics-card' },
    h('p', { class: 'analytics__label' }, 'Hypothèse'),
    h('p', { class: 'analytics-bet__hypothesis' }, bet.hypothesis),
    h('dl', { class: 'analytics-facts' }, fact('KPI visé', bet.kpi), fact('Seuil', bet.threshold), fact('Verdict le', dateLabel(bet.verdictDate))),
  );
}

/**
 * Barres horizontales, écrites comme un tableau (libellé, barre, valeur) : chaque valeur se lit sans
 * survol, et un lecteur d'écran parcourt les mêmes chiffres. Une seule échelle, qui part de zéro ;
 * rien n'est affiché qui ne soit dans le fichier (ni total, ni taux calculé).
 */
function barChart(chart: Chart, caption: string): HTMLElement | null {
  const points = chart.points.filter((p) => Number.isFinite(p.value));
  if (!points.length) return null;
  const max = Math.max(0, ...points.map((p) => p.value));
  const rows = points.map((p) => {
    const bar = h('span', { class: 'analytics-bars__bar' });
    bar.style.width = `${max > 0 ? (Math.max(0, p.value) / max) * 100 : 0}%`;
    return h(
      'tr',
      {},
      h('th', { scope: 'row' }, p.label),
      h('td', { class: 'analytics-bars__track', 'aria-hidden': 'true' }, bar),
      h('td', { class: 'analytics-bars__value' }, valueLabel(p.value, chart.unit)),
    );
  });
  return h('table', { class: 'analytics-bars' }, h('caption', { class: 'visually-hidden' }, caption), h('tbody', {}, ...rows));
}

function analysisCard(analysis: Analysis): HTMLElement {
  return h(
    'li',
    { class: 'analytics-card analytics-analysis' },
    h(
      'div',
      {},
      h('p', { class: 'analytics__meta' }, dateLabel(analysis.date), ` · Échantillon : ${analysis.sampleSize}`),
      h('h3', { class: 'analytics-analysis__question' }, analysis.question),
    ),
    analysis.chart ? barChart(analysis.chart, analysis.question) : null,
    labelled('Lecture', analysis.reading),
    labelled('Décision', analysis.decision),
  );
}

function settledRow(bet: SettledBet): HTMLElement {
  // Une issue inconnue (fichier mal écrit) est montrée comme non concluante plutôt que de tout casser.
  const outcome: Outcome = bet.outcome in OUTCOMES ? bet.outcome : 'inconclusive';
  return h(
    'li',
    { class: 'analytics-bets__row' },
    h(
      'span',
      { class: `analytics-outcome analytics-outcome--${outcome}` },
      h('span', { 'aria-hidden': 'true' }, OUTCOMES[outcome].sign),
      OUTCOMES[outcome].label,
    ),
    h('p', { class: 'analytics-bets__hypothesis' }, bet.hypothesis),
    h('span', { class: 'analytics-bets__date' }, dateLabel(bet.verdictDate)),
    h('p', { class: 'analytics__meta' }, `KPI : ${bet.kpi} · Seuil : ${bet.threshold} · Résultat : ${bet.result}`),
    h('p', { class: 'analytics-bets__decision' }, h('span', { class: 'analytics__label' }, 'Décision'), ` ${bet.decision}`),
  );
}

/** En développement seulement : ce qu'il reste à corriger dans le fichier de contenu. */
function problemsBanner(data: AnalyticsData): HTMLElement | null {
  if (!import.meta.env.DEV) return null;
  const problems = checkAnalytics(data);
  if (!problems.length) return null;
  return h(
    'div',
    { class: 'analytics__problems', role: 'alert' },
    h('strong', {}, 'À corriger dans src/analyticsData.ts (visible en développement seulement)'),
    h('ul', {}, ...problems.map((problem) => h('li', {}, problem))),
  );
}

/** Dessine la vue à partir d'un contenu : celui de analyticsData.ts, ou un jeu d'essai des tests. */
export function renderAnalytics(root: HTMLElement, data: AnalyticsData): void {
  sections = 0;
  root.replaceChildren(
    ...[
      problemsBanner(data),
      header(data),
      section('Entonnoir en direct', empty('L’entonnoir n’est pas encore mesuré.')),
      section('Pari en cours', currentBet(data.currentBet)),
      section(
        'Analyses',
        data.analyses.length
          ? h('ul', { class: 'analytics-analyses' }, ...data.analyses.map(analysisCard))
          : empty('Aucune analyse publiée pour le moment.'),
      ),
      section(
        'Paris tranchés',
        data.settledBets.length
          ? h('ul', { class: 'analytics-bets' }, ...data.settledBets.map(settledRow))
          : empty('Aucun pari tranché pour le moment.'),
      ),
    ].filter((node): node is HTMLElement => node !== null),
  );
}

const root = byId('analytics');
renderAnalytics(root, ANALYTICS);

// En développement, `analytics` est accessible depuis la console et les tests e2e : le contenu du
// fichier (`data`), sa relecture (`check`) et de quoi redessiner la vue avec un autre contenu (`render`).
if (import.meta.env.DEV) {
  Object.assign(window, {
    analytics: { data: ANALYTICS, check: checkAnalytics, render: (data: AnalyticsData) => renderAnalytics(root, data) },
  });
}

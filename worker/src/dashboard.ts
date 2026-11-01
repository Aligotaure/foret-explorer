/**
 * Pages du tableau de bord, rendues côté serveur (aucun JavaScript : la politique de sécurité
 * de la page n'en autorise pas). Graphiques en SVG ; survol = info-bulle native (`<title>`),
 * et toutes les valeurs sont aussi dans le tableau.
 */
import { METRICS, METRIC_NAMES, SERVICES, type MetricName, type ServiceId } from '../../src/metricsSchema.ts';
import { lastDays } from './days.ts';
import type { CountRow } from './store.ts';

export type Period = 7 | 30 | 90;

const OPEN_METEO_DAILY = 10_000;
const OPEN_METEO_MONTHLY = 300_000;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
const fmt = (n: number): string => (Number.isInteger(n) || Math.abs(n) >= 100 ? integer : decimal).format(n);
/** Axes : nombres ronds, compacts au-delà de 10 000 (10 k, 20 k). */
const tick = (n: number): string => (n >= 10_000 ? `${integer.format(n / 1000)} k` : integer.format(n));

const dayLabel = (day: string, withMonth = true): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', withMonth ? { day: 'numeric', month: 'short' } : { day: 'numeric' });

/** Totaux par jour et par compteur (valeurs brutes, avant le facteur d'affichage). */
class Totals {
  private readonly byDay = new Map<string, Map<string, number>>();

  constructor(rows: readonly CountRow[]) {
    for (const r of rows) {
      const day = this.byDay.get(r.day) ?? new Map<string, number>();
      day.set(r.metric, (day.get(r.metric) ?? 0) + Number(r.n));
      this.byDay.set(r.day, day);
    }
  }

  get empty(): boolean {
    return this.byDay.size === 0;
  }

  /** Valeur affichée d'un ou plusieurs compteurs un jour donné. */
  day(day: string, names: readonly MetricName[]): number {
    const counts = this.byDay.get(day);
    if (!counts) return 0;
    return names.reduce((s, name) => s + (counts.get(name) ?? 0) * (METRICS[name].scale ?? 1), 0);
  }

  sum(days: readonly string[], names: readonly MetricName[]): number {
    return days.reduce((s, d) => s + this.day(d, names), 0);
  }
}

// ── Graphiques ───────────────────────────────────────────────────────────────

function niceScale(max: number, ticks: number): { top: number; step: number } {
  if (!(max > 0)) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, ([1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude));
  return { top: Math.ceil(max / step) * step, step };
}

const r2 = (n: number): string => String(Math.round(n * 100) / 100);

/** Colonne : bout arrondi de 4 px, base carrée posée sur l'axe. */
function columnPath(x: number, top: number, width: number, base: number): string {
  const height = base - top;
  if (height <= 0) return '';
  const r = Math.min(4, width / 2, height);
  return `<path class="bar" d="M${r2(x)},${r2(base)}V${r2(top + r)}Q${r2(x)},${r2(top)} ${r2(x + r)},${r2(top)}H${r2(x + width - r)}Q${r2(x + width)},${r2(top)} ${r2(x + width)},${r2(top + r)}V${r2(base)}Z"/>`;
}

interface ColumnChart {
  /** Nom du graphique pour les lecteurs d'écran. */
  label: string;
  days: readonly string[];
  values: readonly number[];
  /** Unité dans les info-bulles (« appels », « requêtes »…). */
  unit: string;
  /** large : grand écran ; etroit : même graphique pour téléphone ; compact : petits multiples. */
  variant?: 'large' | 'etroit' | 'compact';
}

const GEOMETRY = {
  large: { width: 720, height: 220, left: 44, ticks: 4 },
  etroit: { width: 340, height: 170, left: 36, ticks: 3 },
  compact: { width: 340, height: 128, left: 34, ticks: 2 },
} as const;

/** Histogramme d'une seule série par jour : pas de légende, le titre dit ce qui est tracé. */
function columnChart(c: ColumnChart): string {
  const variant = c.variant ?? 'large';
  const { width, height, left, ticks } = GEOMETRY[variant];
  const right = 8;
  const top = 18;
  const bottom = 22;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const base = top + plotH;
  const peak = Math.max(0, ...c.values);
  const scale = niceScale(peak, ticks);
  const y = (v: number): number => base - (v / scale.top) * plotH;
  const band = plotW / Math.max(1, c.days.length);
  const barW = Math.max(1, Math.min(24, band - 2)); // 2 px d'air entre les colonnes

  const parts: string[] = [];
  for (let t = 0; t <= scale.top + 1e-9; t += scale.step) {
    const ty = y(t);
    parts.push(`<line class="${t === 0 ? 'axis' : 'grid'}" x1="${left}" x2="${width - right}" y1="${r2(ty)}" y2="${r2(ty)}"/>`);
    parts.push(`<text class="tick" x="${left - 6}" y="${r2(ty + 4)}" text-anchor="end">${tick(t)}</text>`);
  }
  const peakIndex = c.values.indexOf(peak);
  const last = c.values.length - 1;
  c.values.forEach((v, i) => {
    const x = left + i * band;
    const day = c.days[i] ?? '';
    parts.push(columnPath(x + (band - barW) / 2, y(v), barW, base));
    // Zone de survol sur toute la hauteur : l'info-bulle marche aussi pour les jours à zéro.
    parts.push(
      `<rect class="hit" x="${r2(x)}" y="${top}" width="${r2(band)}" height="${plotH}"><title>${esc(`${dayLabel(day)} : ${fmt(v)} ${c.unit}`)}</title></rect>`,
    );
    // Étiquettes choisies : le maximum et aujourd'hui, pas une valeur par colonne. Près des bords,
    // l'étiquette s'aligne sur la colonne au lieu de déborder sur l'axe ou hors du cadre.
    if (v > 0 && (i === peakIndex || i === last)) {
      const text = fmt(v);
      const half = (text.length * 7) / 2;
      const center = x + band / 2;
      const barLeft = x + (band - barW) / 2;
      const [lx, anchor] =
        center - half < left + 2 ? [barLeft, 'start'] : center + half > width - right ? [barLeft + barW, 'end'] : [center, 'middle'];
      parts.push(`<text class="value" x="${r2(lx)}" y="${r2(y(v) - 5)}" text-anchor="${anchor}">${text}</text>`);
    }
  });
  const first = c.days[0];
  if (first) parts.push(`<text class="tick" x="${left}" y="${height - 5}">${esc(dayLabel(first))}</text>`);
  parts.push(`<text class="tick" x="${width - right}" y="${height - 5}" text-anchor="end">aujourd’hui</text>`);
  return `<svg class="chart chart--${variant}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(c.label)}">${parts.join('')}</svg>`;
}

/** Jauge : bleue sous 50 %, orangée jusqu'à 80 %, rouge au-delà. */
function meter(fraction: number, label: string): string {
  const level = fraction >= 0.8 ? 'critical' : fraction >= 0.5 ? 'warning' : 'ok';
  const width = Math.min(100, Math.max(fraction > 0 ? 1 : 0, fraction * 100));
  return `<div class="meter meter--${level}" role="img" aria-label="${esc(label)}"><span style="width:${width.toFixed(1)}%"></span></div>`;
}

// ── Pages ─────────────────────────────────────────────────────────────────────

const STYLE = `
:root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --text-1: #0b0b0b; --text-2: #52514e; --muted: #6d6b66;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11, 11, 11, 0.1);
  --series: #2a78d6; --track: #cde2fb; --warning: #fab219; --critical: #d03b3b; --good: #0ca30c;
  --accent: #000091;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --text-1: #f0efec; --text-2: #c3c2b7; --muted: #a3a29a;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255, 255, 255, 0.1);
    --series: #3987e5; --track: #184f95; --accent: #8585f6;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--text-1);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { margin: 0; font-size: 22px; }
h2 { margin: 0 0 4px; font-size: 16px; }
p { margin: 0; }
a { color: var(--accent); }
.top { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: flex-end; justify-content: space-between; margin-bottom: 20px; }
.sub, .note { color: var(--text-2); font-size: 13px; }
.periods { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.periods a, .periods button { padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface);
  color: var(--text-1); font: inherit; font-size: 13px; text-decoration: none; cursor: pointer; }
.periods a[aria-current="page"] { border-color: var(--accent); font-weight: 600; box-shadow: inset 0 0 0 1px var(--accent); }
.periods form { margin: 0 0 0 8px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px; margin-top: 16px; }
.hero { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 24px; align-items: end; }
.hero__label, .tile__label { color: var(--text-2); font-size: 13px; }
.hero__value { font-size: 52px; font-weight: 600; line-height: 1.05; margin: 6px 0 10px; }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
.tiles .card { margin: 0; }
.tile__value { font-size: 26px; font-weight: 600; margin: 4px 0 2px; }
.tile__sub { color: var(--text-2); font-size: 12.5px; }
.meter { height: 8px; border-radius: 999px; background: var(--track); overflow: hidden; margin: 8px 0 6px; }
.meter span { display: block; height: 100%; border-radius: 999px; background: var(--series); }
.meter--warning span { background: var(--warning); }
.meter--critical span { background: var(--critical); }
.chart { display: block; width: 100%; height: auto; margin-top: 10px; overflow: visible; }
.chart .bar { fill: var(--series); }
.chart .hit { fill: transparent; }
.chart .hit:hover { fill: var(--grid); fill-opacity: 0.45; }
.chart .grid { stroke: var(--grid); stroke-width: 1; }
.chart .axis { stroke: var(--axis); stroke-width: 1; }
.chart .tick { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.chart--compact .tick, .chart--etroit .tick { font-size: 12px; }
.chart--etroit { display: none; }
@media (max-width: 600px) { .chart--large { display: none; } .chart--etroit { display: block; } }
.chart .value { fill: var(--text-1); font-size: 12px; font-weight: 600; }
.multiples { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px 20px; margin-top: 4px; }
.multiples h3 { margin: 14px 0 0; font-size: 13.5px; font-weight: 600; }
.multiples p { color: var(--text-2); font-size: 12.5px; min-height: 2.9em; }
.table-wrap { overflow-x: auto; margin-top: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th, td { padding: 7px 8px; text-align: right; border-bottom: 1px solid var(--grid); white-space: nowrap; }
th:first-child, td:first-child { text-align: left; white-space: normal; }
thead th { color: var(--text-2); font-weight: 600; font-size: 12.5px; }
tbody th { padding-top: 14px; font-size: 12.5px; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.03em; }
td { font-variant-numeric: tabular-nums; }
.status { display: flex; gap: 8px; align-items: baseline; }
.status::before { content: ""; flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--good); transform: translateY(1px); }
.status--critical::before { background: var(--critical); }
ul.limits { margin: 8px 0 0; padding-left: 18px; color: var(--text-2); font-size: 13px; }
ul.limits li + li { margin-top: 4px; }
.login { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
.login .card { width: min(380px, 100%); margin: 0; }
.login form { display: grid; gap: 10px; margin-top: 16px; }
.login input[type="password"] { padding: 10px 12px; border: 1px solid var(--axis); border-radius: 8px; background: var(--page); color: var(--text-1); font: inherit; }
.login button { padding: 10px 12px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
.alert { margin-top: 12px; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, var(--critical) 12%, transparent); font-size: 13.5px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 760px) {
  .hero { grid-template-columns: 1fr; }
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hero__value { font-size: 44px; }
}
@media (max-width: 420px) { .tiles { grid-template-columns: 1fr; } }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

export type LoginState = null | 'erreur' | 'bloque' | 'config';

const LOGIN_MESSAGES: Record<Exclude<LoginState, null>, string> = {
  erreur: 'Mot de passe incorrect.',
  bloque: 'Trop d’essais : réessayez dans un quart d’heure.',
  config: 'Mot de passe du serveur absent ou trop court : renseignez le secret ADMIN_PASSWORD (12 caractères au moins).',
};

export function renderLogin(base: string, state: LoginState): string {
  const alert = state ? `<p class="alert" role="alert">${esc(LOGIN_MESSAGES[state])}</p>` : '';
  return page(
    'Forêt Explorer · accès privé',
    `<main class="login"><div class="card"><h1>Forêt Explorer</h1><p class="sub">Consommation des API · accès privé</p>${alert}
<form method="post" action="${esc(base)}/connexion">
<input class="sr" type="text" name="identifiant" value="Forêt Explorer" autocomplete="username" tabindex="-1" aria-hidden="true">
<label for="motdepasse">Mot de passe</label>
<input id="motdepasse" name="motdepasse" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Se connecter</button>
</form></div></main>`,
  );
}

interface DashboardInput {
  base: string;
  period: Period;
  today: string;
  rows: readonly CountRow[];
  now: Date;
}

const TILE_NAMES: readonly MetricName[] = ['ign.tiles.forest', 'ign.tiles.forestRaster', 'ign.tiles.plan', 'ign.tiles.ortho', 'ign.fonts'];

function tile(label: string, value: string, sub: string): string {
  return `<div class="card"><p class="tile__label">${esc(label)}</p><p class="tile__value">${esc(value)}</p><p class="tile__sub">${esc(sub)}</p></div>`;
}

export function renderDashboard({ base, period, today, rows, now }: DashboardInput): string {
  const t = new Totals(rows);
  const days = lastDays(today, period);
  const week = lastDays(today, 7);
  const month = lastDays(today, Number(today.slice(8, 10))); // du 1er du mois à aujourd'hui
  const one = (name: MetricName): MetricName[] => [name];

  const callsToday = t.day(today, one('openMeteo.calls10'));
  const callsMonth = t.sum(month, one('openMeteo.calls10'));
  const sessionsToday = t.day(today, one('app.sessions'));
  const sessionsWeek = t.sum(week, one('app.sessions'));
  const mobileWeek = t.sum(week, one('app.sessionsMobile'));
  const sessionsPeriod = t.sum(days, one('app.sessions'));
  const hitsToday = t.day(today, one('openMeteo.cacheHits'));
  const pointsToday = t.day(today, one('openMeteo.locations'));
  const updated = now.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

  const nav = ([7, 30, 90] as const)
    .map((p) => `<a href="${esc(base)}?jours=${p}"${p === period ? ' aria-current="page"' : ''}>${p} jours</a>`)
    .join('');
  const header = `<header class="top"><div><h1>Consommation des API</h1><p class="sub">Forêt Explorer · mis à jour le ${esc(updated)} (heure de Paris)</p></div>
<nav class="periods" aria-label="Période">${nav}<form method="post" action="${esc(base)}/deconnexion"><button type="submit">Se déconnecter</button></form></nav></header>`;

  if (t.empty) {
    return page(
      'Consommation des API · Forêt Explorer',
      `<main>${header}<section class="card"><h2>Pas encore de données</h2><p class="note">Les compteurs arrivent une minute environ après chaque visite de la carte, ou quand on la quitte. Les visiteurs qui activent « Global Privacy Control » ne sont pas comptés.</p></section></main>`,
    );
  }

  const hero = `<section class="card hero"><div><p class="hero__label">Appels Open-Meteo aujourd’hui (pondérés)</p><p class="hero__value">${fmt(callsToday)}</p>
${meter(callsToday / OPEN_METEO_DAILY, `${percent.format(callsToday / OPEN_METEO_DAILY)} du plafond quotidien`)}
<p class="note">${percent.format(callsToday / OPEN_METEO_DAILY)} du plafond gratuit de ${integer.format(OPEN_METEO_DAILY)} appels par jour.</p></div>
<div><p class="hero__label">Depuis le début du mois</p><p class="tile__value">${fmt(callsMonth)}</p>
${meter(callsMonth / OPEN_METEO_MONTHLY, `${percent.format(callsMonth / OPEN_METEO_MONTHLY)} du plafond mensuel`)}
<p class="note">${percent.format(callsMonth / OPEN_METEO_MONTHLY)} des ${integer.format(OPEN_METEO_MONTHLY)} appels du mois.</p></div></section>`;

  const tiles = `<section class="tiles">
${tile('Visites aujourd’hui', fmt(sessionsToday), `${fmt(sessionsWeek)} sur 7 jours${sessionsWeek ? `, dont ${percent.format(mobileWeek / sessionsWeek)} sur téléphone` : ''}`)}
${tile('Météo servie par le cache', pointsToday + hitsToday ? percent.format(hitsToday / (pointsToday + hitsToday)) : '—', `aujourd’hui : ${fmt(pointsToday)} points demandés, ${fmt(hitsToday)} déjà en cache`)}
${tile('Altitude IGN aujourd’hui', fmt(t.day(today, one('ign.altitude.requests'))), `requêtes, pour ${fmt(t.day(today, one('ign.altitude.points')))} points (${fmt(t.day(today, one('ign.altitude.cacheHits')))} en cache)`)}
${tile('Tuiles IGN aujourd’hui', fmt(t.day(today, TILE_NAMES)), `et ${fmt(t.day(today, one('pages.geology')))} tuiles de géologie (GitHub Pages)`)}
</section>`;

  const series = (names: readonly MetricName[]): number[] => days.map((d) => t.day(d, names));
  const main = `<section class="card"><h2>Appels Open-Meteo par jour</h2><p class="note">Appels pondérés : une requête de 21 jours compte 1,5 appel par point demandé. Plafond gratuit : ${integer.format(OPEN_METEO_DAILY)} par jour.</p>
${['large', 'etroit'].map((variant) => columnChart({ label: `Appels Open-Meteo par jour sur ${period} jours`, days, values: series(one('openMeteo.calls10')), unit: 'appels', variant: variant as 'large' | 'etroit' })).join('')}</section>`;

  const small: { title: string; names: readonly MetricName[]; unit: string; note: string }[] = [
    { title: 'Visites', names: one('app.sessions'), unit: 'visites', note: 'Ouvertures de la carte.' },
    { title: 'Altitude IGN', names: one('ign.altitude.requests'), unit: 'requêtes', note: 'Bilans de coin et carrés de 500 m.' },
    { title: 'Recherche de lieu IGN', names: one('ign.geocoding.requests'), unit: 'requêtes', note: 'Autocomplétion de la barre de recherche.' },
    { title: 'Tuiles IGN', names: TILE_NAMES, unit: 'tuiles', note: 'Forêts, plan, photos aériennes, polices.' },
    { title: 'Tuiles de géologie', names: one('pages.geology'), unit: 'tuiles', note: 'Servies par GitHub Pages avec le site.' },
  ];
  const multiples = `<section class="card"><h2>Requêtes par jour, service par service</h2><p class="note">Une échelle par graphique : comparez les formes, pas les hauteurs.</p><div class="multiples">${small
    .map(
      (s) =>
        `<div><h3>${esc(s.title)}</h3><p>${esc(s.note)} ${fmt(t.sum(days, s.names))} sur ${period} jours.</p>${columnChart({ label: `${s.title} par jour`, days, values: series(s.names), unit: s.unit, variant: 'compact' })}</div>`,
    )
    .join('')}</div></section>`;

  const services = Object.keys(SERVICES) as ServiceId[];
  const bodyRows = services
    .map((service) => {
      const names = METRIC_NAMES.filter((n) => METRICS[n].service === service && !('error' in METRICS[n]));
      if (!names.length) return '';
      const head = `<tr><th colspan="5" scope="rowgroup">${esc(SERVICES[service].label)}</th></tr>`;
      const lines = names.map((name) => {
        const total = t.sum(days, [name]);
        const perVisit = sessionsPeriod ? fmt(Math.round((total / sessionsPeriod) * 10) / 10) : '—';
        return `<tr><td>${esc(METRICS[name].label)}</td><td>${fmt(t.day(today, [name]))}</td><td>${fmt(t.sum(week, [name]))}</td><td>${fmt(total)}</td><td>${service === 'app' ? '—' : perVisit}</td></tr>`;
      });
      return head + lines.join('');
    })
    .join('');
  const table = `<section class="card"><h2>Tous les compteurs</h2><div class="table-wrap"><table><thead><tr><th scope="col">Compteur</th><th scope="col">Aujourd’hui</th><th scope="col">7 jours</th><th scope="col">${period} jours</th><th scope="col">Par visite</th></tr></thead><tbody>${bodyRows}</tbody></table></div></section>`;

  const errorNames = METRIC_NAMES.filter((n) => 'error' in METRICS[n]);
  const errorLines = errorNames
    .map((name) => ({ name, total: t.sum(days, [name]), today: t.day(today, [name]) }))
    .filter((e) => e.total > 0)
    .map(
      (e) =>
        `<li class="status status--critical"><span><strong>${esc(SERVICES[METRICS[e.name].service].label)}</strong> : ${fmt(e.total)} erreur${e.total > 1 ? 's' : ''} sur ${period} jours, dont ${fmt(e.today)} aujourd’hui.</span></li>`,
    );
  const errors = `<section class="card"><h2>Erreurs</h2>${
    errorLines.length
      ? `<ul class="limits" style="list-style:none;padding:0">${errorLines.join('')}</ul><p class="note" style="margin-top:8px">Des erreurs répétées signalent un service en panne, un plafond atteint (erreur 429) ou un réseau faible en forêt.</p>`
      : `<p class="status"><span>Aucune erreur sur ${period} jours.</span></p>`
  }</section>`;

  const limits = `<section class="card"><h2>Limites des services</h2><ul class="limits">${services
    .filter((s) => s !== 'app')
    .map((s) => `<li><strong>${esc(SERVICES[s].label)}</strong> : ${esc(SERVICES[s].note)}</li>`)
    .join('')}</ul>
<p class="note" style="margin-top:12px">Mesure anonyme : chaque navigateur envoie des totaux, sans identifiant ni cookie, et l’adresse IP n’est pas conservée. Les chiffres sont des ordres de grandeur : un visiteur hors réseau ou qui active « Global Privacy Control » n’est pas compté. Totaux gardés 400 jours.</p>
<p class="note" style="margin-top:8px"><a href="${esc(base)}/export.json">Télécharger les données (JSON)</a></p></section>`;

  return page('Consommation des API · Forêt Explorer', `<main>${header}${hero}${tiles}${main}${multiples}${table}${errors}${limits}</main>`);
}

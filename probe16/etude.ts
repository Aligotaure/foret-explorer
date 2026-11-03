// Sonde n°16 : quelle taille de case météo garde un indice juste ? (deux périodes : octobre et été)
// Référence : points tous les 0,04° × 0,056° (≈ 4,5 km, la grille actuelle) sur 5 régions.
// On simule des cases plus grandes (une seule série par case, comme le ferait le fichier commun),
// températures ramenées à l'altitude de chaque point, et on compare l'indice (pluie × température)
// de chaque champignon au mois où sa saison vaut 1.
import { writeFileSync } from 'node:fs';
import { atAltitude } from '../src/fineGrid';
import { MUSHROOMS, levelOf, scoreMushroom } from '../src/mushrooms';
import { summarize, type DailySeries } from '../src/weather';

const REGIONS = [
  { nom: 'Alpes (Annecy, Bauges)', s: 45.62, w: 5.95 },
  { nom: 'Massif central (Corrèze)', s: 45.2, w: 1.6 },
  { nom: 'Landes', s: 43.9, w: -1.1 },
  { nom: 'Vosges', s: 48.0, w: 6.7 },
  { nom: 'Provence (Var)', s: 43.35, w: 5.9 },
];
const N = 16;
const FLAT = 0.04;
const FLON = 0.056;
const FACTORS = [1, 2, 3, 4, 5, 6, 8];
const PEAK: Record<string, number> = { cepe: 9, girolle: 8, trompette: 10, chanterelle: 11, morille: 4 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Period = { nom: string; start?: string; end?: string };
let PERIOD: Period = { nom: 'octobre' };
let used = 0;

/** Ne garde que 20 jours passés + le jour de référence, comme la carte aujourd'hui. */
const last21 = (s: DailySeries): DailySeries => ({ ...s, dates: s.dates.slice(-21), rain: s.rain.slice(-21), tmax: s.tmax.slice(-21), tmin: s.tmin.slice(-21) });

async function fetchSeries(points: { lat: number; lon: number }[], model?: string): Promise<DailySeries[]> {
  const out: DailySeries[] = [];
  for (let k = 0; k < points.length; k += 100) {
    const chunk = points.slice(k, k + 100);
    const url = new URL(PERIOD.start ? 'https://historical-forecast-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', chunk.map((p) => p.lat.toFixed(4)).join(','));
    url.searchParams.set('longitude', chunk.map((p) => p.lon.toFixed(4)).join(','));
    url.searchParams.set('daily', 'precipitation_sum,temperature_2m_max,temperature_2m_min');
    if (PERIOD.start && PERIOD.end) {
      url.searchParams.set('start_date', PERIOD.start);
      url.searchParams.set('end_date', PERIOD.end);
    } else {
      url.searchParams.set('past_days', '30');
      url.searchParams.set('forecast_days', '1');
    }
    url.searchParams.set('timezone', 'Europe/Paris');
    if (model) url.searchParams.set('models', model);
    for (let attempt = 1; ; attempt++) {
      let r: Response;
      try {
        r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      } catch (e) {
        console.log(`réseau (${model ?? 'best_match'}), essai ${attempt} : ${(e as Error).message} ${(e as { cause?: { code?: string } }).cause?.code ?? ''}`);
        if (attempt >= 6) throw e;
        await sleep(20_000 * attempt);
        continue;
      }
      if (r.ok) {
        const data = (await r.json()) as any;
        const items = Array.isArray(data) ? data : [data];
        for (const it of items) {
          const d = it.daily ?? {};
          out.push({ dates: d.time, rain: (d.precipitation_sum ?? []).map((x: number | null) => x ?? 0), tmax: d.temperature_2m_max, tmin: d.temperature_2m_min, elevation: it.elevation });
        }
        break;
      }
      console.log(`HTTP ${r.status} (${model ?? 'best_match'}), essai ${attempt} : ${(await r.text()).slice(0, 160)}`);
      if (attempt >= 6) throw new Error(`Open-Meteo HTTP ${r.status}`);
      await sleep(30_000 * attempt);
    }
    used += chunk.length * 2.21;
    await sleep(27_000); // ≈ 490 appels pondérés par minute au plus (100 points × 2,21)
  }
  return out.map(last21);
}

/** Moyenne de plusieurs séries, températures d'abord ramenées à leur altitude moyenne. */
function mean(series: DailySeries[]): DailySeries {
  const z = series.reduce((s, x) => s + x.elevation, 0) / series.length;
  const shifted = series.map((x) => atAltitude(x, z));
  const avg = (pick: (x: DailySeries) => (number | null)[]) =>
    shifted[0]!.dates.map((_, d) => {
      const vals = shifted.map((x) => pick(x)[d]).filter((v): v is number => typeof v === 'number');
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
  return { dates: shifted[0]!.dates, rain: avg((x) => x.rain).map((v) => v ?? 0), tmax: avg((x) => x.tmax), tmin: avg((x) => x.tmin), elevation: z };
}

const score = (m: (typeof MUSHROOMS)[number], s: DailySeries) => scoreMushroom(m, summarize(s), PEAK[m.id]!).score;

type Acc = { n: number; mae: number; same: number; near: number; rain: number; event: number };
const results: Record<string, Record<string, Acc>> = {};
function add(key: string, sub: string, truth: DailySeries, approx: DailySeries) {
  results[key] ??= {};
  const ta = summarize(truth);
  const aa = summarize(approx);
  for (const m of MUSHROOMS) {
    const a = (results[key][m.id] ??= { n: 0, mae: 0, same: 0, near: 0, rain: 0, event: 0 });
    const t = score(m, truth);
    const x = score(m, approx);
    a.n++;
    a.mae += Math.abs(t - x);
    a.same += levelOf(t) === levelOf(x) ? 1 : 0;
    a.near += Math.abs(levelOf(t) - levelOf(x)) <= 1 ? 1 : 0;
    a.rain += Math.abs(ta.rain20 - aa.rain20);
    const te = ta.events[0]?.daysAgo ?? -9;
    const xe = aa.events[0]?.daysAgo ?? -9;
    a.event += Math.abs(te - xe) <= 1 ? 1 : 0;
  }
  void sub;
}

for (const period of [{ nom: 'octobre' }, { nom: 'été', start: '2026-07-15', end: '2026-08-14' }] as Period[]) {
PERIOD = period;
const P = period.nom;
const fine: DailySeries[][][] = [];
for (const [r, reg] of REGIONS.entries()) {
  const pts: { lat: number; lon: number }[] = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) pts.push({ lat: reg.s + (i + 0.5) * FLAT, lon: reg.w + (j + 0.5) * FLON });
  let series: DailySeries[];
  try {
    series = await fetchSeries(pts);
  } catch (e) {
    console.log(`${P} ${reg.nom} : indisponible (${(e as Error).message})`);
    fine.push([]);
    continue;
  }
  const grid: DailySeries[][] = [];
  for (let i = 0; i < N; i++) grid.push(series.slice(i * N, (i + 1) * N));
  fine.push(grid);
  const zs = series.map((s) => s.elevation);
  const rains = series.map((s) => summarize(s).rain20);
  console.log(`${P} ${reg.nom} : ${series.length} points, altitude ${Math.min(...zs)}–${Math.max(...zs)} m, pluie sur 20 j ${Math.min(...rains)}–${Math.max(...rains)} mm`);

  for (const f of FACTORS) {
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const truth = grid[i]![j]!;
        const ci = Math.floor(i / f) * f;
        const cj = Math.floor(j / f) * f;
        const ri = Math.min(N - 1, ci + Math.floor(f / 2));
        const rj = Math.min(N - 1, cj + Math.floor(f / 2));
        const rep = atAltitude(grid[ri]![rj]!, truth.elevation);
        add(`${f}|point|${r}|${P}`, '', truth, rep);
        const members: DailySeries[] = [];
        for (let a = ci; a < Math.min(N, ci + f); a++) for (let b = cj; b < Math.min(N, cj + f); b++) members.push(grid[a]![b]!);
        add(`${f}|moyenne|${r}|${P}`, '', truth, atAltitude(mean(members), truth.elevation));
      }
    }
  }
}

// Modèles « lisses » aux centres de cases de 0,2° × 0,28° (f = 5) : ARPEGE Europe (0,1°) et ECMWF (0,25°).
for (const model of P === 'octobre' ? ['meteofrance_arpege_europe', 'ecmwf_ifs025'] : []) {
  for (const [r, reg] of REGIONS.entries()) {
    if (!fine[r]?.length) continue;
    const f = 5;
    const centers: { lat: number; lon: number; ci: number; cj: number }[] = [];
    for (let ci = 0; ci < N; ci += f) for (let cj = 0; cj < N; cj += f) {
      const ri = Math.min(N - 1, ci + Math.floor(f / 2));
      const rj = Math.min(N - 1, cj + Math.floor(f / 2));
      centers.push({ lat: reg.s + (ri + 0.5) * FLAT, lon: reg.w + (rj + 0.5) * FLON, ci, cj });
    }
    let series: DailySeries[] = [];
    try {
      series = await fetchSeries(centers, model);
    } catch (e) {
      console.log(`${model} indisponible : ${(e as Error).message}`);
      break;
    }
    const grid = fine[r]!;
    for (const [k, c] of centers.entries()) {
      const s = series[k];
      if (!s?.dates?.length) continue;
      for (let i = c.ci; i < Math.min(N, c.ci + f); i++) for (let j = c.cj; j < Math.min(N, c.cj + f); j++) {
        add(`5|${model}|${r}|${P}`, '', grid[i]![j]!, atAltitude(s, grid[i]![j]!.elevation));
      }
    }
  }
}
console.log(`${P} : ${Math.round(used)} appels pondérés depuis le début`);
}

// Synthèse : moyenne sur les régions, par taille et variante.
const lines: string[] = [];
const variants = [...new Set(Object.keys(results).map((k) => k.split('|').slice(0, 2).join('|')))];
for (const P of ['octobre', 'été', '']) {
lines.push('', `== ${P || 'les deux périodes'} ==`, 'taille | variante | champignon | écart moyen de l’indice | même niveau | à un niveau près | écart pluie 20 j (mm) | même dernier épisode (±1 j)');
for (const v of variants) {
  const [f, variant] = v.split('|');
  const km = `${(Number(f) * 4.45).toFixed(0)} km`;
  const per: Record<string, Acc> = {};
  for (const [key, byM] of Object.entries(results)) {
    if (!key.startsWith(`${v}|`)) continue;
    if (P && !key.endsWith(`|${P}`)) continue;
    for (const [m, a] of Object.entries(byM)) {
      const t = (per[m] ??= { n: 0, mae: 0, same: 0, near: 0, rain: 0, event: 0 });
      for (const k of Object.keys(t) as (keyof Acc)[]) t[k] += a[k];
    }
  }
  const all: Acc = { n: 0, mae: 0, same: 0, near: 0, rain: 0, event: 0 };
  for (const [m, a] of Object.entries(per)) {
    for (const k of Object.keys(all) as (keyof Acc)[]) all[k] += a[k];
    lines.push(`${km} | ${variant} | ${m} | ${(a.mae / a.n).toFixed(3)} | ${((100 * a.same) / a.n).toFixed(1)} % | ${((100 * a.near) / a.n).toFixed(1)} % | ${(a.rain / a.n).toFixed(1)} | ${((100 * a.event) / a.n).toFixed(1)} %`);
  }
  if (all.n) lines.push(`${km} | ${variant} | TOUS | ${(all.mae / all.n).toFixed(3)} | ${((100 * all.same) / all.n).toFixed(1)} % | ${((100 * all.near) / all.n).toFixed(1)} % | ${(all.rain / all.n).toFixed(1)} | ${((100 * all.event) / all.n).toFixed(1)} %`);
}
}
// Par région, toutes espèces confondues, variante « point ».
lines.push('', 'période | région | taille | même niveau (toutes espèces) | écart moyen');
for (const P of ['octobre', 'été'])
for (const [r, reg] of REGIONS.entries()) {
  for (const f of FACTORS) {
    const byM = results[`${f}|point|${r}|${P}`] ?? {};
    if (!Object.keys(byM).length) continue;
    const tot = Object.values(byM).reduce((s, a) => ({ n: s.n + a.n, same: s.same + a.same, mae: s.mae + a.mae }), { n: 0, same: 0, mae: 0 });
    lines.push(`${P} | ${reg.nom} | ${(f * 4.45).toFixed(0)} km | ${((100 * tot.same) / tot.n).toFixed(1)} % | ${(tot.mae / tot.n).toFixed(3)}`);
  }
}
writeFileSync('verif/etude-cases.txt', `${lines.join('\n')}\n`);
writeFileSync('verif/etude-cases.json', JSON.stringify(results));
console.log(lines.join('\n'));

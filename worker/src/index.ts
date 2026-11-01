/**
 * Serveur de mesure de Forêt Explorer (Cloudflare Workers, offre gratuite).
 *
 *  POST /collect           compteurs envoyés par la carte (totaux anonymes, origine contrôlée)
 *  GET  /<chemin secret>   tableau de bord, après mot de passe (rendu ici, sans JavaScript)
 *  POST /<chemin>/connexion, /<chemin>/deconnexion, GET /<chemin>/export.json
 *  Tout le reste : 404, y compris un chemin secret erroné.
 */
import { METRIC_DEFS, isMetricName } from '../../src/metricsSchema.ts';
import { adminBase, attemptKey, checkPassword, clearedCookie, hasSession, passwordConfigured, sessionCookie } from './auth.ts';
import { renderDashboard, renderLogin, type Period } from './dashboard.ts';
import { addDays, parisDay } from './days.ts';
import type { Env } from './env.ts';
import type { CountRow } from './store.ts';

export { MetricsStore } from './store.ts';

const MAX_COLLECT_BYTES = 8 * 1024;

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
};

const html = (body: string, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, ...extra } });

const notFound = (): Response =>
  new Response('Introuvable', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS } });

const redirect = (location: string, cookie?: string): Response =>
  new Response(null, { status: 303, headers: { Location: location, ...SECURITY_HEADERS, ...(cookie ? { 'Set-Cookie': cookie } : {}) } });

const store = (env: Env): DurableObjectStub => env.STORE.get(env.STORE.idFromName('global'));

async function callStore<T>(env: Env, path: string, body?: unknown): Promise<T> {
  const response = await store(env).fetch(`https://store${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  return (await response.json()) as T;
}

const allowedOrigins = (env: Env): string[] =>
  (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

/**
 * Compteurs valides d'un envoi : noms connus, entiers positifs sous le plafond de chaque compteur.
 * Un nom inconnu est ignoré (ancienne version de la carte) ; une valeur hors bornes rejette l'envoi.
 */
export function parsePayload(text: string): Record<string, number> | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const { v, c } = data as { v?: unknown; c?: unknown };
  if (v !== 1 || !c || typeof c !== 'object' || Array.isArray(c)) return null;
  const counts: Record<string, number> = {};
  for (const [name, n] of Object.entries(c as Record<string, unknown>)) {
    if (!isMetricName(name)) continue;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > METRIC_DEFS[name].max) return null;
    if (n > 0) counts[name] = n;
  }
  return counts;
}

async function collect(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = allowedOrigins(env).includes(origin);
  const cors: Record<string, string> = allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: allowed ? 204 : 403,
      headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' },
    });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS' } });
  if (!allowed) return new Response(null, { status: 403, headers: cors });
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_COLLECT_BYTES) return new Response(null, { status: 413, headers: cors });
  const text = await request.text();
  if (text.length > MAX_COLLECT_BYTES) return new Response(null, { status: 413, headers: cors });
  const counts = parsePayload(text);
  if (!counts) return new Response(null, { status: 400, headers: cors });
  if (Object.keys(counts).length) await callStore(env, '/add', { day: parisDay(), counts });
  return new Response(null, { status: 204, headers: cors });
}

async function login(request: Request, env: Env, base: string): Promise<Response> {
  if (!passwordConfigured(env)) return html(renderLogin(base, 'config'), 503);
  if (Number(request.headers.get('Content-Length') ?? 0) > 2048) return html(renderLogin(base, 'erreur'), 413);
  const form = await request.formData();
  const password = String(form.get('motdepasse') ?? '');
  const key = await attemptKey(request, env, parisDay());
  const { blocked } = await callStore<{ blocked: boolean }>(env, '/guard', { key });
  if (blocked) return html(renderLogin(base, 'bloque'), 429);
  if (!(await checkPassword(password, env))) {
    await callStore(env, '/fail', { key });
    return html(renderLogin(base, 'erreur'), 401);
  }
  await callStore(env, '/ok', { key });
  return redirect(base, await sessionCookie(env, base));
}

const PERIODS: readonly Period[] = [7, 30, 90];

async function admin(request: Request, env: Env, url: URL, base: string): Promise<Response> {
  const sub = url.pathname.slice(base.length).replace(/\/+$/, '');
  if (sub === '/connexion' && request.method === 'POST') return login(request, env, base);
  if (sub === '/deconnexion' && request.method === 'POST') return redirect(base, clearedCookie(base));
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFound();

  const signedIn = await hasSession(request, env);
  if (sub === '') {
    if (!signedIn) return html(renderLogin(base, passwordConfigured(env) ? null : 'config'));
    const asked = Number(url.searchParams.get('jours'));
    const period = PERIODS.find((p) => p === asked) ?? 30;
    const today = parisDay();
    // Assez de jours pour la période affichée et pour le cumul du mois en cours.
    const from = [addDays(today, -(period - 1)), `${today.slice(0, 8)}01`].sort()[0] ?? today;
    const rows = await callStore<CountRow[]>(env, `/stats?from=${from}`);
    return html(renderDashboard({ base, period, today, rows, now: new Date() }));
  }
  if (sub === '/export.json' && signedIn) {
    const rows = await callStore<CountRow[]>(env, `/stats?from=${addDays(parisDay(), -400)}`);
    return new Response(JSON.stringify({ genere: new Date().toISOString(), compteurs: rows }, null, 1), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="foret-explorer-mesures-${parisDay()}.json"`,
        ...SECURITY_HEADERS,
      },
    });
  }
  return notFound();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/collect') return collect(request, env);
    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const base = adminBase(env);
    if (base && (url.pathname === base || url.pathname.startsWith(`${base}/`))) return admin(request, env, url, base);
    return notFound();
  },
};

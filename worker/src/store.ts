/**
 * Durable Object « MetricsStore » (stockage SQLite, offre gratuite de Cloudflare) : une seule
 * instance, nommée « global », qui additionne les compteurs par jour et limite les essais de
 * connexion. Le Worker (index.ts) l'appelle par des requêtes internes.
 */
import { addDays, isDay } from './days.ts';
import type { Env } from './env.ts';

/** Durée de conservation des totaux par jour (la CNIL recommande 25 mois au plus). */
const RETENTION_DAYS = 400;
/** Essais de connexion ratés : 8 par quart d'heure et par clé, 40 par heure en tout. */
const KEY_WINDOW_MS = 15 * 60_000;
const KEY_MAX_FAILURES = 8;
const GLOBAL_WINDOW_MS = 60 * 60_000;
const GLOBAL_MAX_FAILURES = 40;
const GLOBAL = '*';

export interface CountRow {
  day: string;
  metric: string;
  n: number;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export class MetricsStore {
  private readonly sql: SqlStorage;

  constructor(state: DurableObjectState, _env: Env) {
    this.sql = state.storage.sql;
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS counts (day TEXT NOT NULL, metric TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, metric))',
    );
    this.sql.exec('CREATE TABLE IF NOT EXISTS failures (key TEXT PRIMARY KEY, count INTEGER NOT NULL, since INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = (request.method === 'POST' ? await request.json() : {}) as Record<string, unknown>;
    const key = typeof body['key'] === 'string' ? body['key'] : '';
    switch (url.pathname) {
      case '/add':
        return this.add(body['day'], body['counts']);
      case '/stats': {
        const from = url.searchParams.get('from') ?? '';
        if (!isDay(from)) return json({ error: 'from' }, 400);
        return json(this.sql.exec<Record<string, string | number>>('SELECT day, metric, n FROM counts WHERE day >= ? ORDER BY day', from).toArray());
      }
      case '/guard':
        return json({ blocked: this.blocked(key) });
      case '/fail':
        this.failed(key);
        return json({ ok: true });
      case '/ok':
        this.sql.exec('DELETE FROM failures WHERE key = ?', key);
        return json({ ok: true });
      default:
        return json({ error: 'introuvable' }, 404);
    }
  }

  /** Ajoute les compteurs d'un envoi (déjà validés par le Worker) au total du jour. */
  private add(day: unknown, counts: unknown): Response {
    if (!isDay(day) || !counts || typeof counts !== 'object') return json({ error: 'format' }, 400);
    for (const [metric, n] of Object.entries(counts as Record<string, unknown>)) {
      if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) continue;
      this.sql.exec(
        'INSERT INTO counts (day, metric, n) VALUES (?, ?, ?) ON CONFLICT (day, metric) DO UPDATE SET n = n + excluded.n',
        day,
        metric,
        n,
      );
    }
    this.purge(day);
    return json({ ok: true });
  }

  /** Une fois par jour : oublie les totaux trop anciens et les essais de connexion de la veille. */
  private purge(today: string): void {
    const last = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'purge'").toArray()[0]?.value;
    if (last === today) return;
    this.sql.exec('DELETE FROM counts WHERE day < ?', addDays(today, -RETENTION_DAYS));
    this.sql.exec('DELETE FROM failures WHERE since < ?', Date.now() - 86_400_000);
    this.sql.exec("INSERT INTO meta (key, value) VALUES ('purge', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", today);
  }

  private failures(key: string): { count: number; since: number } | undefined {
    return this.sql.exec<{ count: number; since: number }>('SELECT count, since FROM failures WHERE key = ?', key).toArray()[0];
  }

  private blocked(key: string): boolean {
    const now = Date.now();
    const all = this.failures(GLOBAL);
    if (all && all.count >= GLOBAL_MAX_FAILURES && now - all.since < GLOBAL_WINDOW_MS) return true;
    const mine = key ? this.failures(key) : undefined;
    return Boolean(mine && mine.count >= KEY_MAX_FAILURES && now - mine.since < KEY_WINDOW_MS);
  }

  private failed(key: string): void {
    const now = Date.now();
    for (const [k, window] of [
      [GLOBAL, GLOBAL_WINDOW_MS],
      [key, KEY_WINDOW_MS],
    ] as const) {
      if (!k) continue;
      const row = this.failures(k);
      const fresh = !row || now - row.since >= window;
      this.sql.exec(
        'INSERT INTO failures (key, count, since) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET count = excluded.count, since = excluded.since',
        k,
        fresh ? 1 : (row?.count ?? 0) + 1,
        fresh ? now : (row?.since ?? now),
      );
    }
  }
}

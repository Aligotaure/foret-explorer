/** Jours au format AAAA-MM-JJ, à l'heure de Paris (celle des visiteurs). */

const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });

export function parisDay(now = new Date()): string {
  return PARIS_DAY.format(now);
}

/** Décale un jour AAAA-MM-JJ de `delta` jours. */
export function addDays(day: string, delta: number): string {
  const t = Date.parse(`${day}T12:00:00Z`) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Les `n` derniers jours, du plus ancien à `last` inclus. */
export function lastDays(last: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(last, i - n + 1));
}

export const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

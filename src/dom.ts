type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | null | undefined>;

/**
 * Crée un élément HTML : h('button', { class: 'btn', type: 'button' }, 'OK').
 * Les valeurs `false`/`null`/`undefined` sont ignorées, `true` crée un attribut vide.
 * Le texte passé en enfant est toujours inséré comme texte (pas de HTML).
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) el.append(child);
  }
  return el;
}

/** Récupère un élément par id (erreur explicite s'il manque dans index.html). */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} introuvable dans index.html`);
  return el as T;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: number | undefined;
  return (...args: A) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

let toastTimer: number | undefined;

/** Petit message temporaire en bas de l'écran. */
export function toast(message: string, ms = 2600): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.hidden = true;
  }, ms);
}

/** Icônes SVG (24×24, trait = currentColor). Chaînes statiques, sûres pour innerHTML. */
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  legend: svg(
    '<rect x="3" y="4.5" width="3.5" height="3.5" rx=".5"/><rect x="3" y="10.25" width="3.5" height="3.5" rx=".5"/><rect x="3" y="16" width="3.5" height="3.5" rx=".5"/><path d="M10 6.25h11M10 12h11M10 17.75h11"/>',
  ),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  chevronUp: svg('<path d="m6 15 6-6 6 6"/>'),
  chevronDown: svg('<path d="m6 9 6 6 6-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  locate: svg(
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  ),
  map: svg('<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  expand: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  shrink: svg('<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>'),
  tree: svg('<path d="M12 3 6 12h3.5L5 18.5h14L14.5 12H18z"/><path d="M12 18.5V22"/>'),
  target: svg('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  mushroom: svg('<path d="M3.5 11.5a8.5 7.5 0 0 1 17 0z"/><path d="M9.5 11.5v6.5a2.5 2.5 0 0 0 5 0v-6.5"/>'),
  // Champignon barré : rien à mettre en avant dans la vue (bandeau de gridLoader.ts).
  mushroomOff: svg('<path d="M3.5 11.5a8.5 7.5 0 0 1 17 0z"/><path d="M9.5 11.5v6.5a2.5 2.5 0 0 0 5 0v-6.5"/><path d="M4 3.5l16 17.5"/>'),
  rain: svg('<path d="M7 14.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 7.5a3.5 3.5 0 0 1 0 7z"/><path d="m8.5 18-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>'),
  strata: svg('<path d="M3 7.5c3-2 6 2 9 0s6 2 9 0M3 12.5c3-2 6 2 9 0s6 2 9 0M3 17.5c3-2 6 2 9 0s6 2 9 0"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.01"/>'),
  shield: svg('<path d="M12 3 5 6v5.2c0 4.4 2.9 8.1 7 9.8 4.1-1.7 7-5.4 7-9.8V6z"/><path d="m9 12 2 2 4-4"/>'),
  alert: svg('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.4v.01"/>'),
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = ICONS[name];
  return span;
}

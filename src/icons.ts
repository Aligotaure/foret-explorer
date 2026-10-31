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
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = ICONS[name];
  return span;
}

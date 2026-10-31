import { h, toast } from './dom';
import { CLASS_BY_CODE, FALLBACK_COLOR } from './forestClasses';

const ESSENCE_LABELS: Record<string, string> = {
  NR: 'Non renseignée',
  NC: 'Sans objet',
};

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Contenu de la bulle affichée au clic sur un polygone.
 * Construit en DOM (jamais d'innerHTML) : les valeurs viennent des données.
 */
export function forestPopupContent(
  props: Record<string, unknown>,
  lngLat: { lng: number; lat: number },
): HTMLElement {
  const code = text(props['code_tfv']);
  const cls = CLASS_BY_CODE.get(code);
  const title = cls?.label ?? (text(props['tfv']) || 'Formation végétale');
  const essence = text(props['essence']);
  const lat = lngLat.lat.toFixed(5);
  const lng = lngLat.lng.toFixed(5);

  const rows: [string, string][] = [
    ['Essence', ESSENCE_LABELS[essence] ?? (essence || '—')],
    ['Catégorie', text(props['tfv_g11']) || '—'],
    ['Code', code || '—'],
  ];

  const copy = h('button', { type: 'button', class: 'popup-btn' }, 'Copier');
  copy.addEventListener('click', () => {
    navigator.clipboard
      .writeText(`${lat}, ${lng}`)
      .then(() => toast('Coordonnées copiées'))
      .catch(() => toast(`${lat}, ${lng}`));
  });
  const directions = h(
    'a',
    {
      class: 'popup-btn',
      href: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
      target: '_blank',
      rel: 'noopener',
    },
    'Itinéraire ↗',
  );

  return h(
    'div',
    { class: 'forest-popup__content' },
    h(
      'div',
      { class: 'forest-popup__title' },
      h('span', { class: 'swatch', style: `--swatch: ${cls?.color ?? FALLBACK_COLOR}` }),
      h('strong', {}, title),
    ),
    h('dl', { class: 'forest-popup__props' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h(
      'div',
      { class: 'forest-popup__footer' },
      h('span', { class: 'forest-popup__coords' }, `${lat}, ${lng}`),
      copy,
      directions,
    ),
  );
}

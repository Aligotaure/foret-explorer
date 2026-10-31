import maplibregl, { type LngLat, type Map as MapLibreMap, type PointLike } from 'maplibre-gl';
import { GEOLOGY } from './config';
import { h, toast } from './dom';
import { forestAt, soilAt, type ForestAtPoint, type SoilAtPoint } from './geology';
import { icon } from './icons';
import { LEVELS, MUSHROOMS, scoreMushroom, type MushroomScore } from './mushrooms';
import { setHighlight } from './mapStyle';
import { patternImageId, drawPattern } from './soils';
import type { Store } from './state';
import { fetchAltitude, fetchDaily, summarize, type WeatherSummary } from './weather';

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Histogramme de la pluie jour par jour ; les jours des grosses pluies sont plus foncés. */
function rainChart(w: WeatherSummary): SVGSVGElement {
  const width = 240;
  const height = 64;
  const n = w.days.length;
  const max = Math.max(20, ...w.days.map((d) => d.rain));
  const barW = width / n;
  const peaks = new Set(w.events.map((e) => e.date));
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height + 14}`, class: 'rain-chart', role: 'img' });
  chart.setAttribute('aria-label', `Pluie jour par jour sur ${n} jours, ${Math.round(w.rain20)} mm au total`);
  chart.append(svg('line', { x1: 0, y1: height, x2: width, y2: height, class: 'rain-chart__axis' }));
  w.days.forEach((d, i) => {
    const bh = d.rain > 0 ? Math.max(1.5, (d.rain / max) * (height - 12)) : 0;
    if (!bh) return;
    const bar = svg('rect', {
      x: i * barW + 1,
      y: height - bh,
      width: barW - 2,
      height: bh,
      rx: 1.5,
      class: peaks.has(d.date) ? 'rain-chart__bar rain-chart__bar--peak' : 'rain-chart__bar',
    });
    const title = svg('title', {});
    title.textContent = `${new Date(`${d.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} : ${d.rain.toFixed(1)} mm`;
    bar.append(title);
    chart.append(bar);
    if (peaks.has(d.date)) {
      const label = svg('text', { x: i * barW + barW / 2, y: height - bh - 3, class: 'rain-chart__value', 'text-anchor': 'middle' });
      label.textContent = `${Math.round(d.rain)}`;
      chart.append(label);
    }
  });
  const left = svg('text', { x: 0, y: height + 12, class: 'rain-chart__tick' });
  left.textContent = `il y a ${n} j`;
  const right = svg('text', { x: width, y: height + 12, class: 'rain-chart__tick', 'text-anchor': 'end' });
  right.textContent = 'hier';
  chart.append(left, right);
  return chart;
}

function patternSwatch(soil: SoilAtPoint['soil']): HTMLSpanElement {
  const swatch = h('span', { class: 'swatch swatch--pattern', 'aria-hidden': 'true' });
  swatch.style.backgroundImage = `url(${drawPattern(soil.pattern, 16, 2).toDataURL()})`;
  swatch.dataset['pattern'] = patternImageId(soil.id);
  return swatch;
}

function row(label: string, ...value: (Node | string)[]): HTMLElement {
  return h('div', { class: 'spot__row' }, h('dt', {}, label), h('dd', {}, ...value));
}

/**
 * Bilan d'un coin : forêt, sol, altitude, pluie des 20 derniers jours et, pour chaque
 * champignon, un verdict expliqué. Panneau à droite sur grand écran, tiroir bas sur mobile.
 */
export class SpotPanel {
  private controller: AbortController | null = null;
  private marker: maplibregl.Marker | null = null;
  private readonly body = h('div', { class: 'spot__body' });
  private readonly coords = h('p', { class: 'spot__coords' });

  constructor(
    private readonly root: HTMLElement,
    private readonly map: MapLibreMap,
    private readonly store: Store,
  ) {
    const close = h('button', { class: 'panel__close', type: 'button', 'aria-label': 'Fermer le bilan' }, icon('close'));
    close.addEventListener('click', () => this.close());
    root.replaceChildren(
      h(
        'div',
        { class: 'panel__header' },
        h('span', { class: 'panel__icon' }, icon('target')),
        h('div', { class: 'spot__heading' }, h('h2', { class: 'panel__title' }, 'Ce coin'), this.coords),
        close,
      ),
      this.body,
    );
    root.hidden = true;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.controller?.abort();
    this.root.hidden = true;
    this.marker?.remove();
    setHighlight(this.map, null);
  }

  /** Ouvre le bilan du point cliqué. */
  async open(lngLat: LngLat, point: PointLike): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    const forest = forestAt(this.map, point);
    const soil = soilAt(this.map, point);
    setHighlight(this.map, forest?.id ?? null);
    this.marker ??= new maplibregl.Marker({ color: '#6a6af4', scale: 0.7 });
    this.marker.setLngLat(lngLat).addTo(this.map);

    const lat = lngLat.lat.toFixed(5);
    const lng = lngLat.lng.toFixed(5);
    this.coords.textContent = `${lat}, ${lng}`;
    this.root.hidden = false;
    this.render(forest, soil, null, null, 'loading');

    try {
      const altitude = await fetchAltitude(lngLat.lng, lngLat.lat, controller.signal).catch(() => null);
      const [series] = await fetchDaily(
        [{ lat: lngLat.lat, lon: lngLat.lng, ...(altitude !== null ? { elevation: altitude } : {}) }],
        controller.signal,
      );
      if (controller.signal.aborted) return;
      this.render(forest, soil, altitude, series ? summarize(series) : null, 'ok');
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('[bilan]', error);
      this.render(forest, soil, null, null, 'error');
    }
  }

  private render(
    forest: ForestAtPoint | null,
    soil: SoilAtPoint | null,
    altitude: number | null,
    weather: WeatherSummary | null,
    status: 'loading' | 'ok' | 'error',
  ): void {
    const terrain = h('dl', { class: 'spot__facts' });
    terrain.append(
      row(
        'Forêt',
        ...(forest
          ? [h('span', { class: 'swatch', style: `--swatch: ${forest.cls?.color ?? '#999'}` }), h('span', { class: 'spot__value' }, forest.label)]
          : [this.map.getZoom() < 10 ? 'zoomez pour la connaître' : 'pas de forêt cartographiée']),
      ),
      row(
        'Sol',
        ...(soil
          ? [patternSwatch(soil.soil), h('span', { class: 'spot__value' }, soil.soil.label), h('small', { class: 'spot__descr' }, soil.description)]
          : [`inconnu ici (couverture : ${GEOLOGY.coverage}, zoom 10 et plus)`]),
      ),
      row('Altitude', status === 'loading' ? '…' : altitude !== null ? `${altitude} m` : 'inconnue'),
    );

    const parts: Node[] = [h('section', { class: 'spot__section' }, terrain)];

    if (status === 'loading') {
      parts.push(h('p', { class: 'spot__status' }, 'Calcul de la météo des 20 derniers jours…'));
    } else if (!weather) {
      parts.push(h('p', { class: 'spot__status' }, 'Météo indisponible pour le moment (réseau ?).'));
    } else {
      const last = weather.events[0];
      parts.push(
        h(
          'section',
          { class: 'spot__section' },
          h('h3', { class: 'spot__title' }, 'Météo des 20 derniers jours'),
          h(
            'p',
            { class: 'spot__summary' },
            `${Math.round(weather.rain20)} mm de pluie`,
            last ? ` · dernière grosse pluie : ${Math.round(last.amount)} mm il y a ${last.daysAgo} jours` : ' · pas de grosse pluie',
          ),
          rainChart(weather),
          h(
            'p',
            { class: 'spot__summary' },
            weather.tmean7 !== null ? `${Math.round(weather.tmean7)} °C en moyenne sur 7 jours` : 'Températures inconnues',
            weather.tmin5 !== null ? ` · minimum ${Math.round(weather.tmin5)} °C sur 5 jours` : '',
            weather.frost ? ' · gel' : '',
          ),
        ),
      );

      const month = new Date().getMonth() + 1;
      const chosen = this.store.state.mushroom;
      const scores: MushroomScore[] = MUSHROOMS.map((m) =>
        scoreMushroom(m, weather, month, { forestCode: forest ? forest.code : null, soil: soil?.soil.id ?? null }),
      ).sort((a, b) => (a.id === chosen ? -1 : b.id === chosen ? 1 : b.score - a.score));

      const list = h('ul', { class: 'verdicts' });
      for (const s of scores) {
        const m = MUSHROOMS.find((x) => x.id === s.id);
        const level = LEVELS[s.level];
        list.append(
          h(
            'li',
            { class: `verdict verdict--${s.level}` },
            h(
              'div',
              { class: 'verdict__head' },
              h('strong', {}, m?.label ?? s.id),
              h('span', { class: 'level-pill', style: `--level: ${level?.color ?? '#999'}` }, level?.label ?? ''),
            ),
            h('ul', { class: 'verdict__reasons' }, ...s.reasons.map((r) => h('li', {}, r))),
          ),
        );
      }
      parts.push(h('section', { class: 'spot__section' }, h('h3', { class: 'spot__title' }, 'Champignons'), list));
    }

    const lat = this.coords.textContent?.split(', ')[0] ?? '';
    const lng = this.coords.textContent?.split(', ')[1] ?? '';
    const copy = h('button', { type: 'button', class: 'popup-btn' }, 'Copier les coordonnées');
    copy.addEventListener('click', () => {
      navigator.clipboard
        .writeText(`${lat}, ${lng}`)
        .then(() => toast('Coordonnées copiées'))
        .catch(() => toast(`${lat}, ${lng}`));
    });
    parts.push(
      h(
        'div',
        { class: 'spot__actions' },
        copy,
        h(
          'a',
          { class: 'popup-btn', href: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, target: '_blank', rel: 'noopener' },
          'Itinéraire ↗',
        ),
      ),
      h(
        'p',
        { class: 'spot__note' },
        'Indice indicatif, fondé sur des règles de cueilleur : délai après la pluie, températures à cette altitude, arbres hôtes et sol. Météo : Open-Meteo.',
      ),
    );
    this.body.replaceChildren(...parts);
  }
}

import maplibregl, { type LngLat, type Map as MapLibreMap, type PointLike } from 'maplibre-gl';
import { DIRECT_PAST_DAYS, GEOLOGY } from './config';
import { h, toast } from './dom';
import { forestAt, soilAt, type ForestAtPoint, type SoilAtPoint } from './geology';
import { icon } from './icons';
import { track } from './metrics';
import { LEVELS, MUSHROOMS, scoreMushroom, type MushroomScore } from './mushrooms';
import { setHighlight } from './mapStyle';
import { CELL_KM, KEPT_DAYS } from './meteoGrid';
import { patternImageId, drawPattern } from './soils';
import type { Store } from './state';
import { fetchAltitude, summarize, weatherAt, type WeatherSummary } from './weather';
import { zonesAt, type ZonesAtPoint } from './zones';

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
  const max = Math.max(20, ...w.days.map((d) => d.rain ?? 0));
  const barW = width / n;
  const peaks = new Set(w.events.map((e) => e.date));
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height + 14}`, class: 'rain-chart', role: 'img' });
  chart.setAttribute('aria-label', `Pluie jour par jour sur ${n} jours, ${Math.round(w.rain30)} mm au total`);
  chart.append(svg('line', { x1: 0, y1: height, x2: width, y2: height, class: 'rain-chart__axis' }));
  w.days.forEach((d, i) => {
    if (d.rain === null) {
      // Jour pas encore connu : un tiret sous l'axe.
      chart.append(svg('line', { x1: i * barW + 2, y1: height + 2, x2: (i + 1) * barW - 2, y2: height + 2, class: 'rain-chart__unknown' }));
      return;
    }
    const bh = d.rain > 0 ? Math.max(1.5, (d.rain / max) * (height - 12)) : 0;
    if (!bh) return;
    const bar = svg('rect', {
      x: i * barW + 1,
      y: height - bh,
      width: barW - 2,
      height: bh,
      rx: 1.5,
      class: `rain-chart__bar${peaks.has(d.date) ? ' rain-chart__bar--peak' : ''}${d.estimated ? ' rain-chart__bar--estimated' : ''}`,
    });
    const title = svg('title', {});
    title.textContent = `${new Date(`${d.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} : ${d.rain.toFixed(1)} mm${d.estimated ? ' (estimation)' : ''}`;
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

/** De septembre à février, les battues sont fréquentes. */
const huntingSeason = (month = new Date().getMonth() + 1): boolean => month >= 9 || month <= 2;

/**
 * Droit de cueillir ici : zones protégées, forêt publique ou sans doute privée, et rappel des
 * règles. Les données sont indicatives : on ne parle du statut que si elles sont bien chargées.
 */
function rulesSection(zones: ZonesAtPoint, forest: ForestAtPoint | null): HTMLElement {
  const items: Node[] = [];
  if (!zones.known) {
    items.push(h('p', { class: 'spot__rule' }, `Statut du terrain inconnu : ${zones.reason ?? 'données absentes'}.`));
  } else {
    for (const zone of zones.protections) {
      items.push(
        h(
          'div',
          { class: 'spot__alert', role: 'note' },
          h('span', { class: 'spot__alert-icon' }, icon('alert')),
          h(
            'div',
            {},
            h('strong', {}, zone.label),
            zone.name ? ` « ${zone.name} »` : '',
            h('p', {}, 'Son règlement peut interdire ou limiter la cueillette : consultez-le avant de cueillir.'),
            zone.url ? h('a', { href: zone.url, target: '_blank', rel: 'noopener' }, 'Fiche officielle de la zone (INPN) ↗') : null,
          ),
        ),
      );
    }
    if (zones.publicForest) {
      items.push(
        h(
          'p',
          { class: 'spot__rule' },
          h('strong', {}, zones.publicForest.name),
          ` : forêt publique${zones.publicForest.domaniale ? ' (domaniale)' : ''}, gérée par l’ONF. Une cueillette familiale y est en général tolérée, sauf interdiction (arrêté, panneau).`,
        ),
      );
    } else if (zones.protections.some((z) => z.type === 'cdl')) {
      items.push(
        h('p', { class: 'spot__rule' }, h('strong', {}, 'Propriété publique'), ' (Conservatoire du littoral) : suivez le règlement affiché sur place.'),
      );
    } else if (zones.protections.length) {
      // Dans une zone protégée, le propriétaire peut être public ou privé : on ne devine pas.
      items.push(
        h('p', { class: 'spot__rule' }, h('strong', {}, 'Propriétaire non identifié'), ' : demandez l’accord du propriétaire ou du gestionnaire de la zone.'),
      );
    } else if (forest) {
      items.push(
        h(
          'p',
          { class: 'spot__rule' },
          h('strong', {}, 'Forêt sans doute privée'),
          ' : elle ne figure pas parmi les forêts publiques de l’IGN. Il faut l’accord du propriétaire pour cueillir.',
        ),
      );
    } else {
      items.push(
        h('p', { class: 'spot__rule' }, h('strong', {}, 'Hors forêt cartographiée'), ' : la cueillette demande l’accord du propriétaire du terrain.'),
      );
    }
  }
  items.push(
    h(
      'p',
      { class: 'spot__rule spot__rule--muted' },
      'Sans autorisation, cueillir est une contravention, et un délit au-delà de 10 litres. Des arrêtés limitent souvent les quantités : renseignez-vous en mairie.',
      huntingSeason() ? ' Saison de chasse : portez une couleur vive.' : '',
    ),
  );
  return h('section', { class: 'spot__section' }, h('h3', { class: 'spot__title' }, 'Droit de cueillir'), ...items);
}

/**
 * Bilan d'un coin : forêt, sol, altitude, pluie des 30 derniers jours et, pour chaque
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
    track('app.spots');
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    const forest = forestAt(this.map, point);
    const soil = soilAt(this.map, point);
    const zones = zonesAt(this.map, point, lngLat);
    setHighlight(this.map, forest?.id ?? null);
    this.marker ??= new maplibregl.Marker({ color: '#6a6af4', scale: 0.7 });
    this.marker.setLngLat(lngLat).addTo(this.map);

    const lat = lngLat.lat.toFixed(5);
    const lng = lngLat.lng.toFixed(5);
    this.coords.textContent = `${lat}, ${lng}`;
    this.root.hidden = false;
    this.render(forest, soil, zones, null, null, 'loading');

    try {
      const altitude = await fetchAltitude(lngLat.lng, lngLat.lat, controller.signal).catch(() => null);
      // Case météo commune qui contient le point (températures ramenées à son altitude) ; Open-Meteo
      // n'est appelé que hors de France ou si les fichiers communs sont injoignables.
      const weather = await weatherAt(lngLat.lat, lngLat.lng, altitude, controller.signal);
      if (controller.signal.aborted) return;
      this.render(forest, soil, zones, altitude, weather ? summarize(weather.series) : null, 'ok', weather?.shared ?? false);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('[bilan]', error);
      this.render(forest, soil, zones, null, null, 'error');
    }
  }

  private render(
    forest: ForestAtPoint | null,
    soil: SoilAtPoint | null,
    zones: ZonesAtPoint,
    altitude: number | null,
    weather: WeatherSummary | null,
    status: 'loading' | 'ok' | 'error',
    shared = true,
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

    const parts: Node[] = [h('section', { class: 'spot__section' }, terrain), rulesSection(zones, forest)];

    if (status === 'loading') {
      parts.push(h('p', { class: 'spot__status' }, 'Lecture de la météo des derniers jours…'));
    } else if (!weather) {
      parts.push(h('p', { class: 'spot__status' }, 'Météo indisponible pour le moment (réseau ?).'));
    } else {
      const last = weather.events[0];
      const yesterday = weather.days[weather.days.length - 1]?.date ?? '';
      const late = weather.lastDate && weather.lastDate < yesterday;
      parts.push(
        h(
          'section',
          { class: 'spot__section' },
          // En secours (Open-Meteo interrogé directement), seuls les 20 derniers jours sont connus.
          h('h3', { class: 'spot__title' }, `Météo des ${shared ? KEPT_DAYS : DIRECT_PAST_DAYS} derniers jours`),
          h(
            'p',
            { class: 'spot__summary' },
            `${Math.round(weather.rain30)} mm de pluie`,
            last ? ` · dernière grosse pluie : ${Math.round(last.amount)} mm il y a ${last.daysAgo} jours` : ' · pas de grosse pluie',
            late && weather.lastDate
              ? ` · connue jusqu’au ${new Date(`${weather.lastDate}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`
              : '',
            weather.estimated ? ' · dernier jour estimé d’après la prévision' : '',
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
      parts.push(
        h(
          'section',
          { class: 'spot__section' },
          h('h3', { class: 'spot__title' }, 'Champignons'),
          zones.protections.length
            ? h('p', { class: 'spot__warning' }, 'Zone protégée : même avec un indice favorable, la cueillette peut y être interdite.')
            : null,
          list,
        ),
      );
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
        `Indice expérimental, fondé sur des règles de cueilleur : délai après la pluie, températures à cette altitude, arbres hôtes et sol. Il dit où chercher, pas ce qui se mange ni si l’on peut cueillir. Météo : Open-Meteo, ${shared ? `case de ${CELL_KM} km qui contient ce point, mise à jour chaque nuit` : 'interrogé directement pour ce point'}.`,
      ),
    );
    this.body.replaceChildren(...parts);
  }
}

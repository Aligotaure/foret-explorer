/**
 * « Y aller » : la puce à la voiture de l'en-tête du bilan. Elle déplie, juste sous l'en-tête, les
 * applications de navigation d'un téléphone, et « Copier les coordonnées » pour toutes les autres.
 *
 * Chaque lien est celui que l'éditeur de l'application documente pour un site web : il ouvre
 * l'application si elle est installée, son site sinon (documentations relues le 25/11/2026) :
 *  - Google Maps : https://developers.google.com/maps/documentation/urls/get-started (« Directions ») ;
 *  - Waze : https://developers.google.com/waze/deeplinks ;
 *  - Plans : https://developer.apple.com/documentation/mapkit/unified-map-urls (iOS 18.4 et plus ;
 *    l'ancienne forme `?daddr=` ne marche plus de façon sûre, d'après les forums d'Apple).
 * Une page web ne peut pas savoir quelles applications sont installées : les mêmes sont proposées à
 * tous, sauf Plans, qui n'existe que sur les appareils Apple.
 *
 * Le choix se déplie dans le panneau, sous l'en-tête, plutôt qu'en bulle flottante : le panneau
 * rognerait une bulle, et sur téléphone elle masquerait le bilan. Habillage, validé par Clément sur
 * maquette le 26/11/2026 : des puces à liseré comme celles de « Je cherche… », pour « Y aller »
 * (voiture et texte) comme pour le choix. Deux versions refusées avant : de gros rectangles blancs
 * sous l'en-tête et une voiture dans un rectangle, puis une voiture dans une pastille ronde.
 *
 * Avant le 25/11/2026, « Copier les coordonnées » et « Itinéraire ↗ » (Google Maps seul) étaient tout
 * en bas du bilan : sur téléphone il fallait faire défiler le tiroir pour les trouver (demande de
 * Clément : une voiture bien visible près de « Ce coin », et le choix de l'application).
 */
import { h, toast } from './dom';
import { icon } from './icons';

/** Une application de navigation et son lien vers le coin. */
export interface NavApp {
  id: 'google' | 'waze' | 'apple';
  label: string;
  href: string;
}

/** iPhone, iPad ou Mac : les seuls appareils où l'application Plans existe (un iPad se présente comme un Mac). */
export const isAppleDevice = (ua: string = navigator.userAgent): boolean => /iPhone|iPad|iPod|Macintosh/.test(ua);

/**
 * Les applications proposées pour aller à un point. `lat` et `lng` : degrés décimaux déjà écrits
 * (ceux que l'en-tête du bilan affiche). L'itinéraire part de la position de l'appareil : aucune
 * n'a besoin qu'on lui donne un départ.
 */
export function navApps(lat: string, lng: string, apple: boolean = isAppleDevice()): NavApp[] {
  // Google et Waze demandent la virgule encodée ; les exemples d'Apple l'écrivent telle quelle.
  const point = `${lat}%2C${lng}`;
  const apps: NavApp[] = [
    { id: 'google', label: 'Google Maps', href: `https://www.google.com/maps/dir/?api=1&destination=${point}` },
    { id: 'waze', label: 'Waze', href: `https://waze.com/ul?ll=${point}&navigate=yes` },
  ];
  if (apple) apps.push({ id: 'apple', label: 'Plans', href: `https://maps.apple.com/directions?destination=${lat},${lng}&mode=driving` });
  return apps;
}

const PANEL_ID = 'spot-directions';

/**
 * La puce « Y aller » et ce qu'elle déplie. `button` va dans l'en-tête du bilan, `panel` juste dessous :
 * ni l'un ni l'autre n'est redessiné avec le bilan (qui l'est jusqu'à trois fois par clic).
 */
export class Directions {
  readonly button = h(
    'button',
    { class: 'directions-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': PANEL_ID, 'aria-label': 'Y aller : itinéraire ou coordonnées' },
    icon('car'),
    'Y aller',
  );
  private readonly list = h('div', { class: 'directions__list' });
  readonly panel = h(
    'div',
    { id: PANEL_ID, class: 'directions', role: 'group', 'aria-label': 'Y aller', hidden: true },
    h('p', { class: 'directions__title' }, 'Itinéraire avec'),
    this.list,
  );
  private lat = '';
  private lng = '';

  constructor() {
    this.button.addEventListener('click', () => this.toggle(this.panel.hidden));
    // Échap replie le choix et rend le clavier au bouton, sans rien fermer d'autre.
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || this.panel.hidden) return;
      event.stopPropagation();
      this.toggle(false);
      this.button.focus();
    };
    this.button.addEventListener('keydown', onEscape);
    this.panel.addEventListener('keydown', onEscape);
  }

  /** Nouveau coin : les liens le visent, et le choix se replie. */
  setPoint(lat: string, lng: string): void {
    this.lat = lat;
    this.lng = lng;
    const copy = h('button', { class: 'directions__btn', type: 'button' }, icon('copy'), 'Copier les coordonnées');
    copy.addEventListener('click', () => this.copy());
    this.list.replaceChildren(
      ...navApps(lat, lng).map((app) =>
        // Lu hors de son contexte (liste des liens d'un lecteur d'écran), « Waze » seul ne dit pas ce que fait le lien.
        h('a', { class: 'directions__btn', 'data-app': app.id, 'aria-label': `Itinéraire avec ${app.label}`, href: app.href, target: '_blank', rel: 'noopener' }, app.label, icon('external')),
      ),
      copy,
    );
    this.toggle(false);
  }

  /** Replie le choix (le bilan se ferme). */
  close(): void {
    this.toggle(false);
  }

  private toggle(open: boolean): void {
    this.panel.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
  }

  /** Copie « latitude, longitude » ; presse-papiers refusé ou absent : on les affiche, pour les recopier. */
  private copy(): void {
    const text = `${this.lat}, ${this.lng}`;
    const shown = (): void => toast(text);
    try {
      navigator.clipboard.writeText(text).then(() => toast('Coordonnées copiées'), shown);
    } catch {
      // Page servie sans HTTPS, vieux navigateur : `navigator.clipboard` n'existe pas.
      shown();
    }
  }
}

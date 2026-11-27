/**
 * Mesure d'usage avec PostHog (cloud UE, Francfort), en mode « sans cookie » : le plan de tracking
 * du site, et la seule porte par laquelle un événement en sort.
 *
 * Ce qui part : l'ouverture de la page (`$pageview` : adresse sans sa partie « # », page d'où l'on
 * vient, campagne `utm_`, appareil) et le nom d'un geste de la liste `TrackedEvents`, avec au plus
 * le champignon, l'application de navigation ou le niveau de chance. Jamais de coordonnées, de
 * texte de recherche ni de position de la carte : la partie « # » de l'adresse
 * (`#carte=zoom/lat/lon`) est retirée de tout envoi, deux fois plutôt qu'une (option de la
 * bibliothèque, puis `clean` ci-dessous).
 *
 * Rien n'est écrit dans le navigateur (ni cookie, ni stockage) et rien n'y est lu pour la mesure.
 * D'après la documentation de PostHog, ses serveurs reconnaissent une visite par une empreinte qui
 * change chaque jour : pas de visiteur reconnu d'un jour à l'autre, donc pas de rétention mesurée.
 * Dans PostHog, le projet doit avoir « Enable cookieless tracking » activé (Settings > Project >
 * Web analytics), sinon il jette ces événements.
 *
 * Rien ne part, et la bibliothèque n'est même pas téléchargée :
 *  - si le site est construit sans clé de projet (`VITE_POSTHOG_KEY`) : c'est le cas tant que la
 *    publication ne la fournit pas ;
 *  - si le navigateur signale « Global Privacy Control » (même règle que src/metrics.ts).
 * La bibliothèque elle-même écarte les robots (dont les navigateurs pilotés par un programme).
 *
 * La bibliothèque (≈ 130 ko compressés) est chargée à la demande, une fois la vue affichée
 * (`startTracking`) : les gestes faits avant attendent en mémoire, avec leur heure, et l'ouverture
 * de la page est datée du moment où elle a eu lieu, pour que l'ordre des étapes reste le bon.
 * Variante « no-external » : elle ne télécharge jamais de code depuis PostHog.
 *
 * Ce fichier est chargé d'office avec la page : il n'importe ni la carte ni src/config.ts.
 */
import type { CaptureResult, PostHog } from 'posthog-js/dist/module.no-external';
import { SHOWCASE } from './legal';
import type { MushroomId } from './mushrooms';

/** Clé du projet PostHog (publique par nature : elle est dans le code envoyé au navigateur). */
const KEY = (import.meta.env.VITE_POSTHOG_KEY ?? '').trim();
/** Cloud UE de PostHog : où partent les événements, et l'adresse de son interface. */
const API_HOST = 'https://eu.i.posthog.com';
const UI_HOST = 'https://eu.posthog.com';

/** Niveau de chance qu'un bilan affiche ; « inconnu » : quitté avant que la météo soit lue. */
export type SpotLevel = 'defavorable' | 'peu_probable' | 'possible' | 'favorable' | 'inconnu';
/** Les niveaux, dans l'ordre de `LEVELS` (src/mushrooms.ts). */
export const SPOT_LEVELS: readonly SpotLevel[] = ['defavorable', 'peu_probable', 'possible', 'favorable'];

/**
 * Le plan de tracking : chaque événement, le geste qui le déclenche et ses propriétés. Aucun ne
 * situe le visiteur. S'y ajoute `$pageview` (ouverture de la page), envoyé par `startTracking`.
 * Toute ligne ajoutée ici se décrit aussi dans la page « À propos » (confidentialité).
 */
export interface TrackedEvents {
  /** Clic sur « J'ai compris et j'accepte » : l'avertissement n'est montré qu'à qui ne l'a pas encore accepté. */
  avertissement_accepte: Record<never, never>;
  /** Un champignon choisi (puces de la légende, bandeau, suggestion). `hors_saison` : pas d'estimation ce mois-ci. */
  champignon_choisi: { champignon: MushroomId; hors_saison: boolean };
  /** Bilan d'un coin ouvert par un clic sur la carte. `niveau` : celui du champignon recherché, sinon le meilleur. */
  bilan_ouvert: { niveau: SpotLevel };
  /** « Y aller » déplié dans le bilan. */
  y_aller_ouvert: Record<never, never>;
  /** Clic sur une application de navigation : l'activation du produit. */
  navigation_choisie: { appli: 'google' | 'waze' | 'apple'; niveau: SpotLevel };
  /** « Copier les coordonnées » : une activation plus faible. */
  coordonnees_copiees: Record<never, never>;
  /** Clic sur le lien de contact de la vue Analytics. */
  contact_clique: Record<never, never>;
}
export type TrackedEvent = keyof TrackedEvents;

/** Gestes qui font quitter la page (autre onglet, application) : envoyés sans attendre le prochain lot. */
const INSTANT: ReadonlySet<string> = new Set<TrackedEvent>(['navigation_choisie', 'coordonnees_copiees', 'contact_clique']);

/** Le navigateur signale « Global Privacy Control » : aucun envoi de mesure (ici et dans src/metrics.ts). */
export const privacySignal = (): boolean => (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

/** La mesure est en service pour cette visite. */
const allowed = (): boolean => Boolean(KEY) && !privacySignal();

interface Waiting {
  event: string;
  props: Record<string, unknown>;
  at: Date;
}
/** Au-delà, la bibliothèque n'arrivera sans doute plus : on cesse de garder. */
const MAX_WAITING = 50;
const waiting: Waiting[] = [];
/** Moment où la page s'est ouverte (ce fichier est chargé avec elle). */
const openedAt = new Date();
let state: 'idle' | 'loading' | 'ready' | 'off' = 'idle';
let client: PostHog | null = null;

/** Retire la partie « # » de toute adresse d'un envoi : elle porte la position de la carte. */
function stripHashes(bag: Record<string, unknown> | undefined, depth = 0): void {
  if (!bag || depth > 3) return;
  for (const [key, value] of Object.entries(bag)) {
    if (typeof value === 'string') {
      if (value.includes('#') && /^https?:\/\//i.test(value)) bag[key] = value.slice(0, value.indexOf('#'));
    } else if (value && typeof value === 'object' && !Array.isArray(value)) stripHashes(value as Record<string, unknown>, depth + 1);
  }
}

/** Dernier passage avant l'envoi, pour tout événement : adresses sans « # », et la marque « vitrine ». */
export function clean(result: CaptureResult): CaptureResult {
  stripHashes(result.properties);
  stripHashes(result.$set);
  stripHashes(result.$set_once);
  // Visite ouverte par un lien « vitrine » (?analytics, src/legal.ts) : un prospect, pas un cueilleur.
  result.properties.vitrine = SHOWCASE;
  return result;
}

function send(posthog: PostHog, { event, props, at }: Waiting): void {
  posthog.capture(event, props, { timestamp: at, send_instantly: INSTANT.has(event) });
}

/**
 * Note un geste du plan de tracking. Sans effet si la mesure n'est pas en service. `at` : le moment
 * du geste, s'il est noté après coup (le bilan attend son niveau de chance).
 */
export function capture<E extends TrackedEvent>(
  event: E,
  ...[props, at]: Record<never, never> extends TrackedEvents[E] ? [props?: TrackedEvents[E], at?: Date] : [props: TrackedEvents[E], at?: Date]
): void {
  if (state === 'off' || !allowed()) return;
  const item: Waiting = { event, props: { ...props }, at: at ?? new Date() };
  if (client) send(client, item);
  else if (waiting.length < MAX_WAITING) waiting.push(item);
}

/**
 * Télécharge la bibliothèque et envoie ce qui attendait. Appelé par la vue une fois affichée (carte
 * au repos, vue Analytics dessinée), et par src/main.ts au bout de quelques secondes si elle tarde :
 * le premier appel compte, les suivants ne font rien.
 */
export function startTracking(): void {
  if (state !== 'idle') return;
  if (!allowed()) {
    state = 'off';
    return;
  }
  state = 'loading';
  void import('posthog-js/dist/module.no-external')
    .then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: API_HOST,
        ui_host: UI_HOST,
        // Sans cookie ni stockage : l'empreinte du visiteur est calculée par PostHog, sur ses serveurs.
        cookieless_mode: 'always',
        persistence: 'memory',
        person_profiles: 'never',
        // La partie « # » de l'adresse (position de la carte) et les identifiants publicitaires (gclid, fbclid…).
        disable_capture_url_hashes: true,
        mask_personal_data_properties: true,
        before_send: clean,
        // Seuls le plan de tracking et l'ouverture de la page partent : rien de ce que la
        // bibliothèque sait relever d'elle-même (clics, erreurs, enregistrement d'écran, sondages…).
        capture_pageview: false,
        capture_pageleave: true,
        autocapture: false,
        rageclick: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_performance: false,
        capture_heatmaps: false,
        disable_session_recording: true,
        disable_surveys: true,
        disable_product_tours: true,
        disable_conversations: true,
        disable_web_experiments: true,
        advanced_disable_flags: true,
        disable_external_dependency_loading: true,
        // Explicite : sur localhost, la bibliothèque ne marque personne « utilisateur de test ».
        internal_or_test_user_hostname: null,
      });
      client = posthog;
      state = 'ready';
      // L'ouverture de la page d'abord, à son heure : les gestes en attente l'ont suivie.
      posthog.capture('$pageview', undefined, { timestamp: openedAt });
      for (const item of waiting.splice(0)) send(posthog, item);
    })
    .catch((error: unknown) => {
      // Bibliothèque injoignable (réseau, bloqueur de publicité) : la visite n'est pas mesurée.
      state = 'off';
      waiting.length = 0;
      console.warn('[mesure]', error);
    });
}

/** Délai après lequel src/main.ts lance la mesure si la vue n'est toujours pas affichée. */
export const TRACKING_FALLBACK_MS = 8000;

/** État de la mesure et gestes en attente (console de développement, tests). */
export const trackingState = (): { state: string; waiting: number } => ({ state, waiting: waiting.length });

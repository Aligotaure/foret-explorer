/**
 * Écran « période de chasse » : pendant l'ouverture générale de la chasse, un rappel de sécurité
 * bloquant (GATE_WAIT_SECONDS secondes, src/gate.ts) à l'ouverture de la carte, après
 * l'avertissement s'il est à accepter, avant « La carte en 3 gestes ». Hors période, rien.
 *
 * Dates : celles du Code de l'environnement, article R424-7 (version en vigueur depuis le
 * 05/05/2012, relue sur Légifrance le 15/11/2026). L'ouverture générale doit tenir entre le premier
 * dimanche de septembre (Corse ; deuxième dimanche dans le Sud, troisième dans le Nord) et le
 * dernier jour de février ; le préfet fixe les dates de chaque département dans ces bornes. Le
 * tableau ne couvre ni l'Alsace ni la Moselle. L'article R424-8 permet en outre au préfet d'ouvrir
 * la chasse du sanglier et du chevreuil dès le 1er juin. Les bornes sont calculées pour la saison
 * en cours : rien à mettre à jour d'une année à l'autre.
 *
 * Ce n'est pas un accord (les conditions n'en parlent pas, TERMS_VERSION n'en dépend pas) : le
 * bouton dit seulement « J'ai compris », et le rappel revient au plus toutes les REMIND_HOURS heures.
 *
 * Chargé avec la page d'entrée : rien de la carte.
 */
import { h } from './dom';
import { GATE_WAIT_SECONDS, openGate, waitLabel } from './gate';
import { icon } from './icons';
import { STORAGE_PREFIX } from './legal';

export const HUNTING_KEY = `${STORAGE_PREFIX}chasse`;
/** Le rappel vu n'est pas remontré avant ce délai : une fois par sortie, pas à chaque ouverture de la carte. */
const REMIND_HOURS = 12;

export interface HuntingSeason {
  /** Premier dimanche de septembre : l'ouverture générale la plus précoce (article R424-7). */
  opens: Date;
  /** Dernier jour de février de l'année suivante : la clôture générale la plus tardive. */
  closes: Date;
}

/**
 * Période d'ouverture générale de la chasse qui contient ce jour, ou null hors période (de mars au
 * premier dimanche de septembre). Le jour est lu par `getMonth` et `getDate` seulement, comme la
 * saison des champignons : les tests e2e figent le mois.
 */
export function huntingSeason(now = new Date()): HuntingSeason | null {
  const month = now.getMonth(); // 0 = janvier
  if (month > 1 && month < 8) return null; // de mars à août
  const year = month >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const firstSunday = 1 + ((7 - new Date(year, 8, 1).getDay()) % 7);
  if (month === 8 && now.getDate() < firstSunday) return null;
  return { opens: new Date(year, 8, firstSunday), closes: new Date(year + 1, 2, 0) };
}

/** « 6 septembre 2026 », « 1er septembre 2030 ». */
function dayLabel(date: Date): string {
  const rest = date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return `${date.getDate() === 1 ? '1er' : date.getDate()} ${rest}`;
}

/** « du 6 septembre 2026 au 28 février 2027 ». */
export const seasonLabel = (season: HuntingSeason): string => `du ${dayLabel(season.opens)} au ${dayLabel(season.closes)}`;

/** Vrai si le rappel a été vu sur cet appareil il y a moins de REMIND_HOURS heures. */
function seenRecently(now = Date.now()): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(HUNTING_KEY) ?? 'null') as { t?: unknown } | null;
    return typeof saved?.t === 'number' && saved.t <= now + 60_000 && now - saved.t < REMIND_HOURS * 3600 * 1000;
  } catch {
    return false; // stockage indisponible : le rappel revient à chaque visite
  }
}

function remember(): void {
  try {
    localStorage.setItem(HUNTING_KEY, JSON.stringify({ t: Date.now() }));
  } catch {
    /* navigation privée, stockage bloqué : le rappel reviendra à la prochaine visite */
  }
}

/** Rappel à l'écran, pas encore validé : sa promesse, et de quoi le retirer. */
let pending: { promise: Promise<void>; withdraw: () => void } | null = null;
/** Vu pendant cette visite : il ne revient pas à chaque retour sur la carte, même sans stockage. */
let seenThisVisit = false;

/**
 * Retire le rappel en attente sans le tenir pour vu : le visiteur a quitté la carte pour la vue
 * Analytics. Le prochain `showHunting()` le remontre, compte à rebours repris de zéro.
 */
export function withdrawHunting(): void {
  pending?.withdraw();
}

/**
 * Affiche le rappel si la chasse est ouverte et qu'il n'a pas été vu depuis REMIND_HOURS heures ;
 * la promesse se résout quand le visiteur l'a validé (jamais s'il est retiré avant), tout de suite
 * s'il n'y a rien à montrer. Déjà à l'écran : rien de plus.
 */
export function showHunting(): Promise<void> {
  if (pending) return pending.promise;
  const season = huntingSeason();
  if (!season || seenThisVisit || seenRecently()) return Promise.resolve();

  const accept = h('button', { class: 'hunting__accept', type: 'button', disabled: true }, waitLabel(GATE_WAIT_SECONDS));
  const ready = h('p', { class: 'visually-hidden', role: 'status' });
  const body = h(
    'div',
    { class: 'hunting__body', tabindex: '-1' },
    h('p', { id: 'hunting-alert', class: 'hunting__alert' }, h('strong', {}, `ATTENTION : PÉRIODE DE CHASSE ${seasonLabel(season)}`)),
    h(
      'p',
      { class: 'hunting__text' },
      'Même avec des chasubles visibles, certains chasseurs peuvent vous tirer dessus. Ce danger est réel : ne le sous-estimez pas, même pour une bonne omelette.',
    ),
    h(
      'p',
      { class: 'hunting__text' },
      'Pour ',
      h('strong', {}, 'augmenter'),
      ' votre sécurité, allez dans les forêts communales, où les chasseurs sont tenus d’indiquer si une chasse est en cours par des panneaux.',
    ),
  );
  const dialog = h(
    'dialog',
    {
      class: 'hunting',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-labelledby': 'hunting-heading',
      'aria-describedby': 'hunting-alert',
      closedby: 'none',
    },
    h('div', { class: 'hunting__head' }, h('span', { class: 'hunting__icon' }, icon('alert')), h('h2', { id: 'hunting-heading', class: 'hunting__heading' }, 'Sécurité en forêt')),
    body,
    h('div', { class: 'hunting__foot' }, ready, accept),
  );

  let withdraw = (): void => {};
  const promise = new Promise<void>((resolve) => {
    withdraw = openGate({
      dialog,
      body,
      accept,
      acceptLabel: 'J’ai compris',
      ready,
      readyLabel: 'Vous pouvez maintenant continuer.',
      onGone: () => {
        pending = null;
      },
      onAccept: () => {
        seenThisVisit = true;
        remember();
        resolve();
      },
    });
  });
  pending = { promise, withdraw };
  return promise;
}

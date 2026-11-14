/**
 * Avertissement bloquant à l'ouverture de la carte : il reste au moins WAIT_SECONDS secondes avant
 * qu'on puisse l'accepter, et rien d'autre ne le ferme (ni Échap, ni un clic à côté).
 *
 * Il dit en quelques lignes, lisibles pendant le compte à rebours, que la carte aide à choisir où
 * chercher mais n'identifie aucun champignon et ne donne aucun droit de cueillir, et que le visiteur
 * reste responsable de sa cueillette ; tout le détail des conseils est dans « À propos ». Il revient à
 * chaque nouvelle version des conditions (TERMS_VERSION) et au plus tard après 30 jours. Ce n'est
 * jamais une étape qu'on fait défiler : son seul bouton est l'accord, et la présentation de la carte
 * (src/tour.ts) ne vient qu'après, pour qui accepte pour la première fois.
 */
import { h } from './dom';
import { icon } from './icons';
import { ABOUT_URL, STORAGE_PREFIX, TERMS_DATE_LABEL, TERMS_VERSION, TOUR_SINCE } from './legal';

export const DISCLAIMER_KEY = `${STORAGE_PREFIX}avertissement`;
const WAIT_SECONDS = 3;
/** Si le texte ne tient pas dans la fenêtre, le bouton attend qu'on l'ait fait défiler, au plus ce temps-là. */
const MAX_WAIT_SECONDS = 12;
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

/** Vrai si la version actuelle des conditions a été acceptée sur cet appareil il y a moins de 30 jours. */
export function hasAccepted(now = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(DISCLAIMER_KEY);
    const saved = raw ? (JSON.parse(raw) as { v?: unknown; t?: unknown }) : null;
    return (
      saved?.v === TERMS_VERSION &&
      typeof saved.t === 'number' &&
      saved.t <= now + 60_000 &&
      now - saved.t < MAX_AGE_MS
    );
  } catch {
    return false; // stockage indisponible : on redemande à chaque visite
  }
}

/** Date d'acceptation enregistrée sur cet appareil (null s'il n'y en a pas). */
export function acceptedAt(): Date | null {
  try {
    const saved = JSON.parse(localStorage.getItem(DISCLAIMER_KEY) ?? 'null') as { t?: unknown } | null;
    return typeof saved?.t === 'number' ? new Date(saved.t) : null;
  } catch {
    return null;
  }
}

/** Version des conditions de l'accord gardé sur cet appareil (null : aucun, ou stockage indisponible). */
function savedVersion(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(DISCLAIMER_KEY) ?? 'null') as { v?: unknown } | null;
    return typeof saved?.v === 'string' ? saved.v : null;
  } catch {
    return null;
  }
}

/** Enregistre l'accord ; rend faux si le navigateur refuse de le garder. */
function remember(): boolean {
  try {
    localStorage.setItem(DISCLAIMER_KEY, JSON.stringify({ v: TERMS_VERSION, t: Date.now() }));
    return true;
  } catch {
    return false; // navigation privée, stockage bloqué : l'avertissement reviendra à la prochaine visite
  }
}

const point = (lead: string, text: string): HTMLLIElement => h('li', {}, h('strong', {}, lead), ' ', text);

/**
 * Le strict nécessaire, calqué sur les consignes de premier rang de l'Anses (communiqué du 20/10/2026) :
 * ne manger que ce qu'on connaît, faire contrôler au doute, pas d'application, jamais aux jeunes
 * enfants, qui appeler ; plus le droit de cueillir et ce que vaut la carte. Le reste (champignons
 * entiers, panier, espèces séparées, photo, cuisson, numéros) est dans « À propos », à un lien d'ici.
 */
function content(): HTMLElement {
  return h(
    'div',
    { class: 'disclaimer__body', tabindex: '-1' },
    h(
      'div',
      { id: 'disclaimer-intro' },
      h('p', { class: 'disclaimer__lead' }, 'Cette carte aide à choisir où chercher.'),
      h('p', { class: 'disclaimer__key' }, 'Elle n’identifie aucun champignon et ne donne aucun droit de cueillir.'),
    ),
    h(
      'ul',
      { class: 'disclaimer__rules' },
      point(
        'Manger :',
        'certains champignons sont mortels. Seulement ce que vous connaissez parfaitement ; au moindre doute, pharmacien ou association de mycologie, pas une application. Jamais aux jeunes enfants.',
      ),
      point('Cueillir :', 'il faut l’accord du propriétaire, en forêt privée comme publique.'),
      point('Malaise après un repas de champignons :', 'appelez aussitôt le 15 ou un centre antipoison.'),
    ),
    h('p', { class: 'disclaimer__own' }, 'Tout ici est estimation, sans garantie : vous restez seul responsable de votre cueillette.'),
  );
}

/** Avertissement à l'écran, pas encore accepté : sa promesse, et de quoi le retirer. */
let pending: { promise: Promise<boolean>; withdraw: () => void } | null = null;
/** Accepté pendant cette visite : il ne revient pas à chaque retour sur la carte, même sans stockage. */
let acceptedThisVisit = false;

/**
 * Retire l'avertissement en attente sans l'accepter : le visiteur a quitté la carte pour la vue
 * Analytics. Le prochain `showDisclaimer()` le remontre, compte à rebours repris de zéro.
 */
export function withdrawDisclaimer(): void {
  pending?.withdraw();
}

/**
 * Affiche l'avertissement s'il n'a pas encore été accepté (ou toujours, avec `force`) ; la promesse
 * se résout quand le visiteur l'accepte (jamais s'il est retiré avant). Déjà à l'écran : rien de plus.
 * Elle vaut vrai si c'est un premier accord : aucun n'était gardé sur l'appareil, ou seulement celui
 * d'une version d'avant la refonte de l'interface (TOUR_SINCE). Sans accord à donner : faux.
 */
export function showDisclaimer(force = false): Promise<boolean> {
  if (pending) return pending.promise;
  if (!force && (acceptedThisVisit || hasAccepted())) return Promise.resolve(false);

  const accept = h('button', { class: 'disclaimer__accept', type: 'button', disabled: true }, `Lisez d’abord… ${WAIT_SECONDS}`);
  // Les lecteurs d'écran n'apprenaient pas que le bouton était devenu actif : on le leur dit, une fois.
  const ready = h('p', { class: 'visually-hidden', role: 'status' });
  const body = content();
  const dialog = h(
    'dialog',
    {
      class: 'disclaimer',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-labelledby': 'disclaimer-heading',
      'aria-describedby': 'disclaimer-intro',
      closedby: 'none',
    },
    h(
      'div',
      { class: 'disclaimer__head' },
      h('span', { class: 'disclaimer__icon' }, icon('alert')),
      h('h2', { id: 'disclaimer-heading', class: 'disclaimer__heading' }, 'Avant de partir en forêt'),
    ),
    body,
    h(
      'div',
      { class: 'disclaimer__foot' },
      h(
        'div',
        { class: 'disclaimer__terms' },
        h('p', {}, `En acceptant, vous approuvez les conditions d’utilisation (version du ${TERMS_DATE_LABEL}).`),
        h(
          'p',
          { class: 'disclaimer__links' },
          h('a', { href: `${ABOUT_URL}#conditions` }, 'Conditions'),
          h('a', { href: `${ABOUT_URL}#identifier` }, 'Tous les conseils'),
        ),
      ),
      ready,
      accept,
    ),
  );

  let withdraw = (): void => {};
  const promise = new Promise<boolean>((resolve) => {
    let done = false; // accepté ou retiré : ne plus le rouvrir
    const app = document.getElementById('app');
    const open = (): void => {
      if (dialog.open) return;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else {
        // Très vieux navigateur sans <dialog> modal : on fige la carte nous-mêmes.
        dialog.setAttribute('open', '');
        if (app) app.inert = true;
      }
    };
    // `done` d'abord : l'événement « close » arrive après coup, et ne doit pas rouvrir la fenêtre.
    const dismiss = (): void => {
      done = true;
      pending = null;
      if (dialog.open) dialog.close(); // (un très vieux navigateur n'a ni `open` ni `close()`)
      dialog.remove();
      if (app) app.inert = false;
    };
    // Rien d'autre que le bouton ne ferme l'avertissement : Échap est ignoré, et s'il se ferme
    // quand même (double Échap sur certains navigateurs), il se rouvre aussitôt.
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.addEventListener('close', () => {
      if (!done) open();
    });
    document.body.append(dialog);
    open();
    dialog.dataset['ouvert'] = String(Date.now()); // instants lus par les tests de bout en bout
    body.focus({ preventScroll: true });

    // Compte à rebours sur l'horloge (et non en additionnant des minuteries, qui prennent du retard
    // pendant le chargement de la carte). Il part quand l'avertissement est vraiment à l'écran : deux
    // images après l'ouverture, donc après un éventuel blocage du chargement, et seulement quand
    // l'onglet est visible.
    let started = 0;
    const tick = (): void => {
      if (done) return;
      const left = Math.ceil((WAIT_SECONDS * 1000 - (Date.now() - started)) / 1000);
      if (left > 0) {
        accept.textContent = `Lisez d’abord… ${left}`;
        window.setTimeout(tick, 200);
        return;
      }
      // Petit écran ou police agrandie : si le texte ne tient pas dans la fenêtre, le bouton attend
      // qu'on l'ait fait défiler jusqu'en bas (au plus MAX_WAIT_SECONDS, pour ne bloquer personne).
      const unread = body.scrollHeight - body.clientHeight - body.scrollTop > 8;
      if (unread && Date.now() - started < MAX_WAIT_SECONDS * 1000) {
        accept.textContent = 'Lisez jusqu’en bas…';
        window.setTimeout(tick, 200);
        return;
      }
      accept.disabled = false;
      accept.textContent = 'J’ai compris et j’accepte';
      ready.textContent = 'Vous pouvez maintenant accepter.';
      dialog.dataset['actif'] = String(Date.now());
    };
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        started = Date.now();
        dialog.dataset['debut'] = String(started);
        tick();
      }),
    );

    accept.addEventListener('click', () => {
      if (accept.disabled) return;
      // Premier accord sur cet appareil (ou premier depuis la refonte) : lu avant de l'enregistrer.
      const before = savedVersion();
      acceptedThisVisit = true;
      // Sans stockage, on ne saurait jamais que la présentation a été vue : elle reviendrait à chaque
      // visite. Elle n'est donc montrée d'office que si l'accord a pu être gardé (elle reste dans la légende).
      const kept = remember();
      dismiss();
      resolve(kept && (before === null || before < TOUR_SINCE));
    });
    withdraw = dismiss;
  });
  pending = { promise, withdraw };
  return promise;
}

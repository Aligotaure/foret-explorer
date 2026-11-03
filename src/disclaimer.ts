/**
 * Avertissement bloquant à l'ouverture de la carte : il reste au moins WAIT_SECONDS secondes avant
 * qu'on puisse l'accepter, et rien d'autre ne le ferme (ni Échap, ni un clic à côté).
 *
 * Il rappelle que la carte aide à choisir où chercher, mais n'identifie aucun champignon et ne
 * donne aucun droit de cueillir, et que le visiteur reste responsable de sa cueillette. Il revient
 * à chaque nouvelle version des conditions (TERMS_VERSION) et au plus tard après 30 jours.
 */
import { h } from './dom';
import { icon } from './icons';
import { ABOUT_URL, STORAGE_PREFIX, TERMS_DATE_LABEL, TERMS_VERSION } from './legal';

export const DISCLAIMER_KEY = `${STORAGE_PREFIX}avertissement`;
const WAIT_SECONDS = 3;
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

function remember(): void {
  try {
    localStorage.setItem(DISCLAIMER_KEY, JSON.stringify({ v: TERMS_VERSION, t: Date.now() }));
  } catch {
    /* navigation privée : l'avertissement reviendra à la prochaine visite */
  }
}

const point = (lead: string, text: string): HTMLLIElement => h('li', {}, h('strong', {}, lead), ' ', text);

function content(): HTMLElement {
  return h(
    'div',
    { class: 'disclaimer__body', tabindex: '-1' },
    h(
      'p',
      { id: 'disclaimer-intro', class: 'disclaimer__intro' },
      h('strong', {}, 'Forêt Explorer est une carte personnelle, gratuite et expérimentale.'),
      ' Elle aide à choisir où chercher. Elle ne dit jamais si un champignon se mange, ni si vous avez le droit de le cueillir : ',
      h('strong', {}, 'vous restez seul responsable de votre cueillette.'),
    ),
    h('h3', { class: 'disclaimer__title' }, 'Identifier votre cueillette'),
    h(
      'ul',
      { class: 'disclaimer__list' },
      point(
        'Ne mangez que ce que vous connaissez parfaitement.',
        'Au moindre doute, faites contrôler toute la récolte par un pharmacien ou une association de mycologie avant de la cuisiner.',
      ),
      point(
        'Cueillez des champignons entiers',
        '(pied et chapeau) et en bon état ; séparez les espèces dans un panier, jamais dans un sac en plastique.',
      ),
      point('Une application, une photo ou cette carte ne suffisent pas', 'pour identifier un champignon.'),
      point('Photographiez la récolte avant de la cuisiner,', 'et ne donnez jamais de champignons cueillis à de jeunes enfants.'),
      point(
        'Malaise après un repas de champignons ?',
        'Vomissements, diarrhée, vertiges, troubles de la vue… : appelez aussitôt un centre antipoison (Lyon : 04 72 11 69 11) ou le 15.',
      ),
    ),
    h('h3', { class: 'disclaimer__title' }, 'Où vous avez le droit de cueillir'),
    h(
      'p',
      {},
      h('strong', {}, 'Une forêt sur la carte ne donne aucun droit.'),
      ' Les champignons appartiennent au propriétaire du terrain : sans son accord, la cueillette est sanctionnée, en forêt privée comme publique. Réserves naturelles, arrêtés, quantités limitées : renseignez-vous avant de partir. En période de chasse, portez une couleur vive.',
    ),
    h('h3', { class: 'disclaimer__title' }, 'Responsabilité'),
    h(
      'p',
      {},
      'Forêts, sols, météo, zones protégées et indice de pousse sont des estimations, parfois anciennes ou fausses, fournies sans garantie. ',
      h('strong', {}, 'Vous restez seul responsable de vos sorties, de votre cueillette et de ce que vous mangez.'),
      ' Dans les limites permises par la loi, l’éditeur ne peut être tenu responsable d’une intoxication, d’un accident, d’une perte ou d’une infraction liés à l’utilisation du site.',
    ),
  );
}

/**
 * Affiche l'avertissement s'il n'a pas encore été accepté (ou toujours, avec `force`) ; la promesse
 * se résout quand le visiteur l'accepte.
 */
export function showDisclaimer(force = false): Promise<void> {
  if (!force && hasAccepted()) return Promise.resolve();

  const accept = h('button', { class: 'disclaimer__accept', type: 'button', disabled: true }, `Lisez d’abord… ${WAIT_SECONDS}`);
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
        'p',
        { class: 'disclaimer__terms' },
        `En continuant, vous acceptez les conditions d’utilisation (version du ${TERMS_DATE_LABEL}). `,
        h('a', { href: `${ABOUT_URL}#conditions` }, 'Conditions, mentions légales et confidentialité'),
      ),
      accept,
    ),
  );

  return new Promise((resolve) => {
    let accepted = false;
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
    // Rien d'autre que le bouton ne ferme l'avertissement : Échap est ignoré, et s'il se ferme
    // quand même (double Échap sur certains navigateurs), il se rouvre aussitôt.
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.addEventListener('close', () => {
      if (!accepted) open();
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
      const left = Math.ceil((WAIT_SECONDS * 1000 - (Date.now() - started)) / 1000);
      if (left > 0) {
        accept.textContent = `Lisez d’abord… ${left}`;
        window.setTimeout(tick, 200);
        return;
      }
      accept.disabled = false;
      accept.textContent = 'J’ai compris et j’accepte';
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
      accepted = true;
      remember();
      dialog.close();
      dialog.remove();
      if (app) app.inert = false;
      resolve();
    });
  });
}

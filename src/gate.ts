/**
 * Fenêtre bloquante à compte à rebours : la mécanique commune à l'avertissement (src/disclaimer.ts)
 * et à l'écran « période de chasse » (src/hunting.ts). Chacun fournit sa fenêtre, son texte et son
 * bouton ; ici, ce qui la rend bloquante : ni Échap ni un clic à côté ne la ferment, et son bouton
 * ne répond qu'après GATE_WAIT_SECONDS secondes d'affichage.
 *
 * Chargé avec la page d'entrée : rien de la carte.
 */

/** Durée pendant laquelle le bouton reste bloqué, comptée depuis l'affichage réel de la fenêtre. */
export const GATE_WAIT_SECONDS = 3;
/** Si le texte ne tient pas dans la fenêtre, le bouton attend qu'on l'ait fait défiler, au plus ce temps-là. */
const MAX_WAIT_SECONDS = 12;

/** Texte du bouton pendant le compte à rebours. */
export const waitLabel = (seconds: number): string => `Lisez d’abord… ${seconds}`;

export interface GateParts {
  dialog: HTMLDialogElement;
  /** Le texte à lire : il reçoit le clavier, et c'est lui qui défile sur petit écran. */
  body: HTMLElement;
  /** Le seul bouton, créé bloqué (`disabled`) avec `waitLabel(GATE_WAIT_SECONDS)`. */
  accept: HTMLButtonElement;
  /** Texte du bouton une fois le compte à rebours fini. */
  acceptLabel: string;
  /** Élément `role="status"` et ce qu'il annonce aux lecteurs d'écran quand le bouton devient actif. */
  ready: HTMLElement;
  readyLabel: string;
  /** La fenêtre a quitté l'écran, acceptée ou retirée. */
  onGone: () => void;
  /** Le visiteur a appuyé sur le bouton (la fenêtre est déjà fermée). */
  onAccept: () => void;
}

/** Ouvre la fenêtre et lance son compte à rebours ; rend de quoi la retirer sans qu'elle soit acceptée. */
export function openGate(parts: GateParts): () => void {
  const { dialog, body, accept, ready } = parts;
  let done = false; // acceptée ou retirée : ne plus la rouvrir
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
    if (done) return;
    done = true;
    parts.onGone();
    if (dialog.open) dialog.close(); // (un très vieux navigateur n'a ni `open` ni `close()`)
    dialog.remove();
    if (app) app.inert = false;
  };
  // Rien d'autre que le bouton ne ferme la fenêtre : Échap est ignoré, et si elle se ferme quand
  // même (double Échap sur certains navigateurs), elle se rouvre aussitôt.
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.addEventListener('close', () => {
    if (!done) open();
  });
  document.body.append(dialog);
  open();
  dialog.dataset['ouvert'] = String(Date.now()); // instants lus par les tests de bout en bout
  body.focus({ preventScroll: true });

  // Compte à rebours sur l'horloge (et non en additionnant des minuteries, qui prennent du retard
  // pendant le chargement de la carte). Il part quand la fenêtre est vraiment à l'écran : deux
  // images après l'ouverture, donc après un éventuel blocage du chargement, et seulement quand
  // l'onglet est visible.
  let started = 0;
  const tick = (): void => {
    if (done) return;
    const left = Math.ceil((GATE_WAIT_SECONDS * 1000 - (Date.now() - started)) / 1000);
    if (left > 0) {
      accept.textContent = waitLabel(left);
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
    accept.textContent = parts.acceptLabel;
    ready.textContent = parts.readyLabel;
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
    if (accept.disabled || done) return;
    dismiss();
    parts.onAccept();
  });
  return dismiss;
}

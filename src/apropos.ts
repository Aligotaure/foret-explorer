/**
 * Page « À propos » : date des conditions, état de la mesure de consommation sur cet appareil, liste
 * de ce que le site garde dans le navigateur et bouton « Effacer mes données ».
 */
import './apropos.css';
import { METRICS_URL } from './config';
import { acceptedAt } from './disclaimer';
import { h } from './dom';
import { TERMS_DATE_LABEL, clearStoredData, storedEntries } from './legal';

const LABELS: Readonly<Record<string, string>> = {
  'foret-explorer:v1': 'Vos réglages (types de forêt, champignon, fond de carte, couches affichées)',
  'foret-explorer:avertissement': 'Acceptation de l’avertissement',
  'foret-explorer:meteo': 'Météo du jour demandée directement à Open-Meteo (secours)',
  'foret-explorer:vue': 'Dernière vue de la carte (lieu et zoom)',
  'foret-explorer:altitudes': 'Altitudes des carrés de 500 m déjà vus',
  'foret-explorer:releves': 'Forêts et sols des carrés de 500 m déjà vus',
};

const size = (bytes: number): string =>
  bytes < 1024 ? `${bytes} o` : `${(bytes / 1024).toLocaleString('fr-FR', { maximumFractionDigits: bytes < 10240 ? 1 : 0 })} Ko`;

for (const el of document.querySelectorAll('[data-terms-date]')) el.textContent = TERMS_DATE_LABEL;

const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
const metricsState = document.querySelector('[data-metrics-state]');
if (metricsState) {
  metricsState.textContent = !METRICS_URL
    ? 'désactivée (aucun serveur de mesure configuré)'
    : gpc
      ? 'désactivée (signal Global Privacy Control reçu)'
      : 'activée';
}

const list = document.querySelector('[data-stored-list]');
const button = document.querySelector<HTMLButtonElement>('[data-clear]');
const status = document.querySelector('[data-clear-status]');

function renderStored(): void {
  if (!list) return;
  const entries = storedEntries();
  if (!entries.length) {
    list.replaceChildren(h('li', {}, 'Rien pour le moment.'));
    if (button) button.disabled = true;
    return;
  }
  const accepted = acceptedAt();
  list.replaceChildren(
    ...entries.map((e) => {
      let label = LABELS[e.key] ?? e.key;
      if (e.key === 'foret-explorer:avertissement' && accepted) {
        label += `, le ${accepted.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
      }
      return h('li', {}, label, h('span', { class: 'muted' }, ` · ${size(e.bytes)}`));
    }),
  );
  if (button) button.disabled = false;
}

// Deux temps : un premier appui demande confirmation, le second efface.
let armed: number | undefined;
button?.addEventListener('click', () => {
  if (armed === undefined) {
    button.textContent = 'Confirmer : tout effacer';
    button.classList.add('btn--danger');
    if (status) status.textContent = 'Appuyez encore pour confirmer.';
    armed = window.setTimeout(() => {
      armed = undefined;
      button.textContent = 'Effacer mes données';
      button.classList.remove('btn--danger');
      if (status) status.textContent = '';
    }, 6000);
    return;
  }
  window.clearTimeout(armed);
  armed = undefined;
  const n = clearStoredData();
  button.textContent = 'Effacer mes données';
  button.classList.remove('btn--danger');
  if (status) {
    status.textContent = n
      ? `${n} élément${n > 1 ? 's' : ''} effacé${n > 1 ? 's' : ''}. L’avertissement s’affichera de nouveau à l’ouverture de la carte.`
      : 'Rien à effacer.';
  }
  renderStored();
});

renderStored();

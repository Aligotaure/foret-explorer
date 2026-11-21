/**
 * « Me localiser » qui échoue : une fenêtre dit pourquoi (refus, GPS éteint, navigateur intégré à une
 * application) et quoi régler, selon l'appareil. Aucun lien ne peut ouvrir les réglages du téléphone
 * depuis une page web (iOS et Android le refusent aux sites) : on donne donc le chemin, pas à pas.
 */
import { h, toast } from './dom';

/** Pourquoi la position manque : refus (navigateur ou téléphone), position indisponible. */
export type LocateFailure = 'denied' | 'unavailable';

export interface Device {
  ios: boolean;
  android: boolean;
  /** Navigateur intégré à une application (LinkedIn, Instagram…) : il ne donne pas la position. */
  inApp: boolean;
  /** Nom du navigateur à citer dans les réglages. */
  browser: string;
}

export function detectDevice(ua: string = navigator.userAgent, touchPoints: number = navigator.maxTouchPoints): Device {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  const android = /Android/.test(ua);
  const inApp = /LinkedInApp|FBAN|FBAV|FB_IAB|Instagram|Snapchat|Twitter|TikTok|musical_ly|Pinterest|MicroMessenger|Line\/|GSA\/|; wv\)/.test(ua);
  const browser = /CriOS|Chrome/.test(ua) && !/SamsungBrowser|Edg/.test(ua)
    ? 'Chrome'
    : /FxiOS|Firefox/.test(ua)
      ? 'Firefox'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Edg/.test(ua)
          ? 'Edge'
          : ios || /Safari/.test(ua)
            ? 'Safari'
            : 'votre navigateur';
  return { ios, android, inApp, browser };
}

export interface LocateHelp {
  title: string;
  lead: string;
  steps: string[];
  /** Lien qui rouvre la page dans le vrai navigateur du téléphone (navigateur intégré seulement). */
  open?: { label: string; href: string };
}

/** Ce qu'il faut régler, selon la panne et l'appareil. */
export function locateHelp(failure: LocateFailure, device: Device, url: URL = new URL(window.location.href)): LocateHelp {
  const retry = 'Revenez ici et touchez « Réessayer ».';
  if (device.inApp) {
    const target = device.ios ? 'Safari' : 'Chrome';
    return {
      title: 'Position bloquée par l’application',
      lead: 'Vous êtes dans le navigateur intégré d’une application (LinkedIn, Instagram, Messenger…). Il ne donne pas la position aux sites.',
      steps: [
        'Ouvrez le menu de ce navigateur (⋯ ou ⋮, en haut de l’écran).',
        `Choisissez « Ouvrir dans ${target} » ou « Ouvrir dans le navigateur ».`,
        `Dans ${target}, touchez de nouveau « Me localiser » et acceptez la demande.`,
      ],
      open: device.ios
        ? { label: 'Ouvrir dans Safari', href: `x-safari-${url.href}` }
        : device.android
          ? { label: 'Ouvrir dans Chrome', href: `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;end` }
          : undefined,
    };
  }
  if (failure === 'unavailable') {
    return {
      title: 'Position introuvable',
      lead: 'L’appareil n’a pas pu donner sa position : localisation éteinte, mode avion ou pas de signal.',
      steps: [
        device.ios
          ? 'Réglages de l’iPhone → Confidentialité et sécurité → Service de localisation : activé.'
          : device.android
            ? 'Allumez la localisation du téléphone (volet des réglages rapides, icône « Position »).'
            : 'Vérifiez que l’ordinateur partage sa position et qu’il est connecté (Wi-Fi).',
        'Sortez ou approchez-vous d’une fenêtre, et attendez quelques secondes.',
        retry,
      ],
    };
  }
  if (device.ios) {
    const app = device.browser === 'Safari' ? 'Sites web Safari' : device.browser;
    return {
      title: 'Position refusée',
      lead: `L’iPhone ou ${device.browser} refuse de donner la position à cette page.`,
      steps: [
        'Réglages de l’iPhone → Confidentialité et sécurité → Service de localisation : activé.',
        `Dans la même liste, « ${app} » : choisissez « Lorsque l’app est active ».`,
        device.browser === 'Safari'
          ? 'Sur cette page, touchez le bouton à gauche de l’adresse (« aA » ou l’icône de page) → « Réglages du site web » → Position → « Autoriser ».'
          : `Rouvrez ${device.browser} et acceptez la demande de position.`,
        retry,
      ],
    };
  }
  if (device.android) {
    return {
      title: 'Position refusée',
      lead: `Le téléphone ou ${device.browser} refuse de donner la position à cette page.`,
      steps: [
        'Touchez l’icône à gauche de l’adresse (cadenas ou curseurs) → Autorisations → Position → « Autoriser ».',
        `Si « Position » n’y figure pas : Paramètres du téléphone → Applications → ${device.browser} → Autorisations → Position.`,
        'Vérifiez que la localisation du téléphone est allumée (volet des réglages rapides).',
        retry,
      ],
    };
  }
  return {
    title: 'Position refusée',
    lead: `${device.browser === 'votre navigateur' ? 'Le navigateur' : device.browser} refuse de donner la position à cette page.`,
    steps: [
      'Cliquez sur l’icône à gauche de l’adresse → Position (ou Localisation) → « Autoriser ».',
      'Vérifiez que l’ordinateur partage sa position : Windows, Paramètres → Confidentialité et sécurité → Localisation ; Mac, Réglages Système → Confidentialité et sécurité → Service de localisation.',
      'Cliquez sur « Réessayer ».',
    ],
  };
}

let current: HTMLDialogElement | null = null;

/** Ouvre la fenêtre d'aide ; `retry` relance la localisation. Elle se ferme d'un Échap ou d'un clic à côté. */
export function showLocateHelp(failure: LocateFailure, retry: () => void, device: Device = detectDevice()): void {
  current?.remove();
  const help = locateHelp(failure, device);
  const close = h('button', { class: 'geo-help__btn geo-help__btn--quiet', type: 'button' }, 'Fermer');
  const again = h('button', { class: 'geo-help__btn', type: 'button' }, 'Réessayer');
  const copy = h('button', { class: 'geo-help__btn geo-help__btn--quiet', type: 'button' }, 'Copier le lien');
  const dialog = h(
    'dialog',
    { class: 'geo-help', 'aria-labelledby': 'geo-help-title' },
  );
  // Le contenu dans une boîte : un clic sur la fenêtre elle-même est alors un clic sur le fond.
  const box = h(
    'div',
    { class: 'geo-help__box' },
    h('h2', { class: 'geo-help__title', id: 'geo-help-title' }, help.title),
    h('p', { class: 'geo-help__lead' }, help.lead),
    h('ol', { class: 'geo-help__steps' }, ...help.steps.map((s) => h('li', {}, s))),
    h('p', { class: 'geo-help__note' }, 'Aucun lien ne peut ouvrir ces réglages à votre place : les téléphones le refusent aux pages web.'),
    h(
      'div',
      { class: 'geo-help__foot' },
      ...(help.open ? [h('a', { class: 'geo-help__btn', href: help.open.href }, help.open.label), copy] : []),
      ...(device.inApp ? [] : [again]),
      close,
    ),
  );
  dialog.append(box);
  const dismiss = (): void => {
    if (dialog.open) dialog.close();
    dialog.remove();
    if (current === dialog) current = null;
  };
  close.addEventListener('click', dismiss);
  again.addEventListener('click', () => {
    dismiss();
    retry();
  });
  copy.addEventListener('click', () => {
    const link = window.location.href;
    void (navigator.clipboard?.writeText(link) ?? Promise.reject(new Error('presse-papiers')))
      .then(() => toast('Lien copié : collez-le dans votre navigateur'))
      .catch(() => toast(link, 8000));
  });
  // Clic sur le fond assombri (la fenêtre elle-même, hors de son contenu).
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss();
  });
  dialog.addEventListener('close', dismiss);
  document.body.append(dialog);
  current = dialog;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

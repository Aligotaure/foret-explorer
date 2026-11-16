/**
 * Conditions d'utilisation : version en vigueur, page « À propos » et données gardées sur l'appareil.
 *
 * Changer TERMS_VERSION quand le texte de l'avertissement ou des conditions change : la carte
 * redemande alors l'accord de chaque visiteur.
 */
export const TERMS_VERSION = '2026-11-14';
export const TERMS_DATE_LABEL = '14 novembre 2026';

/**
 * Jour de la refonte de l'interface (AAAA-MM-JJ, comme TERMS_VERSION) : qui n'a jamais accepté, ou a
 * accepté une version plus ancienne, voit une fois « La carte en 3 gestes » après son accord
 * (src/disclaimer.ts, src/tour.ts). Ne change pas avec les conditions suivantes.
 */
export const TOUR_SINCE = '2026-11-14';

/**
 * Mot de l'adresse qui fait d'un lien un lien « vitrine » (`…/?analytics`), donné aux prospects de
 * l'éditeur : lui seul montre l'îlot « Carte / Analytics » et ouvre la vue Analytics. Les visiteurs
 * venus par l'adresse ordinaire ne voient que la carte. Ce n'est pas un verrou : le mot se lit dans le
 * code, qui est public. Le script en tête d'index.html applique la même règle avant le premier
 * affichage : changer le mot aux deux endroits.
 */
export const SHOWCASE_PARAM = 'analytics';

/**
 * L'adresse de cette page porte le mot (`?analytics`, `?analytics=1`, `?utm_source=x&analytics`…).
 * Lu une fois, à l'ouverture : rien dans la page ne change la partie `?` de l'adresse (MapLibre et
 * src/view.ts n'écrivent que ce qui suit le `#`, et le formulaire de recherche n'est jamais envoyé
 * par le navigateur : src/main.ts), donc l'îlot ne disparaît pas en cours de visite.
 */
export const SHOWCASE = typeof location !== 'undefined' && new RegExp(`[?&]${SHOWCASE_PARAM}(?:[=&]|$)`).test(location.search);

/**
 * Page « À propos » (conditions, mentions légales, confidentialité), à côté de index.html. Un lien
 * « vitrine » y garde son mot, que « Retour à la carte » rend à la carte (src/apropos.ts).
 */
export const ABOUT_URL = SHOWCASE ? `a-propos.html?${SHOWCASE_PARAM}` : 'a-propos.html';

/** Dépôt du projet : contact de l'éditeur (onglet « Issues »). */
export const REPO_URL = 'https://github.com/Aligotaure/foret-explorer';

/** Préfixe de toutes les clés localStorage du site (réglages, caches, avertissement accepté). */
export const STORAGE_PREFIX = 'foret-explorer:';

/** Clés du site présentes dans ce navigateur, avec leur taille approximative (octets). */
export function storedEntries(): { key: string; bytes: number }[] {
  const out: { key: string; bytes: number }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      out.push({ key, bytes: (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2 });
    }
  } catch {
    /* stockage indisponible : rien n'est gardé */
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Efface tout ce que le site garde dans ce navigateur. Renvoie le nombre de clés supprimées. */
export function clearStoredData(): number {
  const keys = storedEntries().map((e) => e.key);
  try {
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    return 0;
  }
  return keys.length;
}

/**
 * Conditions d'utilisation : version en vigueur, page « À propos » et données gardées sur l'appareil.
 *
 * Changer TERMS_VERSION quand le texte de l'avertissement ou des conditions change : la carte
 * redemande alors l'accord de chaque visiteur.
 */
export const TERMS_VERSION = '2026-11-03';
export const TERMS_DATE_LABEL = '3 novembre 2026';

/** Page « À propos » (conditions, mentions légales, confidentialité), à côté de index.html. */
export const ABOUT_URL = 'a-propos.html';

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

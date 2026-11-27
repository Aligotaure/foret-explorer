/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresse du serveur de mesure (ex. https://foret-explorer-mesures.xxx.workers.dev), fournie au build. */
  readonly VITE_METRICS_URL?: string;
  /** Clé du projet PostHog (cloud UE), fournie au build ; absente : aucune mesure d'usage (src/tracking.ts). */
  readonly VITE_POSTHOG_KEY?: string;
}

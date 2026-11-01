/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresse du serveur de mesure (ex. https://foret-explorer-mesures.xxx.workers.dev), fournie au build. */
  readonly VITE_METRICS_URL?: string;
}

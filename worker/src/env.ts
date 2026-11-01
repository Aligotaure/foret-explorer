/** Liaisons et secrets du Worker (wrangler.toml + `wrangler secret put`). */
export interface Env {
  /** Base des compteurs : un seul Durable Object (SQLite) nommé « global ». */
  STORE: DurableObjectNamespace;
  /** Origines autorisées à envoyer des compteurs, séparées par des virgules. */
  ALLOWED_ORIGINS?: string;
  /** Mot de passe du tableau de bord (secret). */
  ADMIN_PASSWORD?: string;
  /** Chemin secret du tableau de bord, sans barre oblique (secret). */
  ADMIN_PATH?: string;
}

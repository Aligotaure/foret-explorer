/**
 * Accès au tableau de bord : chemin secret + mot de passe vérifié ici, jamais dans la page.
 * Après connexion, un cookie signé (HMAC) garde la session 30 jours ; changer le mot de passe
 * ou le chemin invalide toutes les sessions.
 */
import type { Env } from './env.ts';

const enc = new TextEncoder();
const COOKIE = 'fe_admin';
const SESSION_DAYS = 30;
export const MIN_PASSWORD = 12;
const MIN_PATH = 12;

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/** Comparaison en temps constant de deux empreintes de même longueur. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

function toBase64Url(buffer: ArrayBuffer): string {
  let text = '';
  for (const b of new Uint8Array(buffer)) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Chemin du tableau de bord (« /xxxx »), ou null si le secret est absent ou trop court. */
export function adminBase(env: Env): string | null {
  const path = (env.ADMIN_PATH ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (path.length < MIN_PATH || !/^[A-Za-z0-9_-]+$/.test(path)) return null;
  return `/${path}`;
}

export const passwordConfigured = (env: Env): boolean => (env.ADMIN_PASSWORD ?? '').length >= MIN_PASSWORD;

export async function checkPassword(candidate: string, env: Env): Promise<boolean> {
  if (!passwordConfigured(env)) return false;
  const [given, expected] = await Promise.all([sha256(`mdp|${candidate}`), sha256(`mdp|${env.ADMIN_PASSWORD ?? ''}`)]);
  return sameBytes(given, expected);
}

async function sessionKey(env: Env): Promise<CryptoKey> {
  const raw = await sha256(`session|${env.ADMIN_PASSWORD ?? ''}|${env.ADMIN_PATH ?? ''}`);
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function sessionCookie(env: Env, base: string): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86_400;
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(env), enc.encode(`v1.${expires}`));
  return `${COOKIE}=${expires}.${toBase64Url(signature)}; Path=${base}; Max-Age=${SESSION_DAYS * 86_400}; HttpOnly; Secure; SameSite=Strict`;
}

export const clearedCookie = (base: string): string => `${COOKIE}=; Path=${base}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export async function hasSession(request: Request, env: Env): Promise<boolean> {
  if (!passwordConfigured(env)) return false;
  const value = readCookie(request, COOKIE);
  if (!value) return false;
  const [expiresText = '', signatureText = ''] = value.split('.');
  const expires = Number(expiresText);
  if (!Number.isInteger(expires) || expires * 1000 < Date.now()) return false;
  const signature = fromBase64Url(signatureText);
  if (!signature) return false;
  return crypto.subtle.verify('HMAC', await sessionKey(env), signature, enc.encode(`v1.${expires}`));
}

/**
 * Clé de limitation des essais : empreinte de l'adresse IP, salée par le jour et le chemin secret.
 * L'adresse elle-même n'est jamais enregistrée.
 */
export async function attemptKey(request: Request, env: Env, day: string): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'inconnue';
  return hex(await sha256(`essai|${day}|${env.ADMIN_PATH ?? ''}|${ip}`)).slice(0, 24);
}

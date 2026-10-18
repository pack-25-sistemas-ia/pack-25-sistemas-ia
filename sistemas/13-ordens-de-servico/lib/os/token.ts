// Link de acompanhamento do cliente. O token é uma CREDENCIAL: 32 bytes aleatórios (256 bits), gerados aqui, no servidor.
// O banco guarda SÓ o sha256 (hex). O token em texto aparece uma única vez, para quem o gerou; nunca vai para logs.
import { createHash, createHmac, randomBytes } from 'node:crypto';

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export const isTokenShape = (v: unknown): v is string => typeof v === 'string' && TOKEN_RE.test(v);

/** Identificador anônimo da ORIGEM (IP) para o limite de abuso: HMAC com sal do servidor; o IP puro nunca é guardado. */
export function sourceKey(ip: string, salt: string): string {
  return createHmac('sha256', salt).update(`os-source-v1:${ip}`).digest('hex').slice(0, 32);
}

export function linkSalt(env: Record<string, string | undefined> = process.env): string {
  const s = env.OS_LINK_SALT ?? '';
  if (s.length < 32) throw new Error('OS_LINK_SALT ausente ou curto demais (mínimo de 32 caracteres)');
  return s;
}

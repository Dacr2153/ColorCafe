/**
 * auth/passwords.ts — Hash y verificación de contraseñas con argon2id.
 *
 * Política:
 *  - argon2id (resistente a GPU y side-channel)
 *  - timeCost=3, memoryCost=65536 (64 MiB), parallelism=4
 *  - validación de fortaleza: ≥10 chars, mayúscula + minúscula + dígito + símbolo
 */
import argon2 from 'argon2';
import { errors } from '../../core/errors.js';

const ARGON2_OPTS = {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 65_536,
  parallelism: 4,
} as const;

const STRENGTH_RE = {
  lower: /[a-z]/,
  upper: /[A-Z]/,
  digit: /\d/,
  symbol: /[^A-Za-z0-9]/,
};

export function validatePasswordStrength(password: string): void {
  if (typeof password !== 'string' || password.length < 10) {
    throw errors.badRequest('password_too_short', { min: 10 });
  }
  if (password.length > 128) {
    throw errors.badRequest('password_too_long', { max: 128 });
  }
  const missing: string[] = [];
  if (!STRENGTH_RE.lower.test(password)) missing.push('lowercase');
  if (!STRENGTH_RE.upper.test(password)) missing.push('uppercase');
  if (!STRENGTH_RE.digit.test(password)) missing.push('digit');
  if (!STRENGTH_RE.symbol.test(password)) missing.push('symbol');
  if (missing.length) throw errors.badRequest('password_weak', { missing });
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

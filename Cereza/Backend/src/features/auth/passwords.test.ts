/**
 * Tests de hashing y validación de contraseñas.
 *
 * Garantías que NO podemos sacrificar:
 *  - Una contraseña débil debe ser rechazada antes de tocar la DB.
 *  - El hash es no-determinista (salt aleatorio): mismo password → distinto hash.
 *  - `verifyPassword` devuelve `false` sin lanzar cuando el hash es inválido
 *    (importante para mitigar enumeración de usuarios en login).
 */
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, validatePasswordStrength } from './passwords.js';

describe('password strength', () => {
  it('acepta contraseña robusta', () => {
    expect(() => validatePasswordStrength('Cafe!2025Robusto')).not.toThrow();
  });
  it('rechaza demasiado corta', () => {
    expect(() => validatePasswordStrength('Ab1!')).toThrow();
  });
  it('rechaza sin símbolo', () => {
    expect(() => validatePasswordStrength('Abcdefgh12')).toThrow();
  });
  it('rechaza sin mayúscula', () => {
    expect(() => validatePasswordStrength('abcdefgh1!')).toThrow();
  });
  it('rechaza > 128 chars', () => {
    expect(() => validatePasswordStrength('A1!' + 'a'.repeat(200))).toThrow();
  });
});

describe('password hashing (argon2id)', () => {
  it('produce hashes únicos por sal aleatoria', async () => {
    const h1 = await hashPassword('Cafe!2025Robusto');
    const h2 = await hashPassword('Cafe!2025Robusto');
    expect(h1).not.toBe(h2);
    expect(h1.startsWith('$argon2id$')).toBe(true);
  }, 15_000);

  it('verifyPassword acepta correcta y rechaza incorrecta', async () => {
    const hash = await hashPassword('Cafe!2025Robusto');
    expect(await verifyPassword(hash, 'Cafe!2025Robusto')).toBe(true);
    expect(await verifyPassword(hash, 'otraClave!9X')).toBe(false);
  }, 15_000);

  it('verifyPassword no lanza con hash inválido', async () => {
    expect(await verifyPassword('hash-corrupto', 'cualquiera')).toBe(false);
  });
});

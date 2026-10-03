import { InvalidValueError } from './domain-error';
import { passwordHash } from './password-hash';

describe('passwordHash', () => {
  describe('when the value starts with $argon2id$', () => {
    it('returns it', () => {
      expect(passwordHash('$argon2id$v=19$abc')).toBe('$argon2id$v=19$abc');
    });
  });

  describe('when the value does not start with $argon2id$', () => {
    it('throws password_hash_invalid', () => {
      expect(() => passwordHash('plain-password')).toThrow(InvalidValueError);
      expect(() => passwordHash('plain-password')).toThrow('password_hash_invalid');
    });
  });

  describe('when a plain string is used where PasswordHash is required', () => {
    it('is rejected by the type checker', () => {
      // @ts-expect-error a plain string is not PasswordHash
      const hash: ReturnType<typeof passwordHash> = 'x';

      expect(hash).toBe('x');
    });
  });
});

import { InvalidValueError } from './domain-error';
import { normalizeEmail } from './email';

describe('normalizeEmail', () => {
  describe('when the email is already normalised', () => {
    it('returns it unchanged', () => {
      expect(normalizeEmail('brand@example.com')).toBe('brand@example.com');
    });
  });

  describe('when the email has mixed case', () => {
    it('lowercases it', () => {
      expect(normalizeEmail('Jamie@Example.COM')).toBe('jamie@example.com');
    });
  });

  describe('when the email has surrounding whitespace', () => {
    it('trims it', () => {
      expect(normalizeEmail('  jamie@example.com ')).toBe('jamie@example.com');
    });
  });

  describe('when a plain string is used where NormalizedEmail is required', () => {
    it('is rejected by the type checker', () => {
      // @ts-expect-error a plain string is not NormalizedEmail
      const email: ReturnType<typeof normalizeEmail> = 'a@b.c';

      expect(email).toBe('a@b.c');
    });
  });

  describe.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['missing @', 'jamie.example.com'],
    ['two @', 'a@b@example.com'],
    ['empty local part', '@example.com'],
    ['empty domain', 'jamie@'],
    ['domain without a dot', 'jamie@localhost'],
    ['consecutive dots in domain', 'jamie@example..com'],
    ['trailing dot in domain', 'jamie@example.com.'],
    ['internal whitespace', 'ja mie@example.com'],
    ['longer than 254 characters', `${'a'.repeat(250)}@example.com`],
  ])('when the email is %s', (_label, raw) => {
    it('throws email_invalid', () => {
      expect(() => normalizeEmail(raw)).toThrow(InvalidValueError);
      expect(() => normalizeEmail(raw)).toThrow('email_invalid');
    });
  });

  describe('when the email has plus tags and dots in the local part', () => {
    it('keeps them untouched', () => {
      expect(normalizeEmail('Ja.Mie+Hyrox@Example.com')).toBe('ja.mie+hyrox@example.com');
    });
  });
});

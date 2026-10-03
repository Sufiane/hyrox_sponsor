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
});

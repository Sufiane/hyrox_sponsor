import { validateLogin, validateSignup } from './validation.ts';

const VALID_SIGNUP = {
  name: 'Ada',
  email: 'ada@example.com',
  password: 'longenough1',
  confirmPassword: 'longenough1',
  adultAttested: true,
};

describe('validateSignup', () => {
  describe('when everything is valid', () => {
    it('returns no errors', () => {
      expect(validateSignup(VALID_SIGNUP)).toEqual({});
    });
  });

  describe('name', () => {
    it.each(['', '   ', 'a'.repeat(101)])('rejects %j', (name) => {
      expect(validateSignup({ ...VALID_SIGNUP, name })).toHaveProperty('name');
    });

    it('accepts 100 characters', () => {
      expect(validateSignup({ ...VALID_SIGNUP, name: 'a'.repeat(100) })).not.toHaveProperty('name');
    });
  });

  describe('email', () => {
    it('rejects a malformed address', () => {
      expect(validateSignup({ ...VALID_SIGNUP, email: 'a' })).toHaveProperty('email');
    });
  });

  describe('password length', () => {
    it('rejects 9 characters', () => {
      const password = 'a'.repeat(9);

      expect(
        validateSignup({ ...VALID_SIGNUP, password, confirmPassword: password }),
      ).toHaveProperty('password');
    });

    it('accepts 10 characters', () => {
      const password = 'a'.repeat(10);

      expect(
        validateSignup({ ...VALID_SIGNUP, password, confirmPassword: password }),
      ).not.toHaveProperty('password');
    });

    it('rejects 129 characters', () => {
      const password = 'a'.repeat(129);

      expect(
        validateSignup({ ...VALID_SIGNUP, password, confirmPassword: password }),
      ).toHaveProperty('password');
    });
  });

  describe('confirm password', () => {
    describe('when it differs', () => {
      it('reports a mismatch', () => {
        expect(validateSignup({ ...VALID_SIGNUP, confirmPassword: 'different1' })).toEqual({
          confirmPassword: 'Passwords do not match.',
        });
      });
    });

    describe('when it is empty', () => {
      it('reports a mismatch', () => {
        expect(validateSignup({ ...VALID_SIGNUP, confirmPassword: '' })).toHaveProperty(
          'confirmPassword',
          'Passwords do not match.',
        );
      });
    });
  });

  describe('adult attestation', () => {
    it('is required', () => {
      expect(validateSignup({ ...VALID_SIGNUP, adultAttested: false })).toHaveProperty(
        'adultAttested',
      );
    });
  });
});

describe('validateLogin', () => {
  describe('when both fields are filled', () => {
    it('returns no errors', () => {
      expect(validateLogin({ email: 'a@b.co', password: 'x' })).toEqual({});
    });
  });

  describe('when fields are empty', () => {
    it('flags email and password', () => {
      expect(Object.keys(validateLogin({ email: '', password: '' }))).toEqual([
        'email',
        'password',
      ]);
    });
  });
});

import { InvalidValueError } from '../common/domain-error';
import { assertPasswordLength } from './password-policy';

describe('assertPasswordLength', () => {
  describe('when the password has 9 characters', () => {
    it('throws password_length_invalid', () => {
      expect(() => assertPasswordLength('a'.repeat(9))).toThrow(InvalidValueError);
      expect(() => assertPasswordLength('a'.repeat(9))).toThrow('password_length_invalid');
    });
  });

  describe('when the password has 10 characters', () => {
    it('passes', () => {
      expect(() => assertPasswordLength('a'.repeat(10))).not.toThrow();
    });
  });

  describe('when the password has 128 characters', () => {
    it('passes', () => {
      expect(() => assertPasswordLength('a'.repeat(128))).not.toThrow();
    });
  });

  describe('when the password has 129 characters', () => {
    it('throws password_length_invalid', () => {
      expect(() => assertPasswordLength('a'.repeat(129))).toThrow('password_length_invalid');
    });
  });
});

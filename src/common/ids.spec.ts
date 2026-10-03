import { InvalidValueError } from './domain-error';
import { athleteId } from './ids';

describe('athleteId', () => {
  describe('when the value is a non-blank string', () => {
    it('returns the trimmed value', () => {
      expect(athleteId('  ath_1 ')).toBe('ath_1');
    });
  });

  describe('when the value is blank', () => {
    it('throws an InvalidValueError', () => {
      expect(() => athleteId('   ')).toThrow(InvalidValueError);
      expect(() => athleteId('   ')).toThrow('athlete_id_invalid');
    });
  });

  describe('when the value is longer than 64 characters', () => {
    it('throws', () => {
      expect(() => athleteId('a'.repeat(65))).toThrow('athlete_id_invalid');
    });
  });
});

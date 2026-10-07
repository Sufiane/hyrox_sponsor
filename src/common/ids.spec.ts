import { InvalidValueError } from './domain-error';
import { athleteId, raceEntryId, staffId } from './ids';

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

describe('raceEntryId', () => {
  describe('when the value is a non-blank string', () => {
    it('returns the trimmed value', () => {
      expect(raceEntryId('  id_1 ')).toBe('id_1');
    });
  });

  describe('when the value is blank', () => {
    it('throws an InvalidValueError', () => {
      expect(() => raceEntryId('   ')).toThrow(InvalidValueError);
      expect(() => raceEntryId('   ')).toThrow('race_entry_id_invalid');
    });
  });

  describe('when the value is longer than 64 characters', () => {
    it('throws', () => {
      expect(() => raceEntryId('a'.repeat(65))).toThrow('race_entry_id_invalid');
    });
  });
});

describe('staffId', () => {
  describe('when the value is a non-blank string', () => {
    it('returns the trimmed value', () => {
      expect(staffId('  id_1 ')).toBe('id_1');
    });
  });

  describe('when the value is blank', () => {
    it('throws an InvalidValueError', () => {
      expect(() => staffId('   ')).toThrow(InvalidValueError);
      expect(() => staffId('   ')).toThrow('staff_id_invalid');
    });
  });

  describe('when the value is longer than 64 characters', () => {
    it('throws', () => {
      expect(() => staffId('a'.repeat(65))).toThrow('staff_id_invalid');
    });
  });
});

import { raceNameKey } from './race-name-key';

describe('raceNameKey', () => {
  describe('when the name has mixed case', () => {
    it('lowercases it', () => {
      expect(raceNameKey('Hyrox CHICAGO')).toBe('hyrox_chicago');
    });
  });

  describe('when the name has surrounding whitespace', () => {
    it('trims it', () => {
      expect(raceNameKey('  Hyrox Chicago  ')).toBe('hyrox_chicago');
    });
  });

  describe('when the name has repeated inner whitespace', () => {
    it('collapses it to a single underscore', () => {
      expect(raceNameKey('Hyrox \t  Chicago')).toBe('hyrox_chicago');
    });
  });

  describe('when the name has punctuation', () => {
    it('keeps it', () => {
      expect(raceNameKey('Hyrox: Chicago, IL')).toBe('hyrox:_chicago,_il');
    });
  });

  describe('when two names differ only by case and spacing', () => {
    it('produces the same key', () => {
      expect(raceNameKey(' HYROX  chicago')).toBe(raceNameKey('hyrox Chicago '));
    });
  });
});

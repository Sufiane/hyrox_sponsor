import { divisionLabel } from './division-label.ts';
import { DIVISION_CODES } from './results-types.ts';

describe('divisionLabel', () => {
  it('labels every division code', () => {
    for (const code of DIVISION_CODES) {
      expect(divisionLabel(code)).not.toBe(code);
    }
  });

  it('labels a known code', () => {
    expect(divisionLabel('DOUBLES_OPEN_MIXED')).toBe('Doubles Open Mixed');
  });

  describe('when the code is unknown', () => {
    it('returns the raw code', () => {
      expect(divisionLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    });
  });
});

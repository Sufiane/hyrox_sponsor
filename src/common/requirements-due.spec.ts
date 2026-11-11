import { parseRequirementsDue } from './requirements-due';

describe('parseRequirementsDue', () => {
  describe('when the value is an array of strings', () => {
    it('returns it', () => {
      expect(parseRequirementsDue(['external_account', 'individual.email'])).toEqual([
        'external_account',
        'individual.email',
      ]);
    });
  });

  describe('when the value is an empty array', () => {
    it('returns an empty array', () => {
      expect(parseRequirementsDue([])).toEqual([]);
    });
  });

  describe.each([
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
    ['a string', 'x'],
    ['an array of numbers', [1, 2]],
    ['a mixed array', ['a', 1]],
  ])('when the value is %s', (_label, value) => {
    it('returns null', () => {
      expect(parseRequirementsDue(value)).toBeNull();
    });
  });
});

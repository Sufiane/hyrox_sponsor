import { displayName } from './display-name';

describe('displayName', () => {
  it.each([
    ['Jane Doe', 'Jane D.'],
    ['Jane', 'Jane'],
    ['Jane Marie van Dijk', 'Jane D.'],
    ['  Jane    Doe  ', 'Jane D.'],
    ['jane doe', 'jane D.'],
    ['Zoë Émile', 'Zoë É.'],
    ['Anna 李', 'Anna 李.'],
    ['Jane \u{1F600}Doe', 'Jane \u{1F600}.'],
  ])('formats %j as %j', (input, expected) => {
    expect(displayName(input)).toBe(expected);
  });

  describe('when the name is blank', () => {
    it.each(['', '   ', '\n\t'])('falls back to Athlete for %j', (input) => {
      expect(displayName(input)).toBe('Athlete');
    });
  });
});

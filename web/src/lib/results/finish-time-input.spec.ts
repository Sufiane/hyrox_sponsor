import { toTotalSeconds } from './finish-time-input.ts';

describe('toTotalSeconds', () => {
  describe('when the parts are valid', () => {
    it('returns total seconds', () => {
      expect(toTotalSeconds({ hours: '1', minutes: '2', seconds: '5' })).toEqual({
        ok: true,
        value: 3_725,
      });
    });

    it('treats blank parts as zero', () => {
      expect(toTotalSeconds({ hours: '', minutes: '45', seconds: '' })).toEqual({
        ok: true,
        value: 2_700,
      });
    });

    it('accepts the bounds', () => {
      expect(toTotalSeconds({ hours: '0', minutes: '30', seconds: '0' })).toMatchObject({
        ok: true,
      });
      expect(toTotalSeconds({ hours: '6', minutes: '0', seconds: '0' })).toMatchObject({
        ok: true,
      });
    });
  });

  describe('when a part is out of range', () => {
    it.each([
      ['hours', { hours: '7', minutes: '0', seconds: '0' }],
      ['minutes', { hours: '1', minutes: '60', seconds: '0' }],
      ['seconds', { hours: '1', minutes: '0', seconds: '60' }],
    ])('rejects %s', (_name, parts) => {
      expect(toTotalSeconds(parts)).toMatchObject({ ok: false });
    });
  });

  describe('when a part is not a whole number', () => {
    it.each(['-1', '1.5', 'abc', '1e1'])('rejects %s', (bad) => {
      expect(toTotalSeconds({ hours: '1', minutes: bad, seconds: '0' })).toMatchObject({
        ok: false,
      });
    });
  });

  describe('when the total is outside backend bounds', () => {
    it('rejects under 30 minutes', () => {
      expect(toTotalSeconds({ hours: '0', minutes: '29', seconds: '59' })).toMatchObject({
        ok: false,
      });
    });

    it('rejects over 6 hours', () => {
      expect(toTotalSeconds({ hours: '6', minutes: '0', seconds: '1' })).toMatchObject({
        ok: false,
      });
    });
  });
});

import { InvalidValueError } from '../common/domain-error';
import type { RaceId } from '../common/ids';
import { decodeRaceCursor, encodeRaceCursor } from './race-cursor';

const cursor = { date: new Date('2026-09-01T10:00:00.000Z'), id: 'race1' as RaceId };

describe('race cursor', () => {
  describe('when a cursor is encoded and decoded', () => {
    it('round-trips', () => {
      expect(decodeRaceCursor(encodeRaceCursor(cursor))).toEqual(cursor);
    });
  });

  describe('when the cursor is garbage', () => {
    it.each([
      '',
      '!!!',
      Buffer.from('not json').toString('base64url'),
      Buffer.from('{"date":"nope","id":"x"}').toString('base64url'),
      Buffer.from('{"date":"2026-09-01T10:00:00Z"}').toString('base64url'),
      Buffer.from('{"date":1,"id":"x"}').toString('base64url'),
      Buffer.from(`{"date":"2026-09-01T10:00:00Z","id":"${'a'.repeat(65)}"}`).toString('base64url'),
    ])('throws cursor_invalid for %j', (raw) => {
      expect(() => decodeRaceCursor(raw)).toThrow(InvalidValueError);
      expect(() => decodeRaceCursor(raw)).toThrow('cursor_invalid');
    });
  });
});

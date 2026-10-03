import { toPublicAthlete } from './public-athlete';
import type { AthleteRecord } from './athlete.service';

describe('toPublicAthlete', () => {
  describe('when the record carries private fields', () => {
    it('returns only id, name, email and isAdult', () => {
      const record = {
        id: 'athlete-1',
        name: 'Jamie Lee',
        email: 'jamie@example.com',
        isAdult: true,
        passwordHash: '$argon2id$x',
        trustScore: 50,
        isBanned: false,
        stripeConnectAccountId: 'acct_1',
      } as AthleteRecord;

      expect(Object.keys(toPublicAthlete(record)).sort()).toEqual(['email', 'id', 'isAdult', 'name']);
    });
  });
});

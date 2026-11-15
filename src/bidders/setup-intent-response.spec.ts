import type { BidderToken } from '../common/bidder-token';
import { toSetupIntentResponse } from './setup-intent-response';

describe('toSetupIntentResponse', () => {
  describe('when mapping a result', () => {
    it('returns the secret, token and ISO expiry only', () => {
      const result = {
        clientSecret: 'seti_secret',
        bidderToken: 'signed.token' as BidderToken,
        bidderTokenExpiresAt: new Date('2026-11-16T12:00:00.000Z'),
        bidderId: 'bidder-1',
      };

      const response = toSetupIntentResponse(result);

      expect(response).toEqual({
        clientSecret: 'seti_secret',
        bidderToken: 'signed.token',
        bidderTokenExpiresAt: '2026-11-16T12:00:00.000Z',
      });
    });
  });
});

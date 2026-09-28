import { DisputeService } from './dispute.service.js';
import { DisputeDb } from './dispute.db.js';

describe('DisputeService', () => {
  describe('hasOpenDispute', () => {
    describe('when an OPEN dispute exists for the auction', () => {
      it('returns true', async () => {
        const db = {
          findOpenForAuction: vi.fn().mockResolvedValue({ id: 'dispute-1', status: 'OPEN' }),
        } as unknown as DisputeDb;
        const service = new DisputeService(db);

        const result = await service.hasOpenDispute('auction-1');

        expect(result).toBe(true);
      });
    });

    describe('when no OPEN dispute exists for the auction', () => {
      it('returns false', async () => {
        const db = { findOpenForAuction: vi.fn().mockResolvedValue(null) } as unknown as DisputeDb;
        const service = new DisputeService(db);

        const result = await service.hasOpenDispute('auction-1');

        expect(result).toBe(false);
      });
    });
  });
});

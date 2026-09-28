import { BidService } from './bid.service.js';
import { BidDb } from './bid.db.js';

describe('BidService', () => {
  describe('getLeadingBid', () => {
    describe('when a leading bid exists', () => {
      it('returns it', async () => {
        const bid = { id: 'bid-1', status: 'LEADING' };
        const db = { findLeadingForAuction: vi.fn().mockResolvedValue(bid) } as unknown as BidDb;
        const service = new BidService(db);

        const result = await service.getLeadingBid('auction-1');

        expect(result).toEqual(bid);
      });
    });

    describe('when no leading bid exists', () => {
      it('returns null', async () => {
        const db = {
          findLeadingForAuction: vi.fn().mockResolvedValue(null),
        } as unknown as BidDb;
        const service = new BidService(db);

        const result = await service.getLeadingBid('auction-1');

        expect(result).toBeNull();
      });
    });
  });
});

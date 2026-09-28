import { BidderService } from './bidder.service.js';
import { BidderDb } from './bidder.db.js';

describe('BidderService', () => {
  describe('getOrCreateByEmail', () => {
    it('delegates to the db upsert and returns the bidder', async () => {
      const bidder = { id: 'bidder-1', email: 'brand@example.com' };
      const db = { upsertByEmail: vi.fn().mockResolvedValue(bidder) } as unknown as BidderDb;
      const service = new BidderService(db);

      const result = await service.getOrCreateByEmail('brand@example.com');

      expect(db.upsertByEmail).toHaveBeenCalledWith('brand@example.com');
      expect(result).toEqual(bidder);
    });
  });
});

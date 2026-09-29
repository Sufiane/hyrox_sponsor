import { BidderService } from './bidder.service.js';
import { BidderDb } from './bidder.db.js';

describe('BidderService', () => {
  describe('getOrCreateByEmail', () => {
    describe('when the email is already normalised', () => {
      it('upserts it unchanged and returns the bidder', async () => {
        const bidder = { id: 'bidder-1', email: 'brand@example.com' };
        const db = { upsertByEmail: vi.fn().mockResolvedValue(bidder) } as unknown as BidderDb;
        const service = new BidderService(db);

        const result = await service.getOrCreateByEmail('brand@example.com');

        expect(db.upsertByEmail).toHaveBeenCalledWith('brand@example.com');
        expect(result).toEqual(bidder);
      });
    });

    describe('when the email has mixed case and surrounding whitespace', () => {
      it('upserts the trimmed lowercase email', async () => {
        const db = { upsertByEmail: vi.fn().mockResolvedValue({}) } as unknown as BidderDb;
        const service = new BidderService(db);

        await service.getOrCreateByEmail('  Jamie@Example.COM ');

        expect(db.upsertByEmail).toHaveBeenCalledWith('jamie@example.com');
      });
    });
  });
});

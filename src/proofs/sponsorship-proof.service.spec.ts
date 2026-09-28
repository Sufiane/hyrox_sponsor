import { SponsorshipProofService } from './sponsorship-proof.service.js';
import { SponsorshipProofDb } from './sponsorship-proof.db.js';

describe('SponsorshipProofService', () => {
  describe('getByAuctionId', () => {
    describe('when a proof has been submitted', () => {
      it('returns it', async () => {
        const proof = { id: 'proof-1', auctionId: 'auction-1' };
        const db = { findByAuctionId: vi.fn().mockResolvedValue(proof) } as unknown as SponsorshipProofDb;
        const service = new SponsorshipProofService(db);

        const result = await service.getByAuctionId('auction-1');

        expect(result).toEqual(proof);
      });
    });

    describe('when no proof has been submitted', () => {
      it('returns null', async () => {
        const db = { findByAuctionId: vi.fn().mockResolvedValue(null) } as unknown as SponsorshipProofDb;
        const service = new SponsorshipProofService(db);

        const result = await service.getByAuctionId('auction-1');

        expect(result).toBeNull();
      });
    });
  });
});

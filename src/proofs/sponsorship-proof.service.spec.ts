import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { SponsorshipProofService } from './sponsorship-proof.service';
import { SponsorshipProofDb } from './sponsorship-proof.db';
import type { AuctionId } from '../common/ids';

describe('SponsorshipProofService', () => {
  let db: DeepMockProxy<SponsorshipProofDb>;
  let service: SponsorshipProofService;

  beforeEach(async () => {
    db = mockDeep<SponsorshipProofDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [SponsorshipProofService, { provide: SponsorshipProofDb, useValue: db }],
    }).compile();
    service = moduleRef.get(SponsorshipProofService);
  });

  describe('getByAuctionId', () => {
    describe('when a proof has been submitted', () => {
      const proof = { id: 'proof-1', auctionId: 'auction-1' };

      beforeEach(() => {
        db.findByAuctionId.mockResolvedValue(proof as never);
      });

      it('returns it', async () => {
        const result = await service.getByAuctionId('auction-1' as AuctionId);

        expect(result).toEqual(proof);
      });
    });

    describe('when no proof has been submitted', () => {
      beforeEach(() => {
        db.findByAuctionId.mockResolvedValue(null);
      });

      it('returns null', async () => {
        const result = await service.getByAuctionId('auction-1' as AuctionId);

        expect(result).toBeNull();
      });
    });
  });
});

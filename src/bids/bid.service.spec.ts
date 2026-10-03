import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { BidService } from './bid.service';
import { BidDb } from './bid.db';
import type { AuctionId } from '../common/ids';

describe('BidService', () => {
  let db: DeepMockProxy<BidDb>;
  let service: BidService;

  beforeEach(async () => {
    db = mockDeep<BidDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [BidService, { provide: BidDb, useValue: db }],
    }).compile();
    service = moduleRef.get(BidService);
  });

  describe('getLeadingBid', () => {
    describe('when a leading bid exists', () => {
      const bid = { id: 'bid-1', status: 'LEADING' };

      beforeEach(() => {
        db.findLeadingForAuction.mockResolvedValue(bid as never);
      });

      it('returns it', async () => {
        const result = await service.getLeadingBid('auction-1' as AuctionId);

        expect(result).toEqual(bid);
      });
    });

    describe('when no leading bid exists', () => {
      beforeEach(() => {
        db.findLeadingForAuction.mockResolvedValue(null);
      });

      it('returns null', async () => {
        const result = await service.getLeadingBid('auction-1' as AuctionId);

        expect(result).toBeNull();
      });
    });
  });
});

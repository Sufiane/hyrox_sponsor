import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { BidService } from './bid.service';
import { BidDb } from './bid.db';
import type { NormalizedEmail } from '../common/email';
import type { AuctionId } from '../common/ids';
import { cents } from '../common/money';
import { PlaceBidUsecase, type PlaceBidInput } from './usecases/place-bid/place-bid.usecase';

describe('BidService', () => {
  let db: DeepMockProxy<BidDb>;
  let usecase: DeepMockProxy<PlaceBidUsecase>;
  let service: BidService;

  beforeEach(async () => {
    db = mockDeep<BidDb>();
    usecase = mockDeep<PlaceBidUsecase>();
    const moduleRef = await Test.createTestingModule({
      providers: [BidService, { provide: BidDb, useValue: db }, { provide: PlaceBidUsecase, useValue: usecase }],
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

  describe('placeBid', () => {
    const input: PlaceBidInput = {
      auctionId: 'auction-1' as AuctionId,
      email: 'brand@example.com' as NormalizedEmail,
      amountCents: cents(5500),
    };

    it('delegates to the usecase and returns its result', async () => {
      const result = { bid: { id: 'bid-1' }, previousLeader: null };
      usecase.execute.mockResolvedValue(result as never);

      const actual = await service.placeBid(input);

      expect(actual).toBe(result);
      expect(usecase.execute).toHaveBeenCalledWith(input);
    });
  });
});

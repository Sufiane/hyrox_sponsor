import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { DisputeService } from './dispute.service';
import { DisputeDb } from './dispute.db';
import type { AuctionId } from '../common/ids';

describe('DisputeService', () => {
  let db: DeepMockProxy<DisputeDb>;
  let service: DisputeService;

  beforeEach(async () => {
    db = mockDeep<DisputeDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [DisputeService, { provide: DisputeDb, useValue: db }],
    }).compile();
    service = moduleRef.get(DisputeService);
  });

  describe('hasOpenDispute', () => {
    describe('when an OPEN dispute exists for the auction', () => {
      beforeEach(() => {
        db.findOpenForAuction.mockResolvedValue({ id: 'dispute-1', status: 'OPEN' } as never);
      });

      it('returns true', async () => {
        const result = await service.hasOpenDispute('auction-1' as AuctionId);

        expect(result).toBe(true);
      });
    });

    describe('when an ARBITRATION dispute exists for the auction', () => {
      beforeEach(() => {
        db.findOpenForAuction.mockResolvedValue({ id: 'dispute-2', status: 'ARBITRATION' } as never);
      });

      it('returns true', async () => {
        const result = await service.hasOpenDispute('auction-1' as AuctionId);

        expect(result).toBe(true);
      });
    });

    describe('when no open dispute exists for the auction', () => {
      beforeEach(() => {
        db.findOpenForAuction.mockResolvedValue(null);
      });

      it('returns false', async () => {
        const result = await service.hasOpenDispute('auction-1' as AuctionId);

        expect(result).toBe(false);
      });
    });
  });
});

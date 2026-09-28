import { NotFoundException } from '@nestjs/common';
import { AuctionService } from './auction.service.js';
import { AuctionDb } from './auction.db.js';

describe('AuctionService', () => {
  describe('getById', () => {
    describe('when the auction exists', () => {
      it('returns the auction', async () => {
        const auction = { id: 'auction-1', zone: 'LEFT_PEC' };
        const db = { findById: vi.fn().mockResolvedValue(auction) } as unknown as AuctionDb;
        const service = new AuctionService(db);

        const result = await service.getById('auction-1');

        expect(result).toEqual(auction);
      });
    });

    describe('when the auction does not exist', () => {
      it('throws NotFoundException', async () => {
        const db = { findById: vi.fn().mockResolvedValue(null) } as unknown as AuctionDb;
        const service = new AuctionService(db);

        await expect(service.getById('missing')).rejects.toThrow(NotFoundException);
      });
    });
  });
});

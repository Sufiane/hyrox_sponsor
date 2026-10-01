import { Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { AuctionService } from './auction.service.js';
import { AuctionDb } from './auction.db.js';
import type { AuctionId } from '../common/ids.js';

describe('AuctionService', () => {
  let db: DeepMockProxy<AuctionDb>;
  let service: AuctionService;

  beforeEach(async () => {
    db = mockDeep<AuctionDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [AuctionService, { provide: AuctionDb, useValue: db }],
    }).compile();
    service = moduleRef.get(AuctionService);
  });

  describe('getById', () => {
    describe('when the auction exists', () => {
      const auction = { id: 'auction-1', zone: 'LEFT_PEC' };

      beforeEach(() => {
        db.findById.mockResolvedValue(auction as never);
      });

      it('returns the auction', async () => {
        const result = await service.getById('auction-1' as AuctionId);

        expect(result).toEqual(auction);
      });
    });

    describe('when the auction does not exist', () => {
      let warn: MockInstance;

      beforeEach(() => {
        db.findById.mockResolvedValue(null);
        warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      });

      afterEach(() => {
        warn.mockRestore();
      });

      it('throws NotFoundException', async () => {
        await expect(service.getById('missing' as AuctionId)).rejects.toThrow(NotFoundException);
      });

      it('throws the auction_not_found code', async () => {
        await expect(service.getById('missing' as AuctionId)).rejects.toThrow('auction_not_found');
      });

      it('logs the missing id', async () => {
        await service.getById('missing' as AuctionId).catch(() => undefined);

        expect(warn).toHaveBeenCalledWith('Auction missing not found');
      });
    });
  });
});

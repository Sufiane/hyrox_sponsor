import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { AuctionId } from '../../../common/ids';
import { BATCH_SIZE } from '../../process-in-batches';
import { CloseAuctionsUsecase } from './close-auctions.usecase';
import { CloseAuctionsUsecaseDb, type DueToClose } from './close-auctions.usecase.db';

const now = new Date('2026-11-09T06:00:00Z');
const raceDate = new Date('2026-11-14T15:00:00Z');

function due(auctionId: string): DueToClose {
  return { auctionId: auctionId as AuctionId, raceDate };
}

describe('CloseAuctionsUsecase', () => {
  let db: DeepMockProxy<CloseAuctionsUsecaseDb>;
  let usecase: CloseAuctionsUsecase;
  let error: MockInstance;

  beforeEach(async () => {
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    db = mockDeep<CloseAuctionsUsecaseDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [CloseAuctionsUsecase, { provide: CloseAuctionsUsecaseDb, useValue: db }],
    }).compile();
    usecase = moduleRef.get(CloseAuctionsUsecase);
  });

  afterEach(() => {
    error.mockRestore();
  });

  describe('when one auction has a winner and another has none', () => {
    beforeEach(() => {
      db.findDue.mockResolvedValueOnce([due('auction-1'), due('auction-2')]);
      db.closeAuction.mockResolvedValueOnce('won').mockResolvedValueOnce('no_sale');
    });

    it('returns both totals', async () => {
      const totals = await usecase.execute(now);

      expect(totals).toEqual({ won: 1, noSale: 1 });
    });

    it('passes now and the proof deadline 48 hours after the race', async () => {
      await usecase.execute(now);

      expect(db.closeAuction).toHaveBeenCalledWith('auction-1', now, new Date('2026-11-16T15:00:00Z'));
    });
  });

  describe('when the auction was already closed', () => {
    beforeEach(() => {
      db.findDue.mockResolvedValueOnce([due('auction-1')]);
      db.closeAuction.mockResolvedValue('already_closed');
    });

    it('counts it in neither total', async () => {
      const totals = await usecase.execute(now);

      expect(totals).toEqual({ won: 0, noSale: 0 });
    });
  });

  describe('when closing one auction throws', () => {
    beforeEach(() => {
      db.findDue.mockResolvedValueOnce([due('auction-1'), due('auction-2')]);
      db.closeAuction.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('won');
    });

    it('still closes the next auction', async () => {
      const totals = await usecase.execute(now);

      expect(totals).toEqual({ won: 1, noSale: 0 });
    });

    it('logs the failure', async () => {
      await usecase.execute(now);

      expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });
  });

  describe('when the first page is full', () => {
    beforeEach(() => {
      const fullPage = Array.from({ length: BATCH_SIZE }, (_, index) => due(`auction-${index}`));
      db.findDue.mockResolvedValueOnce(fullPage).mockResolvedValueOnce([]);
      db.closeAuction.mockResolvedValue('no_sale');
    });

    it('fetches the next page after the last auction id', async () => {
      await usecase.execute(now);

      expect(db.findDue).toHaveBeenNthCalledWith(2, now, `auction-${BATCH_SIZE - 1}`, BATCH_SIZE);
    });
  });
});

import { Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type MockInstance } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { AuctionService } from './auction.service';
import { AuctionDb } from './auction.db';
import type { AuctionId } from '../common/ids';
import { CloseAuctionsUsecase } from './usecases/close-auctions/close-auctions.usecase';
import { MaterializeAuctionsUsecase } from './usecases/materialize-auctions/materialize-auctions.usecase';
import { OpenAuctionsUsecase } from './usecases/open-auctions/open-auctions.usecase';

describe('AuctionService', () => {
  let db: DeepMockProxy<AuctionDb>;
  let materialize: DeepMockProxy<MaterializeAuctionsUsecase>;
  let open: DeepMockProxy<OpenAuctionsUsecase>;
  let close: DeepMockProxy<CloseAuctionsUsecase>;
  let service: AuctionService;

  beforeEach(async () => {
    db = mockDeep<AuctionDb>();
    materialize = mockDeep<MaterializeAuctionsUsecase>();
    open = mockDeep<OpenAuctionsUsecase>();
    close = mockDeep<CloseAuctionsUsecase>();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuctionService,
        { provide: AuctionDb, useValue: db },
        { provide: MaterializeAuctionsUsecase, useValue: materialize },
        { provide: OpenAuctionsUsecase, useValue: open },
        { provide: CloseAuctionsUsecase, useValue: close },
      ],
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

  describe('runLifecycleTick', () => {
    const now = new Date('2026-11-05T12:00:00Z');
    let error: MockInstance;

    beforeEach(() => {
      error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      materialize.execute.mockResolvedValue(9);
      open.execute.mockResolvedValue(9);
      close.execute.mockResolvedValue({ won: 1, noSale: 2 });
    });

    afterEach(() => {
      error.mockRestore();
    });

    describe('when all phases succeed', () => {
      it('aggregates the counts', async () => {
        const result = await service.runLifecycleTick(now);

        expect(result).toEqual({ materialized: 9, opened: 9, closedWithWinner: 1, closedNoSale: 2 });
      });

      it('passes the same now to each phase', async () => {
        await service.runLifecycleTick(now);

        expect(materialize.execute).toHaveBeenCalledWith(now);
        expect(open.execute).toHaveBeenCalledWith(now);
        expect(close.execute).toHaveBeenCalledWith(now);
      });

      it('runs materialize before open', async () => {
        await service.runLifecycleTick(now);

        expect(materialize.execute.mock.invocationCallOrder[0]).toBeLessThan(open.execute.mock.invocationCallOrder[0]);
      });

      it('starts close without waiting for materialize', async () => {
        materialize.execute.mockReturnValue(new Promise(() => undefined));

        void service.runLifecycleTick(now);
        await Promise.resolve();

        expect(close.execute).toHaveBeenCalledWith(now);
      });
    });

    describe('when the materialize phase rejects', () => {
      beforeEach(() => {
        materialize.execute.mockRejectedValue(new Error('boom'));
      });

      it('reports zero materialized and still runs the other phases', async () => {
        const result = await service.runLifecycleTick(now);

        expect(result).toEqual({ materialized: 0, opened: 9, closedWithWinner: 1, closedNoSale: 2 });
      });

      it('logs the failure', async () => {
        await service.runLifecycleTick(now);

        expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
      });
    });

    describe('when the open phase rejects', () => {
      beforeEach(() => {
        open.execute.mockRejectedValue(new Error('boom'));
      });

      it('reports zero opened and still runs close', async () => {
        const result = await service.runLifecycleTick(now);

        expect(result).toEqual({ materialized: 9, opened: 0, closedWithWinner: 1, closedNoSale: 2 });
      });
    });

    describe('when the close phase rejects', () => {
      beforeEach(() => {
        close.execute.mockRejectedValue(new Error('boom'));
      });

      it('reports zero closed', async () => {
        const result = await service.runLifecycleTick(now);

        expect(result).toEqual({ materialized: 9, opened: 9, closedWithWinner: 0, closedNoSale: 0 });
      });
    });
  });
});

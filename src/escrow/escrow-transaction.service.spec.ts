import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { EscrowTransactionService } from './escrow-transaction.service.js';
import { EscrowTransactionDb } from './escrow-transaction.db.js';
import type { BidId } from '../common/ids.js';

describe('EscrowTransactionService', () => {
  let db: DeepMockProxy<EscrowTransactionDb>;
  let service: EscrowTransactionService;

  beforeEach(async () => {
    db = mockDeep<EscrowTransactionDb>();
    const moduleRef = await Test.createTestingModule({
      providers: [EscrowTransactionService, { provide: EscrowTransactionDb, useValue: db }],
    }).compile();
    service = moduleRef.get(EscrowTransactionService);
  });

  describe('hasActiveAuthorization', () => {
    describe('when the bid has no escrow transactions', () => {
      beforeEach(() => {
        db.findLatestForBid.mockResolvedValue(null);
      });

      it('returns false', async () => {
        const result = await service.hasActiveAuthorization('bid-1' as BidId);

        expect(result).toBe(false);
      });
    });

    describe('when the latest transaction is AUTHORIZED', () => {
      beforeEach(() => {
        db.findLatestForBid.mockResolvedValue({ id: 'escrow-1', type: 'AUTHORIZED' } as never);
      });

      it('returns true', async () => {
        const result = await service.hasActiveAuthorization('bid-1' as BidId);

        expect(result).toBe(true);
      });
    });

    describe('when the latest transaction is VOIDED', () => {
      beforeEach(() => {
        db.findLatestForBid.mockResolvedValue({ id: 'escrow-2', type: 'VOIDED' } as never);
      });

      it('returns false', async () => {
        const result = await service.hasActiveAuthorization('bid-1' as BidId);

        expect(result).toBe(false);
      });
    });

    describe('when the latest transaction is CAPTURED', () => {
      beforeEach(() => {
        db.findLatestForBid.mockResolvedValue({ id: 'escrow-3', type: 'CAPTURED' } as never);
      });

      it('returns false', async () => {
        const result = await service.hasActiveAuthorization('bid-1' as BidId);

        expect(result).toBe(false);
      });
    });
  });
});

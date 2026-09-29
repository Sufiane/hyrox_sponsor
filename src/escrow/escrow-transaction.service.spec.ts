import { EscrowTransactionService } from './escrow-transaction.service.js';
import { EscrowTransactionDb } from './escrow-transaction.db.js';
import type { BidId } from '../common/index.js';

function buildService(latest: { id: string; type: string } | null): EscrowTransactionService {
  const db = {
    findLatestForBid: vi.fn().mockResolvedValue(latest),
  } as unknown as EscrowTransactionDb;

  return new EscrowTransactionService(db);
}

describe('EscrowTransactionService', () => {
  describe('hasActiveAuthorization', () => {
    describe('when the bid has no escrow transactions', () => {
      it('returns false', async () => {
        const result = await buildService(null).hasActiveAuthorization('bid-1' as BidId);

        expect(result).toBe(false);
      });
    });

    describe('when the latest transaction is AUTHORIZED', () => {
      it('returns true', async () => {
        const result = await buildService({ id: 'escrow-1', type: 'AUTHORIZED' }).hasActiveAuthorization('bid-1' as BidId);

        expect(result).toBe(true);
      });
    });

    describe('when the latest transaction is VOIDED', () => {
      it('returns false', async () => {
        const result = await buildService({ id: 'escrow-2', type: 'VOIDED' }).hasActiveAuthorization('bid-1' as BidId);

        expect(result).toBe(false);
      });
    });

    describe('when the latest transaction is CAPTURED', () => {
      it('returns false', async () => {
        const result = await buildService({ id: 'escrow-3', type: 'CAPTURED' }).hasActiveAuthorization('bid-1' as BidId);

        expect(result).toBe(false);
      });
    });
  });
});

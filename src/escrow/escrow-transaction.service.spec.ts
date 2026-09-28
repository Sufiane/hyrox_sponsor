import { EscrowTransactionService } from './escrow-transaction.service.js';
import { EscrowTransactionDb } from './escrow-transaction.db.js';

describe('EscrowTransactionService', () => {
  describe('hasActiveAuthorization', () => {
    describe('when an AUTHORIZED transaction exists for the bid', () => {
      it('returns true', async () => {
        const db = {
          findActiveAuthorizationForBid: vi
            .fn()
            .mockResolvedValue({ id: 'escrow-1', type: 'AUTHORIZED' }),
        } as unknown as EscrowTransactionDb;
        const service = new EscrowTransactionService(db);

        const result = await service.hasActiveAuthorization('bid-1');

        expect(result).toBe(true);
      });
    });

    describe('when no AUTHORIZED transaction exists for the bid', () => {
      it('returns false', async () => {
        const db = {
          findActiveAuthorizationForBid: vi.fn().mockResolvedValue(null),
        } as unknown as EscrowTransactionDb;
        const service = new EscrowTransactionService(db);

        const result = await service.hasActiveAuthorization('bid-1');

        expect(result).toBe(false);
      });
    });
  });
});

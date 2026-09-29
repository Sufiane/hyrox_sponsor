import { DisputeService } from './dispute.service.js';
import { DisputeDb } from './dispute.db.js';

function buildService(dispute: { id: string; status: string } | null): DisputeService {
  const db = {
    findOpenForAuction: vi.fn().mockResolvedValue(dispute),
  } as unknown as DisputeDb;

  return new DisputeService(db);
}

describe('DisputeService', () => {
  describe('hasOpenDispute', () => {
    describe('when an OPEN dispute exists for the auction', () => {
      it('returns true', async () => {
        const result = await buildService({ id: 'dispute-1', status: 'OPEN' }).hasOpenDispute('auction-1');

        expect(result).toBe(true);
      });
    });

    describe('when an ARBITRATION dispute exists for the auction', () => {
      it('returns true', async () => {
        const result = await buildService({ id: 'dispute-2', status: 'ARBITRATION' }).hasOpenDispute('auction-1');

        expect(result).toBe(true);
      });
    });

    describe('when no open dispute exists for the auction', () => {
      it('returns false', async () => {
        const result = await buildService(null).hasOpenDispute('auction-1');

        expect(result).toBe(false);
      });
    });
  });
});

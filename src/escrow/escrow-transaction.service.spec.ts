import { Test } from '@nestjs/testing';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { EscrowTransactionService } from './escrow-transaction.service';
import { EscrowTransactionDb } from './escrow-transaction.db';
import type { BidId } from '../common/ids';
import { cents } from '../common/money';
import { StripeUnavailableError } from '../common/stripe-errors';
import { stripePaymentIntentId } from '../common/stripe-ids';
import { StripeGateway } from '../stripe/stripe-gateway';

describe('EscrowTransactionService', () => {
  let db: DeepMockProxy<EscrowTransactionDb>;
  let stripe: DeepMockProxy<StripeGateway>;
  let service: EscrowTransactionService;

  beforeEach(async () => {
    db = mockDeep<EscrowTransactionDb>();
    stripe = mockDeep<StripeGateway>();
    const moduleRef = await Test.createTestingModule({
      providers: [
        EscrowTransactionService,
        { provide: EscrowTransactionDb, useValue: db },
        { provide: StripeGateway, useValue: stripe },
      ],
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

  describe('releaseHold', () => {
    const release = {
      bidId: 'bid-1' as BidId,
      paymentIntentId: stripePaymentIntentId('pi_1'),
      amountCents: cents(5_000),
    };

    describe('when stripe cancels the hold', () => {
      beforeEach(() => {
        stripe.cancelHold.mockResolvedValue(undefined);
      });

      it('records a VOIDED row after the cancel', async () => {
        await service.releaseHold(release);

        expect(stripe.cancelHold).toHaveBeenCalledWith('pi_1');
        expect(db.recordVoided).toHaveBeenCalledWith(release);
        expect(stripe.cancelHold.mock.invocationCallOrder[0]).toBeLessThan(db.recordVoided.mock.invocationCallOrder[0]);
      });
    });

    describe('when stripe fails', () => {
      beforeEach(() => {
        stripe.cancelHold.mockRejectedValue(new StripeUnavailableError());
      });

      it('propagates the error', async () => {
        await expect(service.releaseHold(release)).rejects.toBeInstanceOf(StripeUnavailableError);
      });

      it('records nothing', async () => {
        await service.releaseHold(release).catch(() => undefined);

        expect(db.recordVoided).not.toHaveBeenCalled();
      });
    });
  });
});

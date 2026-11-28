import { mock, mockDeep, type DeepMockProxy, type MockProxy } from 'vitest-mock-extended';
import { Logger } from '@nestjs/common';
import { type MockInstance } from 'vitest';
import type { BidderTokenService } from '../../../bidders/bidder-token.service';
import {
  ConflictError,
  ForbiddenError,
  InvalidValueError,
  NotFoundError,
  PaymentRequiredError,
  UnauthorizedError,
} from '../../../common/domain-error';
import type { NormalizedEmail } from '../../../common/email';
import type { AuctionId, BidderId, BidId } from '../../../common/ids';
import { cents } from '../../../common/money';
import { StripeUnavailableError } from '../../../common/stripe-errors';
import { stripeCustomerId, stripePaymentIntentId, stripePaymentMethodId } from '../../../common/stripe-ids';
import type { EscrowTransactionService } from '../../../escrow/escrow-transaction.service';
import type { StripeGateway } from '../../../stripe/stripe-gateway';
import { PlaceBidUsecase, type PlaceBidInput } from './place-bid.usecase';
import type { BidLeader, LockedAuction, PlaceBidSession, PlacedBid, PlaceBidUsecaseDb } from './place-bid.usecase.db';

describe('PlaceBidUsecase', () => {
  const auctionId = 'auction-1' as AuctionId;
  const placedAt = new Date('2026-11-08T12:00:00Z');
  const newHold = {
    paymentIntentId: stripePaymentIntentId('pi_new'),
    captureBefore: new Date('2026-11-15T12:00:00Z'),
  };
  let db: DeepMockProxy<PlaceBidUsecaseDb>;
  let tokens: DeepMockProxy<BidderTokenService>;
  let stripe: DeepMockProxy<StripeGateway>;
  let escrow: DeepMockProxy<EscrowTransactionService>;
  let session: MockProxy<PlaceBidSession>;
  let auction: LockedAuction;
  let snapshotLeading: BidLeader | null;
  let externalCallsInsideLock: number;
  let usecase: PlaceBidUsecase;
  let warn: MockInstance;
  let logError: MockInstance;
  let logInfo: MockInstance;

  function input(overrides: Partial<PlaceBidInput> = {}): PlaceBidInput {
    return { auctionId, bidderToken: 'token-1', amountCents: cents(1000), ...overrides };
  }

  function leader(bidderId: string, amount: number): void {
    snapshotLeading = { bidderId: bidderId as BidderId, amountCents: cents(amount) };
    session.findLeading.mockResolvedValue({
      id: 'bid-1' as BidId,
      bidderId: bidderId as BidderId,
      amountCents: cents(amount),
      hold: { paymentIntentId: stripePaymentIntentId('pi_old'), amountCents: cents(amount) },
    });
  }

  function externalCallCount(): number {
    return (
      stripe.authorizeHold.mock.calls.length +
      stripe.cancelHold.mock.calls.length +
      escrow.releaseHold.mock.calls.length
    );
  }

  function loggedText(): string {
    return [...warn.mock.calls, ...logError.mock.calls, ...logInfo.mock.calls].flat().map(String).join('\n');
  }

  function expectNoWrites(): void {
    expect(session.markOutbid).not.toHaveBeenCalled();
    expect(session.insertLeading).not.toHaveBeenCalled();
    expect(session.recordAuthorized).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    logInfo = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    db = mockDeep<PlaceBidUsecaseDb>();
    tokens = mockDeep<BidderTokenService>();
    stripe = mockDeep<StripeGateway>();
    escrow = mockDeep<EscrowTransactionService>();
    tokens.verify.mockResolvedValue({ bidderId: 'bidder-2' as BidderId, tokenVersion: 1 });
    db.findBidder.mockResolvedValue({
      id: 'bidder-2' as BidderId,
      email: 'brand@example.com' as NormalizedEmail,
      tokenVersion: 1,
      stripeCustomerId: stripeCustomerId('cus_2'),
      defaultPaymentMethodId: stripePaymentMethodId('pm_2'),
    });
    stripe.authorizeHold.mockResolvedValue({ outcome: 'authorized', ...newHold });
    session = mock<PlaceBidSession>();
    auction = {
      status: 'OPEN',
      dbNow: new Date('2026-11-08T12:00:00Z'),
      closeAt: new Date('2026-11-09T06:00:00Z'),
      floorPriceCents: cents(1000),
      athleteEmail: 'athlete@example.com' as NormalizedEmail,
      athleteBanned: false,
    };
    snapshotLeading = null;
    externalCallsInsideLock = 0;
    db.readBiddingSnapshot.mockImplementation(async () => ({ auction: { ...auction }, leading: snapshotLeading }));
    db.withLockedAuction.mockImplementation((async (
      _id: AuctionId,
      work: (locked: LockedAuction, bound: PlaceBidSession) => Promise<unknown>,
    ) => {
      const before = externalCallCount();

      try {
        return await work(auction, session);
      } finally {
        externalCallsInsideLock += externalCallCount() - before;
      }
    }) as never);
    session.findLeading.mockResolvedValue(null);
    session.insertLeading.mockImplementation(async (bidderId, amountCents): Promise<PlacedBid> => ({
      id: 'bid-2' as BidId,
      auctionId,
      bidderId,
      amountCents,
      placedAt,
    }));
    usecase = new PlaceBidUsecase(db, tokens, stripe, escrow);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when the amount is above the maximum', () => {
    it('rejects without calling stripe or opening a transaction', async () => {
      await expect(usecase.execute(input({ amountCents: cents(100_000_001) }))).rejects.toThrow(
        new InvalidValueError('bid_above_maximum'),
      );
      expect(stripe.authorizeHold).not.toHaveBeenCalled();
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });
  });

  describe('when the bidder token is rejected', () => {
    beforeEach(() => {
      tokens.verify.mockRejectedValue(new UnauthorizedError('bidder_token_required'));
    });

    it('rejects without calling stripe or opening a transaction', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new UnauthorizedError('bidder_token_required'));
      expect(stripe.authorizeHold).not.toHaveBeenCalled();
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });
  });

  describe('when the token bidder no longer exists', () => {
    beforeEach(() => {
      db.findBidder.mockResolvedValue(null);
    });

    it('rejects as token required without calling stripe', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new UnauthorizedError('bidder_token_required'));
      expect(stripe.authorizeHold).not.toHaveBeenCalled();
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });
  });

  describe('when the token is not current for the bidder', () => {
    beforeEach(() => {
      tokens.verify.mockResolvedValue({ bidderId: 'bidder-2' as BidderId, tokenVersion: 0 });
      tokens.assertCurrent.mockImplementation(() => {
        throw new UnauthorizedError('bidder_token_required');
      });
    });

    it('checks the token against the stored bidder', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new UnauthorizedError('bidder_token_required'));
      expect(tokens.assertCurrent).toHaveBeenCalledWith(
        { bidderId: 'bidder-2', tokenVersion: 0 },
        { id: 'bidder-2', tokenVersion: 1 },
      );
    });

    it('calls no stripe and opens no transaction', async () => {
      await expect(usecase.execute(input())).rejects.toThrow();
      expect(stripe.authorizeHold).not.toHaveBeenCalled();
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });
  });

  describe('when the bidder has no saved card', () => {
    beforeEach(() => {
      db.findBidder.mockResolvedValue({
        id: 'bidder-2' as BidderId,
        email: 'brand@example.com' as NormalizedEmail,
        tokenVersion: 1,
        stripeCustomerId: stripeCustomerId('cus_2'),
        defaultPaymentMethodId: null,
      });
    });

    it('rejects as card required without calling stripe', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new ForbiddenError('card_required'));
      expect(stripe.authorizeHold).not.toHaveBeenCalled();
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });
  });

  describe('when the bidder has no stripe customer', () => {
    beforeEach(() => {
      db.findBidder.mockResolvedValue({
        id: 'bidder-2' as BidderId,
        email: 'brand@example.com' as NormalizedEmail,
        tokenVersion: 1,
        stripeCustomerId: null,
        defaultPaymentMethodId: stripePaymentMethodId('pm_2'),
      });
    });

    it('rejects as card required without calling stripe', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new ForbiddenError('card_required'));
      expect(stripe.authorizeHold).not.toHaveBeenCalled();
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });
  });

  describe('when the preflight finds no auction', () => {
    beforeEach(() => {
      db.readBiddingSnapshot.mockResolvedValue(null);
    });

    it('rejects as not found without calling stripe', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new NotFoundError('auction_not_found'));
      expect(stripe.authorizeHold).not.toHaveBeenCalled();
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });
  });

  describe('when the preflight rejects the bid', () => {
    describe('because the auction is CLOSED', () => {
      beforeEach(() => {
        auction.status = 'CLOSED';
      });

      it('rejects as not open without calling stripe', async () => {
        await expect(usecase.execute(input())).rejects.toThrow(new ConflictError('auction_not_open'));
        expect(stripe.authorizeHold).not.toHaveBeenCalled();
        expect(db.withLockedAuction).not.toHaveBeenCalled();
      });
    });

    describe('because the bidder is the athlete', () => {
      beforeEach(() => {
        db.findBidder.mockResolvedValue({
          id: 'bidder-2' as BidderId,
          email: auction.athleteEmail,
          tokenVersion: 1,
          stripeCustomerId: stripeCustomerId('cus_2'),
          defaultPaymentMethodId: stripePaymentMethodId('pm_2'),
        });
      });

      it('rejects the self-bid without calling stripe', async () => {
        await expect(usecase.execute(input())).rejects.toThrow(new ForbiddenError('self_bid_not_allowed'));
        expect(stripe.authorizeHold).not.toHaveBeenCalled();
      });
    });

    describe('because the bidder already leads', () => {
      beforeEach(() => {
        leader('bidder-2', 5000);
      });

      it('rejects as already leading without calling stripe', async () => {
        await expect(usecase.execute(input({ amountCents: cents(9000) }))).rejects.toThrow(
          new ConflictError('already_leading'),
        );
        expect(stripe.authorizeHold).not.toHaveBeenCalled();
      });
    });

    describe('because the amount is below the minimum', () => {
      beforeEach(() => {
        leader('bidder-1', 5000);
      });

      it('rejects as below minimum without calling stripe', async () => {
        await expect(usecase.execute(input({ amountCents: cents(5499) }))).rejects.toThrow(
          new InvalidValueError('bid_below_minimum'),
        );
        expect(stripe.authorizeHold).not.toHaveBeenCalled();
      });
    });
  });

  describe('when the card is declined', () => {
    beforeEach(() => {
      stripe.authorizeHold.mockResolvedValue({ outcome: 'declined', reason: 'insufficient_funds' });
    });

    it('rejects as card declined without a transaction', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new PaymentRequiredError('card_declined'));
      expect(db.withLockedAuction).not.toHaveBeenCalled();
      expect(stripe.cancelHold).not.toHaveBeenCalled();
    });

    it('logs the decline reason', async () => {
      await expect(usecase.execute(input())).rejects.toThrow();

      expect(loggedText()).toContain('insufficient_funds');
    });
  });

  describe('when stripe cannot use the payment method', () => {
    beforeEach(() => {
      stripe.authorizeHold.mockResolvedValue({ outcome: 'payment_method_unusable', reason: 'resource_missing' });
    });

    it('rejects as card required without a transaction', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new ForbiddenError('card_required'));
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });
  });

  describe('when the authorization throws', () => {
    beforeEach(() => {
      stripe.authorizeHold.mockRejectedValue(new StripeUnavailableError());
    });

    it('propagates the stripe error without a transaction', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new StripeUnavailableError());
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });

    it('logs the attempt, auction and bidder at error level', async () => {
      await expect(usecase.execute(input())).rejects.toThrow();

      const { attemptId } = stripe.authorizeHold.mock.calls[0][0];

      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledWith(expect.stringContaining(attemptId));
      expect(logError).toHaveBeenCalledWith(expect.stringContaining(auctionId));
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('bidder-2'));
    });
  });

  describe('when the hold is authorized and the bid commits', () => {
    it('authorizes the bid amount on the token bidder saved card', async () => {
      await usecase.execute(input({ amountCents: cents(1500) }));

      expect(stripe.authorizeHold).toHaveBeenCalledWith({
        customerId: 'cus_2',
        paymentMethodId: 'pm_2',
        amountCents: 1500,
        auctionId,
        bidderId: 'bidder-2',
        attemptId: expect.any(String),
      });
    });

    it('authorizes before opening the transaction', async () => {
      await usecase.execute(input());

      expect(stripe.authorizeHold.mock.invocationCallOrder[0]).toBeLessThan(
        db.withLockedAuction.mock.invocationCallOrder[0],
      );
    });

    it('makes no external call while the auction is locked', async () => {
      await usecase.execute(input());

      expect(externalCallsInsideLock).toBe(0);
    });

    it('inserts the leading bid for the token bidder', async () => {
      await usecase.execute(input());

      expect(tokens.verify).toHaveBeenCalledWith('token-1');
      expect(db.findBidder).toHaveBeenCalledWith('bidder-2');
      expect(session.insertLeading).toHaveBeenCalledWith('bidder-2', 1000);
    });

    it('records the hold on the new bid after inserting it', async () => {
      await usecase.execute(input({ amountCents: cents(1500) }));

      expect(session.recordAuthorized).toHaveBeenCalledWith('bid-2', { ...newHold, amountCents: 1500 });
      expect(session.insertLeading.mock.invocationCallOrder[0]).toBeLessThan(
        session.recordAuthorized.mock.invocationCallOrder[0],
      );
    });

    it('uses a fresh attempt id per call', async () => {
      await usecase.execute(input());
      await usecase.execute(input());

      const [first, second] = stripe.authorizeHold.mock.calls.map(([call]) => call.attemptId);

      expect(first).not.toBe(second);
    });

    it('logs the attempt id with the bid id', async () => {
      await usecase.execute(input());

      const attemptId = stripe.authorizeHold.mock.calls[0][0].attemptId;

      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining(attemptId));
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('bid-2'));
    });

    it('never logs the bidder token', async () => {
      await usecase.execute(input());

      expect(loggedText()).not.toContain('token-1');
    });

    it('neither cancels the new hold nor releases anything', async () => {
      await usecase.execute(input());

      expect(stripe.cancelHold).not.toHaveBeenCalled();
      expect(escrow.releaseHold).not.toHaveBeenCalled();
    });

    it('returns the bid with no previous leader and the closeAt', async () => {
      const result = await usecase.execute(input());

      expect(result.previousLeader).toBeNull();
      expect(result.bid.id).toBe('bid-2');
      expect(result.closeAt).toEqual(auction.closeAt);
    });
  });

  describe('when the locked place rejects after the hold', () => {
    beforeEach(() => {
      session.findLeading.mockResolvedValue({
        id: 'bid-9' as BidId,
        bidderId: 'bidder-9' as BidderId,
        amountCents: cents(5000),
        hold: { paymentIntentId: stripePaymentIntentId('pi_winner'), amountCents: cents(5000) },
      });
    });

    it('rethrows the locked rule violation', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new InvalidValueError('bid_below_minimum'));
      expectNoWrites();
    });

    it('does not look up the bid', async () => {
      await expect(usecase.execute(input())).rejects.toThrow();

      expect(db.bidExists).not.toHaveBeenCalled();
    });

    it('cancels only the new hold, after the transaction', async () => {
      await expect(usecase.execute(input())).rejects.toThrow();

      expect(stripe.cancelHold).toHaveBeenCalledTimes(1);
      expect(stripe.cancelHold).toHaveBeenCalledWith('pi_new');
      expect(externalCallsInsideLock).toBe(0);
      expect(escrow.releaseHold).not.toHaveBeenCalled();
    });

    describe('and the cancel also fails', () => {
      beforeEach(() => {
        stripe.cancelHold.mockRejectedValue(new StripeUnavailableError());
      });

      it('still rethrows the original error', async () => {
        await expect(usecase.execute(input())).rejects.toThrow(new InvalidValueError('bid_below_minimum'));
      });

      it('logs the orphaned hold at error level', async () => {
        await expect(usecase.execute(input())).rejects.toThrow();

        expect(logError).toHaveBeenCalledWith(expect.stringContaining('pi_new'));
      });
    });
  });

  describe('when the transaction fails after the hold', () => {
    beforeEach(() => {
      session.recordAuthorized.mockRejectedValue(new Error('connection reset'));
    });

    it('cancels the new hold and rethrows', async () => {
      await expect(usecase.execute(input())).rejects.toThrow('connection reset');
      expect(stripe.cancelHold).toHaveBeenCalledWith('pi_new');
    });
  });

  describe('when the transaction errors after the bid was placed', () => {
    const commitError = new Error('connection lost before commit ack');

    beforeEach(() => {
      db.withLockedAuction.mockImplementation((async (
        _id: AuctionId,
        work: (locked: LockedAuction, bound: PlaceBidSession) => Promise<unknown>,
      ) => {
        await work(auction, session);

        throw commitError;
      }) as never);
    });

    it('checks whether the placed bid committed', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(commitError);
      expect(db.bidExists).toHaveBeenCalledWith('bid-2');
    });

    describe('and the bid row exists', () => {
      beforeEach(() => {
        db.bidExists.mockResolvedValue(true);
      });

      it('returns the placed bid', async () => {
        await expect(usecase.execute(input())).resolves.toMatchObject({ bid: { id: 'bid-2' } });
      });

      it('keeps the new hold', async () => {
        await usecase.execute(input());

        expect(stripe.cancelHold).not.toHaveBeenCalled();
      });

      it('logs the confirmed ambiguous commit at warn level', async () => {
        await usecase.execute(input());

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('bid-2'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('pi_new'));
        expect(logError).not.toHaveBeenCalled();
      });

      describe('and it outbid a held leader', () => {
        beforeEach(() => {
          leader('bidder-1', 5000);
        });

        it('releases the previous hold', async () => {
          await usecase.execute(input({ amountCents: cents(5500) }));

          expect(escrow.releaseHold).toHaveBeenCalledWith({
            bidId: 'bid-1',
            paymentIntentId: 'pi_old',
            amountCents: 5000,
          });
        });
      });
    });

    describe('and the bid row does not exist', () => {
      beforeEach(() => {
        db.bidExists.mockResolvedValue(false);
      });

      it('cancels the new hold and rethrows the original error', async () => {
        await expect(usecase.execute(input())).rejects.toThrow(commitError);
        expect(stripe.cancelHold).toHaveBeenCalledWith('pi_new');
      });
    });

    describe('and the lookup fails', () => {
      beforeEach(() => {
        db.bidExists.mockRejectedValue(new Error('database unreachable'));
      });

      it('rethrows the original error', async () => {
        await expect(usecase.execute(input())).rejects.toThrow(commitError);
      });

      it('keeps the new hold and logs it at error level', async () => {
        await expect(usecase.execute(input())).rejects.toThrow();

        expect(stripe.cancelHold).not.toHaveBeenCalled();
        expect(logError).toHaveBeenCalledWith(expect.stringContaining('pi_new'));
      });

      describe('and it outbid a held leader', () => {
        beforeEach(() => {
          leader('bidder-1', 5000);
        });

        it('logs the unreleased previous hold instead of releasing it', async () => {
          await expect(usecase.execute(input({ amountCents: cents(5500) }))).rejects.toThrow(commitError);
          expect(escrow.releaseHold).not.toHaveBeenCalled();
          expect(logError).toHaveBeenCalledWith(expect.stringContaining('pi_old'));
        });
      });
    });
  });

  describe('when the auction disappears under the lock', () => {
    beforeEach(() => {
      db.withLockedAuction.mockResolvedValue(null as never);
    });

    it('cancels the new hold and rejects as not found', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new NotFoundError('auction_not_found'));
      expect(stripe.cancelHold).toHaveBeenCalledWith('pi_new');
    });
  });

  describe('when the bid outbids a held leader', () => {
    beforeEach(() => {
      leader('bidder-1', 5000);
    });

    it('demotes the previous leader before inserting', async () => {
      await usecase.execute(input({ amountCents: cents(5500) }));

      expect(session.markOutbid).toHaveBeenCalledWith('bid-1');
      expect(session.markOutbid.mock.invocationCallOrder[0]).toBeLessThan(
        session.insertLeading.mock.invocationCallOrder[0],
      );
    });

    it('reports the previous leader with its hold', async () => {
      const result = await usecase.execute(input({ amountCents: cents(5500) }));

      expect(result.previousLeader).toEqual({
        bidId: 'bid-1',
        bidderId: 'bidder-1',
        amountCents: 5000,
        hold: { paymentIntentId: 'pi_old', amountCents: 5000 },
      });
    });

    it('releases the previous hold after the transaction', async () => {
      await usecase.execute(input({ amountCents: cents(5500) }));

      expect(escrow.releaseHold).toHaveBeenCalledWith({ bidId: 'bid-1', paymentIntentId: 'pi_old', amountCents: 5000 });
      expect(db.withLockedAuction.mock.invocationCallOrder[0]).toBeLessThan(
        escrow.releaseHold.mock.invocationCallOrder[0],
      );
      expect(externalCallsInsideLock).toBe(0);
    });

    describe('and the release fails', () => {
      beforeEach(() => {
        escrow.releaseHold.mockRejectedValue(new StripeUnavailableError());
      });

      it('still returns the placed bid', async () => {
        await expect(usecase.execute(input({ amountCents: cents(5500) }))).resolves.toMatchObject({
          bid: { id: 'bid-2' },
        });
      });

      it('logs the unreleased hold at error level', async () => {
        await usecase.execute(input({ amountCents: cents(5500) }));

        expect(logError).toHaveBeenCalledWith(expect.stringContaining('pi_old'));
        expect(stripe.cancelHold).not.toHaveBeenCalled();
      });
    });
  });

  describe('when the leader changed between the preflight and the lock', () => {
    beforeEach(() => {
      snapshotLeading = { bidderId: 'bidder-0' as BidderId, amountCents: cents(4000) };
      session.findLeading.mockResolvedValue({
        id: 'bid-1' as BidId,
        bidderId: 'bidder-1' as BidderId,
        amountCents: cents(5000),
        hold: { paymentIntentId: stripePaymentIntentId('pi_locked'), amountCents: cents(5000) },
      });
    });

    it('releases the hold read under the lock', async () => {
      await usecase.execute(input({ amountCents: cents(5500) }));

      expect(session.markOutbid).toHaveBeenCalledWith('bid-1');
      expect(escrow.releaseHold).toHaveBeenCalledTimes(1);
      expect(escrow.releaseHold).toHaveBeenCalledWith({
        bidId: 'bid-1',
        paymentIntentId: 'pi_locked',
        amountCents: 5000,
      });
    });
  });

  describe('when the previous leader has no hold', () => {
    beforeEach(() => {
      leader('bidder-1', 5000);
      session.findLeading.mockResolvedValue({
        id: 'bid-1' as BidId,
        bidderId: 'bidder-1' as BidderId,
        amountCents: cents(5000),
        hold: null,
      });
    });

    it('releases nothing', async () => {
      await usecase.execute(input({ amountCents: cents(5500) }));

      expect(escrow.releaseHold).not.toHaveBeenCalled();
    });
  });
});

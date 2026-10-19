import { mock, mockDeep, type DeepMockProxy, type MockProxy } from 'vitest-mock-extended';
import { Logger } from '@nestjs/common';
import { ConflictError, ForbiddenError, InvalidValueError, NotFoundError } from '../../../common/domain-error';
import type { NormalizedEmail } from '../../../common/email';
import type { AuctionId, BidderId, BidId } from '../../../common/ids';
import { cents } from '../../../common/money';
import { PlaceBidUsecase, type PlaceBidInput } from './place-bid.usecase';
import type { LockedAuction, PlaceBidSession, PlacedBid, PlaceBidUsecaseDb } from './place-bid.usecase.db';

describe('PlaceBidUsecase', () => {
  const auctionId = 'auction-1' as AuctionId;
  const placedAt = new Date('2026-11-08T12:00:00Z');
  let db: DeepMockProxy<PlaceBidUsecaseDb>;
  let session: MockProxy<PlaceBidSession>;
  let auction: LockedAuction;
  let usecase: PlaceBidUsecase;

  function input(overrides: Partial<PlaceBidInput> = {}): PlaceBidInput {
    return { auctionId, email: 'brand@example.com' as NormalizedEmail, amountCents: cents(1000), ...overrides };
  }

  function leader(bidderId: string, amount: number): void {
    session.findLeading.mockResolvedValue({
      id: 'bid-1' as BidId,
      bidderId: bidderId as BidderId,
      amountCents: cents(amount),
    });
  }

  function expectNoWrites(): void {
    expect(session.markOutbid).not.toHaveBeenCalled();
    expect(session.insertLeading).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db = mockDeep<PlaceBidUsecaseDb>();
    session = mock<PlaceBidSession>();
    auction = {
      status: 'OPEN',
      dbNow: new Date('2026-11-08T12:00:00Z'),
      closeAt: new Date('2026-11-09T06:00:00Z'),
      floorPriceCents: cents(1000),
      athleteEmail: 'athlete@example.com' as NormalizedEmail,
      athleteBanned: false,
    };
    db.withLockedAuction.mockImplementation(((
      _id: AuctionId,
      work: (locked: LockedAuction, bound: PlaceBidSession) => Promise<unknown>,
    ) => work(auction, session)) as never);
    session.upsertBidder.mockResolvedValue('bidder-2' as BidderId);
    session.findLeading.mockResolvedValue(null);
    session.insertLeading.mockImplementation(
      async (bidderId, amountCents): Promise<PlacedBid> => ({
        id: 'bid-2' as BidId,
        auctionId,
        bidderId,
        amountCents,
        placedAt,
      }),
    );
    usecase = new PlaceBidUsecase(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when the amount is above the maximum', () => {
    it('rejects without opening a transaction', async () => {
      await expect(usecase.execute(input({ amountCents: cents(100_000_001) }))).rejects.toThrow(
        new InvalidValueError('bid_above_maximum'),
      );
      expect(db.withLockedAuction).not.toHaveBeenCalled();
    });
  });

  describe('when the auction does not exist', () => {
    beforeEach(() => {
      db.withLockedAuction.mockResolvedValue(null as never);
    });

    it('rejects as not found', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new NotFoundError('auction_not_found'));
    });
  });

  describe('when the auction is SCHEDULED', () => {
    beforeEach(() => {
      auction.status = 'SCHEDULED';
    });

    it('rejects as not open', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new ConflictError('auction_not_open'));
    });
  });

  describe('when the auction is CLOSED', () => {
    beforeEach(() => {
      auction.status = 'CLOSED';
    });

    it('rejects as not open', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new ConflictError('auction_not_open'));
    });
  });

  describe('when closeAt equals the database time', () => {
    beforeEach(() => {
      auction.closeAt = auction.dbNow;
    });

    it('rejects as not open', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new ConflictError('auction_not_open'));
    });
  });

  describe('when closeAt is before the database time', () => {
    beforeEach(() => {
      auction.closeAt = new Date(auction.dbNow.getTime() - 1);
    });

    it('rejects as not open', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new ConflictError('auction_not_open'));
    });
  });

  describe('when the seller is banned', () => {
    beforeEach(() => {
      auction.athleteBanned = true;
    });

    it('rejects as not open', async () => {
      await expect(usecase.execute(input())).rejects.toThrow(new ConflictError('auction_not_open'));
    });
  });

  describe('when the bidder email is the athlete email', () => {
    it('rejects the self-bid before touching bidders', async () => {
      await expect(usecase.execute(input({ email: auction.athleteEmail }))).rejects.toThrow(
        new ForbiddenError('self_bid_not_allowed'),
      );
      expect(session.upsertBidder).not.toHaveBeenCalled();
      expectNoWrites();
    });
  });

  describe('when the bidder already leads', () => {
    beforeEach(() => {
      leader('bidder-2', 5000);
    });

    it('rejects a valid amount', async () => {
      await expect(usecase.execute(input({ amountCents: cents(9000) }))).rejects.toThrow(
        new ConflictError('already_leading'),
      );
      expectNoWrites();
    });

    it('rejects an amount that is also too low', async () => {
      await expect(usecase.execute(input({ amountCents: cents(5000) }))).rejects.toThrow(
        new ConflictError('already_leading'),
      );
      expectNoWrites();
    });
  });

  describe('when there is no leading bid', () => {
    describe('and the bid is below the floor', () => {
      it('rejects as below minimum', async () => {
        await expect(usecase.execute(input({ amountCents: cents(999) }))).rejects.toThrow(
          new InvalidValueError('bid_below_minimum'),
        );
        expectNoWrites();
      });
    });

    describe('and the bid equals the floor', () => {
      it('accepts with no previous leader', async () => {
        const result = await usecase.execute(input({ amountCents: cents(1000) }));

        expect(result.previousLeader).toBeNull();
        expect(result.bid.amountCents).toBe(1000);
        expect(session.markOutbid).not.toHaveBeenCalled();
      });
    });

    describe('and the bid is above the floor', () => {
      it('accepts', async () => {
        await expect(usecase.execute(input({ amountCents: cents(1500) }))).resolves.toBeDefined();
      });
    });
  });

  describe('when another bidder leads under $100', () => {
    beforeEach(() => {
      leader('bidder-1', 5000);
    });

    it('rejects a bid equal to the leader', async () => {
      await expect(usecase.execute(input({ amountCents: cents(5000) }))).rejects.toThrow(
        new InvalidValueError('bid_below_minimum'),
      );
      expectNoWrites();
    });

    it('rejects a bid one cent under the increment', async () => {
      await expect(usecase.execute(input({ amountCents: cents(5499) }))).rejects.toThrow(
        new InvalidValueError('bid_below_minimum'),
      );
      expectNoWrites();
    });

    it('accepts a bid at exactly the increment and reports the previous leader', async () => {
      const result = await usecase.execute(input({ amountCents: cents(5500) }));

      expect(result.previousLeader).toEqual({ bidId: 'bid-1', bidderId: 'bidder-1', amountCents: 5000 });
      expect(session.markOutbid).toHaveBeenCalledWith('bid-1');
    });

    it('demotes the previous leader before inserting', async () => {
      await usecase.execute(input({ amountCents: cents(5500) }));

      expect(session.markOutbid.mock.invocationCallOrder[0]).toBeLessThan(
        session.insertLeading.mock.invocationCallOrder[0],
      );
    });
  });

  describe('when another bidder leads above $100', () => {
    beforeEach(() => {
      leader('bidder-1', 10_100);
    });

    it('rejects a bid one cent under the 5% increment', async () => {
      await expect(usecase.execute(input({ amountCents: cents(10_604) }))).rejects.toThrow(
        new InvalidValueError('bid_below_minimum'),
      );
    });

    it('accepts a bid at exactly the 5% increment', async () => {
      await expect(usecase.execute(input({ amountCents: cents(10_605) }))).resolves.toBeDefined();
    });
  });
});

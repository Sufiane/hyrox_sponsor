import { ConflictError, ForbiddenError, InvalidValueError } from '../../../common/domain-error';
import type { NormalizedEmail } from '../../../common/email';
import type { BidderId } from '../../../common/ids';
import { cents } from '../../../common/money';
import { findBidRuleViolation, type BidRuleInput } from './bid-rules';

describe('findBidRuleViolation', () => {
  let input: BidRuleInput;

  beforeEach(() => {
    input = {
      auction: {
        status: 'OPEN',
        dbNow: new Date('2026-11-08T12:00:00Z'),
        closeAt: new Date('2026-11-09T06:00:00Z'),
        floorPriceCents: cents(1000),
        athleteEmail: 'athlete@example.com' as NormalizedEmail,
        athleteBanned: false,
      },
      leading: null,
      bidder: { id: 'bidder-2' as BidderId, email: 'brand@example.com' as NormalizedEmail },
      amountCents: cents(1000),
    };
  });

  describe('when every rule passes', () => {
    it('returns null', () => {
      expect(findBidRuleViolation(input)).toBeNull();
    });
  });

  describe('when the auction is SCHEDULED', () => {
    beforeEach(() => {
      input.auction.status = 'SCHEDULED';
    });

    it('returns auction_not_open', () => {
      expect(findBidRuleViolation(input)?.error).toEqual(new ConflictError('auction_not_open'));
    });
  });

  describe('when the auction is CLOSED', () => {
    beforeEach(() => {
      input.auction.status = 'CLOSED';
    });

    it('returns auction_not_open', () => {
      expect(findBidRuleViolation(input)?.error).toEqual(new ConflictError('auction_not_open'));
    });
  });

  describe('when closeAt equals the database time', () => {
    beforeEach(() => {
      input.auction.closeAt = input.auction.dbNow;
    });

    it('returns auction_not_open', () => {
      expect(findBidRuleViolation(input)?.error).toEqual(new ConflictError('auction_not_open'));
    });
  });

  describe('when closeAt is before the database time', () => {
    beforeEach(() => {
      input.auction.closeAt = new Date(input.auction.dbNow.getTime() - 1);
    });

    it('returns auction_not_open', () => {
      expect(findBidRuleViolation(input)?.error).toEqual(new ConflictError('auction_not_open'));
    });
  });

  describe('when the seller is banned', () => {
    beforeEach(() => {
      input.auction.athleteBanned = true;
    });

    it('returns auction_not_open', () => {
      expect(findBidRuleViolation(input)?.error).toEqual(new ConflictError('auction_not_open'));
    });
  });

  describe('when the bidder is the athlete', () => {
    beforeEach(() => {
      input.bidder.email = input.auction.athleteEmail;
    });

    it('returns self_bid_not_allowed', () => {
      expect(findBidRuleViolation(input)?.error).toEqual(new ForbiddenError('self_bid_not_allowed'));
    });
  });

  describe('when the bidder already leads', () => {
    beforeEach(() => {
      input.leading = { bidderId: input.bidder.id, amountCents: cents(5000) };
    });

    describe('and the amount is valid', () => {
      beforeEach(() => {
        input.amountCents = cents(9000);
      });

      it('returns already_leading', () => {
        expect(findBidRuleViolation(input)?.error).toEqual(new ConflictError('already_leading'));
      });
    });

    describe('and the amount is also too low', () => {
      beforeEach(() => {
        input.amountCents = cents(5000);
      });

      it('returns already_leading', () => {
        expect(findBidRuleViolation(input)?.error).toEqual(new ConflictError('already_leading'));
      });
    });
  });

  describe('when there is no leading bid', () => {
    describe('and the amount is below the floor', () => {
      beforeEach(() => {
        input.amountCents = cents(999);
      });

      it('returns bid_below_minimum', () => {
        expect(findBidRuleViolation(input)?.error).toEqual(new InvalidValueError('bid_below_minimum'));
      });
    });

    describe('and the amount equals the floor', () => {
      it('returns null', () => {
        expect(findBidRuleViolation(input)).toBeNull();
      });
    });
  });

  describe('when another bidder leads under $100', () => {
    beforeEach(() => {
      input.leading = { bidderId: 'bidder-1' as BidderId, amountCents: cents(5000) };
    });

    describe('and the amount equals the leader', () => {
      beforeEach(() => {
        input.amountCents = cents(5000);
      });

      it('returns bid_below_minimum', () => {
        expect(findBidRuleViolation(input)?.error).toEqual(new InvalidValueError('bid_below_minimum'));
      });
    });

    describe('and the amount is one cent under the increment', () => {
      beforeEach(() => {
        input.amountCents = cents(5499);
      });

      it('returns bid_below_minimum with the minimum in the detail', () => {
        const violation = findBidRuleViolation(input);

        expect(violation?.error).toEqual(new InvalidValueError('bid_below_minimum'));
        expect(violation?.detail).toContain('5500');
      });
    });

    describe('and the amount is exactly the increment', () => {
      beforeEach(() => {
        input.amountCents = cents(5500);
      });

      it('returns null', () => {
        expect(findBidRuleViolation(input)).toBeNull();
      });
    });
  });

  describe('when another bidder leads above $100', () => {
    beforeEach(() => {
      input.leading = { bidderId: 'bidder-1' as BidderId, amountCents: cents(10_100) };
    });

    describe('and the amount is one cent under the 5% increment', () => {
      beforeEach(() => {
        input.amountCents = cents(10_604);
      });

      it('returns bid_below_minimum', () => {
        expect(findBidRuleViolation(input)?.error).toEqual(new InvalidValueError('bid_below_minimum'));
      });
    });

    describe('and the amount is exactly the 5% increment', () => {
      beforeEach(() => {
        input.amountCents = cents(10_605);
      });

      it('returns null', () => {
        expect(findBidRuleViolation(input)).toBeNull();
      });
    });
  });
});

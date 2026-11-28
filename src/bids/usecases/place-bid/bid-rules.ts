import { ConflictError, ForbiddenError, InvalidValueError, type DomainError } from '../../../common/domain-error';
import type { NormalizedEmail } from '../../../common/email';
import type { BidderId } from '../../../common/ids';
import type { Cents } from '../../../common/money';
import { minimumNextBidCents } from '../../bid-increment';
import type { BidLeader, LockedAuction } from './place-bid.usecase.db';

export type BidRuleInput = {
  auction: LockedAuction;
  leading: BidLeader | null;
  bidder: { id: BidderId; email: NormalizedEmail };
  amountCents: Cents;
};

export type BidRuleViolation = { error: DomainError; detail: string };

export function findBidRuleViolation(input: BidRuleInput): BidRuleViolation | null {
  const { auction, leading, bidder, amountCents } = input;

  if (auction.status !== 'OPEN') {
    return { error: new ConflictError('auction_not_open'), detail: `auction is ${auction.status}` };
  }

  if (auction.closeAt <= auction.dbNow) {
    return { error: new ConflictError('auction_not_open'), detail: `closed at ${auction.closeAt.toISOString()}` };
  }

  if (auction.athleteBanned) {
    return { error: new ConflictError('auction_not_open'), detail: 'seller is banned' };
  }

  if (bidder.email === auction.athleteEmail) {
    return { error: new ForbiddenError('self_bid_not_allowed'), detail: `self-bid by bidder ${bidder.id}` };
  }

  if (leading !== null && leading.bidderId === bidder.id) {
    return { error: new ConflictError('already_leading'), detail: `bidder ${bidder.id} already leads` };
  }

  const minimum = minimumNextBidCents(leading === null ? null : leading.amountCents, auction.floorPriceCents);

  if (amountCents < minimum) {
    return {
      error: new InvalidValueError('bid_below_minimum'),
      detail: `bid of ${amountCents} cents is below the minimum of ${minimum}`,
    };
  }

  return null;
}

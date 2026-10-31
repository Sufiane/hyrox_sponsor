import type { AuctionId, BidderId, BidId } from '../common/ids';
import { cents } from '../common/money';
import { toPlaceBidResponse } from './place-bid-response';
import type { PlaceBidResult } from './usecases/place-bid/place-bid.usecase';

describe('toPlaceBidResponse', () => {
  const placedAt = new Date('2026-11-08T12:00:00Z');
  const closeAt = new Date('2026-11-09T06:00:00Z');

  function result(amount: number, previousLeader: PlaceBidResult['previousLeader'] = null): PlaceBidResult {
    return {
      bid: {
        id: 'bid-2' as BidId,
        auctionId: 'auction-1' as AuctionId,
        bidderId: 'bidder-2' as BidderId,
        amountCents: cents(amount),
        placedAt,
      },
      closeAt,
      previousLeader,
    };
  }

  describe('when the bid is under the $100 threshold', () => {
    it('adds the flat increment for the minimum next bid', () => {
      expect(toPlaceBidResponse(result(5_000)).minimumNextBidCents).toBe(5_500);
    });
  });

  describe('when the bid is at or above the $100 threshold', () => {
    it('adds the 5% increment at exactly $100', () => {
      expect(toPlaceBidResponse(result(10_000)).minimumNextBidCents).toBe(10_500);
    });

    it('rounds the 5% increment up above $100', () => {
      expect(toPlaceBidResponse(result(10_100)).minimumNextBidCents).toBe(10_605);
    });
  });

  describe('when mapping a result', () => {
    const previousLeader = { bidId: 'bid-1' as BidId, bidderId: 'bidder-1' as BidderId, amountCents: cents(4_000) };

    it('exposes exactly the public fields', () => {
      const response = toPlaceBidResponse(result(5_000, previousLeader));

      expect(Object.keys(response).sort()).toEqual([
        'amountCents',
        'auctionId',
        'bidId',
        'closeAt',
        'minimumNextBidCents',
        'placedAt',
        'status',
      ]);
    });

    it('reports the bid as LEADING', () => {
      expect(toPlaceBidResponse(result(5_000)).status).toBe('LEADING');
    });

    it('copies ids, amount and dates from the result', () => {
      expect(toPlaceBidResponse(result(5_000))).toMatchObject({
        bidId: 'bid-2',
        auctionId: 'auction-1',
        amountCents: 5_000,
        placedAt,
        closeAt,
      });
    });
  });
});

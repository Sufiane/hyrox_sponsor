import type { AuctionId, BidId } from '../common/ids';
import { addCents, type Cents } from '../common/money';
import { minimumIncrementCents } from './bid-increment';
import type { PlaceBidResult } from './usecases/place-bid/place-bid.usecase';

export type PlaceBidResponse = {
  bidId: BidId;
  auctionId: AuctionId;
  amountCents: Cents;
  status: 'LEADING';
  placedAt: Date;
  closeAt: Date;
  minimumNextBidCents: Cents;
};

export function toPlaceBidResponse(result: PlaceBidResult): PlaceBidResponse {
  const { bid } = result;

  return {
    bidId: bid.id,
    auctionId: bid.auctionId,
    amountCents: bid.amountCents,
    status: 'LEADING',
    placedAt: bid.placedAt,
    closeAt: result.closeAt,
    minimumNextBidCents: addCents(bid.amountCents, minimumIncrementCents(bid.amountCents)),
  };
}

import { Injectable } from '@nestjs/common';
import type { AuctionId } from '../common/ids';
import { BidDb } from './bid.db';
import {
  PlaceBidUsecase,
  type PlaceBidInput,
  type PlaceBidResult,
} from './usecases/place-bid/place-bid.usecase';

type BidRecord = Awaited<ReturnType<BidDb['findLeadingForAuction']>>;

@Injectable()
export class BidService {
  constructor(
    private readonly db: BidDb,
    private readonly placeBidUsecase: PlaceBidUsecase,
  ) {}

  getLeadingBid(auctionId: AuctionId): Promise<BidRecord> {
    return this.db.findLeadingForAuction(auctionId);
  }

  placeBid(input: PlaceBidInput): Promise<PlaceBidResult> {
    return this.placeBidUsecase.execute(input);
  }
}

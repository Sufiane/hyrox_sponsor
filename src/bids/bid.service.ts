import { Injectable } from '@nestjs/common';
import type { AuctionId } from '../common/ids';
import { BidDb } from './bid.db';

type BidRecord = Awaited<ReturnType<BidDb['findLeadingForAuction']>>;

@Injectable()
export class BidService {
  constructor(private readonly db: BidDb) {}

  getLeadingBid(auctionId: AuctionId): Promise<BidRecord> {
    return this.db.findLeadingForAuction(auctionId);
  }
}

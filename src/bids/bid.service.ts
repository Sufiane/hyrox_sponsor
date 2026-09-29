import { Injectable } from '@nestjs/common';
import type { AuctionId } from '../common/index.js';
import { BidDb } from './bid.db.js';

type BidRecord = Awaited<ReturnType<BidDb['findLeadingForAuction']>>;

@Injectable()
export class BidService {
  constructor(private readonly db: BidDb) {}

  getLeadingBid(auctionId: AuctionId): Promise<BidRecord> {
    return this.db.findLeadingForAuction(auctionId);
  }
}

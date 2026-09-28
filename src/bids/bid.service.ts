import { Injectable } from '@nestjs/common';
import { BidDb } from './bid.db.js';

type BidRecord = Awaited<ReturnType<BidDb['findLeadingForAuction']>>;

@Injectable()
export class BidService {
  constructor(private readonly db: BidDb) {}

  getLeadingBid(auctionId: string): Promise<BidRecord> {
    return this.db.findLeadingForAuction(auctionId);
  }
}

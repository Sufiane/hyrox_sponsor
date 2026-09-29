import { Injectable } from '@nestjs/common';
import { BidderDb } from './bidder.db.js';

type BidderRecord = Awaited<ReturnType<BidderDb['upsertByEmail']>>;

@Injectable()
export class BidderService {
  constructor(private readonly db: BidderDb) {}

  getOrCreateByEmail(email: string): Promise<BidderRecord> {
    return this.db.upsertByEmail(email.trim().toLowerCase());
  }
}

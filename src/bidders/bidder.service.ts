import { Injectable } from '@nestjs/common';
import { normalizeEmail } from '../common/email.js';
import { BidderDb } from './bidder.db.js';

type BidderRecord = Awaited<ReturnType<BidderDb['upsertByEmail']>>;

@Injectable()
export class BidderService {
  constructor(private readonly db: BidderDb) {}

  getOrCreateByEmail(rawEmail: string): Promise<BidderRecord> {
    return this.db.upsertByEmail(normalizeEmail(rawEmail));
  }
}

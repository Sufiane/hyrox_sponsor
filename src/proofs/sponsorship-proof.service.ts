import { Injectable } from '@nestjs/common';
import type { AuctionId } from '../common/ids';
import { SponsorshipProofDb } from './sponsorship-proof.db';

type SponsorshipProofRecord = NonNullable<Awaited<ReturnType<SponsorshipProofDb['findByAuctionId']>>>;

@Injectable()
export class SponsorshipProofService {
  constructor(private readonly db: SponsorshipProofDb) {}

  getByAuctionId(auctionId: AuctionId): Promise<SponsorshipProofRecord | null> {
    return this.db.findByAuctionId(auctionId);
  }
}

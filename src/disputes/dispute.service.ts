import { Injectable } from '@nestjs/common';
import type { AuctionId } from '../common/ids';
import { DisputeDb } from './dispute.db';

@Injectable()
export class DisputeService {
  constructor(private readonly db: DisputeDb) {}

  async hasOpenDispute(auctionId: AuctionId): Promise<boolean> {
    const dispute = await this.db.findOpenForAuction(auctionId);

    return dispute !== null;
  }
}

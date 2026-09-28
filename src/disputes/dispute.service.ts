import { Injectable } from '@nestjs/common';
import { DisputeDb } from './dispute.db.js';

@Injectable()
export class DisputeService {
  constructor(private readonly db: DisputeDb) {}

  async hasOpenDispute(auctionId: string): Promise<boolean> {
    const dispute = await this.db.findOpenForAuction(auctionId);

    return dispute !== null;
  }
}

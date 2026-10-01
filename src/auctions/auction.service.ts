import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuctionId } from '../common/ids.js';
import { AuctionDb } from './auction.db.js';

type AuctionRecord = NonNullable<Awaited<ReturnType<AuctionDb['findById']>>>;

@Injectable()
export class AuctionService {
  private readonly logger = new Logger(AuctionService.name);

  constructor(private readonly db: AuctionDb) {}

  async getById(id: AuctionId): Promise<AuctionRecord> {
    const auction = await this.db.findById(id);

    if (!auction) {
      this.logger.warn(`Auction ${id} not found`);

      throw new NotFoundException('auction_not_found');
    }

    return auction;
  }
}

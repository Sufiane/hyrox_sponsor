import { Injectable, NotFoundException } from '@nestjs/common';
import { AuctionDb } from './auction.db.js';

type AuctionRecord = NonNullable<Awaited<ReturnType<AuctionDb['findById']>>>;

@Injectable()
export class AuctionService {
  constructor(private readonly db: AuctionDb) {}

  async getById(id: string): Promise<AuctionRecord> {
    const auction = await this.db.findById(id);

    if (!auction) {
      throw new NotFoundException(`Auction ${id} not found`);
    }

    return auction;
  }
}

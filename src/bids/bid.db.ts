import { Injectable } from '@nestjs/common';
import type { AuctionId } from '../common/index.js';
import { Bid } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BidDb {
  constructor(private readonly prisma: PrismaService) {}

  findLeadingForAuction(auctionId: AuctionId): Promise<Bid | null> {
    return this.prisma.bid.findFirst({
      where: { auctionId, status: 'LEADING' },
    });
  }
}

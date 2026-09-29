import { Injectable } from '@nestjs/common';
import type { AuctionId } from '../common/index.js';
import { Dispute } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DisputeDb {
  constructor(private readonly prisma: PrismaService) {}

  findOpenForAuction(auctionId: AuctionId): Promise<Dispute | null> {
    return this.prisma.dispute.findFirst({ where: { auctionId, status: { in: ['OPEN', 'ARBITRATION'] } } });
  }
}

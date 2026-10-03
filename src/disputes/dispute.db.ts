import { Injectable } from '@nestjs/common';
import type { AuctionId } from '../common/ids';
import { Dispute } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DisputeDb {
  constructor(private readonly prisma: PrismaService) {}

  findOpenForAuction(auctionId: AuctionId): Promise<Dispute | null> {
    return this.prisma.dispute.findFirst({ where: { auctionId, status: { in: ['OPEN', 'ARBITRATION'] } } });
  }
}

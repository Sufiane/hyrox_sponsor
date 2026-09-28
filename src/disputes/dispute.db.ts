import { Injectable } from '@nestjs/common';
import { Dispute } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DisputeDb {
  constructor(private readonly prisma: PrismaService) {}

  findOpenForAuction(auctionId: string): Promise<Dispute | null> {
    return this.prisma.dispute.findFirst({ where: { auctionId, status: 'OPEN' } });
  }
}

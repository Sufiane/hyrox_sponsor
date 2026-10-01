import { Injectable } from '@nestjs/common';
import type { BidId } from '../common/ids.js';
import { EscrowTransaction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class EscrowTransactionDb {
  constructor(private readonly prisma: PrismaService) {}

  findLatestForBid(bidId: BidId): Promise<EscrowTransaction | null> {
    return this.prisma.escrowTransaction.findFirst({
      where: { bidId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
}

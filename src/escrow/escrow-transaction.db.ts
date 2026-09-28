import { Injectable } from '@nestjs/common';
import { EscrowTransaction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class EscrowTransactionDb {
  constructor(private readonly prisma: PrismaService) {}

  findActiveAuthorizationForBid(bidId: string): Promise<EscrowTransaction | null> {
    return this.prisma.escrowTransaction.findFirst({
      where: { bidId, type: 'AUTHORIZED' },
      orderBy: { createdAt: 'desc' },
    });
  }
}

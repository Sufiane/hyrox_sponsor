import { Injectable } from '@nestjs/common';
import type { BidId } from '../common/ids';
import type { Cents } from '../common/money';
import type { StripePaymentIntentId } from '../common/stripe-ids';
import { EscrowTransaction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type HoldRelease = { bidId: BidId; paymentIntentId: StripePaymentIntentId; amountCents: Cents };

@Injectable()
export class EscrowTransactionDb {
  constructor(private readonly prisma: PrismaService) {}

  findLatestForBid(bidId: BidId): Promise<EscrowTransaction | null> {
    return this.prisma.escrowTransaction.findFirst({
      where: { bidId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async recordVoided(release: HoldRelease): Promise<void> {
    await this.prisma.escrowTransaction.createMany({
      data: [
        {
          bidId: release.bidId,
          stripePaymentIntentId: release.paymentIntentId,
          type: 'VOIDED',
          amountCents: release.amountCents,
        },
      ],
      skipDuplicates: true,
    });
  }
}

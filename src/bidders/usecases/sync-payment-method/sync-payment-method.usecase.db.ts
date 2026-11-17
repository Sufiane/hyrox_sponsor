import { Injectable } from '@nestjs/common';
import { Bidder } from '@prisma/client';
import type { StripeCustomerId, StripePaymentMethodId } from '../../../common/stripe-ids';
import { PrismaService } from '../../../prisma/prisma.service';

export type SaveFirstCardInput = {
  customerId: StripeCustomerId;
  paymentMethodId: StripePaymentMethodId;
  brand: string;
  last4: string;
};

@Injectable()
export class SyncPaymentMethodUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  findByStripeCustomerId(customerId: StripeCustomerId): Promise<Bidder | null> {
    return this.prisma.bidder.findUnique({ where: { stripeCustomerId: customerId } });
  }

  async saveFirstCard(input: SaveFirstCardInput): Promise<boolean> {
    const result = await this.prisma.bidder.updateMany({
      where: { stripeCustomerId: input.customerId, defaultPaymentMethodId: null },
      data: {
        defaultPaymentMethodId: input.paymentMethodId,
        cardBrand: input.brand,
        cardLast4: input.last4,
        tokenVersion: { increment: 1 },
      },
    });

    return result.count > 0;
  }
}

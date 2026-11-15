import { Injectable } from '@nestjs/common';
import { Bidder } from '@prisma/client';
import type { NormalizedEmail } from '../../../common/email';
import type { BidderId } from '../../../common/ids';
import type { StripeCustomerId } from '../../../common/stripe-ids';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class CreatePaymentSetupUsecaseDb {
  constructor(private readonly prisma: PrismaService) {}

  upsertByEmail(email: NormalizedEmail): Promise<Bidder> {
    return this.prisma.bidder.upsert({
      where: { email },
      create: { email },
      update: {},
    });
  }

  findById(id: BidderId): Promise<Bidder | null> {
    return this.prisma.bidder.findUnique({ where: { id } });
  }

  async setStripeCustomerIdIfUnset(id: BidderId, stripeCustomerId: StripeCustomerId): Promise<Bidder | null> {
    await this.prisma.bidder.updateMany({
      where: { id, stripeCustomerId: null },
      data: { stripeCustomerId },
    });

    return this.prisma.bidder.findUnique({ where: { id } });
  }
}

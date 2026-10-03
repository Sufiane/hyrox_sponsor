import { Injectable } from '@nestjs/common';
import type { NormalizedEmail } from '../common/email';
import type { BidderId } from '../common/ids';
import type { StripeCustomerId } from '../common/stripe-ids';
import { Bidder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BidderDb {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: BidderId): Promise<Bidder | null> {
    return this.prisma.bidder.findUnique({ where: { id } });
  }

  findByEmail(email: NormalizedEmail): Promise<Bidder | null> {
    return this.prisma.bidder.findUnique({ where: { email } });
  }

  upsertByEmail(email: NormalizedEmail): Promise<Bidder> {
    return this.prisma.bidder.upsert({
      where: { email },
      create: { email },
      update: {},
    });
  }

  async setStripeCustomerIdIfUnset(id: BidderId, stripeCustomerId: StripeCustomerId): Promise<Bidder | null> {
    await this.prisma.bidder.updateMany({
      where: { id, stripeCustomerId: null },
      data: { stripeCustomerId },
    });

    return this.prisma.bidder.findUnique({ where: { id } });
  }
}

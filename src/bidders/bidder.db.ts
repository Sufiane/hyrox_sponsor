import { Injectable } from '@nestjs/common';
import type { NormalizedEmail } from '../common/email';
import { Bidder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BidderDb {
  constructor(private readonly prisma: PrismaService) {}

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
}

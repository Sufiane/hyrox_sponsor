import { Injectable } from '@nestjs/common';
import { Bidder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BidderDb {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<Bidder | null> {
    return this.prisma.bidder.findUnique({ where: { email } });
  }

  upsertByEmail(email: string): Promise<Bidder> {
    return this.prisma.bidder.upsert({
      where: { email },
      create: { email },
      update: {},
    });
  }
}

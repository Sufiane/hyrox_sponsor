import { Injectable } from '@nestjs/common';
import type { AuctionId } from '../common/ids';
import { Auction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuctionDb {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: AuctionId): Promise<Auction | null> {
    return this.prisma.auction.findUnique({ where: { id } });
  }
}

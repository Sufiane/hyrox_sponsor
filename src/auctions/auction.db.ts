import { Injectable } from '@nestjs/common';
import { Auction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuctionDb {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Auction | null> {
    return this.prisma.auction.findUnique({ where: { id } });
  }
}

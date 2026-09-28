import { Injectable } from '@nestjs/common';
import { SponsorshipProof } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class SponsorshipProofDb {
  constructor(private readonly prisma: PrismaService) {}

  findByAuctionId(auctionId: string): Promise<SponsorshipProof | null> {
    return this.prisma.sponsorshipProof.findUnique({ where: { auctionId } });
  }
}

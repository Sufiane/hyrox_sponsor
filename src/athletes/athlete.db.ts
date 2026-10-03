import { Injectable } from '@nestjs/common';
import type { AthleteId } from '../common/ids';
import { Athlete } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AthleteDb {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: AthleteId): Promise<Athlete | null> {
    return this.prisma.athlete.findUnique({ where: { id } });
  }
}

import { Injectable } from '@nestjs/common';
import type { RaceId } from '../common/index.js';
import { Race } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RaceDb {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: RaceId): Promise<Race | null> {
    return this.prisma.race.findUnique({ where: { id } });
  }
}

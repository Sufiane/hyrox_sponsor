import { Injectable } from '@nestjs/common';
import { Race } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RaceDb {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Race | null> {
    return this.prisma.race.findUnique({ where: { id } });
  }
}
